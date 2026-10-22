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

export type BgTheme =
  | "none"
  | "dawn"
  | "ocean"
  | "forest"
  | "lavender"
  | "sand"
  | "dusk"
  | "midnight"
  | "starlight"
  | "aurora"
  | "graphite";

export interface BgThemeDef {
  id: BgTheme;
  label: string;
  hint: string;
  /** Light-scheme gradient, used for the settings swatch preview. */
  preview: string;
  /** Dark backdrops: loose on-background text flips light for readability. */
  dark?: boolean;
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
  {
    id: "dusk",
    label: "Dusk",
    hint: "Violet into ember",
    preview: "linear-gradient(135deg,#463763,#71486b 52%,#9c665e)",
    dark: true,
  },
  {
    id: "midnight",
    label: "Midnight",
    hint: "Deep indigo night",
    preview: "linear-gradient(135deg,#1b2340,#232a52 48%,#141a33)",
    dark: true,
  },
  {
    id: "starlight",
    label: "Starlight",
    hint: "Night sky & stars",
    preview:
      "radial-gradient(1.5px 1.5px at 15% 25%, rgb(255 255 255 / 0.9), transparent),radial-gradient(1px 1px at 35% 65%, rgb(255 255 255 / 0.7), transparent),radial-gradient(1.5px 1.5px at 55% 15%, rgb(255 255 255 / 0.8), transparent),radial-gradient(1px 1px at 72% 45%, rgb(255 255 255 / 0.6), transparent),radial-gradient(1px 1px at 85% 75%, rgb(255 255 255 / 0.75), transparent),radial-gradient(1.5px 1.5px at 92% 20%, rgb(255 255 255 / 0.85), transparent),radial-gradient(1px 1px at 45% 85%, rgb(255 255 255 / 0.6), transparent),radial-gradient(1px 1px at 8% 80%, rgb(255 255 255 / 0.7), transparent)," +
      "linear-gradient(150deg,#131c3f,#1d1440 52%,#0b1030)",
    dark: true,
  },
  {
    id: "aurora",
    label: "Aurora",
    hint: "Northern-lights glow",
    preview:
      "radial-gradient(55% 45% at 75% 0%, rgb(52 211 153 / 0.28), transparent 70%),radial-gradient(40% 35% at 20% 10%, rgb(45 212 191 / 0.18), transparent 70%)," +
      "linear-gradient(160deg,#081826,#07231f 48%,#0a2e2a)",
    dark: true,
  },
  {
    id: "graphite",
    label: "Graphite",
    hint: "Calm dark slate",
    preview: "linear-gradient(135deg,#3a4150,#2e3442 48%,#232833)",
    dark: true,
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
    if (BG_THEMES.find((t) => t.id === bg)?.dark) {
      document.documentElement.dataset.bgDark = "true";
    } else {
      delete document.documentElement.dataset.bgDark;
    }
  },
  { immediate: true },
);

export function setBgTheme(bg: BgTheme) {
  bgTheme.value = bg;
}
