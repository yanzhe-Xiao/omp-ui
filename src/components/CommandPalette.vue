<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import type { SlashCommand } from '../lib/types';

const props = defineProps<{
  commands: SlashCommand[];
  filter: string;
  visible: boolean;
}>();

const emit = defineEmits<{
  select: [command: SlashCommand];
  close: [];
}>();

const selectedIndex = ref(0);

const listRef = ref<HTMLElement | null>(null);

function scrollToSelected() {
  nextTick(() => {
    if (!listRef.value) return;
    const selectedEl = listRef.value.querySelector('.command-item.selected') as HTMLElement | null;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

watch(selectedIndex, () => {
  scrollToSelected();
});

// Filter commands based on input
const filteredCommands = computed(() => {
  const filterText = props.filter.toLowerCase();
  if (!filterText) return props.commands;
  return props.commands.filter(cmd => 
    cmd.name.toLowerCase().startsWith(filterText) ||
    cmd.description.toLowerCase().includes(filterText)
  );
});

// Reset selection when filter or visibility changes
watch([() => props.filter, () => props.visible], () => {
  selectedIndex.value = 0;
});

function handleKeyDown(event: KeyboardEvent) {
  if (!props.visible || filteredCommands.value.length === 0) return;
  
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      selectedIndex.value = (selectedIndex.value + 1) % filteredCommands.value.length;
      break;
    case 'ArrowUp':
      event.preventDefault();
      selectedIndex.value = (selectedIndex.value - 1 + filteredCommands.value.length) % filteredCommands.value.length;
      break;
    case 'Enter':
      event.preventDefault();
      if (filteredCommands.value[selectedIndex.value]) {
        emit('select', filteredCommands.value[selectedIndex.value]);
      }
      break;
    case 'Escape':
      event.preventDefault();
      emit('close');
      break;
    case 'Tab':
      event.preventDefault();
      if (filteredCommands.value[selectedIndex.value]) {
        emit('select', filteredCommands.value[selectedIndex.value]);
      }
      break;
  }
}

// Expose keyboard handler for parent to call
defineExpose({ handleKeyDown });

function selectCommand(cmd: SlashCommand) {
  emit('select', cmd);
}
</script>

<template>
  <div 
    v-if="visible && filteredCommands.length > 0"
    ref="paletteRef"
    class="command-palette"
  >
    <div ref="listRef" class="command-list">
      <div 
        v-for="(cmd, index) in filteredCommands"
        :key="cmd.name"
        :class="['command-item', { selected: index === selectedIndex }]"
        @click="selectCommand(cmd)"
        @mouseenter="selectedIndex = index"
      >
        <div class="command-row">
          <span class="command-name">/{{ cmd.name }}</span>
          <span class="command-description">{{ cmd.description }}</span>
        </div>
      </div>
    </div>
    <!-- Tooltip on right side for selected item -->
    <div 
      v-if="filteredCommands[selectedIndex]?.description"
      class="command-tooltip"
    >
      {{ filteredCommands[selectedIndex].description }}
    </div>
  </div>
</template>

<style scoped>
/* Nocturne Glassmorphism Command Palette */
.command-palette {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 0;
  width: 440px;
  background: rgba(11, 19, 34, 0.95);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(3, 7, 18, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  max-height: 340px;
  overflow: visible;
  z-index: 1000;
  padding: 0.5rem;
}

.command-list {
  max-height: 320px;
  overflow-y: auto;
}

.command-item {
  padding: 0.55rem 0.85rem;
  cursor: pointer;
  background: transparent;
  display: flex;
  align-items: center;
  transition: var(--transition-spring);
  position: relative;
  border-radius: 14px;
  margin-bottom: 0.25rem;
}

.command-item:last-child {
  margin-bottom: 0;
}

.command-item:hover:not(.selected) {
  background: rgba(255, 255, 255, 0.08);
}

.command-item.selected {
  background: rgba(228, 184, 99, 0.14);
  border: 1px solid rgba(228, 184, 99, 0.35);
}

.command-tooltip {
  position: absolute;
  left: calc(100% + 10px);
  top: 0;
  width: 240px;
  background: rgba(11, 19, 34, 0.92);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(3, 7, 18, 0.60), inset 0 1px 0 rgba(255, 255, 255, 0.20);
  padding: 0.75rem 1rem;
  font-size: 0.825rem;
  white-space: normal;
  z-index: 200;
  word-break: break-word;
}

.command-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 0;
}

.command-name {
  font-weight: 700;
  color: #F3DCA8;
  background: rgba(228, 184, 99, 0.15);
  border: 1px solid rgba(228, 184, 99, 0.35);
  border-radius: 10px;
  padding: 0.2rem 0.55rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.825rem;
  min-width: 100px;
  max-width: 140px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 0 10px rgba(228, 184, 99, 0.15);
}

.command-description {
  color: rgba(255, 255, 255, 0.70);
  font-size: 0.85rem;
  margin-left: 1rem;
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.command-item.selected .command-name {
  background: rgba(228, 184, 99, 0.25);
  color: #FFFFFF;
  border-color: rgba(228, 184, 99, 0.55);
  box-shadow: 0 0 14px rgba(228, 184, 99, 0.35);
}

.command-item.selected .command-description {
  color: #FFFFFF;
  font-weight: 500;
}
</style>
