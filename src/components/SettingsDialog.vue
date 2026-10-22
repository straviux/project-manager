<script setup lang="ts">
import { Check, Contrast, Moon, Settings, Sun, X } from "@lucide/vue";
import {
  BG_THEMES,
  bgTheme,
  chromeDark,
  setBgTheme,
  setThemeMode,
  themeMode,
  type ThemeMode,
} from "../lib/theme";

const emit = defineEmits<{ close: [] }>();

const MODES: { id: ThemeMode; label: string; hint: string }[] = [
  { id: "light", label: "Light", hint: "Bright everywhere" },
  { id: "dark", label: "Dark", hint: "Dark everywhere" },
  { id: "mix", label: "Mix", hint: "Dark nav & menus, light content" },
];
</script>

<template>
  <div
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <header class="mb-4 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <Settings class="h-5 w-5" /> Settings
        </h2>
        <button class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </header>

      <h3 class="mb-2 text-sm font-semibold">Appearance</h3>
      <div class="mb-5 grid grid-cols-3 gap-2">
        <button
          v-for="m in MODES"
          :key="m.id"
          class="option-btn"
          :class="themeMode === m.id ? 'option-btn-active' : ''"
          @click="setThemeMode(m.id)"
        >
          <Sun v-if="m.id === 'light'" class="h-5 w-5" />
          <Moon v-else-if="m.id === 'dark'" class="h-5 w-5" />
          <Contrast v-else class="h-5 w-5" />
          <span class="text-sm font-medium">{{ m.label }}</span>
          <span class="text-center text-[11px] leading-tight text-neutral-500">{{ m.hint }}</span>
        </button>
      </div>

      <h3 class="mb-1 text-sm font-semibold">Background</h3>
      <p class="mb-2 text-xs text-neutral-500">
        Sonoma, Sequoia and Monterey are iOS/macOS-style glass themes:
        vivid wallpapers with true frosted-glass cards. The rest are flat
        colors with softly translucent cards. Changes apply immediately.
      </p>
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="t in BG_THEMES"
          :key="t.id"
          class="option-btn"
          :class="bgTheme === t.id ? 'option-btn-active' : ''"
          @click="setBgTheme(t.id)"
        >
          <span
            class="relative block h-9 w-full overflow-hidden rounded-md ring-1 ring-neutral-300 dark:ring-neutral-700"
            :class="t.preview ? '' : 'bg-neutral-100 dark:bg-neutral-800'"
            :style="t.preview ? { backgroundImage: t.preview } : undefined"
          >
            <Check
              v-if="bgTheme === t.id"
              class="absolute right-1 top-1 h-4 w-4 rounded-full bg-blue-600 p-0.5 text-white"
            />
          </span>
          <span class="text-sm font-medium">{{ t.label }}</span>
          <span class="text-center text-[11px] leading-tight text-neutral-500">{{ t.hint }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.option-btn {
  @apply flex flex-col items-center gap-1 rounded-xl px-2 py-3 ring-1 ring-neutral-300 hover:bg-neutral-50 dark:ring-neutral-700 dark:hover:bg-neutral-800;
}
.option-btn-active {
  @apply font-semibold text-blue-700 ring-2 ring-blue-500 dark:text-blue-300;
  text-shadow:
    0 0 12px rgb(59 130 246 / 0.35),
    0 0 3px rgb(59 130 246 / 0.3);
}
</style>
