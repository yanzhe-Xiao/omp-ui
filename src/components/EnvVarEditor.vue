<script setup lang="ts">
import { ref, watch, computed } from 'vue';

interface EnvVar {
  key: string;
  value: string;
}

const props = defineProps<{
  modelValue: Record<string, string>;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, string>): void;
}>();

const envVars = ref<EnvVar[]>([]);

// Convert Record to array for editing
watch(
  () => props.modelValue,
  (newValue) => {
    envVars.value = Object.entries(newValue || {}).map(([key, value]) => ({
      key,
      value,
    }));
  },
  { immediate: true }
);

// Emit changes when envVars change
function emitUpdate() {
  const result: Record<string, string> = {};
  for (const env of envVars.value) {
    if (env.key.trim()) {
      result[env.key.trim()] = env.value;
    }
  }
  emit('update:modelValue', result);
}

function addEnvVar() {
  envVars.value.push({ key: '', value: '' });
}

function removeEnvVar(index: number) {
  envVars.value.splice(index, 1);
  emitUpdate();
}

function onKeyChange(index: number, event: Event) {
  const input = event.target as HTMLInputElement;
  envVars.value[index].key = input.value;
  emitUpdate();
}

function onValueChange(index: number, event: Event) {
  const input = event.target as HTMLInputElement;
  envVars.value[index].value = input.value;
  emitUpdate();
}

const hasEnvVars = computed(() => envVars.value.length > 0);
</script>

<template>
  <div class="env-var-editor">
    <div class="env-header">
      <span class="env-label">Environment Variables</span>
      <button type="button" class="add-env-btn" @click="addEnvVar">
        + Add
      </button>
    </div>

    <div v-if="hasEnvVars" class="env-list">
      <div v-for="(env, index) in envVars" :key="index" class="env-row">
        <input
          type="text"
          class="env-key"
          placeholder="KEY"
          :value="env.key"
          @input="onKeyChange(index, $event)"
        />
        <span class="env-equals">=</span>
        <input
          type="text"
          class="env-value"
          placeholder="value"
          :value="env.value"
          @input="onValueChange(index, $event)"
        />
        <button
          type="button"
          class="remove-env-btn"
          @click="removeEnvVar(index)"
          title="Remove"
        >
          ✕
        </button>
      </div>
    </div>

    <div v-else class="env-empty">
      No environment variables configured.
    </div>
  </div>
</template>

<style scoped>
.env-var-editor {
  margin-top: 0.5rem;
}

.env-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.env-label {
  font-size: 0.825rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.70);
}

.add-env-btn {
  background: var(--accent-champagne-bg);
  border: 1px solid var(--accent-champagne-border);
  color: var(--accent-champagne-light);
  padding: 0.3rem 0.65rem;
  border-radius: 12px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  transition: var(--transition-spring);
}

.add-env-btn:hover {
  background: var(--accent-champagne-hover-bg);
}

.env-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.env-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.env-key {
  flex: 0 0 130px;
  padding: 0.45rem 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #F3DCA8;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
  transition: var(--transition-spring);
}

.env-equals {
  color: rgba(255, 255, 255, 0.50);
  padding: 0 0.15rem;
}

.env-value {
  flex: 1;
  padding: 0.45rem 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #FFFFFF;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
  transition: var(--transition-spring);
}

.remove-env-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.40);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  font-size: 1rem;
  border-radius: 12px;
  transition: var(--transition-spring);
}

.remove-env-btn:hover {
  color: #F87171;
  background: rgba(248, 113, 113, 0.12);
}

.env-empty {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.45);
  font-style: italic;
}

.env-key:focus,
.env-value:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 3px rgba(228, 184, 99, 0.18);
}
</style>
