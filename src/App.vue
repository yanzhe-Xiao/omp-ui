<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { loadKvStore, isDesktop, type KVStore } from './lib/host';
import { useConfigStore } from './stores/config';
import { useSessionStore } from './stores/session';
import { initTelemetry } from './lib/telemetry';

import SessionList from './components/SessionList.vue';
import ChatView from './components/ChatView.vue';
import PermissionDialog from './components/PermissionDialog.vue';
import SettingsView from './components/SettingsView.vue';
import AuthMethodDialog from './components/AuthMethodDialog.vue';
import TrafficMonitor from './components/TrafficMonitor.vue';
import ModelPicker from './components/ModelPicker.vue';
import ThinkingPicker from './components/ThinkingPicker.vue';
import CommandPalette from './components/CommandPalette.vue';
import type { SlashCommand } from './lib/types';

import type { SavedSession } from './lib/types';

const configStore = useConfigStore();
const sessionStore = useSessionStore();

const selectedAgent = ref('Oh My Pi');
const selectedCwd = ref('');
// On mobile / web there is no native folder picker (and the cwd refers to
// a path on the *agent's* machine, not the local device), so we expose a
const showSidebar = ref(true);
const showSettings = ref(false);
const showTrafficMonitor = ref(false);


const availableModels = computed(() => sessionStore.availableModels);
const currentModelId = computed(() => sessionStore.currentModelId);
const availableThinkingLevels = computed(() => sessionStore.availableThinkingLevels);
const currentThinkingLevel = computed(() => sessionStore.currentThinkingLevel);
const promptSuggestions = computed(() => sessionStore.promptSuggestions);
const heroAttachedImages = ref<Array<{ data: string; mimeType: string; previewUrl: string; name?: string }>>([]);
const heroFileInputRef = ref<HTMLInputElement | null>(null);

async function processHeroImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const rawBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    heroAttachedImages.value.push({
      data: rawBase64,
      mimeType: file.type || 'image/png',
      name: file.name,
      previewUrl: dataUrl,
    });
  };
  reader.readAsDataURL(file);
}

async function handleHeroPaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) {
        await processHeroImageFile(file);
      }
    }
  }
}

async function handleHeroDrop(event: DragEvent) {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (!files) return;
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      await processHeroImageFile(file);
    }
  }
}

function handleHeroFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    for (const file of Array.from(input.files)) {
      if (file.type.startsWith('image/')) {
        processHeroImageFile(file);
      }
    }
  }
  input.value = '';
}
const heroInputText = ref('');
const availableCommands = computed(() => sessionStore.availableCommands);
const heroCommandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);

const showHeroCommandPalette = computed(() => {
  if (availableCommands.value.length === 0) return false;
  const text = heroInputText.value;
  if (!text.startsWith('/')) return false;
  const spaceIndex = text.indexOf(' ');
  return spaceIndex === -1;
});

const heroCommandFilter = computed(() => {
  if (!heroInputText.value.startsWith('/')) return '';
  return heroInputText.value.slice(1);
});

function handleHeroCommandSelect(command: SlashCommand) {
  heroInputText.value = `/${command.name} `;
}
// Reactive flag tracking whether the viewport is narrow enough to show the
// sidebar as a slide-in drawer (mobile / very narrow desktop windows). Used
// by the template to decide when the backdrop is interactive and by
// onMounted to default the drawer closed.
const isNarrowLayout = ref(false);
let narrowMql: MediaQueryList | null = null;
function syncNarrowLayout() {
  if (narrowMql) isNarrowLayout.value = narrowMql.matches;
}

// Foreground-reconnect plumbing. Mobile OSes freeze the WebView when the
// app is backgrounded and routers may drop the idle TCP connection while
// we're away. When the user returns we ask the session store to silently
// reattach to the last session if we have one.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReconnect() {
  // Coalesce rapid visibility/online flips into a single attempt.
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // Skip if the browser still thinks we're offline; we'll be re-triggered
    // by the `online` event when connectivity returns.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    void sessionStore.tryReconnect();
  }, 250);
}
function handleVisibilityChange() {
  if (typeof document !== 'undefined' && !document.hidden) scheduleReconnect();
}
function handleOnline() {
  scheduleReconnect();
}

// Preferences store for persisting user selections
let prefsStore: KVStore | null = null;

const isConnected = computed(() => sessionStore.isConnected);
const isLoading = computed(() => sessionStore.isLoading);
const isConnecting = computed(() => sessionStore.isConnecting);
const isReconnecting = computed(() => sessionStore.isReconnecting);
const error = computed(() => sessionStore.error || configStore.error);

// Name of the agent the reconnect banner refers to. Falls back to the
// generic "agent" if the saved session has no name (shouldn't happen).
const reconnectingAgentName = computed(
  () => sessionStore.currentSession?.agentName ?? 'agent'
);

// True when there is a saved session we *could* reconnect to but the
// transport is currently down. Surfaces a manual "Reconnect" affordance on
// the error banner so users don't have to background+foreground the app to
// trigger the auto path.
const canManuallyReconnect = computed(
  () =>
    !isConnected.value &&
    !isReconnecting.value &&
    !isConnecting.value &&
    !!sessionStore.currentSession?.supportsLoadSession
);

async function handleManualReconnect() {
  await sessionStore.tryReconnect();
}

// Watch for permission requests from session store
const pendingPermission = computed(() => sessionStore.pendingPermission);

// Watch for auth method selection requests
const pendingAuthMethods = computed(() => sessionStore.pendingAuthMethods);
const pendingAuthAgentName = computed(() => sessionStore.pendingAuthAgentName);

onMounted(async () => {
  // Track viewport width so the sidebar can default-collapse into a drawer
  // on phones / narrow windows. We watch a MediaQueryList rather than
  // resize for correctness across orientation changes on iOS.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    narrowMql = window.matchMedia('(max-width: 800px)');
    syncNarrowLayout();
    narrowMql.addEventListener('change', syncNarrowLayout);
    if (isNarrowLayout.value) showSidebar.value = false;
  }

  // Load persisted preferences first
  prefsStore = await loadKvStore('preferences.json');
  
  // Initialize telemetry (check user preference)
  const telemetryEnabled = await prefsStore.get<boolean>('telemetryEnabled') ?? true;
  await initTelemetry(telemetryEnabled);
  
  // Initialize stores
  await configStore.loadConfig();
  await configStore.setupHotReload();
  await sessionStore.initStore();
  
  const savedCwd = await prefsStore.get<string>('lastCwd');
  if (savedCwd) {
    selectedCwd.value = savedCwd;
  }

  // Hook foreground-reconnect listeners. `pageshow` fires both on initial
  // navigation and when iOS restores a frozen WebView from the back/forward
  // cache, so it complements `visibilitychange` on Safari/iOS.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', scheduleReconnect);
    window.addEventListener('online', handleOnline);
  }
});

function isTmpCwd(cwd?: string | null): boolean {
  if (!cwd) return true;
  const lower = cwd.toLowerCase();
  return lower.includes('appdata\\local\\temp') || lower.includes('/tmp') || lower.includes('\\tmp');
}

function getFolderName(pathStr: string): string {
  const parts = pathStr.split(/[\\/]/).filter(Boolean);
  return parts.pop() || pathStr;
}

async function handleNewSession(preferredCwd?: string) {
  if (sessionStore.isConnected && !preferredCwd) {
    if (sessionStore.currentSession?.cwd && !isTmpCwd(sessionStore.currentSession.cwd)) {
      selectedCwd.value = sessionStore.currentSession.cwd;
    }
    await sessionStore.disconnect();
    return;
  }

  const targetCwd = preferredCwd || selectedCwd.value || sessionStore.currentSession?.cwd;
  if (targetCwd && !isTmpCwd(targetCwd)) {
    selectedCwd.value = targetCwd;
  }

  const agent = selectedAgent.value || configStore.agentNames[0] || 'Oh My Pi';
  selectedAgent.value = agent;

  let cwd = selectedCwd.value?.trim() || sessionStore.defaultCwd || '.';
  selectedCwd.value = cwd;

  try {
    if (sessionStore.isConnected) {
      await sessionStore.disconnect();
    }
    if (isDesktop()) {
      await sessionStore.createSession(agent, cwd);
    }
  } catch (e) {
    console.error('Failed to create session:', e);
  }
}

async function handleNewProjectChat(projectCwd: string) {
  selectedCwd.value = projectCwd;
  const agent = selectedAgent.value || configStore.agentNames[0] || 'Oh My Pi';
  selectedAgent.value = agent;

  try {
    if (sessionStore.isConnected) {
      await sessionStore.disconnect();
    }
    if (isDesktop()) {
      await sessionStore.createSession(agent, projectCwd);
    }
  } catch (e) {
    console.error('Failed to create session in project workspace:', e);
  }
}

async function handleSendHeroPrompt(promptText?: string) {
  const text = (typeof promptText === 'string' ? promptText : heroInputText.value).trim();
  if ((!text && heroAttachedImages.value.length === 0) || isLoading.value) return;

  const imagesToSend = heroAttachedImages.value.map(img => ({
    data: img.data,
    mimeType: img.mimeType,
  }));
  heroInputText.value = '';
  heroAttachedImages.value = [];
  const agent = selectedAgent.value || configStore.agentNames[0] || 'Oh My Pi';
  selectedAgent.value = agent;

  let cwd = selectedCwd.value?.trim() || sessionStore.defaultCwd || '.';
  selectedCwd.value = cwd;

  try {
    await sessionStore.createSession(agent, cwd);
    await sessionStore.sendPrompt(text, imagesToSend);
  } catch (e) {
    console.error('Failed to create session and send prompt:', e);
  }
}

function handleHeroKeyDown(event: KeyboardEvent) {
  if (showHeroCommandPalette.value && heroCommandPaletteRef.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      heroCommandPaletteRef.value.handleKeyDown(event);
      return;
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendHeroPrompt();
  }
}

async function handleResumeSession(session: SavedSession) {
  selectedAgent.value = session.agentName;
  try {
    await sessionStore.resumeSession(session);
  } catch (e) {
    console.error('Failed to resume session:', e);
  }
}

async function handleDeleteSession(sessionId: string) {
  await sessionStore.deleteSession(sessionId);
}


function handlePermissionSelect(optionId: string) {
  sessionStore.resolvePermission(optionId);
}

function handlePermissionCancel() {
  sessionStore.cancelPermission();
}

function handleAuthMethodSelect(methodId: string) {
  sessionStore.selectAuthMethod(methodId);
}

function handleAuthMethodCancel() {
  sessionStore.cancelAuthSelection();
}

function toggleSidebar() {
  showSidebar.value = !showSidebar.value;
}

/** Close the drawer when the user taps the backdrop on a narrow viewport. */
function handleBackdropClick() {
  if (isNarrowLayout.value) showSidebar.value = false;
}

onBeforeUnmount(() => {
  if (narrowMql) {
    narrowMql.removeEventListener('change', syncNarrowLayout);
    narrowMql = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('pageshow', scheduleReconnect);
    window.removeEventListener('online', handleOnline);
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
});

function clearError() {
  sessionStore.clearError();
  configStore.clearError();
}
</script>

<template>
  <div class="app-container" :class="{ 'narrow-layout': isNarrowLayout }">
    <!-- Sidebar with slide & collapse transition -->
    <Transition name="sidebar-dock">
      <aside
        v-if="showSidebar"
        class="sidebar"
        :class="{ 'is-drawer': isNarrowLayout }"
      >
      <div class="sidebar-header">
        <div class="brand-group">
          <span class="brand-glow-dot"></span>
          <h1>OMP UI</h1>
        </div>
        <div class="header-actions">
          <button 
            class="settings-btn glass-btn" 
            :class="{ active: showTrafficMonitor }"
            @click="showTrafficMonitor = !showTrafficMonitor" 
            title="流量监控"
          >
            <!-- Custom Vector Radar Icon -->
            <svg class="header-action-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fill="currentColor" fill-opacity="0.3" />
              <path d="M12 3a9 9 0 0 1 9 9" />
              <path d="M12 7a5 5 0 0 1 5 5" />
              <path d="M12 17v4" />
              <path d="M9 21h6" />
            </svg>
          </button>
          <button class="settings-btn glass-btn" @click="showSettings = true" title="设置">
            <!-- Custom Vector Gear Icon -->
            <svg class="header-action-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button class="toggle-btn glass-btn" @click="toggleSidebar" title="收起侧边栏">
            <!-- Custom Vector Panel Collapse Icon -->
            <svg class="header-action-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M9 3v18" />
              <path d="M15 15l-3-3 3-3" />
            </svg>
          </button>
        </div>
      </div>
      
      <div class="sidebar-content">
        <!-- Main Tree Section (Takes all available space!) -->
        <div class="sidebar-main-tree">
          <SessionList 
            @new-chat="handleNewSession"
            @new-project-chat="handleNewProjectChat"
            @resume="handleResumeSession"
            @delete="handleDeleteSession"
          />
        </div>
      </div>
    </aside>
    </Transition>
    <!-- Backdrop behind the drawer on narrow viewports. Only intercepts
         taps when the layout is narrow; on desktop it's display:none. -->
    <div
      v-show="isNarrowLayout && showSidebar"
      class="drawer-backdrop"
      @click="handleBackdropClick"
    />

    <!-- Mobile hamburger to open the drawer when collapsed. The desktop
         chevron toggle (`.sidebar-toggle-collapsed`) is hidden on narrow
         viewports via CSS so we don't show two affordances. -->
    <button
      v-show="isNarrowLayout && !showSidebar"
      class="mobile-hamburger"
      @click="showSidebar = true"
      aria-label="Open menu"
    >☰</button>

    <!-- Floating expand button when sidebar is collapsed on welcome screen -->
    <Transition name="fade-fast">
      <button 
        v-if="!showSidebar && !isConnected && !isNarrowLayout" 
        class="sidebar-expand-float-btn glass-btn"
        @click="showSidebar = true"
        title="展开侧边栏"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <rect x="3" y="3" width="18" height="18" rx="4" />
          <path d="M9 3v18" />
          <path d="M13 9l3 3-3 3" />
        </svg>
      </button>
    </Transition>
    
    <!-- Main Content Area -->
    <div class="main-area">
      <main class="main-content">
        <!-- Reconnect banner takes priority over the error banner: while a
             reconnect is in progress we don't want a contradictory red
             "Connection lost" pill. -->
        <div v-if="isReconnecting" class="reconnect-banner">
          <span class="reconnect-spinner" aria-hidden="true"></span>
          <span class="reconnect-text">
            Reconnecting to <strong>{{ reconnectingAgentName }}</strong>…
          </span>
        </div>

        <!-- Error display (suppressed while reconnecting). -->
        <div v-else-if="error" class="error-banner">
          <span class="error-icon">⚠</span>
          <span class="error-text">{{ error }}</span>
          <button
            v-if="canManuallyReconnect"
            class="error-action"
            @click="handleManualReconnect"
            title="Reconnect"
          >Reconnect</button>
          <button class="error-close" @click="clearError" title="Dismiss">×</button>
        </div>
        
        <!-- Chat View when connected -->
        <ChatView 
          v-if="isConnected" 
          :show-sidebar="showSidebar"
          @toggle-sidebar="showSidebar = true"
          @new-session="(cwd) => handleNewSession(cwd)"
        />
        
        <!-- Welcome screen when not connected -->
        <!-- New Chat / Welcome Hero Screen (Unboxed, serene, matching Codex reference) -->
        <div v-else class="new-chat-hero-screen">
          <div class="hero-center-content">
            <div class="hero-cloud-emblem">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="44" height="44">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
            </div>
            <h1 class="hero-heading">我们要构建什么？</h1>

            <!-- Active Workspace Indicator -->
            <div v-if="selectedCwd && !isTmpCwd(selectedCwd)" class="hero-workspace-pill">
              <svg class="pill-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
              <span>项目工作区: <strong>{{ getFolderName(selectedCwd) }}</strong></span>
              <span class="workspace-pill-path" :title="selectedCwd">({{ selectedCwd }})</span>
            </div>
            <div v-if="promptSuggestions.length > 0" class="hero-chips-row">
              <button 
                v-for="chip in promptSuggestions"
                :key="chip.prompt"
                class="prompt-chip" 
                @click="handleSendHeroPrompt(chip.prompt)"
              >
                <span class="chip-sparkle">{{ chip.icon || '✦' }}</span>
                <span>{{ chip.label }}</span>
              </button>
            </div>
          </div>

          <!-- Bottom Unified Input Card -->
          <div class="hero-input-tray">
            <div 
              class="input-card glass-card" 
              :class="{ 'is-command-active': heroInputText.startsWith('/') }"
              @dragover.prevent
              @drop="handleHeroDrop"
            >
              <!-- Attached Images Preview Bar -->
              <div v-if="heroAttachedImages.length > 0" class="hero-attached-images-tray">
                <div v-for="(img, idx) in heroAttachedImages" :key="idx" class="hero-attached-img-item">
                  <img :src="img.previewUrl" class="hero-attached-thumb" />
                  <button class="remove-img-btn" @click="heroAttachedImages.splice(idx, 1)">✕</button>
                </div>
              </div>

              <CommandPalette
                ref="heroCommandPaletteRef"
                :commands="availableCommands"
                :filter="heroCommandFilter"
                :visible="showHeroCommandPalette"
                @select="handleHeroCommandSelect"
                @close="showHeroCommandPalette = false"
              />
              <textarea
                v-model="heroInputText"
                placeholder="随心输入您的想法或问题... (输入 / 查看快捷指令，支持直接粘贴图片)"
                @keydown="handleHeroKeyDown"
                @paste="handleHeroPaste"
                rows="3"
              />
              <div class="input-card-bottom">
                <div class="input-hints">
                  <button class="attach-image-btn" @click="heroFileInputRef?.click()" title="添加图片 (支持直接粘贴图片 Ctrl+V)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15">
                      <rect x="3" y="3" width="18" height="18" rx="4" />
                      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>
                  <input 
                    ref="heroFileInputRef" 
                    type="file" 
                    accept="image/*" 
                    multiple 
                    style="display: none" 
                    @change="handleHeroFileChange" 
                  />
                  <span class="hint-text">按 <kbd>Enter</kbd> 发送，<kbd>Shift</kbd> + <kbd>Enter</kbd> 换行</span>
                </div>
                <div class="input-card-actions-right">
                  <ModelPicker 
                    :models="availableModels"
                    :current-model-id="currentModelId"
                    placement="top"
                    @change="(m) => sessionStore.setModel(m)"
                  />
                  <ThinkingPicker
                    :levels="availableThinkingLevels"
                    :current-level="currentThinkingLevel"
                    placement="top"
                    @change="(lvl) => sessionStore.setThinkingLevel(lvl)"
                  />
                  <button 
                    class="send-btn champagne-btn"
                    :disabled="!heroInputText.trim() || isLoading"
                    @click="handleSendHeroPrompt()"
                  >
                    <svg class="send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    <span>发送</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      
      <!-- Traffic Monitor Panel -->
      <div v-if="showTrafficMonitor" class="traffic-panel">
        <TrafficMonitor @close="showTrafficMonitor = false" />
      </div>
    </div>
    
    <!-- Permission Dialog -->
    <PermissionDialog 
      v-if="pendingPermission"
      :request="pendingPermission"
      @select="handlePermissionSelect"
      @cancel="handlePermissionCancel"
    />

    <!-- Auth Method Dialog -->
    <AuthMethodDialog 
      v-if="pendingAuthMethods.length > 0"
      :auth-methods="pendingAuthMethods"
      :agent-name="pendingAuthAgentName"
      @select="handleAuthMethodSelect"
      @cancel="handleAuthMethodCancel"
    />

    <!-- Settings -->
    <SettingsView 
      v-if="showSettings"
      v-model:selected-agent="selectedAgent"
      @close="showSettings = false"
    />
  </div>
</template>

<style>
:root {
  --bg-primary: #0066cc;
  --bg-primary-hover: #0052a3;
  --bg-sidebar: #f8f9fa;
  --bg-main: #ffffff;
  --bg-hover: #f0f0f0;
  --bg-user: #e3f2fd;
  --bg-assistant: #f5f5f5;
  --bg-code: #282c34;
  --bg-success: #28a745;
  --bg-danger: #dc3545;
  --bg-warning: #fff3cd;
  --text-primary: #333;
  --text-secondary: #666;
  --text-muted: #999;
  --text-accent: #0066cc;
  --text-code: #abb2bf;
  --border-color: #e0e0e0;
  
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #4da6ff;
    --bg-primary-hover: #3399ff;
    --bg-sidebar: #1e1e1e;
    --bg-main: #252525;
    --bg-hover: #333;
    --bg-user: #1a3a5c;
    --bg-assistant: #2d2d2d;
    --text-primary: #e0e0e0;
    --text-secondary: #a0a0a0;
    --text-muted: #707070;
    --text-accent: #4da6ff;
    --border-color: #404040;
    background-color: #252525;
  }
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #app {
  height: 100%;
}
</style>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 320px;
  min-width: 320px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.sidebar-header h1 {
  font-size: 1.25rem;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 0.25rem;
}

.settings-btn,
.toggle-btn {
  padding: 0.25rem 0.5rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--text-muted);
}

.settings-btn:hover,
.toggle-btn:hover {
  color: var(--text-primary);
}

.settings-btn.active {
  color: var(--text-accent);
  background: var(--bg-hover);
  border-radius: 4px;
}

.sidebar-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-main-tree {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-footer-group {
  flex-shrink: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}

.sidebar-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  gap: 0.5rem;
}

.workspace-status-capsule {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.65rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.75rem;
  cursor: pointer;
  transition: var(--transition-spring);
  flex: 1;
  min-width: 0;
}

.workspace-status-capsule:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(228, 184, 99, 0.35);
  color: #FFFFFF;
}

.status-indicator-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94A3B8;
  flex-shrink: 0;
}

.status-indicator-dot.connected {
  background: #34D399;
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.6);
}

.capsule-agent-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-divider {
  color: rgba(255, 255, 255, 0.30);
}

.capsule-cwd-text {
  color: rgba(255, 255, 255, 0.50);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.capsule-gear-icon {
  color: rgba(255, 255, 255, 0.35);
  margin-left: auto;
  flex-shrink: 0;
}

.quick-disconnect-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 8px;
  background: rgba(248, 113, 113, 0.15);
  border: 1px solid rgba(248, 113, 113, 0.35);
  color: #F87171;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: var(--transition-spring);
}

.quick-disconnect-btn:hover {
  background: rgba(248, 113, 113, 0.25);
  border-color: rgba(248, 113, 113, 0.60);
}

.agent-config-expanded {
  padding: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(6, 10, 19, 0.95);
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.config-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.config-drawer-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: #FFFFFF;
}

.config-close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  font-size: 0.8rem;
}

.section {
  padding: 0.5rem;
  border-bottom: 1px solid var(--border-color);
}
.new-session-btn,
.disconnect-btn {
  width: 100%;
  margin-top: 0.75rem;
  padding: 0.625rem 1rem;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
}

.new-session-btn {
  background: var(--bg-primary);
  color: white;
}

.new-session-btn:hover:not(:disabled) {
  background: var(--bg-primary-hover);
}

.new-session-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cwd-picker {
  margin-top: 0.75rem;
}

.cwd-picker label {
  display: block;
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.cwd-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.cwd-path {
  flex: 1;
  padding: 0.375rem 0.5rem;
  background: var(--bg-main);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.8rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cwd-btn {
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
}

.cwd-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.cwd-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Mobile-only free-text cwd input. */
.cwd-input {
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-main);
  color: var(--text-primary);
  font-size: 16px; /* 16px = no iOS auto-zoom */
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.cwd-input:disabled {
  opacity: 0.5;
}

.disconnect-btn {
  background: var(--bg-danger);
  color: white;
}

.disconnect-btn:hover {
  background: #c82333;
}

/* Sidebar slide in/out spring transition */
.sidebar-dock-enter-active,
.sidebar-dock-leave-active {
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 500ms cubic-bezier(0.16, 1, 0.3, 1),
              margin-left 500ms cubic-bezier(0.16, 1, 0.3, 1);
}

.sidebar-dock-enter-from,
.sidebar-dock-leave-to {
  transform: translateX(-100%);
  opacity: 0;
  margin-left: -320px;
}

/* Floating expand button when sidebar is collapsed */
.sidebar-expand-float-btn {
  position: fixed;
  top: 1.15rem;
  left: 1.25rem;
  z-index: 999;
  width: 36px;
  height: 36px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 12px;
  color: #E4B863;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: var(--transition-spring);
}

.sidebar-expand-float-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(228, 184, 99, 0.45);
  transform: translateY(-1px);
  box-shadow: 0 12px 32px rgba(3, 7, 18, 0.6), 0 0 14px rgba(228, 184, 99, 0.25);
}

.fade-fast-enter-active,
.fade-fast-leave-active {
  transition: opacity 300ms ease, transform 300ms ease;
}

.fade-fast-enter-from,
.fade-fast-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-main);
}

.traffic-panel {
  flex-shrink: 0;
  border-top: 2px solid var(--border-color);
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: #fee;
  color: #c00;
  border-bottom: 1px solid #fcc;
}

.error-icon {
  flex-shrink: 0;
}

.error-text {
  flex: 1;
}

.error-close {
  flex-shrink: 0;
  padding: 0.25rem 0.5rem;
  border: none;
  background: transparent;
  color: #c00;
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0.6;
  border-radius: 4px;
}

.error-close:hover {
  opacity: 1;
  background: rgba(204, 0, 0, 0.1);
}

/* Inline "Reconnect" affordance shown next to a stale error when we have a
   saved session we could reattach to. */
.error-action {
  flex-shrink: 0;
  padding: 0.25rem 0.6rem;
  margin-right: 0.25rem;
  border: 1px solid #c00;
  border-radius: 4px;
  background: transparent;
  color: #c00;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
}

.error-action:hover {
  background: rgba(204, 0, 0, 0.1);
}

/* Foreground-reconnect banner. Distinct visual style from the red error
   banner so users immediately read it as transient progress, not failure. */
.reconnect-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  background: #e0f2fe;
  color: #0369a1;
  border-bottom: 1px solid #bae6fd;
}

.reconnect-text {
  flex: 1;
  font-size: 0.9rem;
}

.reconnect-text strong {
  font-weight: 600;
}

.reconnect-spinner {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: reconnect-spin 0.9s linear infinite;
}

@keyframes reconnect-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-color-scheme: dark) {
  .reconnect-banner {
    background: #082f49;
    color: #7dd3fc;
    border-bottom-color: #0c4a6e;
  }
}

/* New Chat Hero Screen (Unboxed, serene, matching Codex reference) */
.new-chat-hero-screen {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.hero-center-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  text-align: center;
}

.hero-cloud-emblem {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(124, 156, 196, 0.22) 0%, transparent 70%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #7C9CC4;
  margin-bottom: 1.5rem;
}

.hero-heading {
  font-size: 2.15rem;
  font-weight: 500;
  color: #FFFFFF;
  margin: 0 0 1.75rem 0;
  letter-spacing: -0.02em;
}
.hero-workspace-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 1rem;
  margin-top: -0.5rem;
  margin-bottom: 1.5rem;
  border-radius: 9999px;
  background: rgba(124, 156, 196, 0.12);
  border: 1px solid rgba(124, 156, 196, 0.35);
  box-shadow: 0 4px 16px rgba(3, 7, 18, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.20);
  color: #FFFFFF;
  font-size: 0.825rem;
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
}

.hero-workspace-pill .pill-folder-icon {
  color: #7C9CC4;
  flex-shrink: 0;
}

.hero-workspace-pill strong {
  color: #E4B863;
  font-weight: 600;
}

.workspace-pill-path {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.725rem;
  font-family: var(--font-mono);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hero-chips-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  max-width: 680px;
}

.prompt-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.825rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.prompt-chip:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(228, 184, 99, 0.40);
  color: #FFFFFF;
  transform: translateY(-1px);
}

.chip-sparkle {
  color: #E4B863;
  font-size: 0.85rem;
}

.hero-input-tray {
  padding: 0 1.5rem 1.25rem 1.5rem;
  width: 100%;
}

.hero-input-tray .input-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem 1.15rem 0.8rem 1.15rem;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 24px;
  box-shadow: 0 16px 40px rgba(3, 7, 18, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  transition: var(--transition-spring);
  overflow: visible;
}
/* Hero Attached Images */
.hero-attached-images-tray {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 0.35rem 0.25rem 0.5rem 0.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.hero-attached-img-item {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.20);
  background: rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.hero-attached-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.remove-img-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.30);
  color: #FFFFFF;
  font-size: 0.65rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 200ms ease;
}

.remove-img-btn:hover {
  background: rgba(248, 113, 113, 0.85);
  border-color: #F87171;
}

.attach-image-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #E4B863;
  cursor: pointer;
  transition: var(--transition-spring);
  flex-shrink: 0;
}

.attach-image-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(228, 184, 99, 0.45);
  transform: translateY(-0.5px);
}

.hero-input-tray .input-card:hover {
  border-color: rgba(255, 255, 255, 0.28);
  box-shadow: 0 20px 48px rgba(3, 7, 18, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
}

.hero-input-tray .input-card:focus-within {
  border-color: rgba(228, 184, 99, 0.40);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.15), 0 20px 48px rgba(3, 7, 18, 0.60), inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.hero-input-tray .input-card textarea {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 0.25rem 0.25rem;
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  font-size: 0.95rem;
  font-family: var(--font-text);
  color: #FFFFFF;
  resize: none;
  min-height: 56px;
  line-height: 1.55;
}

.hero-input-tray .input-card textarea::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.hero-input-tray .input-card textarea:focus {
  outline: none !important;
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  border: none !important;
}

.hero-input-tray .input-card-bottom {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.hero-input-tray .input-card-actions-right {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-left: auto;
}

.hero-input-tray .input-hints {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.hero-input-tray .hint-text {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.40);
  letter-spacing: 0.01em;
}

.hero-input-tray .hint-text kbd {
  font-family: inherit;
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.75);
}

.hero-input-tray .send-btn {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1.4rem;
  border-radius: 14px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  margin-left: auto;
}

.hero-input-tray .send-icon {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  transform: rotate(-10deg);
  display: block;
}
/* ---------- Mobile / narrow-viewport layout ---------- */

.drawer-backdrop {
  display: none;
}

.mobile-hamburger {
  display: none;
}

@media (max-width: 800px) {
  .app-container {
    /* Prevent the off-screen drawer from causing horizontal scroll. */
    overflow-x: hidden;
  }

  /* Banners sit at the very top of the main area, where the OS status bar
     / camera notch overlap on phones. Extend the banner colour through the
     safe-area inset and push the text below it so the status bar reads as
     a tinted continuation of the banner instead of clipping its content. */
  .reconnect-banner,
  .error-banner {
    padding-top: calc(0.75rem + env(safe-area-inset-top, 0px));
  }

  .sidebar.is-drawer {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 85vw;
    max-width: 360px;
    z-index: 100;
    box-shadow: 2px 0 16px rgba(0, 0, 0, 0.3);
    /* Honour iOS notch / Android status bar. */
    padding-top: env(safe-area-inset-top, 0px);
  }

  .drawer-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 90;
  }

  /* Hide the desktop chevron when the mobile hamburger is in play. */
  .sidebar-toggle-collapsed {
    display: none;
  }

  .mobile-hamburger {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
    left: 0.5rem;
    z-index: 50;
    width: 44px;
    height: 44px;
    padding: 0;
    background: var(--bg-sidebar);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    font-size: 1.25rem;
    cursor: pointer;
    color: var(--text-primary);
  }

  /* Tap-target sizing for the icon buttons inside the sidebar header. */
  .settings-btn,
  .toggle-btn {
    min-width: 40px;
    min-height: 40px;
    font-size: 1rem;
  }

  /* Honour the iOS home indicator at the bottom of the main area. */
  .main-area {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}
</style>