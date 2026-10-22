// Types for OMP UI application

/**
 * Transport kinds supported by the frontend.
 *
 * - `stdio`: agent runs as a local subprocess (desktop only).
 * - `websocket`: agent listens on `ws://` / `wss://` and speaks ACP over a WebSocket.
 * - `http`: agent listens on `http://` / `https://` and speaks ACP over Streamable HTTP / SSE.
 */
export type AgentTransportKind = 'stdio' | 'websocket' | 'http';

export interface AgentConfig {
  /**
   * Transport kind. Optional for backward compatibility — when omitted, the
   * config is treated as a stdio agent.
   */
  transport?: AgentTransportKind;

  // ----- stdio fields (optional when transport != 'stdio') -----
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // ----- remote fields (used when transport != 'stdio') -----
  url?: string;
  headers?: Record<string, string>;
}

export interface ProxyConfig {
  enabled: boolean;
  url?: string;
}

export interface AgentsConfig {
  version?: number;
  proxy?: ProxyConfig;
  agents: Record<string, AgentConfig>;
}

/** Returns the effective transport kind for an agent config. */
export function getTransportKind(config: AgentConfig): AgentTransportKind {
  return config.transport ?? 'stdio';
}

/** Type guard: true for legacy / explicit stdio agents. */
export function isStdioConfig(
  config: AgentConfig
): config is AgentConfig & { command: string } {
  return getTransportKind(config) === 'stdio';
}

/** Type guard: true for websocket / http agents with a non-empty URL. */
export function isRemoteConfig(
  config: AgentConfig
): config is AgentConfig & { url: string } {
  const kind = getTransportKind(config);
  return (
    (kind === 'websocket' || kind === 'http') &&
    typeof config.url === 'string' &&
    config.url.length > 0
  );
}

export interface AgentInstance {
  id: string;
  name: string;
}

export interface AgentMessage {
  agent_id: string;
  message: string;
}

export interface AgentStderr {
  agent_id: string;
  line: string;
}

export interface SavedSession {
  id: string;
  agentName: string;
  sessionId: string;
  title: string;
  lastUpdated: number;
  cwd: string;
  supportsLoadSession?: boolean; // Whether the agent supports session/load
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  timestamp: number;
  toolCalls?: ToolCallInfo[];
  images?: Array<{ data: string; mimeType: string; previewUrl?: string }>;
}

export interface ToolCallInfo {
  toolCallId: string;
  title: string;
  kind: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  locations?: { path: string }[];
  overview?: string;
  arguments?: any;
  result?: string | null;
}

export interface PermissionRequest {
  sessionId: string;
  toolCall: ToolCallInfo;
  options: PermissionOption[];
}

export interface PermissionOption {
  kind: string;
  name: string;
  optionId: string;
}

// Session Modes
export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface SessionModeState {
  currentModeId: string;
  availableModes: SessionMode[];
}

// Slash Commands
export interface SlashCommand {
  name: string;
  description: string;
  hint?: string;
}

// Models
export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

// Config Options (ACP standard for session configuration such as models, thinking levels)
export interface ConfigOptionValue {
  value: string;
  name?: string;
  description?: string;
}

export interface ConfigOption {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: ConfigOptionValue[];
}

// Global Session Manager Types
export interface GlobalSessionSummary {
  session_id: string;
  title: string;
  updated_at: number;
  cwd: string | null;
  recap: string | null;
  bound_account: string | null;
  bound_provider: string | null;
  has_entity_file: boolean;
  file_path: string | null;
}

export interface TranscriptStats {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  user_message_count: number;
  assistant_message_count: number;
  tool_call_count: number;
}

export interface TranscriptToolCall {
  id: string;
  name: string;
  arguments: any;
  result: string | null;
  is_error: boolean;
}

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp?: string;
  text?: string;
  thinking?: string;
  tool_calls: TranscriptToolCall[];
}

export interface SessionTranscript {
  session_id: string;
  title?: string;
  cwd?: string;
  model?: string;
  bound_account?: string;
  bound_provider?: string;
  stats: TranscriptStats;
  messages: TranscriptMessage[];
}
