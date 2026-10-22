<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';

interface ThinkingLevel {
  id: string;
  name: string;
  description?: string;
}

const props = withDefaults(defineProps<{
  levels: ThinkingLevel[];
  currentLevel: string;
  disabled?: boolean;
  placement?: 'top' | 'bottom' | 'auto';
}>(), {
  placement: 'auto',
  disabled: false,
});

const emit = defineEmits<{
  change: [levelId: string];
}>();

const isOpen = ref(false);
const isDropUp = ref(false);
const buttonRef = ref<HTMLElement | null>(null);

const activeLevel = computed(() => {
  return props.levels.find(l => l.id.toLowerCase() === props.currentLevel.toLowerCase()) || {
    id: props.currentLevel,
    name: props.currentLevel || 'Thinking',
  };
});

function toggleDropdown() {
  if (!props.disabled) {
    if (!isOpen.value) {
      window.dispatchEvent(new CustomEvent('acp:close-dropdowns', { detail: 'thinking-picker' }));
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
  if (ce.detail !== 'thinking-picker') {
    isOpen.value = false;
  }
}

function selectLevel(levelId: string) {
  if (levelId !== props.currentLevel) {
    emit('change', levelId);
  }
  isOpen.value = false;
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (target && !target.closest('.thinking-picker')) {
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
  <div class="thinking-picker" :class="{ disabled, 'drop-up': isDropUp }">
    <button
      ref="buttonRef"
      class="thinking-button"
      :disabled="disabled"
      @click.stop="toggleDropdown"
      title="配置思考强度"
    >
      <span class="thinking-icon">
        <svg class="thinking-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
          <path d="M9 21h6" />
          <path d="M10 17h4" />
        </svg>
      </span>
      <span class="thinking-label">{{ activeLevel.name }}</span>
      <svg class="dropdown-chevron-icon" :class="{ 'is-open': isOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <Transition name="dropdown">
      <div v-if="isOpen" class="dropdown-menu" :class="{ 'drop-up': isDropUp }" @click.stop>
        <div class="menu-header">
          <span>思考强度</span>
        </div>
        <div
          v-for="level in levels"
          :key="level.id"
          :class="['dropdown-item', { selected: level.id.toLowerCase() === currentLevel.toLowerCase() }]"
          @click="selectLevel(level.id)"
        >
          <span class="item-icon">
            <svg class="thinking-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
              <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
              <path d="M9 21h6" />
              <path d="M10 17h4" />
            </svg>
          </span>
          <div class="item-content">
            <span class="item-name">{{ level.name }}</span>
            <span v-if="level.description" class="item-description">
              {{ level.description }}
            </span>
          </div>
          <span v-if="level.id.toLowerCase() === currentLevel.toLowerCase()" class="check-mark">
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
.thinking-picker {
  position: relative;
  display: inline-block;
}

.thinking-picker.disabled {
  opacity: 0.40;
  pointer-events: none;
}

.thinking-button {
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

.thinking-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(255, 255, 255, 0.35);
  transform: translateY(-1px);
  box-shadow: 0 8px 24px rgba(3, 7, 18, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.30);
}

.thinking-svg-icon {
  width: 14px;
  height: 14px;
  color: #E4B863;
  display: block;
  flex-shrink: 0;
}

.thinking-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.thinking-label {
  font-weight: 500;
  text-transform: capitalize;
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
  min-width: 230px;
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

.menu-header {
  padding: 0.45rem 0.75rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.50);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10);
  margin-bottom: 0.25rem;
}

.dropdown-item {
  display: flex;
  align-items: center;
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
  font-weight: 500;
}

.item-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.item-name {
  font-size: 0.85rem;
  font-weight: 500;
  color: #FFFFFF;
  text-transform: capitalize;
}

.item-description {
  font-size: 0.72rem;
  color: rgba(255, 255, 255, 0.50);
  margin-top: 0.15rem;
}

.check-mark {
  color: #E4B863;
  font-weight: 700;
  font-size: 0.85rem;
}

/* Animations */
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
