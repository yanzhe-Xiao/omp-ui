<script setup lang="ts">
import type { PermissionRequest } from '../lib/types';

defineProps<{
  request: PermissionRequest;
}>();

const emit = defineEmits<{
  select: [optionId: string];
  cancel: [];
}>();

function handleSelect(optionId: string) {
  emit('select', optionId);
}

function handleCancel() {
  emit('cancel');
}
</script>

<template>
  <div class="permission-overlay">
    <div class="permission-dialog">
      <div class="dialog-header">
        <span class="icon">🔐</span>
        <h3>Permission Required</h3>
      </div>
      
      <div class="dialog-content">
        <div class="tool-info">
          <span class="tool-title">{{ request.toolCall.title }}</span>
          <span class="tool-kind">{{ request.toolCall.kind }}</span>
        </div>
        
        <div v-if="request.toolCall.locations?.length" class="locations">
          <div 
            v-for="(loc, index) in request.toolCall.locations" 
            :key="index"
            class="location"
          >
            📁 {{ loc.path }}
          </div>
        </div>
      </div>
      
      <div class="dialog-actions">
        <button 
          v-for="option in request.options" 
          :key="option.optionId"
          :class="['option-btn', `option-${option.kind}`]"
          @click="handleSelect(option.optionId)"
        >
          {{ option.name }}
        </button>
        <button class="cancel-btn" @click="handleCancel">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.permission-overlay {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.65);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.permission-dialog {
  position: relative;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 24px;
  box-shadow: 0 24px 64px rgba(3, 7, 18, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  max-width: 480px;
  width: 90%;
  overflow: hidden;
}

.permission-dialog::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.12), transparent 48px);
  pointer-events: none;
}

.dialog-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.dialog-header .icon {
  font-size: 1.35rem;
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #FFFFFF;
}

.dialog-content {
  position: relative;
  z-index: 1;
  padding: 1.25rem 1.5rem;
}

.tool-info {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tool-title {
  font-weight: 600;
  font-size: 1rem;
  color: #FFFFFF;
}

.tool-kind {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.55);
  text-transform: capitalize;
}

.locations {
  margin-top: 0.85rem;
  padding: 0.75rem 1rem;
  background: rgba(6, 10, 19, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
}

.location {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
  padding: 0.2rem 0;
  color: #F3DCA8;
  word-break: break-all;
}

.dialog-actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 1.25rem 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.option-btn {
  flex: 1;
  min-width: 120px;
  padding: 0.65rem 1rem;
  border-radius: 14px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-spring);
}

.option-allow_once,
.option-allow_always {
  background: var(--accent-champagne-bg);
  border: 1px solid var(--accent-champagne-border);
  color: var(--accent-champagne-light);
  box-shadow: var(--accent-champagne-shadow);
}

.option-allow_once:hover,
.option-allow_always:hover {
  background: var(--accent-champagne-hover-bg);
  border-color: var(--accent-champagne-hover-border);
  transform: translateY(-1px);
}

.option-reject_once,
.option-reject_always {
  background: rgba(248, 113, 113, 0.14);
  border: 1px solid rgba(248, 113, 113, 0.35);
  color: #FCA5A5;
}

.option-reject_once:hover,
.option-reject_always:hover {
  background: rgba(248, 113, 113, 0.24);
  border-color: rgba(248, 113, 113, 0.55);
  transform: translateY(-1px);
}

.cancel-btn {
  flex: 1;
  min-width: 120px;
  padding: 0.65rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.80);
  font-size: 0.875rem;
  cursor: pointer;
  transition: var(--transition-spring);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
}
</style>
