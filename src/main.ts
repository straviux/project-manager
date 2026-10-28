import "./lib/theme";
import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import App from "./App.vue";
import "./index.css";

// PrimeVue 4 (MIT), Aura preset — deliberately NOT PrimeVue 5.
// PrimeVue 5 moved to the commercial PrimeUI license: it requires a
// license key, and without one it shows an "Invalid PrimeUI License"
// notice in the bottom-right corner. PrimeVue 4 stays MIT forever and
// needs no key, and no PrimeVue component is used yet, so downgrading
// from 5 to 4 changes nothing in the UI. If PrimeVue 5 is ever wanted
// again, it needs a Community/Commercial key passed as the `license`
// option here — and that key must NOT be committed to this public
// repo; it would have to come from a gitignored .env at build time.
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
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: ".dark",
    },
  },
});
app.mount("#app");
