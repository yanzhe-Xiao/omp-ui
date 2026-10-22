<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { renderMarkdown } from '../lib/markdown';
import { useSessionStore } from '../stores/session';
import { isMobile } from '../lib/platform';
import ModePicker from './ModePicker.vue';
import ModelPicker from './ModelPicker.vue';
import ThinkingPicker from './ThinkingPicker.vue';
import CommandPalette from './CommandPalette.vue';
import type { SlashCommand } from '../lib/types';

withDefaults(defineProps<{
  showSidebar?: boolean;
}>(), {
  showSidebar: true,
});

const emit = defineEmits<{
  (e: 'newSession', cwd?: string): void;
  (e: 'toggleSidebar'): void;
}>();

function isTmpCwd(cwd?: string | null): boolean {
  if (!cwd) return true;
  const lower = cwd.toLowerCase();
  return lower.includes('appdata\\local\\temp') || lower.includes('/tmp') || lower.includes('\\tmp');
}

function getFolderName(pathStr: string): string {
  const parts = pathStr.split(/[\\/]/).filter(Boolean);
  return parts.pop() || pathStr;
}
const sessionStore = useSessionStore();
const inputText = ref('');
const isInputFocused = ref(false);
const attachedImages = ref<Array<{ data: string; mimeType: string; previewUrl: string; name?: string }>>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const messagesContainer = ref<HTMLElement | null>(null);
const commandPaletteRef = ref<InstanceType<typeof CommandPalette> | null>(null);

async function processImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    const rawBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    attachedImages.value.push({
      data: rawBase64,
      mimeType: file.type || 'image/png',
      name: file.name,
      previewUrl: dataUrl,
    });
  };
  reader.readAsDataURL(file);
}

async function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) {
        await processImageFile(file);
      }
    }
  }
}

async function handleDrop(event: DragEvent) {
  event.preventDefault();
  const files = event.dataTransfer?.files;
  if (!files) return;
  for (const file of Array.from(files)) {
    if (file.type.startsWith('image/')) {
      await processImageFile(file);
    }
  }
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) {
    for (const file of Array.from(input.files)) {
      if (file.type.startsWith('image/')) {
        processImageFile(file);
      }
    }
  }
  input.value = '';
}
// On mobile (iOS/Android) the soft-keyboard's Return key should insert a
// newline like every other native chat app; submitting is the dedicated
// Send button. On desktop, Enter still submits and Shift+Enter newlines.
const submitOnEnter = !isMobile();

// Track expanded thought sections by message id
const expandedThoughts = ref<Set<string>>(new Set());

const messages = computed(() => sessionStore.messageList);
const isLoading = computed(() => sessionStore.isLoading);
const isReconnecting = computed(() => sessionStore.isReconnecting);
const currentSession = computed(() => sessionStore.currentSession);
const availableModes = computed(() => sessionStore.availableModes);
const currentModeId = computed(() => sessionStore.currentModeId);
const availableModels = computed(() => sessionStore.availableModels);
const currentModelId = computed(() => sessionStore.currentModelId);
const availableCommands = computed(() => sessionStore.availableCommands);


const availableThinkingLevels = computed(() => sessionStore.availableThinkingLevels);
const currentThinkingLevel = computed(() => sessionStore.currentThinkingLevel);

async function handleThinkingLevelChange(levelId: string) {
  try {
    await sessionStore.setThinkingLevel(levelId);
  } catch (e) {
    console.error('Failed to change thinking level:', e);
  }
}
// Slash command state
const showCommandPalette = computed(() => {
  if (availableCommands.value.length === 0) return false;
  const text = inputText.value;
  // Show palette when input starts with "/" and cursor is after it
  if (!text.startsWith('/')) return false;
  // Don't show if there's a space (command already entered)
  const spaceIndex = text.indexOf(' ');
  return spaceIndex === -1;
});

const commandFilter = computed(() => {
  if (!inputText.value.startsWith('/')) return '';
  return inputText.value.slice(1); // Remove the leading "/"
});

// Auto-scroll to bottom with requestAnimationFrame to coalesce rapid streaming chunks
let scrollRafId: number | null = null;
watch(messages, () => {
  if (scrollRafId !== null) return;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}, { deep: true });

async function handleSend() {
  const text = inputText.value.trim();
  if ((!text && attachedImages.value.length === 0) || isLoading.value) return;

  const imagesToSend = attachedImages.value.map(img => ({
    data: img.data,
    mimeType: img.mimeType,
  }));

  inputText.value = '';
  attachedImages.value = [];

  try {
    await sessionStore.sendPrompt(text, imagesToSend);
  } catch (e) {
    console.error('Failed to send prompt:', e);
  }
}

function handleKeyDown(event: KeyboardEvent) {
  // Let CommandPalette handle navigation keys when visible
  if (showCommandPalette.value && commandPaletteRef.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
      commandPaletteRef.value.handleKeyDown(event);
      return;
    }
  }

  // Enter-to-send is desktop only. On mobile we let the textarea insert a
  // newline like every other native chat app and require an explicit tap
  // on the Send button.
  if (submitOnEnter && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
}

function handleCommandSelect(command: SlashCommand) {
  // Replace current input with the command
  if (command.hint) {
    inputText.value = `/${command.name} `;
  } else {
    inputText.value = `/${command.name} `;
  }
}

function handleCommandClose() {
  // Just dismiss, keep the text
}

function handleCancel() {
  sessionStore.cancelOperation();
}

async function handleModeChange(modeId: string) {
  try {
    await sessionStore.setMode(modeId);
  } catch (e) {
    console.error('Failed to change mode:', e);
  }
}

async function handleModelChange(modelId: string) {
  try {
    await sessionStore.setModel(modelId);
  } catch (e) {
    console.error('Failed to change model:', e);
  }
}

function isThoughtExpanded(messageId: string): boolean {
  return expandedThoughts.value.has(messageId);
}

function toggleThought(messageId: string): void {
  if (expandedThoughts.value.has(messageId)) {
    expandedThoughts.value.delete(messageId);
  } else {
    expandedThoughts.value.add(messageId);
  }
}


</script>

<template>
  <div class="chat-view">
    <div class="chat-header">
      <div class="header-left">
        <Transition name="expand-pill">
          <button 
            v-if="!showSidebar" 
            class="header-expand-btn glass-btn specular-sweep"
            @click="emit('toggleSidebar')"
            title="展开侧边栏"
          >
            <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <path d="M9 3v18" />
              <path d="M13 9l3 3-3 3" />
            </svg>
          </button>
        </Transition>
        <div class="header-title-group">
          <h2>{{ currentSession?.title || 'Chat' }}</h2>
          <div class="header-badges">
            <span v-if="currentSession?.agentName" class="agent-badge">{{ currentSession.agentName }}</span>
            <span v-if="currentSession?.cwd && !isTmpCwd(currentSession.cwd)" class="cwd-badge" :title="currentSession.cwd">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="11" height="11">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
              <span>{{ getFolderName(currentSession.cwd) }}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="header-right">
        <ModelPicker 
          :models="availableModels"
          :current-model-id="currentModelId"
          :disabled="isLoading"
          @change="handleModelChange"
        />
        <ThinkingPicker
          :levels="availableThinkingLevels"
          :current-level="currentThinkingLevel"
          :disabled="isLoading"
          @change="handleThinkingLevelChange"
        />
        <ModePicker 
          v-if="availableModes.length > 0"
          :modes="availableModes"
          :current-mode-id="currentModeId"
          :disabled="isLoading"
          @change="handleModeChange"
        />
        <button
          class="header-new-session-btn champagne-btn specular-sweep"
          @click="emit('newSession', currentSession?.cwd)"
          title="在此工作区开启新会话"
        >
          + 新建会话
        </button>
      </div>
    </div>
    <div ref="messagesContainer" class="messages-container">
      <div 
        v-for="message in messages" 
        :key="message.id"
        v-show="Boolean(message.content || message.thought || (message.toolCalls && message.toolCalls.length > 0))"
        :class="['message', `message-${message.role}`]"
      >
        <div class="message-header">
          <span class="role-avatar" :class="message.role === 'user' ? 'user-avatar' : 'assistant-avatar'">
            <svg v-if="message.role === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="12" height="12">
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" fill="currentColor" fill-opacity="0.25" />
            </svg>
          </span>
          <span class="role">{{ message.role === 'user' ? '用户' : '智能助手' }}</span>
          <span v-if="message.role === 'assistant' && currentSession?.agentName" class="agent-tag">
            {{ currentSession.agentName }}
          </span>
        </div>
        <!-- User Attached Images -->
        <div v-if="message.images?.length" class="message-images-row">
          <div v-for="(img, idx) in message.images" :key="idx" class="message-img-card">
            <img :src="img.previewUrl || (img.data.startsWith('data:') ? img.data : `data:${img.mimeType || 'image/png'};base64,${img.data}`)" class="message-img-thumb" alt="User image" />
          </div>
        </div>
        <!-- Agent thinking section (collapsible) - shown first to explain reasoning -->
        <div v-if="message.thought && message.role === 'assistant'" class="thought-section">
          <button class="thought-toggle" @click="toggleThought(message.id)">
            <span class="thought-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
                <circle cx="8" cy="12" r="1" fill="currentColor" />
                <circle cx="12" cy="12" r="1" fill="currentColor" />
                <circle cx="16" cy="12" r="1" fill="currentColor" />
              </svg>
            </span>
            <span class="thought-label">{{ isThoughtExpanded(message.id) ? '隐藏思考过程' : '展开思考过程' }}</span>
            <svg class="thought-chevron" :class="{ 'is-expanded': isThoughtExpanded(message.id) }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div v-if="isThoughtExpanded(message.id)" class="thought-content">
            <div v-html="renderMarkdown(message.thought)" />
          </div>
        </div>
        
        <!-- Tool calls for this message (shown after thinking) -->
        <div v-if="message.toolCalls?.length" class="tool-calls-section">
          <div 
            v-for="tc in message.toolCalls" 
            :key="tc.toolCallId"
            :class="['tool-call-inline', `tool-${tc.status}`]"
          >
            <span class="tool-icon">
              <!-- Read -->
              <svg v-if="tc.kind === 'read'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <!-- Edit / Write -->
              <svg v-else-if="tc.kind === 'edit' || tc.kind === 'write'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              <!-- Execute / Terminal -->
              <svg v-else-if="tc.kind === 'execute'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <!-- Search -->
              <svg v-else-if="tc.kind === 'search'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <!-- Default Tool -->
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </span>
            <span class="tool-name">{{ tc.title }}</span>
            <span v-if="tc.overview || tc.locations?.length" class="tool-overview" :title="tc.overview || tc.locations?.[0]?.path">
              {{ tc.overview || tc.locations?.[0]?.path }}
            </span>
            <span :class="['tool-status', `status-${tc.status}`]">
              <svg v-if="tc.status === 'completed'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span v-else-if="tc.status === 'in_progress'" class="tool-spinner"></span>
              <svg v-else-if="tc.status === 'failed'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </span>
          </div>
        </div>
        
        <div 
          v-if="message.content"
          class="message-content"
          v-html="renderMarkdown(message.content)"
        />
      </div>
      
      <!-- Loading indicator -->
      <div v-if="isLoading" class="loading-indicator">
        <span class="spinner"></span>
        <span>思考中...</span>
        <button class="cancel-btn" @click="handleCancel">取消</button>
      </div>
    </div>
    
    <div class="input-tray">
      <div 
        class="input-card glass-card" 
        :class="{ 
          'is-focused': isInputFocused,
          'is-command-active': inputText.startsWith('/') 
        }"
        @dragover.prevent
        @drop="handleDrop"
      >
        <!-- Attached Images Preview Bar -->
        <div v-if="attachedImages.length > 0" class="attached-images-tray">
          <div v-for="(img, idx) in attachedImages" :key="idx" class="attached-img-item">
            <img :src="img.previewUrl" class="attached-thumb" />
            <button class="remove-img-btn" @click="attachedImages.splice(idx, 1)">✕</button>
          </div>
        </div>

        <!-- Active slash command pill tag -->
        <div v-if="inputText.startsWith('/')" class="command-active-pill">
          <svg class="pill-spark" viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span class="pill-cmd">{{ inputText.split(' ')[0] }}</span>
          <span v-if="inputText.indexOf(' ') !== -1" class="pill-args">{{ inputText.slice(inputText.indexOf(' ')) }}</span>
        </div>
        <CommandPalette
          ref="commandPaletteRef"
          :commands="availableCommands"
          :filter="commandFilter"
          :visible="showCommandPalette"
          @select="handleCommandSelect"
          @close="handleCommandClose"
        />
        <textarea
          v-model="inputText"
          :placeholder="
            isReconnecting
              ? '正在重连…'
              : (availableCommands.length > 0
                  ? '输入您的消息... (输入 / 查看快捷指令，支持直接粘贴图片)'
                  : '输入您的消息... (支持直接粘贴图片)')
          "
          :disabled="isLoading || isReconnecting"
          @keydown="handleKeyDown"
          @paste="handlePaste"
          @focus="isInputFocused = true"
          @blur="isInputFocused = false"
          rows="3"
        />
        <div class="input-card-bottom">
          <div class="input-hints">
            <!-- Image upload button -->
            <button class="attach-image-btn" @click="fileInputRef?.click()" title="添加图片 (支持直接粘贴图片 Ctrl+V)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <input 
              ref="fileInputRef" 
              type="file" 
              accept="image/*" 
              multiple 
              style="display: none" 
              @change="handleFileChange" 
            />
            <span v-if="!isMobile()" class="hint-text">按 <kbd>Enter</kbd> 发送，<kbd>Shift</kbd> + <kbd>Enter</kbd> 换行</span>
          </div>
          <button 
            class="send-btn champagne-btn specular-sweep"
            :disabled="!inputText.trim() || isLoading || isReconnecting"
            @click="handleSend"
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
</template>

<style scoped>
.chat-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  position: relative;
  background: transparent;
  overflow: hidden;
}

/* Glass Chat Header */
.chat-header {
  position: relative;
  flex-shrink: 0;
  padding: 0 1.5rem;
  min-height: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border-radius: 0 !important;
  border: none !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10) !important;
  box-shadow: 0 4px 20px rgba(3, 7, 18, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  z-index: 100;
  overflow: visible !important;
}

.chat-header::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.10), transparent 36px);
  pointer-events: none;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}

.chat-header h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #FFFFFF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}
.header-title-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.header-badges {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.cwd-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.55rem;
  border-radius: 9999px;
  background: rgba(124, 156, 196, 0.12);
  border: 1px solid rgba(124, 156, 196, 0.30);
  color: #7C9CC4;
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.cwd-badge svg {
  flex-shrink: 0;
}

.header-expand-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  color: #E4B863;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(3, 7, 18, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.25);
  transition: var(--transition-spring);
  flex-shrink: 0;
}

.header-expand-btn:hover {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(228, 184, 99, 0.45);
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.55), 0 0 12px rgba(228, 184, 99, 0.25);
}

.header-expand-btn .expand-icon {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  color: #E4B863;
  display: block;
}
.expand-pill-enter-active,
.expand-pill-leave-active {
  transition: opacity 500ms cubic-bezier(0.16, 1, 0.3, 1),
              transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
}

.expand-pill-enter-from,
.expand-pill-leave-to {
  opacity: 0;
  transform: translateX(-16px) scale(0.92);
}

.agent-badge {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0.25rem 0.65rem;
  border-radius: 9999px;
  color: #E4B863;
  border: 1px solid rgba(228, 184, 99, 0.32);
  letter-spacing: 0.04em;
  box-shadow: 0 0 12px rgba(228, 184, 99, 0.15);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-shrink: 0;
}

.header-new-session-btn {
  padding: 0.45rem 0.9rem;
  font-size: 0.825rem;
  border-radius: 14px;
}

.messages-container {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  -webkit-overflow-scrolling: touch;
}

.messages-container::-webkit-scrollbar {
  width: 8px;
}

.messages-container::-webkit-scrollbar-track {
  background: transparent;
}

.messages-container::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 9999px;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background: rgba(228, 184, 99, 0.50);
}
/* Nocturne Glass Messages */
.message {
  position: relative;
  flex-shrink: 0;
  min-height: fit-content;
  padding: 1.25rem 1.5rem;
  border-radius: 24px;
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  transition: border-color 300ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 300ms cubic-bezier(0.16, 1, 0.3, 1);
  overflow: hidden;
  content-visibility: auto;
  contain-intrinsic-size: 0 120px;
}

.message::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.12), transparent 40px);
  pointer-events: none;
  border-radius: inherit;
}

.message-user {
  background: rgba(255, 255, 255, 0.11);
  border: 1px solid rgba(255, 255, 255, 0.22);
  box-shadow: 0 16px 40px rgba(3, 7, 18, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  margin-left: 3.5rem;
  align-self: flex-end;
  max-width: 85%;
}

.message-user:hover {
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 20px 48px rgba(3, 7, 18, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.35), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
}

.message-assistant {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 16px 40px rgba(3, 7, 18, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  margin-right: 3.5rem;
  align-self: flex-start;
  max-width: 90%;
}

.message-assistant:hover {
  border-color: rgba(255, 255, 255, 0.30);
  box-shadow: 0 20px 48px rgba(3, 7, 18, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.30), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
}

.message-header {
  position: relative;
  z-index: 1;
  margin-bottom: 0.65rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.role-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.user-avatar {
  background: rgba(228, 184, 99, 0.15);
  border: 1px solid rgba(228, 184, 99, 0.35);
  color: #F3DCA8;
  box-shadow: 0 0 10px rgba(228, 184, 99, 0.2);
}

.assistant-avatar {
  background: rgba(124, 156, 196, 0.15);
  border: 1px solid rgba(124, 156, 196, 0.35);
  color: #7C9CC4;
  box-shadow: 0 0 10px rgba(124, 156, 196, 0.2);
}

.agent-tag {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.65);
  margin-left: 0.35rem;
}

.role {
  font-weight: 600;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.80);
  letter-spacing: 0.02em;
}

.message-user .role {
  color: #F3DCA8;
}

.tool-spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 1.5px solid rgba(96, 165, 250, 0.3);
  border-top-color: #60A5FA;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
/* Tool calls inline styles */
.tool-calls-section {
  position: relative;
  z-index: 1;
  margin-bottom: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.tool-call-inline {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.5rem 0.85rem;
  border-radius: 14px;
  font-size: 0.8rem;
  background: rgba(6, 10, 19, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.tool-pending {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.06);
}

.tool-in_progress {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.06);
}

.tool-completed {
  border-color: rgba(52, 211, 153, 0.35);
  background: rgba(52, 211, 153, 0.06);
}

.tool-failed {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.06);
}
.tool-icon {
  font-size: 0.9rem;
}

.tool-name {
  font-weight: 600;
  font-family: var(--font-mono);
  color: #60A5FA;
  padding: 0.1rem 0.45rem;
  border-radius: 6px;
  background: rgba(96, 165, 250, 0.12);
  border: 1px solid rgba(96, 165, 250, 0.25);
  font-size: 0.72rem;
  flex-shrink: 0;
}

.tool-overview {
  flex: 1;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.8rem;
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}
.tool-status {
  font-size: 0.75rem;
  font-weight: 600;
}

.status-pending { color: #FBBF24; }
.status-in_progress { color: #60A5FA; }
.status-completed { color: #34D399; }
.status-failed { color: #F87171; }

.message-content {
  position: relative;
  z-index: 1;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.85);
  overflow-wrap: break-word;
  word-wrap: break-word;
  font-size: 0.95rem;
}

.message-content :deep(p) {
  margin: 0.5rem 0;
}

.message-content :deep(ol),
.message-content :deep(ul) {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}

.message-content :deep(li) {
  margin: 0.35rem 0;
}

.message-content :deep(pre) {
  background: rgba(6, 10, 19, 0.75);
  color: #F1F5F9;
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 1rem;
  border-radius: 16px;
  overflow-x: auto;
  box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.4);
  margin: 0.75rem 0;
}

.message-content :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.message-content :deep(:not(pre) > code) {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #F3DCA8;
  padding: 0.15rem 0.4rem;
  border-radius: 10px;
}

/* Loading indicator */
.loading-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 1.25rem;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.70);
  font-size: 0.875rem;
  align-self: flex-start;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: #E4B863;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.cancel-btn {
  margin-left: 0.5rem;
  padding: 0.25rem 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.75rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
}

/* Attached Images Preview in Input Card */
.attached-images-tray {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 0.35rem 0.25rem 0.5rem 0.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.attached-img-item {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.20);
  background: rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}

.attached-thumb {
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

/* User Message Images Row */
.message-images-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-bottom: 0.65rem;
}

.message-img-card {
  max-width: 280px;
  max-height: 200px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.20);
  background: rgba(0, 0, 0, 0.25);
}

.message-img-thumb {
  width: 100%;
  height: 100%;
  max-height: 200px;
  object-fit: cover;
  display: block;
}
/* All-in-One Unified Input Tray & Card */
.input-tray {
  position: relative;
  flex-shrink: 0;
  padding: 0.5rem 1.5rem 1.25rem 1.5rem;
  background: transparent;
  width: 100%;
}

.input-card {
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

.input-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.10), transparent 48px);
  pointer-events: none;
}

.input-card:hover {
  border-color: rgba(255, 255, 255, 0.28);
  box-shadow: 0 20px 48px rgba(3, 7, 18, 0.58), inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
}

.input-card:focus-within,
.input-card.is-focused {
  border-color: rgba(228, 184, 99, 0.40);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.15), 0 20px 48px rgba(3, 7, 18, 0.60), inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.input-card.is-command-active {
  border-color: rgba(228, 184, 99, 0.55);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.22), 0 20px 48px rgba(228, 184, 99, 0.20), inset 0 1px 0 rgba(243, 220, 168, 0.35);
}

.command-active-pill {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  align-self: flex-start;
  padding: 0.3rem 0.75rem;
  border-radius: 12px;
  background: rgba(228, 184, 99, 0.15);
  border: 1px solid rgba(228, 184, 99, 0.40);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 600;
  color: #F3DCA8;
  box-shadow: 0 4px 14px rgba(228, 184, 99, 0.15);
}

.pill-spark {
  font-size: 0.85rem;
  color: #E4B863;
}

.pill-cmd {
  color: #F3DCA8;
  font-weight: 700;
}

.pill-args {
  color: rgba(255, 255, 255, 0.65);
  font-weight: normal;
}

.input-card textarea,
.chat-view textarea {
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
  transition: color 500ms cubic-bezier(0.16, 1, 0.3, 1);
}

.input-card textarea::placeholder,
.chat-view textarea::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.input-card textarea:focus,
.chat-view textarea:focus {
  outline: none !important;
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  border: none !important;
}

.input-card-bottom {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.input-hints {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.hint-text {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.40);
  letter-spacing: 0.01em;
}

.hint-text kbd {
  font-family: inherit;
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.75);
}

.send-btn {
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

.send-icon {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  transform: rotate(-10deg);
  display: block;
}

/* Agent Thinking Section */
.thought-section {
  position: relative;
  z-index: 1;
  margin-bottom: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
}

.thought-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.6rem 0.95rem;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
  color: rgba(255, 255, 255, 0.75);
  text-align: left;
  transition: var(--transition-spring);
}

.thought-toggle:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #FFFFFF;
}

.thought-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.thought-label {
  flex: 1;
  font-weight: 500;
}

.thought-chevron {
  width: 14px;
  height: 14px;
  color: rgba(255, 255, 255, 0.50);
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
  display: block;
}

.thought-chevron.is-expanded {
  transform: rotate(180deg);
}

.thought-content {
  padding: 0.85rem 1.15rem;
  background: rgba(6, 10, 19, 0.40);
  border-top: 1px solid rgba(255, 255, 255, 0.10);
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.6;
}

/* Mobile layout tweaks */
@media (max-width: 800px) {
  .chat-header {
    padding-top: calc(1rem + env(safe-area-inset-top, 0px));
    padding-left: calc(44px + 1rem);
  }

  .chat-header h2 {
    display: none;
  }

  .message-user {
    margin-left: 1rem;
    max-width: 90%;
  }

  .message-assistant {
    margin-right: 1rem;
    max-width: 95%;
  }
  .input-tray {
    padding: 0.5rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom, 0px)) 0.75rem;
  }

  .input-hints {
    display: none;
  }
  textarea {
    font-size: 16px;
    min-height: 44px;
  }

  .send-btn {
    min-width: 64px;
    min-height: 44px;
  }
}
</style>
