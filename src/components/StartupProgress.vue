<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  agentName: string;
  phase: string;
  logs: string[];
  elapsedSeconds: number;
  showDetails: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  toggleDetails: [];
}>();

const phaseIcon = computed(() => {
  switch (props.phase) {
    case 'starting': return '🚀';
    case 'downloading': return '📥';
    case 'installing': return '📦';
    case 'building': return '🔨';
    case 'initializing': return '⚙️';
    case 'connecting': return '🔗';
    default: return '⏳';
  }
});

const phaseText = computed(() => {
  switch (props.phase) {
    case 'starting': return 'Starting process...';
    case 'downloading': return 'Downloading packages...';
    case 'installing': return 'Installing dependencies...';
    case 'building': return 'Building...';
    case 'initializing': return 'Initializing agent...';
    case 'connecting': return 'Connecting to agent...';
    default: return 'Please wait...';
  }
});

const formattedTime = computed(() => {
  const mins = Math.floor(props.elapsedSeconds / 60);
  const secs = props.elapsedSeconds % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
});

const isLongWait = computed(() => props.elapsedSeconds > 10);
</script>

<template>
  <div class="startup-progress">
    <div class="progress-header">
      <span class="agent-name">Connecting to {{ agentName }}...</span>
      <span class="elapsed-time">{{ formattedTime }}</span>
    </div>
    
    <div class="progress-status">
      <span class="phase-icon">{{ phaseIcon }}</span>
      <span class="phase-text">{{ phaseText }}</span>
    </div>
    
    <div v-if="isLongWait && !showDetails" class="first-run-hint">
      First run may take longer while dependencies are installed.
    </div>
    
    <div class="progress-actions">
      <button 
        class="details-btn"
        @click="emit('toggleDetails')"
      >
        {{ showDetails ? 'Hide Details ▲' : 'Show Details ▼' }}
      </button>
      <button 
        class="cancel-btn"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </div>
    
    <div v-if="showDetails" class="logs-container">
      <div class="logs-header">Output</div>
      <div class="logs-content">
        <div 
          v-for="(log, index) in logs.slice(-50)" 
          :key="index"
          class="log-line"
        >
          {{ log }}
        </div>
        <div v-if="logs.length === 0" class="no-logs">
          Waiting for output...
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.startup-progress {
  padding: 1.15rem;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 20px;
  margin-top: 0.85rem;
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(2, 6, 16, 0.30);
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.agent-name {
  font-weight: 600;
  color: #FFFFFF;
  font-size: 0.9rem;
}

.elapsed-time {
  font-size: 0.75rem;
  color: #E4B863;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.progress-status {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.85rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  margin-bottom: 0.75rem;
}

.phase-icon {
  font-size: 1.15rem;
}

.phase-text {
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.85rem;
}

.first-run-hint {
  font-size: 0.75rem;
  color: #F3DCA8;
  font-style: italic;
  margin-bottom: 0.75rem;
  padding: 0.6rem 0.85rem;
  background: rgba(228, 184, 99, 0.10);
  border: 1px solid rgba(228, 184, 99, 0.28);
  border-radius: 14px;
}

.progress-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.details-btn {
  padding: 0.45rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.80);
  font-size: 0.8rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.details-btn:hover {
  background: rgba(255, 255, 255, 0.14);
  color: #FFFFFF;
}

.cancel-btn {
  padding: 0.45rem 0.85rem;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 12px;
  background: rgba(248, 113, 113, 0.12);
  color: #FCA5A5;
  font-size: 0.8rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.cancel-btn:hover {
  background: rgba(248, 113, 113, 0.22);
  border-color: rgba(248, 113, 113, 0.55);
  color: #FFFFFF;
}

.logs-container {
  margin-top: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  overflow: hidden;
  background: rgba(6, 10, 19, 0.75);
}

.logs-header {
  padding: 0.45rem 0.75rem;
  background: rgba(255, 255, 255, 0.06);
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.80);
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
}

.logs-content {
  max-height: 150px;
  overflow-y: auto;
  padding: 0.65rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
}

.log-line {
  color: #E2E8F0;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.45;
}

.no-logs {
  color: rgba(255, 255, 255, 0.40);
  font-style: italic;
}
</style>
