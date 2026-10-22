<script setup lang="ts">
import { computed } from 'vue';
import type { ToolCallInfo } from '../lib/types';

const props = defineProps<{
  toolCall: ToolCallInfo;
}>();

const statusClass = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return 'status-pending';
    case 'in_progress': return 'status-running';
    case 'completed': return 'status-completed';
    case 'failed': return 'status-failed';
    default: return '';
  }
});

const statusIcon = computed(() => {
  switch (props.toolCall.status) {
    case 'pending': return '⏳';
    case 'in_progress': return '⚙️';
    case 'completed': return '✅';
    case 'failed': return '❌';
    default: return '🔧';
  }
});

const kindIcon = computed(() => {
  switch (props.toolCall.kind) {
    case 'read': return '📖';
    case 'edit': return '✏️';
    case 'write': return '📝';
    case 'execute': return '▶️';
    default: return '🔧';
  }
});
</script>

<template>
  <div class="tool-call-card" :class="statusClass">
    <div class="tool-header">
      <span class="kind-icon">{{ kindIcon }}</span>
      <span class="tool-title">{{ toolCall.title }}</span>
      <span class="status-icon">{{ statusIcon }}</span>
    </div>
    
    <div v-if="toolCall.locations?.length" class="tool-locations">
      <div 
        v-for="(loc, index) in toolCall.locations" 
        :key="index"
        class="location"
      >
        📁 {{ loc.path }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-call-card {
  padding: 0.85rem 1.15rem;
  border-radius: 16px;
  margin: 0.5rem 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  box-shadow: 0 4px 16px rgba(3, 7, 18, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition: var(--transition-spring);
}

.status-pending {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.status-running {
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(96, 165, 250, 0.08);
}

.status-completed {
  border-color: rgba(52, 211, 153, 0.35);
  background: rgba(52, 211, 153, 0.08);
}

.status-failed {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.kind-icon {
  font-size: 1rem;
}

.tool-title {
  flex: 1;
  font-weight: 500;
  font-size: 0.875rem;
  color: #FFFFFF;
}

.status-icon {
  font-size: 0.85rem;
}

.tool-locations {
  margin-top: 0.5rem;
  padding-left: 1.65rem;
}

.location {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.60);
  padding: 0.15rem 0;
}
</style>
