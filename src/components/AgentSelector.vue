<script setup lang="ts">
import { computed, watch } from 'vue';
import { useConfigStore } from '../stores/config';
import { restrictedTransports } from '../lib/platform';

const emit = defineEmits<{
  select: [agentName: string];
}>();

const configStore = useConfigStore();

const selectedAgent = defineModel<string>('selected', { default: '' });

const agents = computed(() => configStore.agentNames);
const hasAgents = computed(() => configStore.hasAgents);
const configPath = computed(() => configStore.configPath);
// On mobile / web the config-file path is not actionable (sandbox /
// localStorage). Point users at the Settings dialog instead of the path.
const restricted = restrictedTransports();

/** Build the display label for each agent once, instead of calling
 * `getAgentTransportKind` twice per option in the template. */
const agentLabels = computed<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  for (const name of agents.value) {
    out[name] = name;
  }
  return out;
});

// Auto-select Oh My Pi by default when agents are available and none selected
watch(agents, (newAgents) => {
  if (newAgents.length > 0 && !selectedAgent.value) {
    const omp = newAgents.find((a) => a.toLowerCase().includes('oh my pi') || a.toLowerCase() === 'omp');
    const defaultAgent = omp || newAgents[0];
    selectedAgent.value = defaultAgent;
    emit('select', defaultAgent);
  }
}, { immediate: true });

function handleSelect(event: Event) {
  const target = event.target as HTMLSelectElement;
  selectedAgent.value = target.value;
  if (target.value) {
    emit('select', target.value);
  }
}
</script>

<template>
  <div class="agent-selector">
    <label for="agent-select">智能体:</label>
    <div class="select-container" :class="{ disabled: !hasAgents }">
      <span class="select-arrow-prefix">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
      <select 
        id="agent-select" 
        :value="selectedAgent"
        @change="handleSelect"
        :disabled="!hasAgents"
      >
        <option value="" disabled>
          {{ hasAgents ? '请选择智能体...' : '未配置智能体' }}
        </option>
        <option v-for="agent in agents" :key="agent" :value="agent">
          {{ agentLabels[agent] }}
        </option>
      </select>
    </div>
    
    <div v-if="!hasAgents" class="config-hint">
      <template v-if="restricted">
        <p>未配置远程智能体。</p>
        <p class="hint-action">点击设置 (⚙) 添加智能体。</p>
      </template>
      <template v-else>
        <p>未检测到智能体，请添加至配置文件:</p>
        <code>{{ configPath }}</code>
      </template>
    </div>
  </div>
</template>

<style scoped>
.agent-selector {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

label {
  font-size: 0.8rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
}

.select-container {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(2, 6, 16, 0.30);
  transition: var(--transition-spring);
  padding: 0 0.85rem;
}

.select-container:hover:not(.disabled) {
  border-color: rgba(255, 255, 255, 0.30);
  background: rgba(255, 255, 255, 0.09);
}

.select-container:focus-within {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.select-container.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.select-arrow-prefix {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #E4B863;
  margin-right: 0.55rem;
  flex-shrink: 0;
  pointer-events: none;
  transition: var(--transition-spring);
}

select {
  flex: 1;
  width: 100%;
  padding: 0.65rem 0;
  border: none !important;
  background: transparent !important;
  background-color: transparent !important;
  border-radius: 0 !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  box-shadow: none !important;
  outline: none !important;
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  color: #FFFFFF;
  font-size: 0.875rem;
  cursor: pointer;
}

select:focus {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}
select option {
  background: #0B1322;
  color: #FFFFFF;
  padding: 0.5rem;
}

select:disabled {
  opacity: 0.40;
  cursor: not-allowed;
}

.config-hint {
  margin-top: 0.5rem;
  padding: 0.85rem 1rem;
  background: rgba(228, 184, 99, 0.08);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid rgba(228, 184, 99, 0.25);
  border-radius: 16px;
  font-size: 0.8rem;
  color: #F3DCA8;
}

.hint-action {
  margin-top: 0.25rem;
  font-weight: 500;
  color: #E4B863;
}

.config-hint code {
  display: block;
  margin-top: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: rgba(6, 10, 19, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  word-break: break-all;
  color: #FFFFFF;
}
</style>
