import type { Component } from "vue";
import {
  BookOpen,
  Bot,
  Box,
  Briefcase,
  Bug,
  Cloud,
  Code,
  Cpu,
  Database,
  Folder,
  Gamepad2,
  GitBranch,
  Globe,
  Layers,
  Music,
  Palette,
  Rocket,
  Server,
  ShoppingCart,
  Smartphone,
  Star,
  Terminal,
  Wrench,
  Zap,
} from "@lucide/vue";

/** Lucide icons a project can use, keyed by the name stored in the DB. */
export const PROJECT_ICONS: Record<string, Component> = {
  Folder,
  Code,
  Terminal,
  Globe,
  Server,
  Database,
  Smartphone,
  Gamepad2,
  Rocket,
  Box,
  Layers,
  GitBranch,
  Cpu,
  Palette,
  Music,
  ShoppingCart,
  Star,
  Zap,
  Bug,
  BookOpen,
  Briefcase,
  Wrench,
  Bot,
  Cloud,
};

export const PROJECT_ICON_NAMES = Object.keys(PROJECT_ICONS);

/** Colors a Lucide project icon can use, keyed by the name stored in the DB.
   `text` colors the icon on the card, `dot` is the picker swatch. Classes
   are written out literally (never built from strings) so Tailwind picks
   them up. Blue is the default, matching the previous hardcoded color. */
export const PROJECT_ICON_COLORS: Record<string, { text: string; dot: string }> = {
  blue: { text: "text-blue-500", dot: "bg-blue-500" },
  red: { text: "text-red-500", dot: "bg-red-500" },
  green: { text: "text-green-500", dot: "bg-green-500" },
  amber: { text: "text-amber-500", dot: "bg-amber-500" },
  purple: { text: "text-purple-500", dot: "bg-purple-500" },
  pink: { text: "text-pink-500", dot: "bg-pink-500" },
  cyan: { text: "text-cyan-500", dot: "bg-cyan-500" },
  slate: { text: "text-slate-400", dot: "bg-slate-400" },
};

export const PROJECT_ICON_COLOR_NAMES = Object.keys(PROJECT_ICON_COLORS);
