<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  modelId: string;
  modelName?: string;
  size?: number;
}>(), {
  modelName: '',
  size: 14
});

const vendor = computed(() => {
  const text = `${props.modelId} ${props.modelName}`.toLowerCase();
  
  // Specific checks with vendor priority
  if (text.includes('claude') || text.includes('anthropic')) return 'anthropic';
  if (text.includes('gemini') || text.includes('google') || text.includes('gemma')) return 'google';
  if (text.includes('gpt') || text.includes('openai') || text.includes('chatgpt') || text.includes('dall-e') || /\bo[134](-mini|-preview)?\b/.test(text)) return 'openai';
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('mistral') || text.includes('mixtral') || text.includes('codestral')) return 'mistral';
  if (text.includes('qwen') || text.includes('qianwen') || text.includes('alibaba')) return 'qwen';
  if (text.includes('kimi') || text.includes('moonshot')) return 'moonshot';
  if (text.includes('glm') || text.includes('zhipu') || text.includes('chatglm')) return 'zhipu';
  if (text.includes('grok') || text.includes('xai')) return 'xai';
  if (text.includes('ollama')) return 'ollama';
  if (text.includes('llama') || text.includes('meta')) return 'meta';
  if (text.includes('cohere') || text.includes('command')) return 'cohere';
  
  return 'default';
});
</script>

<template>
  <span class="model-vendor-icon-wrapper" :class="`vendor-${vendor}`">
    <!-- Claude / Anthropic: 8-point Asterisk Spark -->
    <svg 
      v-if="vendor === 'anthropic'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="currentColor"
      class="vendor-svg"
    >
      <path d="M12 2a1.5 1.5 0 0 1 1.5 1.5v3.38l2.39-2.39a1.5 1.5 0 1 1 2.12 2.12l-2.39 2.39h3.38a1.5 1.5 0 1 1 0 3h-3.38l2.39 2.39a1.5 1.5 0 1 1-2.12 2.12l-2.39-2.39v3.38a1.5 1.5 0 1 1-3 0v-3.38l-2.39 2.39a1.5 1.5 0 1 1-2.12-2.12l2.39-2.39H4.5a1.5 1.5 0 1 1 0-3h3.38l-2.39-2.39a1.5 1.5 0 1 1 2.12-2.12l2.39 2.39V3.5A1.5 1.5 0 0 1 12 2z" />
    </svg>

    <!-- Google / Gemini: 4-point Sparkle Star -->
    <svg 
      v-else-if="vendor === 'google'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="currentColor"
      class="vendor-svg"
    >
      <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" />
    </svg>

    <!-- OpenAI: Iconic Rosette Swirl -->
    <svg 
      v-else-if="vendor === 'openai'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="currentColor"
      class="vendor-svg"
    >
      <path d="M22.28 9.82a5.98 5.98 0 0 0-.51-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.2 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.08zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.5zm-9.66-4.12a4.47 4.47 0 0 1-.54-3.02l.14.09 4.79 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L3.99 14a4.5 4.5 0 0 1-1.65-6.1zm16.6 3.86L13.1 8.36l2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.4.68zm1.1-2.36l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5Z" />
    </svg>

    <!-- DeepSeek: Swimming Whale -->
    <svg 
      v-else-if="vendor === 'deepseek'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.8" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <path d="M3.5 14c2-4 6-6 10-5.5 3.5.4 6.5 2.8 7.5 6-.5 1-1.5 1.5-3 1.5-2.5 0-4-1.2-6-1.2-2 0-3.5 1.2-5.5 1.2-1.5 0-2.5-.8-3-2z" fill="currentColor" fill-opacity="0.25" />
      <path d="M17 8.5c1-1.5 2.5-2.5 4.5-3" />
      <circle cx="7.5" cy="13" r="1.1" fill="currentColor" />
    </svg>

    <!-- Meta / Llama: Infinity Loop -->
    <svg 
      v-else-if="vendor === 'meta'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="2" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <path d="M12 13.5c-1.8 2.2-3.3 3.5-5 3.5a4 4 0 1 1 0-8c2 0 3.5 1.5 5 4.5 1.5-3 3-4.5 5-4.5a4 4 0 1 1 0 8c-1.7 0-3.2-1.3-5-3.5z" />
    </svg>

    <!-- Mistral: Cascading Blocks -->
    <svg 
      v-else-if="vendor === 'mistral'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="currentColor"
      class="vendor-svg"
    >
      <rect x="3" y="4" width="4" height="4" rx="0.8" />
      <rect x="17" y="4" width="4" height="4" rx="0.8" />
      <rect x="3" y="10" width="18" height="4" rx="0.8" />
      <rect x="7" y="16" width="10" height="4" rx="0.8" />
    </svg>

    <!-- Qwen: Faceted Prism Crystal -->
    <svg 
      v-else-if="vendor === 'qwen'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.8" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <polygon points="12 2 21 8.5 21 15.5 12 22 3 15.5 3 8.5" fill="currentColor" fill-opacity="0.2" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <polyline points="21 8.5 12 12 3 8.5" />
    </svg>

    <!-- Moonshot / Kimi: Crescent Moon & Twinkle -->
    <svg 
      v-else-if="vendor === 'moonshot'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.8" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" fill-opacity="0.25" />
      <polygon points="15.5 6 16.2 7.8 18 8.5 16.2 9.2 15.5 11 14.8 9.2 13 8.5 14.8 7.8" fill="currentColor" stroke="none" />
    </svg>

    <!-- Zhipu / GLM: Neural Network Node -->
    <svg 
      v-else-if="vendor === 'zhipu'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.6" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
      <circle cx="5" cy="7" r="2" fill="currentColor" fill-opacity="0.6" stroke="none" />
      <circle cx="19" cy="7" r="2" fill="currentColor" fill-opacity="0.6" stroke="none" />
      <circle cx="7" cy="18" r="2" fill="currentColor" fill-opacity="0.6" stroke="none" />
      <circle cx="17" cy="18" r="2" fill="currentColor" fill-opacity="0.6" stroke="none" />
      <path d="M7 8l3.2 2.6M17 8l-3.2 2.6M8.5 16.5l2.2-2.7M15.5 16.5l-2.2-2.7" />
    </svg>

    <!-- xAI / Grok: Minimalist X -->
    <svg 
      v-else-if="vendor === 'xai'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="2.2" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <line x1="5" y1="5" x2="19" y2="19" />
      <path d="M19 5L5 19" stroke-width="1.6" />
    </svg>

    <!-- Ollama / Local AI: Llama Face -->
    <svg 
      v-else-if="vendor === 'ollama'" 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.8" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <rect x="5" y="7" width="14" height="13" rx="4" fill="currentColor" fill-opacity="0.2" />
      <path d="M8 7V4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3M14 7V4a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3" />
      <circle cx="9.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M10.5 16h3" />
    </svg>

    <!-- Fallback / Default: Precision Microchip -->
    <svg 
      v-else 
      :width="size" 
      :height="size" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.8" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      class="vendor-svg"
    >
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" fill-opacity="0.25" stroke="none" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    </svg>
  </span>
</template>

<style scoped>
.model-vendor-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  vertical-align: middle;
}

.vendor-svg {
  display: block;
  transition: transform 500ms cubic-bezier(0.16, 1, 0.3, 1), filter 500ms cubic-bezier(0.16, 1, 0.3, 1);
}

/* Distinctive, elegant vendor hues calibrated for Nocturne Glassmorphism */
.vendor-anthropic {
  color: #E07A5F; /* Claude terracotta warm glow */
}

.vendor-google {
  color: #60A5FA; /* Gemini moonlight blue */
}

.vendor-openai {
  color: #34D399; /* OpenAI emerald mint */
}

.vendor-deepseek {
  color: #38BDF8; /* DeepSeek marine cyan */
}

.vendor-meta {
  color: #818CF8; /* Meta royal indigo */
}

.vendor-mistral {
  color: #FB923C; /* Mistral flame orange */
}

.vendor-qwen {
  color: #A78BFA; /* Qwen violet */
}

.vendor-moonshot {
  color: #FCD34D; /* Moonshot celestial yellow */
}

.vendor-zhipu {
  color: #2DD4BF; /* GLM turquoise */
}

.vendor-xai {
  color: #F3F4F6; /* Grok moonlight silver */
}

.vendor-ollama {
  color: #F59E0B; /* Ollama amber */
}

.vendor-default {
  color: #E4B863; /* Champagne gold */
}
</style>
