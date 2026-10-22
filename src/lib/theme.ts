import { computed, ref, watch } from "vue";

export type ThemeMode = "light" | "dark" | "mix";

const STORAGE_KEY = "pm-theme";

function initialMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark" || saved === "mix") return saved;
  // First run: follow the OS, like the app did before the switch existed.
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export const themeMode = ref<ThemeMode>(initialMode());

/** App chrome (header/nav, dialogs, menus) renders dark in dark & mix modes. */
export const chromeDark = computed(() => themeMode.value !== "light");

watch(
  themeMode,
  (mode) => {
    localStorage.setItem(STORAGE_KEY, mode);
    // Full dark: `.dark` on <html> scopes every dark: utility to the page.
    // Mix: no root class — chrome elements carry `.dark` themselves, so
    // only they (and their children) flip; page content stays light.
    document.documentElement.classList.toggle("dark", mode === "dark");
  },
  { immediate: true },
);

export function setThemeMode(mode: ThemeMode) {
  themeMode.value = mode;
}
