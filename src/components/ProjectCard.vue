<script setup lang="ts">
import {
  Code,
  ExternalLink,
  FileText,
  Folder,
  Pencil,
  Server,
  Terminal,
  Trash2,
} from "@lucide/vue";
import type { Project } from "../types";

defineProps<{ project: Project }>();
const emit = defineEmits<{
  vscode: [];
  terminal: [];
  ssh: [];
  readme: [];
  edit: [];
  remove: [];
}>();
</script>

<template>
  <article
    class="flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
  >
    <header class="mb-1 flex items-start justify-between gap-2">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <Folder class="h-5 w-5 shrink-0 text-amber-500" />
        <span class="truncate">{{ project.name }}</span>
      </h3>
      <div class="flex shrink-0 gap-1">
        <button class="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Edit project" @click="emit('edit')">
          <Pencil class="h-4 w-4" />
        </button>
        <button class="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950" title="Remove from list (files are kept)" @click="emit('remove')">
          <Trash2 class="h-4 w-4" />
        </button>
      </div>
    </header>

    <p class="mb-2 truncate text-xs text-neutral-500" :title="project.path">
      {{ project.path }}
    </p>
    <p v-if="project.description" class="mb-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
      {{ project.description }}
    </p>

    <div class="mb-3 flex flex-wrap gap-1.5">
      <span
        v-for="stack in project.stacks"
        :key="stack"
        class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      >
        {{ stack }}
      </span>
    </div>

    <a
      v-if="project.repoUrl"
      :href="project.repoUrl"
      target="_blank"
      rel="noreferrer"
      class="mb-4 flex items-center gap-1 truncate text-sm text-blue-600 hover:underline dark:text-blue-400"
    >
      <ExternalLink class="h-3.5 w-3.5 shrink-0" />
      <span class="truncate">{{ project.repoUrl }}</span>
    </a>

    <footer class="mt-auto grid grid-cols-4 gap-1.5">
      <button class="action" title="Open in VS Code" @click="emit('vscode')">
        <Code class="h-4 w-4" /> Code
      </button>
      <button class="action" title="Open terminal at project root" @click="emit('terminal')">
        <Terminal class="h-4 w-4" /> Terminal
      </button>
      <button class="action" title="SSH connections" @click="emit('ssh')">
        <Server class="h-4 w-4" /> SSH
      </button>
      <button class="action" title="Open README.md" @click="emit('readme')">
        <FileText class="h-4 w-4" /> README
      </button>
    </footer>
  </article>
</template>

<style scoped>
.action {
  @apply flex items-center justify-center gap-1.5 rounded-lg bg-neutral-100 px-2 py-2 text-xs font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700;
}
</style>
