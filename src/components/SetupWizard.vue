<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { pickerDefaultPath } from "../lib/paths";
import { FolderOpen, HardDriveDownload } from "@lucide/vue";
import { getSetting, setSetting, PROJECTS_DIR_KEY } from "../lib/db";

const emit = defineEmits<{ done: [dir: string] }>();
const selected = ref<string | null>(null);
const error = ref<string | null>(null);

async function browse() {
  const picked = await open({ directory: true, multiple: false, defaultPath: await pickerDefaultPath() });
  if (typeof picked === "string") selected.value = picked;
}

async function confirm() {
  if (!selected.value) return;
  try {
    await setSetting(PROJECTS_DIR_KEY, selected.value);
    emit("done", selected.value);
  } catch (e) {
    error.value = String(e);
  }
}

// Expose current value for the "change folder" flow in Settings.
async function loadCurrent() {
  selected.value = await getSetting(PROJECTS_DIR_KEY);
}
loadCurrent();
</script>

<template>
  <div class="flex h-full items-center justify-center p-6" :class="{ dark: chromeDark }">
    <div class="glass-panel w-full max-w-lg rounded-2xl bg-white p-8 shadow dark:bg-neutral-900">
      <div class="mb-4 flex items-center gap-3">
        <HardDriveDownload class="h-8 w-8 text-blue-600" />
        <h1 class="text-2xl font-bold">Where do your projects live?</h1>
      </div>
      <p class="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Pick the parent directory that contains all your projects. New clones
        will be created there too. You can change this later in Settings.
      </p>

      <button
        class="flex w-full items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-left hover:border-blue-500 dark:border-neutral-700"
        @click="browse"
      >
        <FolderOpen class="h-5 w-5 shrink-0 text-neutral-500" />
        <span class="truncate">
          {{ selected ?? "Choose a folder…" }}
        </span>
      </button>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <button
        class="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white disabled:opacity-40"
        :disabled="!selected"
        @click="confirm"
      >
        Continue
      </button>
    </div>
  </div>
</template>
