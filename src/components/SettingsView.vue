<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useConfigStore } from '../stores/config';
import { addAgent, removeAgent, updateAgent } from '../lib/host';
import { getTransportKind, type AgentTransportKind } from '../lib/types';
import { restrictedTransports } from '../lib/platform';
import EnvVarEditor from './EnvVarEditor.vue';
import AgentSelector from './AgentSelector.vue';

const props = defineProps<{
  selectedAgent?: string;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:selectedAgent', val: string): void;
}>();

const configStore = useConfigStore();
const localSelectedAgent = computed({
  get: () => props.selectedAgent || '',
  set: (val: string) => emit('update:selectedAgent', val),
});


interface AgentRow {
  name: string;
  transport: AgentTransportKind;
  command: string;
  args: string;
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
}

// True on iOS / Android / web: hide the stdio option in the form, and
// filter stdio agents out of the list entirely (they can't run there
// anyway).
const restricted = restrictedTransports();

const agents = computed<AgentRow[]>(() => {
  const entries = Object.entries(configStore.config.agents);
  // On restricted hosts (mobile / web), hide stdio agents entirely. They
  // can't run there (no subprocess), and showing them with a disabled
  // Edit button just creates confusion. The raw entries remain in the
  // config so a desktop sync round-trips them losslessly.
  const filtered = restricted
    ? entries.filter(([, c]) => getTransportKind(c) !== 'stdio')
    : entries;
  return filtered.map(([name, config]) => ({
    name,
    transport: getTransportKind(config),
    command: config.command ?? '',
    args: (config.args ?? []).join(' '),
    env: config.env ?? {},
    url: config.url ?? '',
    headers: config.headers ?? {},
  }));
});

// Form state
const showAddForm = ref(false);
const editingAgent = ref<string | null>(null);
const formName = ref('');
const formTransport = ref<AgentTransportKind>(restricted ? 'websocket' : 'stdio');
const formCommand = ref('');
const formArgs = ref('');
const formEnv = ref<Record<string, string>>({});
const formUrl = ref('');
const formHeaders = ref<Record<string, string>>({});
const formError = ref('');
const isSubmitting = ref(false);

const proxyEnabled = ref(configStore.proxy?.enabled ?? false);
const proxyUrl = ref(configStore.proxy?.url ?? '');
const isSavingProxy = ref(false);
const proxyMessage = ref('');

watch(
  () => configStore.proxy,
  (newProxy) => {
    proxyEnabled.value = newProxy?.enabled ?? false;
    proxyUrl.value = newProxy?.url ?? '';
  },
  { immediate: true }
);

function applyProxyPreset(url: string) {
  proxyUrl.value = url;
}

async function handleSaveProxy() {
  isSavingProxy.value = true;
  proxyMessage.value = '';
  try {
    await configStore.saveProxy(proxyEnabled.value, proxyUrl.value.trim() || undefined);
    proxyMessage.value = '✓ 代理设置已保存并生效于后续创建的会话';
    setTimeout(() => {
      proxyMessage.value = '';
    }, 4000);
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e);
  } finally {
    isSavingProxy.value = false;
  }
}

async function toggleProxy(event: Event) {
  const target = event.target as HTMLInputElement;
  proxyEnabled.value = target.checked;
  if (!target.checked) {
    await handleSaveProxy();
  }
}

function quickAddProxyEnv() {
  const current = proxyUrl.value.trim() || 'http://127.0.0.1:7890';
  formEnv.value = {
    ...formEnv.value,
    HTTP_PROXY: current,
    HTTPS_PROXY: current,
    ALL_PROXY: current,
  };
}

function resetForm() {
  formName.value = '';
  formTransport.value = restricted ? 'websocket' : 'stdio';
  formCommand.value = '';
  formArgs.value = '';
  formEnv.value = {};
  formUrl.value = '';
  formHeaders.value = {};
  formError.value = '';
  showAddForm.value = false;
  editingAgent.value = null;
}

function startAdd() {
  resetForm();
  showAddForm.value = true;
}

function startEdit(agent: AgentRow) {
  resetForm();
  editingAgent.value = agent.name;
  formName.value = agent.name;
  formTransport.value = agent.transport;
  formCommand.value = agent.command;
  formArgs.value = agent.args;
  formEnv.value = { ...agent.env };
  formUrl.value = agent.url;
  formHeaders.value = { ...agent.headers };
}

function parseArgs(argsString: string): string[] {
  // Simple arg parsing - split on spaces but respect quotes
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (const char of argsString) {
    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuotes) {
      if (current.trim()) {
        args.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

async function handleSubmit() {
  formError.value = '';

  if (!formName.value.trim()) {
    formError.value = 'Name is required';
    return;
  }

  // Validate agent name is not purely numeric (JavaScript object key ordering issue)
  if (/^\d+$/.test(formName.value)) {
    formError.value = 'Agent name cannot be purely numeric';
    return;
  }

  const transport = formTransport.value;
  const isRemote = transport !== 'stdio';

  if (isRemote) {
    if (!formUrl.value.trim()) {
      formError.value = 'URL is required for remote agents';
      return;
    }
    const lower = formUrl.value.trim().toLowerCase();
    if (transport === 'websocket' && !(lower.startsWith('ws://') || lower.startsWith('wss://'))) {
      formError.value = 'WebSocket URL must start with ws:// or wss://';
      return;
    }
    if (transport === 'http' && !(lower.startsWith('http://') || lower.startsWith('https://'))) {
      formError.value = 'HTTP URL must start with http:// or https://';
      return;
    }
  } else {
    if (!formCommand.value.trim()) {
      formError.value = 'Command is required';
      return;
    }
  }

  const args = isRemote ? [] : parseArgs(formArgs.value);
  isSubmitting.value = true;

  try {
    const remoteOpts = isRemote
      ? {
          transport: transport as 'websocket' | 'http',
          url: formUrl.value.trim(),
          headers: Object.keys(formHeaders.value).length > 0 ? formHeaders.value : undefined,
        }
      : {};
    const command = isRemote ? null : formCommand.value;
    const env = isRemote ? {} : formEnv.value;

    if (editingAgent.value) {
      const newConfig = await updateAgent(formName.value, command, args, env, remoteOpts);
      configStore.updateFromEvent(newConfig);
    } else {
      // Check for duplicates
      if (configStore.config.agents[formName.value]) {
        formError.value = 'An agent with this name already exists';
        isSubmitting.value = false;
        return;
      }
      const newConfig = await addAgent(formName.value, command, args, env, remoteOpts);
      configStore.updateFromEvent(newConfig);
    }
    resetForm();
  } catch (e) {
    formError.value = e instanceof Error ? e.message : String(e);
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(name: string) {
  if (!confirm(`Delete agent "${name}"?`)) return;

  try {
    const newConfig = await removeAgent(name);
    configStore.updateFromEvent(newConfig);
  } catch (e) {
    console.error('Failed to delete agent:', e);
  }
}
</script>

<template>
  <div class="settings-overlay" @click.self="emit('close')">
    <div class="settings-panel">
      <div class="settings-header">
        <h2>设置</h2>
        <button class="close-btn" @click="emit('close')" title="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="settings-content">
        <!-- Active Default Agent Selection Section -->
        <section class="default-agent-section">
          <div class="section-header">
            <h3>核心智能体选择</h3>
          </div>
          <p class="settings-section-desc">选择当前会话与对话默认调用的核心智能体客户端：</p>
          <div class="default-agent-picker-box">
            <AgentSelector 
              v-model:selected="localSelectedAgent"
              @select="(val) => emit('update:selectedAgent', val)"
            />
          </div>
        </section>

        <section class="agents-section">
          <div class="section-header">
            <h3>智能体配置</h3>
            <button class="add-btn" @click="startAdd" :disabled="showAddForm">
              + 添加智能体
            </button>
          </div>

          <!-- Add/Edit Form -->
          <div v-if="showAddForm || editingAgent" class="agent-form">
            <h4>{{ editingAgent ? '编辑智能体' : '添加新智能体' }}</h4>

            <div class="form-group">
              <label>名称 (Name)</label>
              <input
                v-model="formName"
                type="text"
                placeholder="My Agent"
                :disabled="!!editingAgent"
              />
            </div>

            <div class="form-group">
              <label>传输方式 (Transport)</label>
              <select v-model="formTransport">
                <option v-if="!restricted" value="stdio">stdio (local subprocess)</option>
                <option value="websocket">websocket (remote)</option>
                <option value="http">http (remote)</option>
              </select>
              <small v-if="restricted">stdio is not available on this platform.</small>
            </div>

            <template v-if="formTransport === 'stdio'">
              <div class="form-group">
                <label>Command</label>
                <input
                  v-model="formCommand"
                  type="text"
                  placeholder="npx"
                />
              </div>

              <div class="form-group">
                <label>Arguments</label>
                <input
                  v-model="formArgs"
                  type="text"
                  placeholder="-y @example/agent"
                />
                <small>Space-separated. Use quotes for args with spaces.</small>
              </div>

              <div class="form-group">
                <EnvVarEditor v-model="formEnv" />
                <div class="quick-env-actions">
                  <button type="button" class="preset-chip" @click="quickAddProxyEnv">
                    + 一键填入代理环境变量 (HTTP_PROXY / HTTPS_PROXY)
                  </button>
                </div>
              </div>
            </template>

            <template v-else>
              <div class="form-group">
                <label>URL</label>
                <input
                  v-model="formUrl"
                  type="text"
                  :placeholder="formTransport === 'websocket' ? 'wss://acp.example.com/v1' : 'https://acp.example.com/v1'"
                />
                <small>
                  {{ formTransport === 'websocket' ? 'WebSocket endpoint (ws:// or wss://)' : 'Streamable HTTP endpoint (http:// or https://)' }}
                </small>
              </div>

              <div class="form-group">
                <label>Headers</label>
                <EnvVarEditor v-model="formHeaders" />
                <small>
                  Authorization headers are sent over the connection. Browser WebSocket APIs
                  cannot attach arbitrary HTTP headers; an <code>Authorization: Bearer &lt;token&gt;</code>
                  header is forwarded as a <code>bearer.&lt;token&gt;</code> WebSocket subprotocol.
                </small>
              </div>
            </template>

            <div v-if="formError" class="form-error">
              {{ formError }}
            </div>

            <div class="form-actions">
              <button
                class="save-btn"
                @click="handleSubmit"
                :disabled="isSubmitting"
              >
                {{ isSubmitting ? '保存中...' : '保存' }}
              </button>
              <button class="cancel-btn" @click="resetForm">
                取消
              </button>
            </div>
          </div>

          <!-- Agent List -->
          <div class="agents-list">
            <div
              v-for="agent in agents"
              :key="agent.name"
              class="agent-item"
            >
              <div class="agent-info">
                <div class="agent-name">
                  {{ agent.name }}
                  <span class="agent-transport-badge" :data-kind="agent.transport">{{ agent.transport }}</span>
                </div>
                <div class="agent-command">
                  <code v-if="agent.transport === 'stdio'">{{ agent.command }} {{ agent.args }}</code>
                  <code v-else>{{ agent.url }}</code>
                </div>
              </div>
              <div class="agent-actions">
                <button class="edit-btn" @click="startEdit(agent)">
                  编辑
                </button>
                <button class="delete-btn" @click="handleDelete(agent.name)">
                  删除
                </button>
              </div>
            </div>

            <div v-if="agents.length === 0" class="no-agents">
              暂未配置智能体，请点击上方按钮添加！
            </div>
          </div>
        </section>

        <!-- Proxy Settings Section -->
        <section class="proxy-section">
          <div class="section-header">
            <h3>网络代理</h3>
          </div>
          <div class="proxy-box">
            <div class="proxy-row">
              <label class="proxy-toggle-label">
                <input
                  type="checkbox"
                  :checked="proxyEnabled"
                  @change="toggleProxy"
                />
                <span>启用全局网络代理</span>
              </label>
            </div>
            <div v-if="proxyEnabled" class="proxy-inputs">
              <div class="form-group">
                <label>Proxy URL</label>
                <div class="proxy-input-group">
                  <input
                    v-model="proxyUrl"
                    type="text"
                    placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:7890"
                  />
                  <button
                    class="save-btn proxy-save-btn"
                    @click="handleSaveProxy"
                    :disabled="isSavingProxy"
                  >
                    {{ isSavingProxy ? 'Saving...' : '保存代理' }}
                  </button>
                </div>
                <small class="proxy-hint">
                  启用后将自动注入 <code>HTTP_PROXY</code>, <code>HTTPS_PROXY</code>, <code>ALL_PROXY</code> 环境变量给 Oh My Pi 及其他本地 stdio Agent。
                </small>
              </div>
              <div class="preset-group">
                <span class="preset-label">常用预设：</span>
                <button type="button" class="preset-chip" @click="applyProxyPreset('http://127.0.0.1:7890')">Clash / Mihomo (7890)</button>
                <button type="button" class="preset-chip" @click="applyProxyPreset('http://127.0.0.1:10809')">v2rayN (10809)</button>
                <button type="button" class="preset-chip" @click="applyProxyPreset('socks5://127.0.0.1:7890')">SOCKS5 (7890)</button>
              </div>
            </div>
            <div v-if="proxyMessage" class="proxy-success-msg">
              {{ proxyMessage }}
            </div>
          </div>
        </section>

        <section class="config-section">
          <h3>配置文件路径</h3>
          <p class="config-path">{{ configStore.configPath }}</p>
          <small>对该文件的修改将被自动监测并热重载。</small>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.65);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.default-agent-section {
  padding-bottom: 1.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}

.settings-section-desc {
  margin: 0.25rem 0 0.85rem 0;
  font-size: 0.825rem;
  color: rgba(255, 255, 255, 0.55);
}

.default-agent-picker-box {
  max-width: 340px;
}


.agent-transport-badge {
  display: inline-block;
  margin-left: 0.5rem;
  padding: 0.15rem 0.6rem;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  vertical-align: middle;
  background: rgba(52, 211, 153, 0.15);
  color: #34D399;
  border: 1px solid rgba(52, 211, 153, 0.35);
}
.agent-transport-badge[data-kind='websocket'],
.agent-transport-badge[data-kind='http'] {
  background: rgba(124, 156, 196, 0.18);
  color: #7C9CC4;
  border-color: rgba(124, 156, 196, 0.35);
}

.settings-panel {
  position: relative;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 24px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(3, 7, 18, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  overflow: hidden;
}

.settings-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.12), transparent 48px);
  pointer-events: none;
}

.settings-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.settings-header h2 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #FFFFFF;
}

.close-btn {
  border: none;
  background: transparent;
  font-size: 1.25rem;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.50);
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  transition: var(--transition-spring);
}

.close-btn:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.12);
}

.settings-content {
  position: relative;
  z-index: 1;
  padding: 1.5rem;
  overflow-y: auto;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.section-header h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #FFFFFF;
}

.add-btn {
  padding: 0.45rem 0.95rem;
  border: 1px solid var(--accent-champagne-border);
  background: var(--accent-champagne-bg);
  color: var(--accent-champagne-light);
  border-radius: 14px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  transition: var(--transition-spring);
  box-shadow: var(--accent-champagne-shadow);
}

.add-btn:hover:not(:disabled) {
  background: var(--accent-champagne-hover-bg);
  border-color: var(--accent-champagne-hover-border);
  transform: translateY(-1px);
}

.add-btn:disabled {
  opacity: 0.40;
  cursor: not-allowed;
}

.agent-form {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 1.25rem;
  border-radius: 16px;
  margin-bottom: 1.25rem;
  backdrop-filter: blur(40px) saturate(180%);
}

.agent-form h4 {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: #FFFFFF;
}

.form-group {
  margin-bottom: 0.85rem;
}

.form-group label {
  display: block;
  font-size: 0.825rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.70);
  margin-bottom: 0.35rem;
}

.form-group input {
  width: 100%;
  padding: 0.6rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  font-size: 0.9rem;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px) saturate(180%);
  color: #FFFFFF;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(2, 6, 16, 0.30);
  transition: var(--transition-spring);
}

.form-group input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.form-group small {
  display: block;
  margin-top: 0.3rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.50);
}

.form-error {
  color: #F87171;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.form-actions {
  display: flex;
  gap: 0.65rem;
  margin-top: 1rem;
}

.save-btn {
  padding: 0.55rem 1.15rem;
  background: var(--accent-champagne-bg);
  border: 1px solid var(--accent-champagne-border);
  color: var(--accent-champagne-light);
  border-radius: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--accent-champagne-shadow);
  transition: var(--transition-spring);
}

.save-btn:hover:not(:disabled) {
  background: var(--accent-champagne-hover-bg);
  border-color: var(--accent-champagne-hover-border);
  transform: translateY(-1px);
}

.save-btn:disabled {
  opacity: 0.40;
  cursor: not-allowed;
}

.cancel-btn {
  padding: 0.55rem 1.15rem;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.80);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  cursor: pointer;
  transition: var(--transition-spring);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #FFFFFF;
}

.agents-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.agent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  backdrop-filter: blur(40px) saturate(180%);
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-weight: 500;
  color: #FFFFFF;
  margin-bottom: 0.25rem;
}

.agent-command {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.50);
}

.agent-command code {
  background: rgba(6, 10, 19, 0.75);
  padding: 0.2rem 0.45rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  word-break: break-all;
  color: #F3DCA8;
}

.agent-actions {
  display: flex;
  gap: 0.5rem;
  margin-left: 1rem;
}

.edit-btn,
.delete-btn {
  padding: 0.35rem 0.65rem;
  border-radius: 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.edit-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: rgba(255, 255, 255, 0.80);
}

.edit-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
}

.delete-btn {
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.35);
  color: #FCA5A5;
}

.delete-btn:hover {
  background: rgba(248, 113, 113, 0.22);
  color: #FFFFFF;
}

.no-agents {
  text-align: center;
  padding: 2rem;
  color: rgba(255, 255, 255, 0.50);
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 16px;
}

.config-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.config-section h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #FFFFFF;
}

.config-path {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: #F3DCA8;
  background: rgba(6, 10, 19, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 0.65rem 0.85rem;
  border-radius: 14px;
  word-break: break-all;
  margin-bottom: 0.35rem;
}

.config-section small {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.50);
}

.proxy-section {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.proxy-box {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  backdrop-filter: blur(40px) saturate(180%);
}

.proxy-toggle-label {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  cursor: pointer;
  font-weight: 500;
  color: #FFFFFF;
}

.proxy-inputs {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding-top: 0.5rem;
}

.proxy-input-group {
  display: flex;
  gap: 0.65rem;
}

.proxy-input-group input {
  flex: 1;
  padding: 0.6rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  color: #FFFFFF;
  font-size: 0.875rem;
}

.proxy-save-btn {
  white-space: nowrap;
  padding: 0.6rem 1.15rem;
  background: var(--accent-champagne-bg);
  border: 1px solid var(--accent-champagne-border);
  color: var(--accent-champagne-light);
  border-radius: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-spring);
}

.proxy-save-btn:hover {
  background: var(--accent-champagne-hover-bg);
}

.preset-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.preset-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.50);
}

.preset-chip {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  padding: 0.25rem 0.65rem;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.80);
  cursor: pointer;
  transition: var(--transition-spring);
}

.preset-chip:hover {
  border-color: rgba(228, 184, 99, 0.50);
  color: #F3DCA8;
  background: rgba(228, 184, 99, 0.12);
}

.quick-env-actions {
  margin-top: 0.4rem;
}

.proxy-hint {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.50);
  margin-top: 0.25rem;
}

.proxy-success-msg {
  font-size: 0.8rem;
  color: #34D399;
  font-weight: 500;
}
</style>
