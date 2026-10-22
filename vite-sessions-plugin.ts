import type { Plugin } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const ompDir = path.join(os.homedir(), '.omp', 'agent');
const historyDbPath = path.join(ompDir, 'history.db');
const agentDbPath = path.join(ompDir, 'agent.db');
const sessionsDir = path.join(ompDir, 'sessions');

function escapeCwd(cwd: string): string {
  if (!cwd) return '-';
  const s = cwd.trim();
  if (s.length >= 2 && s[1] === ':') {
    const drive = s[0];
    const rest = s.slice(2).replace(/[\\/]+/g, '-').replace(/^-+|-+$/g, '');
    return `--${drive}--${rest}--`;
  }
  return s.replace(/[\\/]+/g, '-');
}

function findSessionFile(sessionId: string, cwd?: string | null): string | null {
  const suffix = `_${sessionId}.jsonl`;

  if (cwd) {
    const targetDir = path.join(sessionsDir, escapeCwd(cwd));
    if (fs.existsSync(targetDir)) {
      const files = fs.readdirSync(targetDir);
      const match = files.find(f => f.endsWith(suffix));
      if (match) return path.join(targetDir, match);
    }
  }

  if (fs.existsSync(sessionsDir)) {
    const dirs = fs.readdirSync(sessionsDir);
    for (const d of dirs) {
      const dirPath = path.join(sessionsDir, d);
      if (fs.statSync(dirPath).isDirectory()) {
        const files = fs.readdirSync(dirPath);
        const match = files.find(f => f.endsWith(suffix));
        if (match) return path.join(dirPath, match);
      }
    }
  }

  return null;
}

function resolveBlobImageNode(blobRef: string): string | null {
  if (!blobRef.startsWith('blob:sha256:')) return null;
  const hash = blobRef.slice('blob:sha256:'.length);
  const blobsDir = path.join(ompDir, 'blobs');
  const candidates = [hash, `${hash}.webp`, `${hash}.png`, `${hash}.jpg`, `${hash}.jpeg`];
  for (const c of candidates) {
    const p = path.join(blobsDir, c);
    if (fs.existsSync(p)) {
      const buf = fs.readFileSync(p);
      return `data:image/png;base64,${buf.toString('base64')}`;
    }
  }
  return null;
}
function queryGlobalSessionsNode() {
  if (!fs.existsSync(historyDbPath)) return [];

  const stickyMap = new Map<string, { account: string; provider: string | null }>();
  if (fs.existsSync(agentDbPath)) {
    try {
      const adb = new DatabaseSync(agentDbPath, { readOnly: true });
      const credMap = new Map<number, { provider: string; identity: string }>();
      const credRows = adb.prepare('SELECT id, provider, identity_key FROM auth_credentials').all() as Array<{
        id: number;
        provider: string;
        identity_key: string;
      }>;
      for (const r of credRows) {
        credMap.set(r.id, { provider: r.provider, identity: r.identity_key });
      }

      const stickyRows = adb.prepare("SELECT key, value FROM cache WHERE key LIKE 'session:sticky:%'").all() as Array<{
        key: string;
        value: string;
      }>;
      for (const r of stickyRows) {
        const parts = r.key.split(':');
        if (parts.length >= 4) {
          const sessionId = parts[3];
          const providerHint = parts[2];
          try {
            const v = JSON.parse(r.value);
            if (v.credentialId && credMap.has(v.credentialId)) {
              const c = credMap.get(v.credentialId)!;
              const cleanIdentity = c.identity.replace(/^email:/, '');
              stickyMap.set(sessionId, { account: cleanIdentity, provider: c.provider });
            } else {
              stickyMap.set(sessionId, { account: '默认 / 自动轮换', provider: providerHint });
            }
          } catch {}
        }
      }
      adb.close();
    } catch (e) {
      console.warn('agent.db read error:', e);
    }
  }

  const hdb = new DatabaseSync(historyDbPath, { readOnly: true });
  const query = `
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
  `;

  const rows = hdb.prepare(query).all() as Array<{
    session_id: string;
    title: string;
    updated_at: number;
    cwd: string | null;
    recap: string | null;
  }>;
  hdb.close();

  return rows.map((r) => {
    const sticky = stickyMap.get(r.session_id);
    const filePath = findSessionFile(r.session_id, r.cwd);
    return {
      session_id: r.session_id,
      title: r.title,
      updated_at: r.updated_at,
      cwd: r.cwd || null,
      recap: r.recap || null,
      bound_account: sticky?.account || '默认 / 自动轮换',
      bound_provider: sticky?.provider || null,
      has_entity_file: !!filePath,
      file_path: filePath || null,
    };
  });
}

async function parseSessionTranscriptNode(
  sessionId: string,
  cwd?: string | null,
  filePath?: string | null
) {
  const targetPath = filePath && fs.existsSync(filePath)
    ? filePath
    : findSessionFile(sessionId, cwd);

  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error(`Session transcript file not found for ${sessionId}`);
  }

  const fileStream = fs.createReadStream(targetPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let model: string | null = null;
  let title: string | null = null;
  let resolvedCwd: string | null = cwd || null;
  const stats = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    user_message_count: 0,
    assistant_message_count: 0,
    tool_call_count: 0,
  };

  const messages: any[] = [];
  const toolCallIndexMap = new Map<string, { msgIdx: number; tcIdx: number }>();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      switch (entry.type) {
        case 'title':
        case 'title_change':
          if (entry.title) title = entry.title;
          break;
        case 'session':
          if (entry.cwd && !resolvedCwd) resolvedCwd = entry.cwd;
          if (entry.title && !title) title = entry.title;
          break;
        case 'model_change':
          if (entry.model) model = entry.model;
          break;
        case 'message': {
          const msg = entry.message;
          if (!msg) break;

          if (msg.usage) {
            stats.input_tokens += msg.usage.input || 0;
            stats.output_tokens += msg.usage.output || 0;
            stats.total_tokens += msg.usage.totalTokens || 0;
            if (msg.usage.cost?.total) stats.cost_usd += msg.usage.cost.total;
          }

          if (msg.role === 'user') {
            stats.user_message_count++;
            let text = '';
            const images: Array<{ data: string; mimeType: string }> = [];
            for (const c of msg.content || []) {
              if (c.type === 'text') text += c.text;
              if (c.type === 'image') {
                const mime = c.mimeType || 'image/png';
                const rawD = c.data || '';
                if (rawD.startsWith('blob:sha256:')) {
                  const dataUrl = resolveBlobImageNode(rawD);
                  if (dataUrl) images.push({ data: dataUrl, mimeType: mime });
                } else if (rawD) {
                  images.push({ data: rawD, mimeType: mime });
                }
              }
            }
            messages.push({
              id: entry.id || String(messages.length),
              role: 'user',
              timestamp: entry.timestamp,
              text: text || null,
              thinking: null,
              tool_calls: [],
              images,
            });
          } else if (msg.role === 'assistant') {
            stats.assistant_message_count++;
            let text = '';
            let thinking = '';
            const toolCalls: any[] = [];

            for (const c of msg.content || []) {
              if (c.type === 'text') text += c.text;
              if (c.type === 'thinking') thinking += c.thinking;
              if (c.type === 'toolCall') {
                stats.tool_call_count++;
                const tc = {
                  id: c.id,
                  name: c.name,
                  arguments: c.arguments,
                  result: null,
                  is_error: false,
                };
                toolCalls.push(tc);
              }
            }

            const last = messages[messages.length - 1];
            if (last && last.role === 'assistant') {
              if (text) last.text = (last.text ? last.text + '\n\n' : '') + text;
              if (thinking) last.thinking = (last.thinking ? last.thinking + '\n\n' : '') + thinking;
              const msgIdx = messages.length - 1;
              for (const tc of toolCalls) {
                const tcIdx = last.tool_calls.length;
                toolCallIndexMap.set(tc.id, { msgIdx, tcIdx });
                last.tool_calls.push(tc);
              }
            } else {
              const msgIdx = messages.length;
              for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
                toolCallIndexMap.set(toolCalls[tcIdx].id, { msgIdx, tcIdx });
              }
              messages.push({
                id: entry.id || String(messages.length),
                role: 'assistant',
                timestamp: entry.timestamp,
                text: text || null,
                thinking: thinking || null,
                tool_calls: toolCalls,
              });
            }
          } else if (msg.role === 'toolResult') {
            const loc = toolCallIndexMap.get(msg.toolCallId);
            if (loc && messages[loc.msgIdx]) {
              const tc = messages[loc.msgIdx].tool_calls[loc.tcIdx];
              if (tc) {
                let resText = '';
                for (const c of msg.content || []) {
                  if (c.type === 'text') resText += c.text;
                }
                tc.result = resText;
                tc.is_error = !!msg.isError;
              }
            }
          }
          break;
        }
      }
    } catch {}
  }

  return {
    session_id: sessionId,
    title,
    cwd: resolvedCwd,
    model,
    bound_account: null,
    bound_provider: null,
    stats,
    messages,
  };
}
function queryOmpModelsAndConfigNode() {
  let defaultModelId = '';
  let defaultThinkingLevel = '';
  const defaultCwd = os.tmpdir();

  const configYmlPath = path.join(ompDir, 'config.yml');
  if (fs.existsSync(configYmlPath)) {
    const raw = fs.readFileSync(configYmlPath, 'utf8');
    const defaultMatch = /default:\s*([^\s\n\r]+)/.exec(raw);
    if (defaultMatch) {
      const parts = defaultMatch[1].split(':');
      defaultModelId = parts[0];
      if (parts[1]) defaultThinkingLevel = parts[1];
    }
    const thinkMatch = /defaultThinkingLevel:\s*([^\s\n\r]+)/.exec(raw);
    if (thinkMatch && !defaultThinkingLevel) {
      defaultThinkingLevel = thinkMatch[1];
    }
  }

  const activeProviders = new Set<string>();
  if (fs.existsSync(agentDbPath)) {
    try {
      const adb = new DatabaseSync(agentDbPath, { readOnly: true });
      const rows = adb.prepare('SELECT DISTINCT provider FROM auth_credentials WHERE disabled_cause IS NULL').all() as Array<{ provider: string }>;
      for (const r of rows) activeProviders.add(r.provider);
      adb.close();
    } catch {}
  }
  if (defaultModelId && defaultModelId.includes('/')) {
    activeProviders.add(defaultModelId.split('/')[0]);
  }

  const models: Array<{ modelId: string; name: string; description: string }> = [];
  const thinkingEfforts = new Set<string>(['off', 'minimal', 'low', 'medium', 'high', 'max']);
  const mdbPath = path.join(ompDir, 'models.db');
  if (fs.existsSync(mdbPath)) {
    try {
      const mdb = new DatabaseSync(mdbPath, { readOnly: true });
      const rows = mdb.prepare('SELECT provider_id, models FROM model_cache').all() as Array<{ provider_id: string; models: string }>;
      for (const r of rows) {
        if (!activeProviders.has(r.provider_id) && activeProviders.size > 0) continue;
        try {
          const list = JSON.parse(r.models);
          for (const m of list) {
            if (m.id.includes('preview') || m.id.includes('image')) continue;
            const fullModelId = `${r.provider_id}/${m.id}`;
            models.push({
              modelId: fullModelId,
              name: m.name || m.id,
              description: r.provider_id,
            });
            if (m.thinking?.efforts) {
              for (const eff of m.thinking.efforts) {
                thinkingEfforts.add(eff);
              }
            }
          }
        } catch {}
      }
      mdb.close();
    } catch {}
  }

  if (!defaultModelId && models.length > 0) {
    defaultModelId = models[0].modelId;
  }
  if (!defaultThinkingLevel) {
    defaultThinkingLevel = 'auto';
  }

  const thinkingLevels = Array.from(thinkingEfforts).map((eff) => ({
    id: eff,
    name: eff.charAt(0).toUpperCase() + eff.slice(1),
    description: eff === 'off' ? '关闭深度思考' : `${eff} 思考强度`,
  }));

  // Read installed skills dynamically from ~/.omp/agent/skills
  const skillsDir = path.join(ompDir, 'skills');
  const commands = [
    { name: 'new', description: '开启全新会话 (重置当前对话状态)', hint: '[cwd]' },
    { name: 'model', description: '查看或切换当前使用的大语言模型', hint: '[model-id]' },
    { name: 'usage', description: '查看账户使用配额与 Token 消耗统计' },
    { name: 'switch', description: '切换当前绑定的服务商或账号凭据' },
    { name: 'login', description: '登录或注册服务商凭据' },
    { name: 'plan', description: '生成多步任务执行计划' },
    { name: 'queue', description: '查看后台任务队列' },
    { name: 'goal', description: '设定当前终极目标' },
  ];

  const installedSkills: Array<{ name: string; desc: string }> = [];
  if (fs.existsSync(skillsDir)) {
    try {
      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          let skillName = ent.name;
          let skillDesc = '';
          for (const cand of ['SKILL.md', 'skill.md', 'README.md']) {
            const docP = path.join(skillsDir, ent.name, cand);
            if (fs.existsSync(docP)) {
              try {
                const content = fs.readFileSync(docP, 'utf8');
                if (content.startsWith('---')) {
                  const lines = content.split('\n');
                  let inFm = false;
                  let inDesc = false;
                  for (const line of lines) {
                    const t = line.trim();
                    if (t === '---') {
                      if (inFm) break;
                      inFm = true;
                      continue;
                    }
                    if (inFm) {
                      if (t.startsWith('name:')) {
                        skillName = t.replace('name:', '').trim() || skillName;
                      } else if (t.startsWith('description:')) {
                        const d = t.replace('description:', '').trim();
                        if (d && d !== '|' && d !== '>') {
                          skillDesc = d;
                        } else {
                          inDesc = true;
                        }
                      } else if (inDesc) {
                        if (t.includes(':') && !line.startsWith('  ')) break;
                        if (t) {
                          skillDesc = (skillDesc ? skillDesc + ' ' : '') + t;
                        }
                      }
                    }
                  }
                }
                if (!skillDesc) {
                  const firstLine = content.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('---'));
                  if (firstLine) skillDesc = firstLine;
                }
              } catch {}
              break;
            }
          }
          if (!skillDesc) skillDesc = `OMP 技能: ${skillName}`;
          installedSkills.push({ name: skillName, desc: skillDesc });
          commands.push({
            name: `skill:${skillName}`,
            description: skillDesc,
          });
        }
      }
    } catch {}
  }

  const promptSuggestions = [
    {
      label: '分析项目架构与代码',
      prompt: '请分析当前项目的架构设计与模块组织',
      icon: '✦',
    },
    {
      label: '排查并修复代码潜在问题',
      prompt: '帮我排查并修复当前代码中的潜在问题',
      icon: '✦',
    },
    {
      label: '编写核心模块自动化测试',
      prompt: '为核心模块编写自动化测试用例',
      icon: '✦',
    },
  ];
  for (const s of installedSkills) {
    const lower = s.name.toLowerCase();
    if (lower === 'paper-analyzer') {
      promptSuggestions.push({
        label: '论文深度解析与长文生成',
        prompt: '/skill:paper-analyzer 深度解析当前论文的核心方法与图表',
        icon: '📄',
      });
    } else if (lower === 'ppt-master' || lower === 'paper-deck') {
      promptSuggestions.push({
        label: '生成架构演示幻灯片',
        prompt: '/skill:ppt-master 制作当前项目架构设计的精美演示胶片',
        icon: '📊',
      });
    }
  }

  return {
    default_model_id: defaultModelId,
    default_thinking_level: defaultThinkingLevel,
    default_cwd: defaultCwd,
    models,
    thinking_levels: thinkingLevels,
    commands,
    prompt_suggestions: promptSuggestions,
  };
}


export function ompSessionsPlugin(): Plugin {
  return {
    name: 'omp-sessions-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/omp-models-config') {
          try {
            const data = queryOmpModelsAndConfigNode();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        if (req.url === '/api/global-sessions') {
          try {
            const data = queryGlobalSessionsNode();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        if (req.url?.startsWith('/api/delete-session')) {
          const url = new URL(req.url, 'http://localhost');
          const sessionId = url.searchParams.get('sessionId') || '';
          const cwd = url.searchParams.get('cwd');
          const filePath = url.searchParams.get('filePath') || findSessionFile(sessionId, cwd);
          if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch {}
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.url?.startsWith('/api/delete-workspace')) {
          const url = new URL(req.url, 'http://localhost');
          const cwd = url.searchParams.get('cwd') || '';
          const targetDir = path.join(sessionsDir, escapeCwd(cwd));
          if (fs.existsSync(targetDir)) {
            try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch {}
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.url?.startsWith('/api/session-transcript')) {
          const url = new URL(req.url, 'http://localhost');
          const sessionId = url.searchParams.get('sessionId') || '';
          const cwd = url.searchParams.get('cwd');
          const filePath = url.searchParams.get('filePath');

          try {
            const data = await parseSessionTranscriptNode(sessionId, cwd, filePath);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        next();
      });
    },
  };
}
