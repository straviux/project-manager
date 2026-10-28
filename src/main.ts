import "./lib/theme";
import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import App from "./App.vue";
import "./index.css";

// PrimeVue 5 (PrimeUI), Aura preset. PrimeVue 5 requires a license
// key — without one it shows an "Invalid PrimeUI License" notice.
// The key is NOT in this repo (this repo is public, and publishing
// the key would let anyone else use it): it comes from
// VITE_PRIMEUI_LICENSE_KEY in a local .env file, which .gitignore
// already covers (.env, .env.* — only .env.example is tracked, and
// it carries no key, just the variable name). Vite bakes the env
// value into the bundle at build time, so a build made on a machine
// with the key in its .env carries a valid key, while the pushed
// source carries none. If the variable is unset, PrimeVue runs
// without a key and the notice returns — that is the signal that
// the local .env is missing, not a code problem.
// darkModeSelector matches the app's existing
// dark-only setup: theme.ts always puts `.dark` on <html>, so PrimeVue
// components render in their dark variant without a separate toggle.
// Components are tree-shakeable: importing one later (e.g.
// `primevue/orderlist`) adds only that component, on top of the
// PrimeVue core + Aura theme registered here. Project-card and Files
// dragging stay on the existing pointer-based code — PrimeVue's
// HTML5-drag components are not used, because HTML5 drag does not
// engage in this Tauri webview.
const app = createApp(App);
const primeuiLicense = import.meta.env.VITE_PRIMEUI_LICENSE_KEY as
  | string
  | undefined;
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: ".dark",
    },
  },
  // Omit the option entirely when no key is configured, rather than
  // passing an empty string (which PrimeVue reports as malformed).
  ...(primeuiLicense ? { license: primeuiLicense } : {}),
});
app.mount("#app");
