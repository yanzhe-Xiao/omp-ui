<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { SessionMode } from '../lib/types';

const props = defineProps<{
  modes: SessionMode[];
  currentModeId: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  change: [modeId: string];
}>();

const isOpen = ref(false);

const currentMode = computed(() => 
  props.modes.find(m => m.id === props.currentModeId)
);

function toggleDropdown() {
  if (!props.disabled) {
    if (!isOpen.value) {
      window.dispatchEvent(new CustomEvent('acp:close-dropdowns', { detail: 'mode-picker' }));
    }
    isOpen.value = !isOpen.value;
  }
}

function handleCloseDropdowns(e: Event) {
  const ce = e as CustomEvent<string>;
  if (ce.detail !== 'mode-picker') {
    isOpen.value = false;
  }
}

function selectMode(modeId: string) {
  if (modeId !== props.currentModeId) {
    emit('change', modeId);
  }
  isOpen.value = false;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target && !target.closest('.mode-picker')) {
    isOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside, true);
  window.addEventListener('acp:close-dropdowns', handleCloseDropdowns);
});

onBeforeUnmount(() => {
  window.removeEventListener('click', handleClickOutside, true);
  window.removeEventListener('acp:close-dropdowns', handleCloseDropdowns);
});
</script>

<template>
  <div class="mode-picker" :class="{ disabled }">
    <button 
      class="mode-button"
      :disabled="disabled"
      @click.stop="toggleDropdown"
    >
      <span class="mode-icon">
        <svg class="mode-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </span>
      <span class="mode-name">{{ currentMode?.name || currentModeId }}</span>
      <svg class="dropdown-chevron-icon" :class="{ 'is-open': isOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    
    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu" @click.stop>
        <div 
          v-for="mode in modes"
          :key="mode.id"
          :class="['dropdown-item', { selected: mode.id === currentModeId }]"
          @click="selectMode(mode.id)"
        >
          <span class="item-icon">
            <svg class="mode-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <div class="item-content">
            <span class="item-name">{{ mode.name }}</span>
            <span v-if="mode.description" class="item-description">
              {{ mode.description }}
            </span>
          </div>
          <span v-if="mode.id === currentModeId" class="check-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.mode-picker {
  position: relative;
  display: inline-block;
}

.mode-picker.disabled {
  opacity: 0.40;
  pointer-events: none;
}

.mode-button {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  color: #FFFFFF;
  font-size: 0.8rem;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(3, 7, 18, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(2, 6, 16, 0.30);
  transition: var(--transition-spring);
}

.mode-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.35);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.mode-button:disabled {
  cursor: not-allowed;
}

.mode-svg-icon {
  width: 14px;
  height: 14px;
  color: rgba(255, 255, 255, 0.75);
  display: block;
  flex-shrink: 0;
}

.mode-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.mode-name {
  font-weight: 500;
}

.dropdown-chevron-icon {
  width: 11px;
  height: 11px;
  color: rgba(255, 255, 255, 0.50);
  margin-left: 0.35rem;
  flex-shrink: 0;
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
  display: block;
}

.dropdown-chevron-icon.is-open {
  transform: rotate(180deg);
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 250px;
  background: rgba(11, 19, 34, 0.88);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(3, 7, 18, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  z-index: 1000;
  overflow: hidden;
  padding: 0.5rem;
}

@media (max-width: 800px) {
  .dropdown-menu {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 4.5rem);
    left: 0.75rem;
    right: 0.75rem;
    bottom: auto;
    min-width: 0;
    max-width: none;
    max-height: calc(100vh - 6rem);
  }
}

.dropdown-item {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  padding: 0.65rem 0.85rem;
  border-radius: 14px;
  cursor: pointer;
  transition: var(--transition-spring);
  margin-bottom: 0.25rem;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.10);
}

.dropdown-item.selected {
  background: rgba(228, 184, 99, 0.12);
  border: 1px solid rgba(228, 184, 99, 0.30);
  color: #F3DCA8;
}

.dropdown-item + .dropdown-item {
  border-top: none;
}

.item-icon {
  font-size: 1rem;
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-name {
  display: block;
  font-weight: 500;
  color: #FFFFFF;
  font-size: 0.85rem;
}

.item-description {
  display: block;
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.50);
  margin-top: 0.2rem;
  line-height: 1.35;
}

.check-mark {
  color: #E4B863;
  font-weight: bold;
  margin-left: auto;
  flex-shrink: 0;
}

/* Dropdown animation */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 500ms cubic-bezier(0.16, 1, 0.3, 1), transform 500ms cubic-bezier(0.16, 1, 0.3, 1);
}

.dropdown-leave-active {
  pointer-events: none;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}
</style>
