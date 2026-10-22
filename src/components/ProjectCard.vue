<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  Code,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GripVertical,
  MoreVertical,
  Pencil,
  Pin,
  Server,
  Terminal,
  Trash2,
} from "@lucide/vue";
import { getGitStatus } from "../lib/api";
import { PROJECT_ICONS } from "../lib/projectIcons";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { GitStatus, Project } from "../types";

const props = defineProps<{
  project: Project;
  statusKey?: number;
  reorderEnabled?: boolean;
}>();
const emit = defineEmits<{
  vscode: [];
  terminal: [];
  folder: [];
  ssh: [];
  readme: [];
  edit: [];
  remove: [];
  pin: [];
  dragStart: [];
  drop: [];
}>();

const status = ref<GitStatus | null>(null);
const menuOpen = ref(false);

async function loadStatus() {
  status.value = await getGitStatus(props.project.path).catch(() => null);
}
onMounted(loadStatus);
watch(() => props.statusKey, loadStatus);
</script>

<template>
  <article
    class="card-glass flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
    :class="project.pinned ? 'ring-2 ring-amber-400 dark:ring-amber-500' : ''"
    :draggable="reorderEnabled"
    @dragstart="emit('dragStart')"
    @dragover.prevent
    @drop.prevent="emit('drop')"
  >
    <header class="mb-1 flex items-start justify-between gap-2">
      <h3 class="flex items-center gap-2 text-lg font-semibold">
        <GripVertical
          v-if="reorderEnabled"
          class="h-4 w-4 shrink-0 cursor-grab text-neutral-400"
        />
        <img
          v-if="project.iconKind === 'ico' && project.iconValue"
          :src="convertFileSrc(project.iconValue)"
          alt=""
          class="h-6 w-6 shrink-0 rounded"
        />
        <component
          v-else-if="project.iconKind === 'lucide' && project.iconValue && PROJECT_ICONS[project.iconValue]"
          :is="PROJECT_ICONS[project.iconValue]"
          class="h-5 w-5 shrink-0 text-blue-500"
        />
        <Folder v-else class="h-5 w-5 shrink-0 text-amber-500" />
        <span class="truncate">{{ project.name }}</span>
      </h3>
      <div class="flex shrink-0 gap-1">
        <button
          class="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          :class="project.pinned ? 'text-amber-500' : ''"
          :title="project.pinned ? 'Unpin' : 'Pin to top'"
          @click="emit('pin')"
        >
          <Pin class="h-4 w-4" />
        </button>
        <div class="relative">
          <button
            class="rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="More actions"
            @click="menuOpen = !menuOpen"
          >
            <MoreVertical class="h-4 w-4" />
          </button>
          <template v-if="menuOpen">
            <div class="fixed inset-0 z-10" @click="menuOpen = false"></div>
            <div
              class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl bg-white p-1 text-sm shadow-lg ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700"
            >
              <button class="menu-item" @click="menuOpen = false; emit('edit')">
                <Pencil class="h-4 w-4" /> Edit
              </button>
              <button
                class="menu-item text-red-600 dark:text-red-400"
                title="Remove from list (files are kept)"
                @click="menuOpen = false; emit('remove')"
              >
                <Trash2 class="h-4 w-4" /> Remove
              </button>
            </div>
          </template>
        </div>
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

    <div class="mb-3 flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <template v-if="status?.isRepo">
        <span class="flex items-center gap-1 font-medium">
          <GitBranch class="h-3.5 w-3.5" />
          {{ status.branch ?? "detached HEAD" }}
        </span>
        <span
          v-if="status.dirty"
          class="flex items-center gap-1.5 text-amber-600 dark:text-amber-400"
        >
          <span class="h-2 w-2 rounded-full bg-amber-500" />
          {{ status.changedFiles }} uncommitted change{{ status.changedFiles === 1 ? "" : "s" }}
        </span>
        <span v-else class="flex items-center gap-1 text-green-600 dark:text-green-400">
          <CircleCheck class="h-3.5 w-3.5" /> Clean
        </span>
        <span v-if="status.ahead" class="flex items-center gap-0.5" title="Commits to push">
          <ArrowUp class="h-3.5 w-3.5" />{{ status.ahead }}
        </span>
        <span v-if="status.behind" class="flex items-center gap-0.5" title="Commits to pull">
          <ArrowDown class="h-3.5 w-3.5" />{{ status.behind }}
        </span>
      </template>
      <span v-else-if="status" class="text-neutral-400">Not a git repository</span>
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

    <footer class="mt-auto grid grid-cols-5 gap-1.5">
      <button class="action" title="Open in VS Code" @click="emit('vscode')">
        <Code class="h-4 w-4" />
      </button>
      <button class="action" title="Open source folder" @click="emit('folder')">
        <FolderOpen class="h-4 w-4" />
      </button>
      <button class="action" title="Open terminal at project root" @click="emit('terminal')">
        <Terminal class="h-4 w-4" />
      </button>
      <button class="action" title="SSH connections" @click="emit('ssh')">
        <Server class="h-4 w-4" />
      </button>
      <button class="action" title="Open README.md" @click="emit('readme')">
        <FileText class="h-4 w-4" />
      </button>
    </footer>
  </article>
</template>

<style scoped>
.menu-item {
  @apply flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-700;
}
.action {
  @apply flex items-center justify-center gap-1.5 rounded-lg bg-blue-100/80 px-2 py-2 text-xs font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:hover:bg-blue-900/70;
}
</style>
