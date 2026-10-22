import { createApp } from "vue";
import { createPinia, type Pinia } from "pinia";
import App from "./App.vue";
import "./styles/glassmorphism.css";

const app = createApp(App);
const pinia = createPinia();

declare global {
  interface Window {
    __pinia?: Pinia;
  }
}

if (typeof window !== "undefined") {
  window.__pinia = pinia;
}

app.use(pinia);
app.mount("#app");
