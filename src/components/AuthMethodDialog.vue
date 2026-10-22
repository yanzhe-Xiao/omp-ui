<script setup lang="ts">
import type { AuthMethod } from '@agentclientprotocol/sdk';

defineProps<{
  authMethods: AuthMethod[];
  agentName: string;
}>();

const emit = defineEmits<{
  (e: 'select', methodId: string): void;
  (e: 'cancel'): void;
}>();

function handleSelect(methodId: string) {
  emit('select', methodId);
}
</script>

<template>
  <div class="auth-overlay" @click.self="emit('cancel')">
    <div class="auth-dialog">
      <div class="dialog-header">
        <h3>Authentication Required</h3>
        <button class="close-btn" @click="emit('cancel')">✕</button>
      </div>
      
      <div class="dialog-content">
        <p class="description">
          <strong>{{ agentName }}</strong> requires authentication to continue.
          Select an authentication method:
        </p>
        
        <div class="auth-methods">
          <button
            v-for="method in authMethods"
            :key="method.id"
            class="auth-method-btn"
            @click="handleSelect(method.id)"
          >
            <div class="method-info">
              <span class="method-name">{{ method.name }}</span>
              <span v-if="method.description" class="method-desc">
                {{ method.description }}
              </span>
            </div>
            <span class="arrow">→</span>
          </button>
        </div>
      </div>
      
      <div class="dialog-footer">
        <button class="cancel-btn" @click="emit('cancel')">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-overlay {
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

.auth-dialog {
  position: relative;
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(60px) saturate(180%);
  -webkit-backdrop-filter: blur(60px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.20);
  border-radius: 24px;
  width: 90%;
  max-width: 440px;
  box-shadow: 0 24px 64px rgba(3, 7, 18, 0.70), inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(2, 6, 16, 0.35);
  overflow: hidden;
}

.auth-dialog::before {
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
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.dialog-header h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #FFFFFF;
}

.close-btn {
  border: none;
  background: transparent;
  font-size: 1.2rem;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.50);
  padding: 0.25rem 0.5rem;
  border-radius: 12px;
  transition: var(--transition-spring);
}

.close-btn:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.12);
}

.dialog-content {
  position: relative;
  z-index: 1;
  padding: 1.25rem 1.5rem;
}

.description {
  margin: 0 0 1.25rem 0;
  color: rgba(255, 255, 255, 0.70);
  font-size: 0.875rem;
  line-height: 1.5;
}

.description strong {
  color: #F3DCA8;
}

.auth-methods {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.auth-method-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.95rem 1.15rem;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  cursor: pointer;
  text-align: left;
  transition: var(--transition-spring);
  box-shadow: 0 4px 16px rgba(3, 7, 18, 0.40), inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

.auth-method-btn:hover {
  border-color: rgba(228, 184, 99, 0.45);
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(3, 7, 18, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.method-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.method-name {
  font-weight: 500;
  color: #FFFFFF;
  font-size: 0.9rem;
}

.method-desc {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.50);
}

.arrow {
  font-size: 1.25rem;
  color: rgba(255, 255, 255, 0.40);
  transition: var(--transition-spring);
}

.auth-method-btn:hover .arrow {
  color: #E4B863;
  transform: translateX(3px);
}

.dialog-footer {
  position: relative;
  z-index: 1;
  padding: 1rem 1.5rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  justify-content: flex-end;
}

.cancel-btn {
  padding: 0.55rem 1.15rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.80);
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-spring);
}

.cancel-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #FFFFFF;
}
</style>
