<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import type { ModelInfo } from '../lib/types';
import ModelVendorIcon from './ModelVendorIcon.vue';
const props = withDefaults(defineProps<{
  models: ModelInfo[];
  currentModelId: string;
  disabled?: boolean;
  placement?: 'top' | 'bottom' | 'auto';
}>(), {
  placement: 'auto',
  disabled: false,
});
const emit = defineEmits<{
  change: [modelId: string];
}>();

const isOpen = ref(false);
const isDropUp = ref(false);
const buttonRef = ref<HTMLElement | null>(null);

const currentModel = computed(() => 
  props.models.find(m => m.modelId === props.currentModelId)
);

function toggleDropdown() {
  if (!props.disabled) {
    if (!isOpen.value) {
      window.dispatchEvent(new CustomEvent('acp:close-dropdowns', { detail: 'model-picker' }));
      if (props.placement === 'top') {
        isDropUp.value = true;
      } else if (props.placement === 'bottom') {
        isDropUp.value = false;
      } else if (buttonRef.value) {
        const rect = buttonRef.value.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        isDropUp.value = spaceBelow < 380 && rect.top > 250;
      }
    }
    isOpen.value = !isOpen.value;
  }
}

function handleCloseDropdowns(e: Event) {
  const ce = e as CustomEvent<string>;
  if (ce.detail !== 'model-picker') {
    isOpen.value = false;
  }
}

function selectModel(modelId: string) {
  if (modelId !== props.currentModelId) {
    emit('change', modelId);
  }
  isOpen.value = false;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target && !target.closest('.model-picker')) {
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
  <div class="model-picker" :class="{ disabled, 'drop-up': isDropUp }">
    <button 
      ref="buttonRef"
      class="model-button"
      :disabled="disabled"
      @click.stop="toggleDropdown"
      :title="currentModel?.name || currentModelId"
    >
      <span class="model-icon">
        <ModelVendorIcon :model-id="currentModelId" :model-name="currentModel?.name" :size="14" />
      </span>
      <span class="model-name">{{ currentModel?.name || currentModelId }}</span>
      <svg class="dropdown-chevron-icon" :class="{ 'is-open': isOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    
    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu" :class="{ 'drop-up': isDropUp }" @click.stop>
        <div 
          v-for="model in models"
          :key="model.modelId"
          :class="['dropdown-item', { selected: model.modelId === currentModelId }]"
          @click="selectModel(model.modelId)"
        >
          <span class="item-icon">
            <ModelVendorIcon :model-id="model.modelId" :model-name="model.name" :size="14" />
          </span>
          <div class="item-content">
            <span class="item-name">{{ model.name }}</span>
            <span v-if="model.description" class="item-description">
              {{ model.description }}
            </span>
          </div>
          <span v-if="model.modelId === currentModelId" class="check-mark">
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
.model-picker {
  position: relative;
  display: inline-block;
}

.model-picker.disabled {
  opacity: 0.40;
  pointer-events: none;
}

.model-button {
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
  max-width: 220px;
}

.model-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.35);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.model-button:disabled {
  cursor: not-allowed;
}

.picker-svg-icon {
  width: 14px;
  height: 14px;
  color: #7C9CC4;
  display: block;
  flex-shrink: 0;
}

.model-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.model-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  min-width: 280px;
  max-width: 360px;
  max-height: 340px;
  overflow-y: auto;
  background: rgba(11, 19, 34, 0.88);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 20px;
  box-shadow: 0 20px 50px rgba(3, 7, 18, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  z-index: 1000;
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
}

.dropdown-item + .dropdown-item {
  border-top: none;
}

.item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.10);
  flex-shrink: 0;
  margin-top: 0.1rem;
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
  color: rgba(255, 255, 255, 0.55);
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

.dropdown-menu.drop-up {
  top: auto;
  bottom: calc(100% + 8px);
  box-shadow: 0 -20px 50px rgba(3, 7, 18, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
}

.dropdown-menu.drop-up.dropdown-enter-from,
.dropdown-menu.drop-up.dropdown-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>
