use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use base64::Engine;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptImage {
    pub data: String,
    pub mime_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GlobalSessionSummary {
    pub session_id: String,
    pub title: String,
    pub updated_at: i64,
    pub cwd: Option<String>,
    pub recap: Option<String>,
    pub bound_account: Option<String>,
    pub bound_provider: Option<String>,
    pub has_entity_file: bool,
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct TranscriptStats {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub user_message_count: usize,
    pub assistant_message_count: usize,
    pub tool_call_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    pub result: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TranscriptMessage {
    pub id: String,
    pub role: String,
    pub timestamp: Option<String>,
    pub text: Option<String>,
    pub thinking: Option<String>,
    pub tool_calls: Vec<TranscriptToolCall>,
    pub images: Vec<TranscriptImage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionTranscript {
    pub session_id: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub model: Option<String>,
    pub bound_account: Option<String>,
    pub bound_provider: Option<String>,
    pub stats: TranscriptStats,
    pub messages: Vec<TranscriptMessage>,
}

pub fn get_omp_agent_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".omp").join("agent"))
        .ok_or_else(|| "Could not determine user home directory".to_string())
}

fn resolve_blob_image(omp_dir: &Path, blob_ref: &str) -> Option<String> {
    if !blob_ref.starts_with("blob:sha256:") {
        return None;
    }
    let hash = blob_ref.trim_start_matches("blob:sha256:");
    let blobs_dir = omp_dir.join("blobs");
    let candidates = [
        blobs_dir.join(hash),
        blobs_dir.join(format!("{}.webp", hash)),
        blobs_dir.join(format!("{}.png", hash)),
        blobs_dir.join(format!("{}.jpg", hash)),
        blobs_dir.join(format!("{}.jpeg", hash)),
    ];
    for p in &candidates {
        if p.is_file() {
            if let Ok(bytes) = std::fs::read(p) {
                return Some(base64::prelude::BASE64_STANDARD.encode(&bytes));
            }
        }
    }
    None
}

pub fn escape_cwd(cwd: &str) -> String {
    if cwd.is_empty() {
        return "-".to_string();
    }
    let s = cwd.trim();
    if s.len() >= 2 && s.as_bytes()[1] == b':' {
        let drive = &s[..1];
        let rest = s[2..].replace(['\\', '/'], "-").trim_matches('-').to_string();
        format!("--{}--{}--", drive, rest)
    } else {
        s.replace(['\\', '/'], "-")
    }
}

pub fn find_session_file(sessions_dir: &Path, session_id: &str, cwd: Option<&str>) -> Option<PathBuf> {
    let suffix = format!("_{}.jsonl", session_id);

    // 1. Direct path check if cwd provided
    if let Some(c) = cwd {
        let escaped = escape_cwd(c);
        let target_dir = sessions_dir.join(escaped);
        if target_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&target_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.ends_with(&suffix) {
                                return Some(path);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Global search across all subdirectories in sessions
    if sessions_dir.is_dir() {
        if let Ok(dirs) = std::fs::read_dir(sessions_dir) {
            for dir_entry in dirs.flatten() {
                let dir_path = dir_entry.path();
                if dir_path.is_dir() {
                    if let Ok(files) = std::fs::read_dir(&dir_path) {
                        for file_entry in files.flatten() {
                            let path = file_entry.path();
                            if path.is_file() {
                                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                                    if name.ends_with(&suffix) {
                                        return Some(path);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

pub fn query_global_sessions() -> Result<Vec<GlobalSessionSummary>, String> {
    let omp_dir = get_omp_agent_dir()?;
    let history_db_path = omp_dir.join("history.db");
    let agent_db_path = omp_dir.join("agent.db");
    let sessions_dir = omp_dir.join("sessions");

    if !history_db_path.exists() {
        return Ok(Vec::new());
    }

    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;

    // 1. Query sticky credentials from agent.db
    let mut sticky_map: HashMap<String, (String, Option<String>)> = HashMap::new(); // session_id -> (account, provider)
    if agent_db_path.exists() {
        if let Ok(agent_conn) = Connection::open_with_flags(&agent_db_path, flags) {
            let _ = agent_conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");

            // Cache auth_credentials: id -> (identity_key, provider)
            let mut cred_map: HashMap<i64, (String, String)> = HashMap::new();
            if let Ok(mut stmt) = agent_conn.prepare("SELECT id, provider, identity_key FROM auth_credentials") {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                }) {
                    for r in rows.flatten() {
                        cred_map.insert(r.0, (r.2, r.1));
                    }
                }
            }

            // Query cache for session:sticky:
            if let Ok(mut stmt) = agent_conn.prepare("SELECT key, value FROM cache WHERE key LIKE 'session:sticky:%'") {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for r in rows.flatten() {
                        let parts: Vec<&str> = r.0.split(':').collect();
                        if parts.len() >= 4 {
                            let session_id = parts[3].to_string();
                            let provider_hint = parts[2].to_string();
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&r.1) {
                                if let Some(cred_id) = v.get("credentialId").and_then(|c| c.as_i64()) {
                                    if let Some((identity, provider)) = cred_map.get(&cred_id) {
                                        let clean_identity = identity.trim_start_matches("email:").to_string();
                                        sticky_map.insert(session_id, (clean_identity, Some(provider.clone())));
                                    }
                                } else {
                                    sticky_map.insert(session_id, ("默认 / 自动轮换".to_string(), Some(provider_hint)));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Query history.db
    let history_conn = Connection::open_with_flags(&history_db_path, flags)
        .map_err(|e| format!("Failed to open history.db: {}", e))?;
    let _ = history_conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");

    let query = "
        SELECT 
            t.session_id,
            t.title,
            t.updated_at,
            COALESCE(r.cwd, h.cwd) as cwd,
            r.recap
        FROM session_titles t
        LEFT JOIN (
            SELECT session_id, cwd, recap, MAX(created_at) as max_c
            FROM session_recaps
            GROUP BY session_id
        ) r ON t.session_id = r.session_id
        LEFT JOIN (
            SELECT session_id, cwd, MAX(created_at) as max_h
            FROM history
            WHERE cwd IS NOT NULL
            GROUP BY session_id
        ) h ON t.session_id = h.session_id
        ORDER BY t.updated_at DESC;
    ";

    let mut stmt = history_conn.prepare(query)
        .map_err(|e| format!("Failed to prepare history query: {}", e))?;

    let session_rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    }).map_err(|e| format!("Failed to execute history query: {}", e))?;

    let mut summaries = Vec::new();
    for r in session_rows.flatten() {
        let session_id = r.0;
        let title = r.1;
        let updated_at = r.2;
        let cwd = r.3;
        let recap = r.4;

        let (bound_account, bound_provider) = if let Some((acc, prov)) = sticky_map.get(&session_id) {
            (Some(acc.clone()), prov.clone())
        } else {
            (Some("默认 / 自动轮换".to_string()), None)
        };

        let file_path = find_session_file(&sessions_dir, &session_id, cwd.as_deref());
        let has_entity_file = file_path.is_some();
        let file_path_str = file_path.map(|p| p.to_string_lossy().to_string());

        summaries.push(GlobalSessionSummary {
            session_id,
            title,
            updated_at,
            cwd,
            recap,
            bound_account,
            bound_provider,
            has_entity_file,
            file_path: file_path_str,
        });
    }

    Ok(summaries)
}

pub fn parse_session_transcript(
    session_id: &str,
    cwd: Option<&str>,
    file_path: Option<&str>,
) -> Result<SessionTranscript, String> {
    let omp_dir = get_omp_agent_dir()?;
    let sessions_dir = omp_dir.join("sessions");

    let target_path = if let Some(fp) = file_path {
        let p = PathBuf::from(fp);
        if p.exists() {
            p
        } else {
            find_session_file(&sessions_dir, session_id, cwd)
                .ok_or_else(|| format!("Session entity file not found for {}", session_id))?
        }
    } else {
        find_session_file(&sessions_dir, session_id, cwd)
            .ok_or_else(|| format!("Session entity file not found for {}", session_id))?
    };

    let file = File::open(&target_path)
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);

    let mut model: Option<String> = None;
    let mut title: Option<String> = None;
    let mut resolved_cwd: Option<String> = cwd.map(|s| s.to_string());
    let mut stats = TranscriptStats::default();

    let mut messages: Vec<TranscriptMessage> = Vec::new();
    let mut tool_call_index_map: HashMap<String, (usize, usize)> = HashMap::new(); // tool_call_id -> (message_idx, tool_call_idx)

    for line_res in reader.lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let entry: serde_json::Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match entry_type {
            "title" | "title_change" => {
                if let Some(t) = entry.get("title").and_then(|s| s.as_str()) {
                    title = Some(t.to_string());
                }
            }
            "session" => {
                if let Some(c) = entry.get("cwd").and_then(|s| s.as_str()) {
                    if resolved_cwd.is_none() {
                        resolved_cwd = Some(c.to_string());
                    }
                }
                if let Some(t) = entry.get("title").and_then(|s| s.as_str()) {
                    if title.is_none() {
                        title = Some(t.to_string());
                    }
                }
            }
            "model_change" => {
                if let Some(m) = entry.get("model").and_then(|s| s.as_str()) {
                    model = Some(m.to_string());
                }
            }
            "message" => {
                if let Some(msg_obj) = entry.get("message") {
                    let role = msg_obj.get("role").and_then(|r| r.as_str()).unwrap_or("");
                    let timestamp = entry.get("timestamp").and_then(|t| t.as_str()).map(|s| s.to_string());
                    let msg_id = entry.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string();

                    // Accumulate usage
                    if let Some(usage) = msg_obj.get("usage") {
                        stats.input_tokens += usage.get("input").and_then(|v| v.as_i64()).unwrap_or(0);
                        stats.output_tokens += usage.get("output").and_then(|v| v.as_i64()).unwrap_or(0);
                        stats.total_tokens += usage.get("totalTokens").and_then(|v| v.as_i64()).unwrap_or(0);
                        if let Some(cost) = usage.get("cost") {
                            stats.cost_usd += cost.get("total").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        }
                    }

                    if role == "user" {
                        stats.user_message_count += 1;
                        let mut text = String::new();
                        let mut images = Vec::new();
                        if let Some(content_arr) = msg_obj.get("content").and_then(|c| c.as_array()) {
                            for chunk in content_arr {
                                let ctype = chunk.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                if ctype == "text" {
                                    if let Some(t) = chunk.get("text").and_then(|s| s.as_str()) {
                                        text.push_str(t);
                                    }
                                } else if ctype == "image" {
                                    let mime = chunk.get("mimeType").and_then(|m| m.as_str()).unwrap_or("image/png").to_string();
                                    let raw_d = chunk.get("data").and_then(|d| d.as_str()).unwrap_or("");
                                    if raw_d.starts_with("blob:sha256:") {
                                        if let Some(b64) = resolve_blob_image(&omp_dir, raw_d) {
                                            images.push(TranscriptImage { data: b64, mime_type: mime });
                                        }
                                    } else if !raw_d.is_empty() {
                                        images.push(TranscriptImage { data: raw_d.to_string(), mime_type: mime });
                                    }
                                }
                            }
                        }
                        messages.push(TranscriptMessage {
                            id: msg_id,
                            role: "user".to_string(),
                            timestamp,
                            text: if text.is_empty() { None } else { Some(text) },
                            thinking: None,
                            tool_calls: Vec::new(),
                            images,
                        });
                    } else if role == "assistant" {
                        stats.assistant_message_count += 1;
                        let mut text = String::new();
                        let mut thinking = String::new();
                        let mut tool_calls = Vec::new();

                        if let Some(content_arr) = msg_obj.get("content").and_then(|c| c.as_array()) {
                            for chunk in content_arr {
                                match chunk.get("type").and_then(|t| t.as_str()) {
                                    Some("text") => {
                                        if let Some(t) = chunk.get("text").and_then(|s| s.as_str()) {
                                            text.push_str(t);
                                        }
                                    }
                                    Some("thinking") => {
                                        if let Some(t) = chunk.get("thinking").and_then(|s| s.as_str()) {
                                            thinking.push_str(t);
                                        }
                                    }
                                    Some("toolCall") => {
                                        stats.tool_call_count += 1;
                                        let call_id = chunk.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                        let call_name = chunk.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                        let call_args = chunk.get("arguments").cloned().unwrap_or(serde_json::Value::Null);

                                        let tc = TranscriptToolCall {
                                            id: call_id.clone(),
                                            name: call_name,
                                            arguments: call_args,
                                            result: None,
                                            is_error: false,
                                        };
                                        tool_calls.push(tc);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        let is_last_assistant = messages.last().map(|m| m.role == "assistant").unwrap_or(false);
                        if is_last_assistant {
                            let msg_idx = messages.len() - 1;
                            let last_msg = &mut messages[msg_idx];
                            if !text.is_empty() {
                                match &mut last_msg.text {
                                    Some(existing) => {
                                        existing.push_str("\n\n");
                                        existing.push_str(&text);
                                    }
                                    None => last_msg.text = Some(text),
                                }
                            }
                            if !thinking.is_empty() {
                                match &mut last_msg.thinking {
                                    Some(existing) => {
                                        existing.push_str("\n\n");
                                        existing.push_str(&thinking);
                                    }
                                    None => last_msg.thinking = Some(thinking),
                                }
                            }
                            for tc in tool_calls {
                                let tc_idx = last_msg.tool_calls.len();
                                tool_call_index_map.insert(tc.id.clone(), (msg_idx, tc_idx));
                                last_msg.tool_calls.push(tc);
                            }
                        } else {
                            let msg_idx = messages.len();
                            for (tc_idx, tc) in tool_calls.iter().enumerate() {
                                tool_call_index_map.insert(tc.id.clone(), (msg_idx, tc_idx));
                            }
                            messages.push(TranscriptMessage {
                                id: msg_id,
                                role: "assistant".to_string(),
                                timestamp,
                                text: if text.is_empty() { None } else { Some(text) },
                                thinking: if thinking.is_empty() { None } else { Some(thinking) },
                                tool_calls,
                                images: Vec::new(),
                            });
                        }
                    } else if role == "toolResult" {
                        let tool_call_id = msg_obj.get("toolCallId").and_then(|s| s.as_str()).unwrap_or("");
                        let is_error = msg_obj.get("isError").and_then(|b| b.as_bool()).unwrap_or(false);
                        let mut result_text = String::new();
                        if let Some(content_arr) = msg_obj.get("content").and_then(|c| c.as_array()) {
                            for chunk in content_arr {
                                if let Some(t) = chunk.get("text").and_then(|s| s.as_str()) {
                                    result_text.push_str(t);
                                }
                            }
                        }

                        if let Some(&(msg_idx, tc_idx)) = tool_call_index_map.get(tool_call_id) {
                            if let Some(m) = messages.get_mut(msg_idx) {
                                if let Some(tc) = m.tool_calls.get_mut(tc_idx) {
                                    tc.result = Some(result_text);
                                    tc.is_error = is_error;
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(SessionTranscript {
        session_id: session_id.to_string(),
        title,
        cwd: resolved_cwd,
        model,
        bound_account: None,
        bound_provider: None,
        stats,
        messages,
    })
}

pub fn delete_session_file(session_id: &str, cwd: Option<&str>, file_path: Option<&str>) -> Result<(), String> {
    let omp_dir = get_omp_agent_dir()?;
    let sessions_dir = omp_dir.join("sessions");

    let target_path = if let Some(fp) = file_path {
        let p = PathBuf::from(fp);
        if p.exists() {
            Some(p)
        } else {
            find_session_file(&sessions_dir, session_id, cwd)
        }
    } else {
        find_session_file(&sessions_dir, session_id, cwd)
    };

    if let Some(p) = target_path {
        if p.exists() {
            let _ = std::fs::remove_file(p);
        }
    }

    Ok(())
}

pub fn delete_workspace_folder(cwd: &str) -> Result<(), String> {
    let omp_dir = get_omp_agent_dir()?;
    let sessions_dir = omp_dir.join("sessions");
    let escaped = escape_cwd(cwd);
    let target_dir = sessions_dir.join(escaped);
    if target_dir.exists() && target_dir.is_dir() {
        let _ = std::fs::remove_dir_all(target_dir);
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OmpSlashCommand {
    pub name: String,
    pub description: String,
    pub hint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PromptSuggestion {
    pub label: String,
    pub prompt: String,
    pub icon: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OmpModelConfigResponse {
    pub default_model_id: String,
    pub default_thinking_level: String,
    pub default_cwd: String,
    pub models: Vec<OmpModelItem>,
    pub thinking_levels: Vec<OmpThinkingItem>,
    pub commands: Vec<OmpSlashCommand>,
    pub prompt_suggestions: Vec<PromptSuggestion>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OmpModelItem {
    pub model_id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OmpThinkingItem {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

pub fn query_omp_models_and_config() -> Result<OmpModelConfigResponse, String> {
    let omp_dir = get_omp_agent_dir()?;
    let config_yml_path = omp_dir.join("config.yml");
    let agent_db_path = omp_dir.join("agent.db");
    let models_db_path = omp_dir.join("models.db");

    let mut default_model_id = String::new();
    let mut default_thinking_level = String::new();
    let default_cwd = std::env::temp_dir().to_string_lossy().to_string();

    // 1. Read config.yml
    if config_yml_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_yml_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("default:") {
                    let val = trimmed.trim_start_matches("default:").trim();
                    let parts: Vec<&str> = val.split(':').collect();
                    if !parts.is_empty() && !parts[0].is_empty() {
                        default_model_id = parts[0].to_string();
                    }
                    if parts.len() > 1 && !parts[1].is_empty() {
                        default_thinking_level = parts[1].to_string();
                    }
                } else if trimmed.starts_with("defaultThinkingLevel:") {
                    let lvl = trimmed.trim_start_matches("defaultThinkingLevel:").trim();
                    if !lvl.is_empty() && default_thinking_level.is_empty() {
                        default_thinking_level = lvl.to_string();
                    }
                }
            }
        }
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;

    // 2. Read active providers from agent.db
    let mut active_providers: Vec<String> = Vec::new();
    if agent_db_path.exists() {
        if let Ok(agent_conn) = Connection::open_with_flags(&agent_db_path, flags) {
            let _ = agent_conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
            if let Ok(mut stmt) = agent_conn.prepare("SELECT DISTINCT provider FROM auth_credentials") {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    for r in rows.flatten() {
                        active_providers.push(r);
                    }
                }
            }
        }
    }

    if default_model_id.contains('/') {
        if let Some(prov) = default_model_id.split('/').next() {
            if !active_providers.iter().any(|p| p == prov) {
                active_providers.push(prov.to_string());
            }
        }
    }

    // 3. Read models from models.db
    let mut models = Vec::new();
    let thinking_efforts: Vec<String> = vec![
        "off".to_string(),
        "minimal".to_string(),
        "low".to_string(),
        "medium".to_string(),
        "high".to_string(),
        "max".to_string(),
    ];

    if models_db_path.exists() {
        if let Ok(mdb_conn) = Connection::open_with_flags(&models_db_path, flags) {
            let _ = mdb_conn.execute_batch("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
            if let Ok(mut stmt) = mdb_conn.prepare("SELECT provider_id, models FROM model_cache") {
                if let Ok(rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                }) {
                    for r in rows.flatten() {
                        let provider_id = r.0;
                        if !active_providers.is_empty() && !active_providers.contains(&provider_id) {
                            continue;
                        }
                        if let Ok(list) = serde_json::from_str::<serde_json::Value>(&r.1) {
                            if let Some(arr) = list.as_array() {
                                for m in arr {
                                    let id = m.get("id").and_then(|s| s.as_str()).unwrap_or("");
                                    if id.is_empty() || id.contains("preview") || id.contains("image") {
                                        continue;
                                    }
                                    let name = m.get("name").and_then(|s| s.as_str()).unwrap_or(id).to_string();
                                    let full_model_id = format!("{}/{}", provider_id, id);

                                    models.push(OmpModelItem {
                                        model_id: full_model_id,
                                        name,
                                        description: Some(provider_id.clone()),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let thinking_levels = thinking_efforts.into_iter().map(|eff| {
        let name = match eff.as_str() {
            "off" => "Off",
            "minimal" => "Minimal",
            "low" => "Low",
            "medium" => "Medium",
            "high" => "High",
            "max" => "Max",
            _ => "Auto",
        }.to_string();
        let desc = match eff.as_str() {
            "off" => "关闭深度思考",
            "minimal" => "极轻思考",
            "low" => "轻度思考",
            "medium" => "中度思考",
            "high" => "深度思考",
            "max" => "极限推理",
            _ => "自动",
        }.to_string();
        OmpThinkingItem {
            id: eff,
            name,
            description: Some(desc),
        }
    }).collect();

    if default_model_id.is_empty() && !models.is_empty() {
        default_model_id = models[0].model_id.clone();
    }
    if default_thinking_level.is_empty() {
        default_thinking_level = "auto".to_string();
    }

    // 4. Read installed skills dynamically from ~/.omp/agent/skills
    let skills_dir = omp_dir.join("skills");
    let mut commands = vec![
        OmpSlashCommand { name: "new".to_string(), description: "开启全新会话 (重置当前对话状态)".to_string(), hint: Some("[cwd]".to_string()) },
        OmpSlashCommand { name: "model".to_string(), description: "查看或切换当前使用的大语言模型".to_string(), hint: Some("[model-id]".to_string()) },
        OmpSlashCommand { name: "usage".to_string(), description: "查看账户使用配额与 Token 消耗统计".to_string(), hint: None },
        OmpSlashCommand { name: "switch".to_string(), description: "切换当前绑定的服务商或账号凭据".to_string(), hint: None },
        OmpSlashCommand { name: "login".to_string(), description: "登录或注册服务商凭据".to_string(), hint: None },
        OmpSlashCommand { name: "plan".to_string(), description: "生成多步任务执行计划".to_string(), hint: None },
        OmpSlashCommand { name: "queue".to_string(), description: "查看后台任务队列".to_string(), hint: None },
        OmpSlashCommand { name: "goal".to_string(), description: "设定当前终极目标".to_string(), hint: None },
    ];

    let mut installed_skills: Vec<(String, String)> = Vec::new();

    if skills_dir.exists() && skills_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let folder_name = entry.file_name().to_string_lossy().to_string();
                    let mut skill_name = folder_name.clone();
                    let mut skill_desc = String::new();

                    for candidate in &["SKILL.md", "skill.md", "README.md"] {
                        let doc_path = path.join(candidate);
                        if doc_path.exists() {
                            if let Ok(content) = std::fs::read_to_string(&doc_path) {
                                if content.starts_with("---") {
                                    let mut in_frontmatter = false;
                                    let mut in_desc = false;
                                    for line in content.lines() {
                                        let trimmed = line.trim();
                                        if trimmed == "---" {
                                            if in_frontmatter { break; }
                                            in_frontmatter = true;
                                            continue;
                                        }
                                        if in_frontmatter {
                                            if trimmed.starts_with("name:") {
                                                let n = trimmed.trim_start_matches("name:").trim();
                                                if !n.is_empty() {
                                                    skill_name = n.to_string();
                                                }
                                            } else if trimmed.starts_with("description:") {
                                                let d = trimmed.trim_start_matches("description:").trim();
                                                if d != "|" && d != ">" && !d.is_empty() {
                                                    skill_desc = d.to_string();
                                                } else {
                                                    in_desc = true;
                                                }
                                            } else if in_desc {
                                                if trimmed.contains(':') && !line.starts_with("  ") {
                                                    break;
                                                }
                                                if !trimmed.is_empty() {
                                                    if !skill_desc.is_empty() {
                                                        skill_desc.push(' ');
                                                    }
                                                    skill_desc.push_str(trimmed);
                                                }
                                            }
                                        }
                                    }
                                }
                                if skill_desc.is_empty() {
                                    for line in content.lines() {
                                        let trimmed = line.trim();
                                        if !trimmed.is_empty() && !trimmed.starts_with('#') && !trimmed.starts_with("---") {
                                            skill_desc = trimmed.to_string();
                                            break;
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }

                    if skill_desc.is_empty() {
                        skill_desc = format!("OMP 技能: {}", skill_name);
                    }

                    installed_skills.push((skill_name.clone(), skill_desc.clone()));
                    commands.push(OmpSlashCommand {
                        name: format!("skill:{}", skill_name),
                        description: skill_desc,
                        hint: None,
                    });
                }
            }
        }
    }

    // 5. Generate prompt suggestions based on installed skills and project context
    let mut prompt_suggestions = Vec::new();
    prompt_suggestions.push(PromptSuggestion {
        label: "分析项目架构与代码".to_string(),
        prompt: "请分析当前项目的架构设计与模块组织".to_string(),
        icon: Some("✦".to_string()),
    });
    prompt_suggestions.push(PromptSuggestion {
        label: "排查并修复代码潜在问题".to_string(),
        prompt: "帮我排查并修复当前代码中的潜在问题".to_string(),
        icon: Some("✦".to_string()),
    });
    prompt_suggestions.push(PromptSuggestion {
        label: "编写核心模块自动化测试".to_string(),
        prompt: "为核心模块编写自动化测试用例".to_string(),
        icon: Some("✦".to_string()),
    });
    for (s_name, _desc) in &installed_skills {
        let lower = s_name.to_lowercase();
        if lower == "paper-analyzer" {
            prompt_suggestions.push(PromptSuggestion {
                label: "论文深度解析与长文生成".to_string(),
                prompt: "/skill:paper-analyzer 深度解析当前论文的核心方法与图表".to_string(),
                icon: Some("📄".to_string()),
            });
        } else if lower == "ppt-master" || lower == "paper-deck" {
            prompt_suggestions.push(PromptSuggestion {
                label: "生成架构演示幻灯片".to_string(),
                prompt: "/skill:ppt-master 制作当前项目架构设计的精美演示胶片".to_string(),
                icon: Some("📊".to_string()),
            });
        }
    }

    Ok(OmpModelConfigResponse {
        default_model_id,
        default_thinking_level,
        default_cwd,
        models,
        thinking_levels,
        commands,
        prompt_suggestions,
    })
}
