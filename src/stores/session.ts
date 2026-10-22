// Session store for managing ACP sessions and persistence
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { loadKvStore, type KVStore } from '../lib/host/storage';
import { getAppVersion, getSessionTranscript, getOmpModelsAndConfig, type PromptSuggestion } from '../lib/host';
import { trackEvent, trackError } from '../lib/telemetry';
import type {
  SavedSession,
  ChatMessage,
  ToolCallInfo,
  PermissionRequest,
  SessionMode,
  SlashCommand,
  ModelInfo,
  AgentConfig,
  ConfigOption,
  GlobalSessionSummary,
} from '../lib/types';
import { getTransportKind } from '../lib/types';
import { AcpClientBridge, createAcpClient } from '../lib/acp-bridge';
import { onAgentStderr, spawnAgent, killAgent } from '../lib/host';
import { isDesktop } from '../lib/platform';
import { useConfigStore } from './config';
import type { SessionNotification, AuthMethod } from '@agentclientprotocol/sdk';

const STORE_PATH = 'sessions.json';
const PROTOCOL_VERSION = 1;

// App version (loaded once at startup)
let appVersion = '0.1.0';

// Startup phase detection patterns
function detectPhase(line: string): string | null {
  const lower = line.toLowerCase();
  if (lower.includes('download') || lower.includes('fetch') || lower.includes('get ')) {
    return 'downloading';
  }
  if (lower.includes('install') || lower.includes('added') || lower.includes('packages')) {
    return 'installing';
  }
  if (lower.includes('build') || lower.includes('compil')) {
    return 'building';
  }
  if (lower.includes('start') || lower.includes('spawn')) {
    return 'starting';
  }
  return null;
}

export function extractToolOverview(name: string, args: any, locations?: { path: string }[]): string {
  if (locations && locations.length > 0 && locations[0].path) {
    return locations[0].path;
  }
  if (!args || typeof args !== 'object') {
    return '';
  }

  if (args.i && typeof args.i === 'string') {
    return args.i;
  }

  if (name === 'read' || name === 'write') {
    return args.path || '';
  }

  if (name === 'edit') {
    if (args.input && typeof args.input === 'string') {
      const match = /^\[([^#\]]+)/.exec(args.input.trim());
      if (match) return match[1];
    }
    return args.path || '';
  }

  if (name === 'bash') {
    return args.command || '';
  }

  if (name === 'grep') {
    if (args.pattern) {
      return `"${args.pattern}"` + (args.path ? ` in ${args.path}` : '');
    }
  }

  if (name === 'glob') {
    return args.path || '';
  }

  if (name === 'eval') {
    return args.title || (args.code ? args.code.slice(0, 50).replace(/\n/g, ' ') : '');
  }

  if (name === 'todo') {
    return (args.op ? `${args.op}: ` : '') + (args.task || '');
  }

  if (args.path && typeof args.path === 'string') {
    return args.path;
  }

  return '';
}

interface SessionCapabilitiesLike {
  modes?: {
    availableModes?: Array<{ id: string; name: string; description?: string }>;
    currentModeId?: string;
  };
  models?: {
    availableModels?: Array<{ modelId: string; name: string; description?: string }>;
    currentModelId?: string;
  };
  configOptions?: ConfigOption[];
}

function extractModelsAndModes(res: SessionCapabilitiesLike): {
  modes: SessionMode[];
  currentModeId: string;
  models: ModelInfo[];
  currentModelId: string;
  thinkingLevels: Array<{ id: string; name: string; description?: string }>;
  currentThinkingLevel: string;
} {
  const modes: SessionMode[] = (res.modes?.availableModes || []).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
  }));
  const currentModeId = res.modes?.currentModeId || '';

  let models: ModelInfo[] = [];
  let currentModelId = '';
  if (res.models) {
    models = (res.models.availableModels || []).map((m) => ({
      modelId: m.modelId,
      name: m.name,
      description: m.description,
    }));
    currentModelId = res.models.currentModelId || '';
  } else if (Array.isArray(res.configOptions)) {
    const modelConfig = res.configOptions.find(
      (opt) => opt.category === 'model' || opt.id === 'model'
    );
    if (modelConfig && Array.isArray(modelConfig.options)) {
      models = modelConfig.options.map((opt) => ({
        modelId: opt.value,
        name: opt.name || opt.value,
        description: opt.description,
      }));
      currentModelId = modelConfig.currentValue || '';
    }
  }

  let thinkingLevels: Array<{ id: string; name: string; description?: string }> = [];
  let currentThinkingLevel = '';
  if (Array.isArray(res.configOptions)) {
    const thinkConfig = res.configOptions.find(
      (opt) => opt.category === 'thought_level' || opt.id === 'thinking'
    );
    if (thinkConfig && Array.isArray(thinkConfig.options)) {
      thinkingLevels = thinkConfig.options.map((opt) => ({
        id: opt.value,
        name: opt.name || opt.value,
        description: opt.description,
      }));
      currentThinkingLevel = thinkConfig.currentValue || '';
    }
  }

  return { modes, currentModeId, models, currentModelId, thinkingLevels, currentThinkingLevel };
}


export const useSessionStore = defineStore('session', () => {
  // State
  const savedSessions = ref<SavedSession[]>([]);
  const currentSession = ref<SavedSession | null>(null);
  const messages = ref<ChatMessage[]>([]);
  const toolCalls = ref<Map<string, ToolCallInfo>>(new Map());
  const isConnected = ref(false);
  const isLoading = ref(false);
  const isConnecting = ref(false);
  // True while a foreground reconnect attempt is in flight. Distinct from
  // `isConnecting` (which is the multi-phase initial spawn/connect path):
  // reconnects skip the spawn/stderr-progress UI and just need a small
  // "Reconnecting…" indicator.
  const isReconnecting = ref(false);
  const error = ref<string | null>(null);
  const pendingPermission = ref<PermissionRequest | null>(null);
  
  // Authentication state
  const pendingAuthMethods = ref<AuthMethod[]>([]);
  const pendingAuthAgentName = ref<string>('');
  let authMethodResolver: ((methodId: string | null) => void) | null = null;
  
  // Session modes
  const availableModes = ref<SessionMode[]>([]);
  const currentModeId = ref<string>('');
  
  // Standard OMP slash commands & skills
  // Built-in basic commands (extended dynamically from backend OMP skills)
  const BUILTIN_COMMANDS: SlashCommand[] = [
    { name: 'new', description: '开启全新会话 (重置当前对话状态)', hint: '[cwd]' },
    { name: 'model', description: '查看或切换当前使用的大语言模型', hint: '[model-id]' },
    { name: 'usage', description: '查看账户使用配额与 Token 消耗统计' },
    { name: 'switch', description: '切换当前绑定的服务商或账号凭据' },
    { name: 'login', description: '登录或配置新的服务商账号' },
    { name: 'logout', description: '登出当前账号并清除凭据' },
    { name: 'plan', description: '生成并审阅多步骤执行规划' },
    { name: 'queue', description: '查看后台并发任务队列状态' },
    { name: 'goal', description: '设定当前任务的最终验收目标', hint: '<goal-text>' },
    { name: 'settings', description: '打开偏好设置面板' },
    { name: 'clear', description: '清空当前屏幕内容' },
  ];
  const availableCommands = ref<SlashCommand[]>(BUILTIN_COMMANDS);
  
  // Session models (dynamically loaded from omp models.db and config.yml)
  const availableModels = ref<ModelInfo[]>([]);
  const currentModelId = ref<string>('');

  // Session thinking levels (dynamically loaded from omp models.db and config.yml)
  const availableThinkingLevels = ref<Array<{ id: string; name: string; description?: string }>>([]);
  const currentThinkingLevel = ref<string>('');

  // System default cwd and prompt suggestions loaded from backend
  const defaultCwd = ref<string>('');
  const promptSuggestions = ref<PromptSuggestion[]>([]);

  async function refreshOmpModelsAndConfig(): Promise<void> {
    try {
      const ompConfig = await getOmpModelsAndConfig();
      if (ompConfig.models.length > 0) {
        availableModels.value = ompConfig.models;
      }
      if (ompConfig.default_model_id && !currentModelId.value) {
        currentModelId.value = ompConfig.default_model_id;
      }
      if (ompConfig.thinking_levels.length > 0) {
        availableThinkingLevels.value = ompConfig.thinking_levels;
      }
      if (ompConfig.default_thinking_level && !currentThinkingLevel.value) {
        currentThinkingLevel.value = ompConfig.default_thinking_level;
      }
      if (ompConfig.default_cwd) {
        defaultCwd.value = ompConfig.default_cwd;
      }
      if (ompConfig.commands && ompConfig.commands.length > 0) {
        availableCommands.value = ompConfig.commands;
      }
      if (ompConfig.prompt_suggestions && ompConfig.prompt_suggestions.length > 0) {
        promptSuggestions.value = ompConfig.prompt_suggestions;
      }
    } catch (e) {
      console.warn('Failed to load omp models and config:', e);
    }
  }

  // Immediately query omp models and configuration
  refreshOmpModelsAndConfig();
  let connectionAborted = false;
  
  // Startup progress tracking
  const startupPhase = ref<string>('starting');
  const startupLogs = ref<string[]>([]);
  const startupElapsed = ref<number>(0);
  let startupTimer: ReturnType<typeof setInterval> | null = null;
  let stderrUnlisten: (() => void) | null = null;
  
  // Current ACP client
  let acpClient: AcpClientBridge | null = null;
  let store: KVStore | null = null;

  // Computed
  const hasActiveSession = computed(() => currentSession.value !== null);
  const messageList = computed(() => messages.value);
  const toolCallList = computed(() => Array.from(toolCalls.value.values()));
  // Only sessions that support resuming (loadSession capability)
  const resumableSessions = computed(() => 
    savedSessions.value.filter(s => s.supportsLoadSession === true)
  );

  // Initialize store
  async function initStore() {
    store = await loadKvStore(STORE_PATH);
    const saved = await store.get<SavedSession[]>('sessions');
    if (saved) {
      savedSessions.value = saved;
    }
    
    // Load app version (Tauri API on desktop/mobile, build-time inject on web)
    try {
      appVersion = await getAppVersion();
    } catch (e) {
      console.warn('Failed to get app version:', e);
    }
  }

  async function saveSessionsToStore() {
    if (store) {
      await store.set('sessions', savedSessions.value);
      await store.save();
    }
  }

  // Handle an unexpected transport close (e.g. WebSocket dropped while idle,
  // local agent process exited). The bridge has already rejected any
  // in-flight requests; we just need to tear down UI state so the user gets
  // a clear "disconnected" signal instead of a stale "connected" view.
  function handleUnexpectedClose(reason?: string): void {
    // If `acpClient` is already null, this fired during a voluntary
    // disconnect that's tearing down anyway — nothing to do.
    if (!acpClient) return;
    acpClient = null;
    isConnected.value = false;
    isLoading.value = false;
    pendingPermission.value = null;
    error.value = `Connection lost: ${reason ?? 'transport closed'}`;
  }
  // Helper to extract text safely from any ACP chunk payload shape
  function extractChunkText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(extractChunkText).join('');
    }
    if (content && typeof content === 'object') {
      if ('text' in content) {
        const textVal = content.text;
        if (typeof textVal === 'string') return textVal;
      }
      if ('content' in content) {
        const nestedVal = content.content;
        if (typeof nestedVal === 'string') return nestedVal;
        if (typeof nestedVal === 'object') return extractChunkText(nestedVal);
      }
    }
    return '';
  }

  // Session update handler
  function handleSessionUpdate(notification: SessionNotification) {
    const update = notification.update;
    
    switch (update.sessionUpdate) {
      case 'user_message_chunk': {
        const text = extractChunkText(update.content);
        const lastUserMsg = messages.value[messages.value.length - 1];
        if (lastUserMsg && lastUserMsg.role === 'user') {
          if (!lastUserMsg.content) {
            lastUserMsg.content = text;
          } else if (text && !lastUserMsg.content.includes(text)) {
            lastUserMsg.content += text;
          }
        } else if (text) {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: text,
            timestamp: Date.now(),
          });
        }
        break;
      }

      case 'agent_message_chunk': {
        const text = extractChunkText(update.content);
        const lastMsg = messages.value[messages.value.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          lastMsg.content = (lastMsg.content || '') + text;
        } else if (text) {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: text,
            timestamp: Date.now(),
            toolCalls: [],
          });
        }
        break;
      }

      case 'agent_thought_chunk': {
        const text = extractChunkText(update.content);
        const lastAssistantMsg = messages.value[messages.value.length - 1];
        if (lastAssistantMsg && lastAssistantMsg.role === 'assistant') {
          lastAssistantMsg.thought = (lastAssistantMsg.thought || '') + text;
        } else if (text) {
          messages.value.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            thought: text,
            timestamp: Date.now(),
            toolCalls: [],
          });
        }
        break;
      }
      case 'tool_call': {
        let currentAssistantMsg = messages.value[messages.value.length - 1];
        if (!currentAssistantMsg || currentAssistantMsg.role !== 'assistant') {
          currentAssistantMsg = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            toolCalls: [],
          };
          messages.value.push(currentAssistantMsg);
        }
        if (!currentAssistantMsg.toolCalls) {
          currentAssistantMsg.toolCalls = [];
        }
        const rawArgs = update.rawInput ?? (update as any).input;
        const overview = extractToolOverview(update.title, rawArgs, update.locations);
        currentAssistantMsg.toolCalls.push({
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind || 'other',
          status: update.status || 'pending',
          locations: update.locations,
          overview,
          arguments: rawArgs,
        });
        // Also keep in global map for updates
        toolCalls.value.set(update.toolCallId, {
          toolCallId: update.toolCallId,
          title: update.title,
          kind: update.kind || 'other',
          status: update.status || 'pending',
          locations: update.locations,
          overview,
          arguments: rawArgs,
        });
        break;
      }

      case 'tool_call_update':
        const existing = toolCalls.value.get(update.toolCallId);
        if (existing) {
          if (update.status) existing.status = update.status;
          if (update.title) existing.title = update.title;
          // Also update in the message's toolCalls array
          for (const msg of messages.value) {
            if (msg.toolCalls) {
              const tc = msg.toolCalls.find(t => t.toolCallId === update.toolCallId);
              if (tc) {
                if (update.status) tc.status = update.status;
                if (update.title) tc.title = update.title;
              }
            }
          }
        }
        break;

      case 'current_mode_update':
        // Agent changed the mode
        if ('modeId' in update && update.modeId) {
          currentModeId.value = update.modeId as string;
        }
        break;

      case 'available_commands_update':
        // Agent advertised slash commands
        if ('availableCommands' in update && Array.isArray(update.availableCommands)) {
          availableCommands.value = update.availableCommands.map((cmd) => ({
            name: cmd.name,
            description: cmd.description,
            hint: cmd.input?.hint ?? undefined,
          }));
        }
        break;
      case 'config_option_update':
        if ('configOptions' in update && Array.isArray(update.configOptions)) {
          const opts = update.configOptions as ConfigOption[];
          const modelOpt = opts.find((opt) => opt.category === 'model' || opt.id === 'model');
          if (modelOpt) {
            if (Array.isArray(modelOpt.options)) {
              availableModels.value = modelOpt.options.map((opt) => ({
                modelId: opt.value,
                name: opt.name || opt.value,
                description: opt.description,
              }));
            }
            if (modelOpt.currentValue) {
              currentModelId.value = modelOpt.currentValue;
            }
          }
          const thinkOpt = opts.find((opt) => opt.category === 'thought_level' || opt.id === 'thinking');
          if (thinkOpt) {
            if (Array.isArray(thinkOpt.options)) {
              availableThinkingLevels.value = thinkOpt.options.map((opt) => ({
                id: opt.value,
                name: opt.name || opt.value,
                description: opt.description,
              }));
            }
            if (thinkOpt.currentValue) {
              currentThinkingLevel.value = thinkOpt.currentValue;
            }
          }
        }
        break;

      default:
        console.log('Unhandled session update:', update);
    }
  }

  // Prompt user to select auth method
  async function promptForAuthMethod(authMethods: AuthMethod[], agentName: string): Promise<string | null> {
    return new Promise((resolve) => {
      pendingAuthMethods.value = authMethods;
      pendingAuthAgentName.value = agentName;
      authMethodResolver = resolve;
    });
  }

  // User selected an auth method
  function selectAuthMethod(methodId: string): void {
    if (authMethodResolver) {
      authMethodResolver(methodId);
      authMethodResolver = null;
      pendingAuthMethods.value = [];
      pendingAuthAgentName.value = '';
    }
  }

  // User cancelled auth selection
  function cancelAuthSelection(): void {
    if (authMethodResolver) {
      authMethodResolver(null);
      authMethodResolver = null;
      pendingAuthMethods.value = [];
      pendingAuthAgentName.value = '';
    }
  }

  // Create new session
  async function createSession(agentName: string, cwd: string): Promise<void> {
    isLoading.value = true;
    isConnecting.value = true;
    connectionAborted = false;
    error.value = null;

    // Look up the agent's transport kind so we know whether to do the
    // stdio-only startup choreography (spawn → stderr progress) or the
    // streamlined remote path (just open a network transport).
    const configStore = useConfigStore();
    const agentConfig: AgentConfig | undefined = configStore.getAgent(agentName);
    const transportKind = agentConfig
      ? getTransportKind(agentConfig)
      : 'stdio';
    const isRemote = transportKind !== 'stdio';

    // Reset and start progress tracking
    startupPhase.value = 'starting';
    startupLogs.value = [];
    startupElapsed.value = 0;
    startupTimer = setInterval(() => {
      startupElapsed.value++;
    }, 1000);

    // Track the spawned stdio instance separately so we can `killAgent` it
    // if cancellation/abort happens before we've wrapped it in a bridge.
    // Once `acpClient` is set, ownership transfers to the bridge and
    // `acpClient.disconnect()` becomes the only correct cleanup path.
    let spawnedInstance: { id: string } | null = null;

    try {
      if (!agentConfig) {
        throw new Error(`Agent '${agentName}' not found in config`);
      }

      if (!isRemote) {
        // For stdio agents we need the spawned process's id up front so the
        // stderr listener can filter on it (multiple agents may be running
        // concurrently). We spawn here, hand the resulting AgentInstance to
        // a StdioTransport, then build the bridge from that transport.
        startupPhase.value = 'starting';
        const agentInstance = await spawnAgent(agentName);
        spawnedInstance = agentInstance;

        stderrUnlisten = await onAgentStderr((stderr) => {
          if (stderr.agent_id !== agentInstance.id) return;
          startupLogs.value.push(stderr.line);
          // Detect phase from output
          const detectedPhase = detectPhase(stderr.line);
          if (detectedPhase) {
            startupPhase.value = detectedPhase;
          }
        }) as unknown as () => void;

        if (connectionAborted) {
          // Process was spawned but no bridge exists yet — kill the orphan
          // before throwing so the local agent doesn't keep running.
          await killAgent(agentInstance.id).catch((err) =>
            console.warn('killAgent during abort failed:', err)
          );
          spawnedInstance = null;
          throw new Error('Connection cancelled');
        }

        startupPhase.value = 'initializing';

        // Wrap the just-spawned instance in a StdioTransport. Using the
        // legacy single-arg form keeps backward compatibility and avoids a
        // double-spawn (StdioTransport.spawn would call spawnAgent again).
        acpClient = await createAcpClient(agentInstance);
        // Ownership of the child process now belongs to the bridge — clear
        // our local reference so the catch block doesn't double-kill it.
        spawnedInstance = null;
      } else {
        // Remote agents have no stderr stream; show a minimal "connecting"
        // state instead of the multi-phase progress UI.
        startupPhase.value = 'connecting';

        if (connectionAborted) {
          throw new Error('Connection cancelled');
        }

        // The factory opens a WebSocket / HTTP connection based on
        // agentConfig.transport.
        acpClient = await createAcpClient({ name: agentName, config: agentConfig });
      }

      acpClient.onSessionUpdate = handleSessionUpdate;
      // Surface unexpected transport closes (e.g. WebSocket drop while idle)
      // to the UI so users don't sit on a stale "connected" state forever.
      acpClient.onTransportClose = (reason) => {
        handleUnexpectedClose(reason);
      };
      
      // Sync bridge's pendingPermissionRequest to store's pendingPermission
      watch(
        () => acpClient?.pendingPermissionRequest.value,
        (newValue) => {
          pendingPermission.value = newValue ?? null;
        },
        { immediate: true }
      );

      if (connectionAborted) {
        await acpClient.disconnect();
        throw new Error('Connection cancelled');
      }

      startupPhase.value = 'connecting';

      // Initialize connection
      // Only Tauri desktop has real filesystem access; mobile and web
      // cannot fulfil readTextFile / writeTextFile RPCs.
      const canAccessFs = isDesktop();

      const initResponse = await acpClient.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: canAccessFs,
            writeTextFile: canAccessFs,
          },
          prompt: {
            image: true,
          },
        } as any,
        clientInfo: {
          name: 'omp-ui',
          title: 'OMP UI',
          version: appVersion,
        },
      });

      console.log('Agent initialized:', initResponse);

      // Check if agent supports session loading
      const supportsLoadSession = initResponse.agentCapabilities?.loadSession ?? false;

      if (connectionAborted) {
        await acpClient.disconnect();
        throw new Error('Connection cancelled');
      }

      // Store available auth methods for potential retry
      const availableAuthMethods = initResponse.authMethods || [];

      if (connectionAborted) {
        await acpClient.disconnect();
        throw new Error('Connection cancelled');
      }

      // Try to create session - may fail with auth_required
      let sessionResponse;
      try {
        sessionResponse = await acpClient.newSession({
          cwd,
          mcpServers: [],
        });
      } catch (sessionError: unknown) {
        // Check if auth is required (error code -32000)
        const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
        const isAuthRequired = errorMessage.toLowerCase().includes('authentication required') ||
                               errorMessage.includes('-32000');
        
        if (isAuthRequired && availableAuthMethods.length > 0) {
          console.log('Authentication required, available methods:', availableAuthMethods);
          
          // Prompt user to select auth method
          const selectedMethodId = await promptForAuthMethod(availableAuthMethods, agentName);
          
          if (!selectedMethodId || connectionAborted) {
            await acpClient.disconnect();
            throw new Error('Authentication cancelled by user');
          }
          
          console.log('Authenticating with method:', selectedMethodId);
          const authResponse = await acpClient.authenticate({
            methodId: selectedMethodId,
          });
          console.log('Authentication successful:', authResponse);

          if (connectionAborted) {
            await acpClient.disconnect();
            throw new Error('Connection cancelled');
          }

          // Retry session creation after auth
          sessionResponse = await acpClient.newSession({
            cwd,
            mcpServers: [],
          });
        } else {
          throw sessionError;
        }
      }

      // Save session
      const session: SavedSession = {
        id: crypto.randomUUID(),
        agentName,
        sessionId: sessionResponse.sessionId,
        title: `Session ${new Date().toLocaleString()}`,
        lastUpdated: Date.now(),
        cwd,
        supportsLoadSession,
      };

      currentSession.value = session;
      savedSessions.value.push(session);
      await saveSessionsToStore();
      
      isConnected.value = true;
      messages.value = [];
      toolCalls.value.clear();
      
      // Track successful session creation
      trackEvent('SessionCreated', { agentName, success: 'true' });
      
      // Set up session modes if available
      const extracted = extractModelsAndModes(sessionResponse as unknown as SessionCapabilitiesLike);
      if (extracted.modes.length > 0) {
        availableModes.value = extracted.modes;
        currentModeId.value = extracted.currentModeId;
      }
      if (extracted.models.length > 0) {
        availableModels.value = extracted.models;
      }
      if (extracted.thinkingLevels.length > 0) {
        availableThinkingLevels.value = extracted.thinkingLevels;
      }

      // Apply pre-selected model or adopt agent's current model
      if (currentModelId.value) {
        try {
          await acpClient.setSessionConfigOption({
            sessionId: sessionResponse.sessionId,
            configId: 'model',
            value: currentModelId.value,
          });
        } catch {
          try {
            await acpClient.unstable_setSessionModel({
              sessionId: sessionResponse.sessionId,
              modelId: currentModelId.value,
            });
          } catch {}
        }
      } else if (extracted.currentModelId) {
        currentModelId.value = extracted.currentModelId;
      }

      // Apply pre-selected thinking level or adopt agent's current level
      if (currentThinkingLevel.value) {
        try {
          await acpClient.setSessionConfigOption({
            sessionId: sessionResponse.sessionId,
            configId: 'thinking',
            value: currentThinkingLevel.value,
          });
        } catch {}
      } else if (extracted.currentThinkingLevel) {
        currentThinkingLevel.value = extracted.currentThinkingLevel;
      }

    } catch (e) {
      let rawError = e instanceof Error ? e.message : String(e);
      if (agentName === 'Oh My Pi' || agentName.toLowerCase().includes('omp')) {
        const logsText = startupLogs.value.join('\n');
        const combined = `${rawError} ${logsText}`.toLowerCase();
        if (
          combined.includes('not recognized') ||
          combined.includes('not found') ||
          combined.includes('enoent') ||
          combined.includes('不是内部或外部命令') ||
          combined.includes('没有那个文件或目录')
        ) {
          rawError = '未找到 omp 命令，请先安装 Oh My Pi，并确认其已加入系统 PATH。';
        } else if (
          combined.includes('authentication required') ||
          combined.includes('credentials') ||
          combined.includes('api key') ||
          combined.includes('unauthorized')
        ) {
          rawError = 'Oh My Pi 模型或认证未配置，请先在终端运行 omp 命令完成模型配置与登录。';
        }
      }
      error.value = rawError;
      // Tear down whichever side of the connection is live. The bridge owns
      // the spawned process once it exists, so prefer disconnecting it.
      // Otherwise (e.g. abort right after spawn but before bridge creation)
      // kill the orphaned local agent directly.
      if (acpClient) {
        try {
          await acpClient.disconnect();
        } catch (cleanupErr) {
          console.warn('disconnect during createSession cleanup failed:', cleanupErr);
        }
      } else if (spawnedInstance) {
        try {
          await killAgent(spawnedInstance.id);
        } catch (cleanupErr) {
          console.warn('killAgent during createSession cleanup failed:', cleanupErr);
        }
      }
      acpClient = null;
      // Track session creation failure
      trackEvent('SessionCreated', { agentName, success: 'false' });
      trackError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      isLoading.value = false;
      isConnecting.value = false;
      // Clean up startup progress tracking
      if (startupTimer) {
        clearInterval(startupTimer);
        startupTimer = null;
      }
      if (stderrUnlisten) {
        stderrUnlisten();
        stderrUnlisten = null;
      }
    }
  }

  // Resume existing session
  async function resumeSession(savedSession: SavedSession): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const configStore = useConfigStore();
      const agentConfig: AgentConfig | undefined = configStore.getAgent(savedSession.agentName);
      if (!agentConfig) {
        throw new Error(`Agent '${savedSession.agentName}' not found in config`);
      }

      // Create ACP client bridge (transport selected based on agent config).
      acpClient = await createAcpClient({
        name: savedSession.agentName,
        config: agentConfig,
      });
      acpClient.onSessionUpdate = handleSessionUpdate;
      // Surface unexpected transport closes (e.g. WebSocket dropped while idle,
      // local agent process crashed) so the UI doesn't sit on a stale
      // "connected" view forever.
      acpClient.onTransportClose = (reason) => {
        handleUnexpectedClose(reason);
      };

      // Sync bridge's pendingPermissionRequest to store's pendingPermission
      watch(
        () => acpClient?.pendingPermissionRequest.value,
        (newValue) => {
          pendingPermission.value = newValue ?? null;
        },
        { immediate: true }
      );

      // Only Tauri desktop has real filesystem access; mobile and web
      // cannot fulfil readTextFile / writeTextFile RPCs.
      const canAccessFs = isDesktop();

      // Initialize connection
      const initResponse = await acpClient.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: canAccessFs,
            writeTextFile: canAccessFs,
          },
          prompt: {
            image: true,
          },
        } as any,
        clientInfo: {
          name: 'omp-ui',
          title: 'OMP UI',
          version: appVersion,
        },
      });

      // Store available auth methods for potential retry
      const availableAuthMethods = initResponse.authMethods || [];

      // Clear messages BEFORE loadSession - the agent will stream replay via notifications
      messages.value = [];
      toolCalls.value.clear();

      // Try to load existing session - may fail with auth_required
      let sessionResponse;
      try {
        sessionResponse = await acpClient.loadSession({
          sessionId: savedSession.sessionId,
          cwd: savedSession.cwd,
          mcpServers: [],
        });
      } catch (sessionError: unknown) {
        // Check if auth is required (error code -32000)
        const errorMessage = sessionError instanceof Error ? sessionError.message : String(sessionError);
        const isAuthRequired = errorMessage.toLowerCase().includes('authentication required') ||
                               errorMessage.includes('-32000');
        
        if (isAuthRequired && availableAuthMethods.length > 0) {
          console.log('Authentication required, available methods:', availableAuthMethods);
          
          // Prompt user to select auth method
          const selectedMethodId = await promptForAuthMethod(availableAuthMethods, savedSession.agentName);
          
          if (!selectedMethodId) {
            await acpClient.disconnect();
            throw new Error('Authentication cancelled by user');
          }
          
          console.log('Authenticating with method:', selectedMethodId);
          const authResponse = await acpClient.authenticate({
            methodId: selectedMethodId,
          });
          console.log('Authentication successful:', authResponse);

          // Retry loading session after auth
          sessionResponse = await acpClient.loadSession({
            sessionId: savedSession.sessionId,
            cwd: savedSession.cwd,
            mcpServers: [],
          });
        } else {
          throw sessionError;
        }
      }


      // Populate modes and models on resume if returned
      if (sessionResponse) {
        const resumeExtracted = extractModelsAndModes(sessionResponse as unknown as SessionCapabilitiesLike);
        if (resumeExtracted.modes.length > 0) {
          availableModes.value = resumeExtracted.modes;
          currentModeId.value = resumeExtracted.currentModeId;
        }
        if (resumeExtracted.models.length > 0) {
          availableModels.value = resumeExtracted.models;
          currentModelId.value = resumeExtracted.currentModelId;
        }
        if (resumeExtracted.thinkingLevels.length > 0) {
          availableThinkingLevels.value = resumeExtracted.thinkingLevels;
          currentThinkingLevel.value = resumeExtracted.currentThinkingLevel;
        }
      }
      currentSession.value = savedSession;
      isConnected.value = true;
      // Messages already populated by session/update notifications during loadSession

      // Track successful session resume
      trackEvent('SessionResumed', { agentName: savedSession.agentName, success: 'true' });

      // Update last accessed time
      savedSession.lastUpdated = Date.now();
      await saveSessionsToStore();

    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      // Disconnect the bridge if it was created — otherwise we leak the
      // spawned stdio process or open WebSocket on initialize/loadSession
      // failure.
      if (acpClient) {
        try {
          await acpClient.disconnect();
        } catch (cleanupErr) {
          console.warn('disconnect during resumeSession cleanup failed:', cleanupErr);
        }
        acpClient = null;
      }
      // Track session resume failure
      trackEvent('SessionResumed', { agentName: savedSession.agentName, success: 'false' });
      trackError(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  // Send prompt
  async function sendPrompt(
    text: string,
    images?: Array<{ data: string; mimeType: string }>
  ): Promise<void> {
    if (!acpClient || !currentSession.value) {
      throw new Error('No active session');
    }

    // Add user message
    messages.value.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      images: images && images.length > 0 ? images : undefined,
    });

    isLoading.value = true;
    try {
      const promptBlocks: any[] = [];
      if (text.trim()) {
        promptBlocks.push({
          type: 'text',
          text: text.trim(),
        });
      }
      if (images && images.length > 0) {
        for (const img of images) {
          const rawBase64 = img.data.replace(/^data:[^;]+;base64,/, '');
          promptBlocks.push({
            type: 'image',
            data: rawBase64,
            mimeType: img.mimeType || 'image/png',
          });
        }
      }

      const response = await acpClient.prompt({
        sessionId: currentSession.value.sessionId,
        prompt: promptBlocks,
      });
      console.log('Prompt completed:', response.stopReason);

      // Track prompt sent
      trackEvent('PromptSent', { 
        messageLength: String(text.length),
        stopReason: response.stopReason || 'unknown',
      });

      // Update session title if it's the first message
      if (messages.value.length === 2 && currentSession.value) {
        currentSession.value.title = text.slice(0, 50) + (text.length > 50 ? '...' : '');
        currentSession.value.lastUpdated = Date.now();
        await saveSessionsToStore();
      }
    } finally {
      isLoading.value = false;
    }
  }

  // Cancel current operation
  async function cancelOperation(): Promise<void> {
    if (!acpClient || !currentSession.value) return;
    
    await acpClient.cancel({
      sessionId: currentSession.value.sessionId,
    });
  }

  // Cancel ongoing connection attempt
  async function cancelConnection(): Promise<void> {
    connectionAborted = true;
    
    // Cancel auth selection if pending
    if (authMethodResolver) {
      authMethodResolver(null);
      authMethodResolver = null;
      pendingAuthMethods.value = [];
      pendingAuthAgentName.value = '';
    }
    
    // Disconnect if client exists
    if (acpClient) {
      try {
        await acpClient.disconnect();
      } catch (e) {
        console.error('Error disconnecting:', e);
      }
      acpClient = null;
    }
    
    isLoading.value = false;
    isConnecting.value = false;
    error.value = null;
  }

  // Handle permission response
  function resolvePermission(optionId: string): void {
    if (acpClient) {
      acpClient.resolvePermission(optionId);
    }
  }

  function cancelPermission(): void {
    if (acpClient) {
      acpClient.cancelPermission();
    }
  }

  // Disconnect current session
  async function disconnect(): Promise<void> {
    const agentName = currentSession.value?.agentName || 'unknown';
    const sessionStart = currentSession.value?.lastUpdated || Date.now();
    const sessionDuration = Math.round((Date.now() - sessionStart) / 1000);
    
    if (acpClient) {
      await acpClient.disconnect();
      acpClient = null;
    }
    
    // Track session disconnect
    trackEvent('SessionDisconnected', { 
      agentName,
      sessionDurationSeconds: String(sessionDuration),
      messageCount: String(messages.value.length),
    });
    
    currentSession.value = null;
    isConnected.value = false;
    messages.value = [];
    toolCalls.value.clear();
    availableModes.value = [];
    currentModeId.value = '';
    refreshOmpModelsAndConfig();
  }

  // Delete saved session
  async function deleteSession(sessionId: string): Promise<void> {
    savedSessions.value = savedSessions.value.filter(s => s.id !== sessionId);
    await saveSessionsToStore();
  }

  // Set session mode
  async function setMode(modeId: string): Promise<void> {
    if (!acpClient || !currentSession.value) {
      throw new Error('No active session');
    }
    
    await acpClient.setMode({
      sessionId: currentSession.value.sessionId,
      modeId,
    });
    
    // Optimistically update the current mode
    currentModeId.value = modeId;
  }

  // Set session model (works on Hero screen and during active session)
  async function setModel(modelId: string): Promise<void> {
    currentModelId.value = modelId;
    if (acpClient && currentSession.value) {
      try {
        await acpClient.setSessionConfigOption({
          sessionId: currentSession.value.sessionId,
          configId: 'model',
          value: modelId,
        });
      } catch (err) {
        try {
          await acpClient.unstable_setSessionModel({
            sessionId: currentSession.value.sessionId,
            modelId,
          });
        } catch (fallbackErr) {
          console.warn('Failed to set session model on agent:', fallbackErr);
        }
      }
    }
  }

  // Set thinking level (works on Hero screen and during active session)
  async function setThinkingLevel(level: string): Promise<void> {
    currentThinkingLevel.value = level;
    if (acpClient && currentSession.value) {
      try {
        await acpClient.setSessionConfigOption({
          sessionId: currentSession.value.sessionId,
          configId: 'thinking',
          value: level,
        });
      } catch (err) {
        console.warn('Failed to set thinking level on agent:', err);
      }
    }
  }

  function clearError() {
    error.value = null;
  }

  /**
   * Foreground reconnect: when the user returns to the app and we're
   * disconnected (because the OS froze the WebView, the NAT killed the TCP
   * connection, or the network changed), silently re-attach to the saved
   * session if possible.
   *
   * Returns `true` if a reconnect was attempted, `false` if there was
   * nothing to do (no saved session, already connected/connecting, agent
   * doesn't advertise session-load support, etc.).
   *
   * Errors are surfaced via `error.value` exactly like a manual resume
   * would; the caller doesn't need to handle them.
   */
  async function tryReconnect(): Promise<boolean> {
    // Already connected or already trying — leave it alone.
    if (isConnected.value || isConnecting.value || isLoading.value) {
      return false;
    }
    // No prior session to reconnect to.
    const session = currentSession.value;
    if (!session) {
      return false;
    }
    // Bridge already exists (race with another reconnect in flight).
    if (acpClient) {
      return false;
    }
    // Agent must support `session/load` for resume to be meaningful;
    // otherwise we'd just create a fresh session, which is a strictly
    // user-initiated action.
    if (!session.supportsLoadSession) {
      return false;
    }

    // Clear the stale "Connection lost" banner up-front so the UI shows
    // an honest "Reconnecting…" state instead of a contradictory red
    // banner during the attempt. If the reconnect ultimately fails, the
    // catch below restores a real error message.
    error.value = null;
    isReconnecting.value = true;
    try {
      await resumeSession(session);
      return true;
    } catch (e) {
      // `resumeSession`'s own catch already wrote `error.value`; nothing
      // more to do here. Returning true so the caller knows we tried.
      console.warn('Foreground reconnect failed:', e);
      return true;
    } finally {
      isReconnecting.value = false;
    }
  }
  async function loadHistoricalSession(sessionSummary: GlobalSessionSummary): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const transcript = await getSessionTranscript(
        sessionSummary.session_id,
        sessionSummary.cwd,
        sessionSummary.file_path
      );

      toolCalls.value.clear();
      for (const m of transcript.messages) {
        for (const tc of m.tool_calls) {
          const overview = extractToolOverview(tc.name, tc.arguments);
          toolCalls.value.set(tc.id, {
            toolCallId: tc.id,
            title: tc.name,
            kind: tc.name,
            status: tc.result !== null ? (tc.is_error ? 'failed' : 'completed') : 'pending',
            overview,
            arguments: tc.arguments,
            result: tc.result,
          });
        }
      }

      const chatMsgs: ChatMessage[] = transcript.messages.map((m: any) => {
        const toolCallsList: ToolCallInfo[] = (m.tool_calls || []).map((tc: any) => ({
          toolCallId: tc.id,
          title: tc.name,
          kind: tc.name,
          status: tc.result !== null ? (tc.is_error ? 'failed' : 'completed') : 'pending',
          overview: extractToolOverview(tc.name, tc.arguments),
          arguments: tc.arguments,
          result: tc.result,
        }));

        const imagesList = (m.images || []).map((img: any) => ({
          data: img.data,
          mimeType: img.mime_type || img.mimeType || 'image/png',
          previewUrl: img.data.startsWith('data:') ? img.data : `data:${img.mime_type || img.mimeType || 'image/png'};base64,${img.data}`,
        }));

        return {
          id: m.id,
          role: m.role,
          content: m.text || '',
          thought: m.thinking || undefined,
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
          toolCalls: toolCallsList.length > 0 ? toolCallsList : undefined,
          images: imagesList.length > 0 ? imagesList : undefined,
        };
      });

      messages.value = chatMsgs;

      if (transcript.model) {
        currentModelId.value = transcript.model;
        if (!availableModels.value.some(m => m.modelId === transcript.model)) {
          availableModels.value.unshift({
            modelId: transcript.model,
            name: transcript.model.split('/').pop() || transcript.model,
          });
        }
      }
      if (!currentThinkingLevel.value) {
        currentThinkingLevel.value = 'high';
      }
      currentSession.value = {
        id: sessionSummary.session_id,
        sessionId: sessionSummary.session_id,
        title: sessionSummary.title,
        cwd: sessionSummary.cwd || '',
        agentName: 'Oh My Pi',
        lastUpdated: sessionSummary.updated_at * 1000,
        supportsLoadSession: true,
      };

      isConnected.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  function startNewChat(): void {
    currentSession.value = null;
    messages.value = [];
    toolCalls.value.clear();
    error.value = null;
    isConnected.value = false;
  }

  return {
    // State
    savedSessions,
    currentSession,
    messages,
    isConnected,
    isLoading,
    isConnecting,
    isReconnecting,
    error,
    pendingPermission,
    pendingAuthMethods,
    pendingAuthAgentName,
    availableModes,
    currentModeId,
    availableCommands,
    availableModels,
    currentModelId,
    availableThinkingLevels,
    currentThinkingLevel,
    defaultCwd,
    promptSuggestions,
    startupPhase,
    startupLogs,
    startupElapsed,
    
    // Computed
    hasActiveSession,
    messageList,
    toolCallList,
    resumableSessions,
    
    // Actions
    initStore,
    createSession,
    resumeSession,
    sendPrompt,
    loadHistoricalSession,
    startNewChat,
    cancelOperation,
    cancelConnection,
    resolvePermission,
    cancelPermission,
    selectAuthMethod,
    cancelAuthSelection,
    disconnect,
    deleteSession,
    setMode,
    setModel,
    setThinkingLevel,
    clearError,
    tryReconnect,
    
    // Expose client for permission handling
    get acpClient() { return acpClient; },
  };
});
