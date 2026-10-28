<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { ref } from "vue";
import { Download, X } from "@lucide/vue";
import { gitClone, detectStacks } from "../lib/api";
import { useDialogDrag } from "../lib/useDialogDrag";
import { createProject } from "../lib/db";

const props = defineProps<{ projectsDir: string }>();
const emit = defineEmits<{ close: []; cloned: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);

const repoUrl = ref("");
const folderName = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

function nameFromUrl(url: string): string {
  const clean = url.replace(/\.git$/, "").replace(/\/$/, "");
  return clean.split(/[/:]/).pop() ?? "project";
}

async function clone() {
  error.value = null;
  busy.value = true;
  try {
    const url = repoUrl.value.trim();
    if (!url) throw new Error("Paste a repository URL first.");
    const name = folderName.value.trim() || nameFromUrl(url);
    const path = await gitClone(url, props.projectsDir, name);
    const stacks = await detectStacks(path).catch(() => []);
    await createProject({
      name,
      path,
      repoUrl: url,
      description: null,
      stacks,
    });
    emit("cloned");
  } catch (e) {
    error.value = String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" :class="{ dark: chromeDark }">
    <div ref="dialogPanel" class="glass-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
      <header ref="dialogHandle" class="mb-4 flex cursor-grab items-center justify-between active:cursor-grabbing">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <Download class="h-5 w-5" /> Clone repository
        </h2>
        <button class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </header>

      <label class="mb-4 block">
        <span class="mb-1 block text-sm font-medium">Repository URL</span>
        <input
          v-model="repoUrl"
          class="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          placeholder="https://github.com/you/repo.git"
        />
      </label>

      <label class="mb-4 block">
        <span class="mb-1 block text-sm font-medium">Folder name (optional)</span>
        <input
          v-model="folderName"
          class="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          :placeholder="repoUrl ? nameFromUrl(repoUrl) : 'repo'"
        />
      </label>

      <p class="mb-4 text-sm text-neutral-500">
        Will be cloned into <span class="font-mono">{{ projectsDir }}</span> and
        added to your project list with its stacks auto-detected.
      </p>

      <p v-if="error" class="mb-3 whitespace-pre-wrap text-sm text-red-600">{{ error }}</p>

      <footer class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">
          Cancel
        </button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="busy"
          @click="clone"
        >
          {{ busy ? "Cloning…" : "Clone" }}
        </button>
      </footer>
    </div>
  </div>
</template>
