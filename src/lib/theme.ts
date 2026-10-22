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

/* ------------------- Explorer background ("eye candy") ------------------- */

export type BgTheme = "none" | "dawn" | "ocean" | "forest" | "lavender" | "sand";

export interface BgThemeDef {
  id: BgTheme;
  label: string;
  hint: string;
  /** Light-scheme gradient, used for the settings swatch preview. */
  preview: string;
}

/** Soft, low-contrast gradients meant to be easy on the eyes. The actual
 *  page gradients (light + dark variants) live in index.css, keyed by the
 *  `data-bg` attribute these definitions set on <html>. */
export const BG_THEMES: BgThemeDef[] = [
  { id: "none", label: "None", hint: "Plain background", preview: "" },
  {
    id: "dawn",
    label: "Dawn",
    hint: "Warm peach & lilac",
    preview: "linear-gradient(135deg,#fdeee3,#fbe4e6 48%,#ece5fb)",
  },
  {
    id: "ocean",
    label: "Ocean",
    hint: "Calm blue & mint",
    preview: "linear-gradient(135deg,#e2f2f5,#ddf0ec 48%,#e1e9fb)",
  },
  {
    id: "forest",
    label: "Forest",
    hint: "Soft green & straw",
    preview: "linear-gradient(135deg,#e9f5e3,#e2f2e6 48%,#faf3da)",
  },
  {
    id: "lavender",
    label: "Lavender",
    hint: "Gentle violet & rose",
    preview: "linear-gradient(135deg,#efe8fc,#fbe7f1 48%,#e5eefc)",
  },
  {
    id: "sand",
    label: "Sand",
    hint: "Warm neutral beige",
    preview: "linear-gradient(135deg,#faf2df,#f6e8d4 48%,#f1eee2)",
  },
];

const BG_STORAGE_KEY = "pm-bg";

function initialBg(): BgTheme {
  const saved = localStorage.getItem(BG_STORAGE_KEY);
  return BG_THEMES.some((t) => t.id === saved) ? (saved as BgTheme) : "none";
}

export const bgTheme = ref<BgTheme>(initialBg());

watch(
  bgTheme,
  (bg) => {
    localStorage.setItem(BG_STORAGE_KEY, bg);
    document.documentElement.dataset.bg = bg;
  },
  { immediate: true },
);

export function setBgTheme(bg: BgTheme) {
  bgTheme.value = bg;
}
