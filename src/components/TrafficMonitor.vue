<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue';
import { useTrafficStore, type TrafficEntry } from '../stores/traffic';

const emit = defineEmits<{
  close: [];
  resize: [height: number];
}>();

const trafficStore = useTrafficStore();
const expandedIds = ref<Set<string>>(new Set());
const logContainer = ref<HTMLElement | null>(null);
const autoScroll = ref(true);

// Resize handling
const isResizing = ref(false);
const panelHeight = ref(220);
const MIN_HEIGHT = 100;
const MAX_HEIGHT = window.innerHeight * 0.7;

function startResize(e: MouseEvent) {
  isResizing.value = true;
  e.preventDefault();
  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'ns-resize';
  document.body.style.userSelect = 'none';
}

function doResize(e: MouseEvent) {
  if (!isResizing.value) return;
  const newHeight = window.innerHeight - e.clientY;
  panelHeight.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, newHeight));
  emit('resize', panelHeight.value);
}

function stopResize() {
  isResizing.value = false;
  document.removeEventListener('mousemove', doResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onUnmounted(() => {
  document.removeEventListener('mousemove', doResize);
  document.removeEventListener('mouseup', stopResize);
});

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit',
  }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
}

function toggleExpand(id: string) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id);
  } else {
    expandedIds.value.add(id);
  }
  // Force reactivity
  expandedIds.value = new Set(expandedIds.value);
}

function formatJson(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function getEntryClass(entry: TrafficEntry): string {
  const classes = ['entry', entry.direction];
  if (entry.error) classes.push('error');
  return classes.join(' ');
}

function getDirectionIcon(entry: TrafficEntry): string {
  return entry.direction === 'out' ? '→' : '←';
}

function getTypeLabel(entry: TrafficEntry): string {
  if (entry.type === 'notification') {
    return '(notification)';
  } else if (entry.type === 'response') {
    return '(response)';
  }
  return '';
}

// Auto-scroll when new entries arrive
watch(() => trafficStore.entries.length, async () => {
  if (autoScroll.value && logContainer.value && !trafficStore.isPaused) {
    await nextTick();
    logContainer.value.scrollTop = logContainer.value.scrollHeight;
  }
});

function handleScroll() {
  if (!logContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = logContainer.value;
  // Disable auto-scroll if user scrolled up
  autoScroll.value = scrollTop + clientHeight >= scrollHeight - 50;
}

function handleCopy(entry: TrafficEntry) {
  navigator.clipboard.writeText(formatJson(entry.payload));
}
</script>

<template>
  <div class="traffic-monitor" :style="{ height: panelHeight + 'px' }">
    <!-- Resize Handle -->
    <div 
      class="resize-handle" 
      @mousedown="startResize"
      title="Drag to resize"
    ></div>
    
    <div class="monitor-header">
      <span class="title">
        <svg class="traffic-title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
          <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fill="currentColor" fill-opacity="0.3" />
          <path d="M12 3a9 9 0 0 1 9 9" />
          <path d="M12 7a5 5 0 0 1 5 5" />
          <path d="M12 17v4" />
          <path d="M9 21h6" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
        <span>通信监控</span>
      </span>
      <div class="controls">
        <button 
          class="control-btn"
          :class="{ active: trafficStore.isPaused }"
          @click="trafficStore.togglePause()"
          :title="trafficStore.isPaused ? '恢复监听' : '暂停监听'"
        >
          {{ trafficStore.isPaused ? '▶ 恢复' : '⏸ 暂停' }}
        </button>
        
        <button 
          class="control-btn"
          @click="trafficStore.clear()"
          title="清空记录"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="13" height="13">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        
        <div class="search-container">
          <span class="search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input 
            type="text"
            class="search-input"
            placeholder="搜索通信消息..."
            :value="trafficStore.searchQuery"
            @input="trafficStore.setSearch(($event.target as HTMLInputElement).value)"
          />
          <button 
            v-if="trafficStore.searchQuery"
            class="search-clear-btn"
            @click="trafficStore.clearSearch()"
            title="清除搜索"
          >
            ×
          </button>
        </div>
        
        <span v-if="trafficStore.searchQuery" class="match-count">
          {{ trafficStore.filteredEntries.length }} 项匹配
        </span>
        
        <select 
          class="filter-select"
          :value="trafficStore.filter"
          @change="trafficStore.setFilter(($event.target as HTMLSelectElement).value as any)"
        >
          <option value="all">全部</option>
          <option value="requests">请求</option>
          <option value="responses">响应</option>
          <option value="notifications">通知</option>
        </select>
      </div>
      
      <button class="close-btn" @click="emit('close')" title="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
    
    <div 
      class="log-container" 
      ref="logContainer"
      @scroll="handleScroll"
    >
      <div v-if="trafficStore.filteredEntries.length === 0" class="empty-state">
        暂无通信记录。连接智能体后在此查看 ACP 交互消息。
      </div>
      
      <div 
        v-for="entry in trafficStore.filteredEntries" 
        :key="entry.id"
        :class="getEntryClass(entry)"
      >
        <div class="entry-header" @click="toggleExpand(entry.id)">
          <span class="expand-icon">{{ expandedIds.has(entry.id) ? '▾' : '▸' }}</span>
          <span class="timestamp">{{ formatTime(entry.timestamp) }}</span>
          <span class="direction-icon">{{ getDirectionIcon(entry) }}</span>
          <span class="method">{{ entry.method }}</span>
          <span class="type-label">{{ getTypeLabel(entry) }}</span>
          <span v-if="entry.requestId !== undefined" class="request-id">#{{ entry.requestId }}</span>
          <button 
            class="copy-btn" 
            @click.stop="handleCopy(entry)"
            title="Copy JSON"
          >
            📋
          </button>
        </div>
        
        <div v-if="expandedIds.has(entry.id)" class="entry-payload">
          <pre>{{ formatJson(entry.payload) }}</pre>
        </div>
      </div>
    </div>
    
    <div v-if="trafficStore.isPaused" class="paused-indicator">
      ⏸ 监控已暂停
    </div>
  </div>
</template>

<style scoped>
.traffic-monitor {
  display: flex;
  flex-direction: column;
  background: rgba(11, 19, 34, 0.88);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  font-size: 0.8rem;
  position: relative;
  box-shadow: 0 -8px 32px rgba(3, 7, 18, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

.resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 6px;
  cursor: ns-resize;
  background: transparent;
  z-index: 10;
}

.resize-handle:hover,
.resize-handle:active {
  background: #E4B863;
  opacity: 0.6;
}

.monitor-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}

.title {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  margin-right: auto;
  color: #FFFFFF;
}

.traffic-title-icon {
  width: 16px;
  height: 16px;
  color: #E4B863;
  flex-shrink: 0;
}

.controls {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.control-btn {
  padding: 0.3rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  font-size: 0.75rem;
  transition: var(--transition-spring);
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #FFFFFF;
}

.control-btn.active {
  background: rgba(228, 184, 99, 0.18);
  border-color: rgba(228, 184, 99, 0.45);
  color: #F3DCA8;
}

.search-container {
  display: flex;
  align-items: center;
  position: relative;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 0.15rem 0.45rem;
}

.search-icon {
  font-size: 0.7rem;
  opacity: 0.6;
  color: rgba(255, 255, 255, 0.7);
}

.search-input {
  width: 140px;
  padding: 0.25rem 0.45rem;
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  color: #FFFFFF;
  font-size: 0.75rem;
  outline: none !important;
}

.search-input:focus {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}

.search-container:focus-within {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.40);
}

.search-clear-btn {
  padding: 0 0.25rem;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.40);
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  transition: var(--transition-spring);
}

.search-clear-btn:hover {
  color: #FFFFFF;
}

.match-count {
  font-size: 0.7rem;
  color: #E4B863;
  white-space: nowrap;
}

.filter-select {
  padding: 0.3rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #FFFFFF;
  font-size: 0.75rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.filter-select option {
  background: #0B1322;
  color: #FFFFFF;
}

.close-btn {
  padding: 0.25rem 0.5rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  color: rgba(255, 255, 255, 0.50);
  border-radius: 12px;
  transition: var(--transition-spring);
}

.close-btn:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.10);
}

.log-container {
  flex: 1;
  overflow-y: auto;
  font-family: var(--font-mono);
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: rgba(255, 255, 255, 0.40);
}

.entry {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.entry-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 1rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.entry-header:hover {
  background: rgba(255, 255, 255, 0.08);
}

.expand-icon {
  color: rgba(255, 255, 255, 0.45);
  width: 1em;
}

.timestamp {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.7rem;
}

.direction-icon {
  font-weight: bold;
  width: 1em;
}

.entry.out .direction-icon {
  color: #60A5FA;
}

.entry.in .direction-icon {
  color: #34D399;
}

.entry.error .direction-icon,
.entry.error .method {
  color: #F87171;
}

.method {
  font-weight: 600;
  color: #FFFFFF;
}

.type-label {
  color: rgba(255, 255, 255, 0.45);
  font-size: 0.7rem;
}

.request-id {
  color: #E4B863;
  font-size: 0.7rem;
  margin-left: auto;
}

.copy-btn {
  padding: 0.15rem 0.35rem;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.75rem;
  opacity: 0;
  transition: opacity var(--transition-spring);
}

.entry-header:hover .copy-btn {
  opacity: 1;
}

.entry-payload {
  padding: 0.65rem 1rem 0.85rem 2.25rem;
  background: rgba(6, 10, 19, 0.75);
  overflow-x: auto;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.entry-payload pre {
  margin: 0;
  color: #E2E8F0;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
}

.paused-indicator {
  position: absolute;
  bottom: 0.65rem;
  right: 0.65rem;
  padding: 0.3rem 0.65rem;
  background: rgba(228, 184, 99, 0.15);
  border: 1px solid rgba(228, 184, 99, 0.35);
  border-radius: 12px;
  font-size: 0.72rem;
  color: #F3DCA8;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
}
</style>
