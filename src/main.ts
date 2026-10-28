import "./lib/theme";
import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import App from "./App.vue";
import "./index.css";

// PrimeVue 5, Aura preset. darkModeSelector matches the app's existing
// dark-only setup: theme.ts always puts `.dark` on <html>, so PrimeVue
// components render in their dark variant without a separate toggle.
// Components are tree-shakeable: importing one later (e.g.
// `primevue/orderlist`) adds only that component, on top of the
// PrimeVue core + Aura theme registered here. Project-card and Files
// dragging stay on the existing pointer-based code — PrimeVue's
// HTML5-drag components are not used, because HTML5 drag does not
// engage in this Tauri webview.
const app = createApp(App);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: ".dark",
    },
  },
});
app.mount("#app");
