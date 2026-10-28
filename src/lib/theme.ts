import { computed, ref, watch } from "vue";

// The app is dark-only: <html> always carries `.dark`, so every dark:
// utility is active. (DaisyUI was dropped; the button/menu/tooltip
// classes it used to provide are now defined in index.css.)
document.documentElement.classList.add("dark");
localStorage.removeItem("pm-theme"); // leftover from the removed mode switch

/**
 * App chrome (header/nav, dialogs, menus) is always dark. Kept as an
 * export because the header, footer and every dialog bind it to apply
 * the `.dark` class to themselves.
 */
export const chromeDark = computed(() => true);

/* --------------------- Explorer background themes --------------------- */

export type BgTheme =
  | "none"
  | "sonoma"
  | "sequoia"
  | "monterey"
  | "bigsur"
  | "catalina"
  | "sky"
  | "mint"
  | "blush"
  | "butter"
  | "ink";

export interface BgThemeDef {
  id: BgTheme;
  label: string;
  hint: string;
  /** Gradient used for the settings swatch preview (the dark variant,
   *  since the app is dark-only). */
  preview: string;
  /** Dark backdrops: loose on-background text flips light for readability. */
  dark?: boolean;
  /** iOS/macOS-style layout themes: cards become true frosted glass. */
  glass?: boolean;
}

export const BG_THEMES: BgThemeDef[] = [
  { id: "none", label: "None", hint: "Plain background", preview: "" },
  {
    id: "sonoma",
    label: "Sonoma",
    hint: "Grape & ember, glass cards",
    preview:
      "radial-gradient(60% 50% at 20% 20%, rgb(255 154 158 / 0.32), transparent 70%),radial-gradient(50% 40% at 85% 15%, rgb(250 208 108 / 0.26), transparent 70%),radial-gradient(70% 60% at 75% 85%, rgb(168 85 247 / 0.3), transparent 70%),linear-gradient(140deg, #170b2e 0%, #38122e 45%, #571f16 100%)",
    dark: true,
    glass: true,
  },
  {
    id: "sequoia",
    label: "Sequoia",
    hint: "Blue-teal, glass cards",
    preview:
      "radial-gradient(55% 45% at 15% 25%, rgb(56 189 248 / 0.3), transparent 70%),radial-gradient(50% 45% at 85% 20%, rgb(45 212 191 / 0.27), transparent 70%),radial-gradient(65% 55% at 70% 90%, rgb(129 140 248 / 0.3), transparent 70%),linear-gradient(150deg, #04101f 0%, #081f3d 50%, #062a30 100%)",
    dark: true,
    glass: true,
  },
  {
    id: "monterey",
    label: "Monterey",
    hint: "Midnight glass",
    preview:
      "radial-gradient(50% 40% at 25% 15%, rgb(99 102 241 / 0.3), transparent 70%),radial-gradient(45% 40% at 80% 30%, rgb(34 211 238 / 0.22), transparent 70%),radial-gradient(60% 50% at 60% 95%, rgb(217 70 239 / 0.18), transparent 70%),linear-gradient(160deg, #03040c 0%, #05081f 55%, #080620 100%)",
    dark: true,
    glass: true,
  },
  {
    id: "bigsur",
    label: "Big Sur",
    hint: "Blue & violet waves, glass",
    preview:
      "radial-gradient(55% 45% at 18% 12%, rgb(59 130 246 / 0.35), transparent 70%),radial-gradient(50% 45% at 85% 18%, rgb(168 85 247 / 0.32), transparent 70%),radial-gradient(60% 55% at 55% 95%, rgb(236 72 153 / 0.26), transparent 70%),linear-gradient(155deg, #050914 0%, #0e1330 52%, #22093f 100%)",
    dark: true,
    glass: true,
  },
  {
    id: "catalina",
    label: "Catalina",
    hint: "Violet dusk glow, glass",
    preview:
      "radial-gradient(50% 40% at 80% 10%, rgb(251 146 60 / 0.24), transparent 70%),radial-gradient(55% 50% at 15% 30%, rgb(124 58 237 / 0.3), transparent 70%),radial-gradient(60% 55% at 60% 100%, rgb(37 99 235 / 0.28), transparent 70%),linear-gradient(160deg, #08040f 0%, #120826 50%, #04101f 100%)",
    dark: true,
    glass: true,
  },
  {
    id: "sky",
    label: "Sky",
    hint: "Flat color · sky blue",
    preview: "linear-gradient(#14334d,#14334d)",
  },
  {
    id: "mint",
    label: "Mint",
    hint: "Flat color · mint green",
    preview: "linear-gradient(#16382a,#16382a)",
  },
  {
    id: "blush",
    label: "Blush",
    hint: "Flat color · blush pink",
    preview: "linear-gradient(#3d1e2c,#3d1e2c)",
  },
  {
    id: "butter",
    label: "Butter",
    hint: "Flat color · butter cream",
    preview: "linear-gradient(#3a3114,#3a3114)",
  },
  {
    id: "ink",
    label: "Ink",
    hint: "Flat color · ink charcoal",
    preview: "linear-gradient(#101216,#101216)",
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
    const def = BG_THEMES.find((t) => t.id === bg);
    if (def?.dark) {
      document.documentElement.dataset.bgDark = "true";
    } else {
      delete document.documentElement.dataset.bgDark;
    }
    if (def?.glass) {
      document.documentElement.dataset.glass = "true";
    } else {
      delete document.documentElement.dataset.glass;
    }
  },
  { immediate: true },
);

export function setBgTheme(bg: BgTheme) {
  bgTheme.value = bg;
}
