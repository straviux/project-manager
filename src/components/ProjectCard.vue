<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  GripVertical,
  MoreVertical,
  Pencil,
  Star,
  Server,
  Terminal,
  Trash2,
} from "@lucide/vue";
import VscodeIcon from "./VscodeIcon.vue";
import { getGitStatus } from "../lib/api";
import { PROJECT_ICON_COLORS, PROJECT_ICONS } from "../lib/projectIcons";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { GitStatus, Project } from "../types";

const props = defineProps<{
  project: Project;
  statusKey?: number;
  reorderEnabled?: boolean;
  dropTarget?: boolean;
  dropAfter?: boolean;
}>();
const emit = defineEmits<{
  vscode: [];
  terminal: [];
  folder: [];
  ssh: [];
  readme: [];
  edit: [];
  copyClone: [];
  remove: [];
  pin: [];
  context: [event: MouseEvent];
  pointerDragStart: [];
  pointerDragMove: [pos: { x: number; y: number }];
  pointerDragEnd: [];
}>();

const status = ref<GitStatus | null>(null);
const iconColorClass = computed(
  () =>
    (PROJECT_ICON_COLORS[props.project.iconColor ?? "blue"] ??
      PROJECT_ICON_COLORS.blue).text,
);
const menuOpen = ref(false);
const menuWrap = ref<HTMLElement | null>(null);

// The old full-screen backdrop div did not work: the card itself carries
// backdrop-filter under any background theme, and that makes the card a
// containing block for fixed-position descendants — so the "fixed inset-0"
// backdrop was clipped to the card and clicks outside it never reached it.
// A document listener has no such trap: any click outside the menu wrapper
// closes the menu, wherever it lands.
function onDocClick(event: MouseEvent) {
  if (menuWrap.value && !menuWrap.value.contains(event.target as Node)) {
    menuOpen.value = false;
  }
}
watch(menuOpen, (open) => {
  if (open) {
    document.addEventListener("click", onDocClick, true);
  } else {
    document.removeEventListener("click", onDocClick, true);
  }
});
onUnmounted(() => {
  document.removeEventListener("click", onDocClick, true);
  document.body.classList.remove("select-none");
});
// Dragging is done with pointer events, not the browser's drag system:
// HTML5 drag-and-drop never engaged in this webview at all (nothing ever
// lifted, through three attempts at it). Pointer tracking has no such
// dependency — press, move past a small threshold, and the card is being
// dragged. Capture is only taken once the threshold is crossed, so plain
// clicks on the card's buttons still work exactly as before, and
// right-click menus are unaffected.
const dragStartPos = ref<{ x: number; y: number; pointerId: number } | null>(null);
const dragActive = ref(false);

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !props.reorderEnabled) return;
  dragStartPos.value = {
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
  };
}

function onPointerMove(event: PointerEvent) {
  const start = dragStartPos.value;
  if (!start || event.pointerId !== start.pointerId) return;
  if (!dragActive.value) {
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragActive.value = true;
    // Stop the browser selecting text under the cursor while dragging:
    // without this, every drag also highlights the cards' contents.
    document.body.classList.add("select-none");
    window.getSelection()?.removeAllRanges();
    emit("pointerDragStart");
  }
  emit("pointerDragMove", { x: event.clientX, y: event.clientY });
}

function onPointerUp(event: PointerEvent) {
  const start = dragStartPos.value;
  if (!start || event.pointerId !== start.pointerId) return;
  const wasDragging = dragActive.value;
  dragStartPos.value = null;
  dragActive.value = false;
  document.body.classList.remove("select-none");
  if (wasDragging) emit("pointerDragEnd");
}

async function loadStatus() {
  status.value = await getGitStatus(props.project.path).catch(() => null);
}
onMounted(loadStatus);
watch(() => props.statusKey, loadStatus);
</script>

<template>
  <article
    class="card-glass relative flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
    :data-project-id="project.id"
    :class="[
      project.pinned && !dragActive
        ? 'ring-2 ring-amber-400 dark:ring-amber-500'
        : '',
      dragActive
        ? 'z-10 cursor-grabbing opacity-70 shadow-xl ring-2 ring-blue-500 scale-[1.02]'
        : '',
    ]"
    @contextmenu.prevent.stop="menuOpen = false; emit('context', $event)"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div
      v-if="dropTarget"
      class="absolute left-2 right-2 z-10 h-1 rounded-full bg-blue-500"
      :class="dropAfter ? '-bottom-2' : '-top-2'"
    />
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
          class="h-5 w-5 shrink-0"
          :class="iconColorClass"
        />
        <Folder v-else class="h-5 w-5 shrink-0 text-amber-500" />
        <span class="truncate">{{ project.name }}</span>
      </h3>
      <div class="flex shrink-0 gap-1">
        <button
          class="tooltip tooltip-left rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          :class="project.pinned ? 'text-amber-500' : ''"
          :data-tip="project.pinned ? 'Remove star' : 'Star'"
          @click="emit('pin')"
        >
          <Star class="h-4 w-4" :fill="project.pinned ? 'currentColor' : 'none'" />
        </button>
        <div ref="menuWrap" class="relative">
          <button
            class="tooltip tooltip-left rounded p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            data-tip="More actions"
            @click="menuOpen = !menuOpen"
          >
            <MoreVertical class="h-4 w-4" />
          </button>
          <template v-if="menuOpen">
            <ul
              class="menu absolute right-0 top-full z-20 mt-1 w-44 rounded-box bg-base-200 p-2 text-sm shadow-xl ring-1 ring-white/10"
            >
              <li>
                <a @click="menuOpen = false; emit('edit')">
                  <Pencil class="h-4 w-4" /> Edit
                </a>
              </li>
              <li v-if="project.repoUrl">
                <a @click="menuOpen = false; emit('copyClone')">
                  <Copy class="h-4 w-4" /> Copy clone URL
                </a>
              </li>
              <li>
                <a
                  class="text-error"
                  @click="menuOpen = false; emit('remove')"
                >
                  <Trash2 class="h-4 w-4" /> Remove from list
                </a>
              </li>
            </ul>
          </template>
        </div>
      </div>
    </header>

    <p class="tooltip tooltip-bottom mb-2 truncate text-xs text-neutral-500" :data-tip="project.path">
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
        <span v-if="status.ahead" class="tooltip tooltip-top flex items-center gap-0.5" data-tip="Commits to push">
          <ArrowUp class="h-3.5 w-3.5" />{{ status.ahead }}
        </span>
        <span v-if="status.behind" class="tooltip tooltip-top flex items-center gap-0.5" data-tip="Commits to pull">
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
      <button class="action tooltip tooltip-top" data-tip="Open in VS Code" @click="emit('vscode')">
        <VscodeIcon class="h-4 w-4" />
        <span>VS Code</span>
      </button>
      <button class="action tooltip tooltip-top" data-tip="Open source folder" @click="emit('folder')">
        <FolderOpen class="h-4 w-4" />
        <span>Folder</span>
      </button>
      <button class="action tooltip tooltip-top" data-tip="Open terminal at project root" @click="emit('terminal')">
        <Terminal class="h-4 w-4" />
        <span>Terminal</span>
      </button>
      <button class="action tooltip tooltip-top" data-tip="SSH connections" @click="emit('ssh')">
        <Server class="h-4 w-4" />
        <span>SSH</span>
      </button>
      <button class="action tooltip tooltip-top" data-tip="Open README.md" @click="emit('readme')">
        <FileText class="h-4 w-4" />
        <span>README</span>
      </button>
    </footer>
  </article>
</template>

<style scoped>
.action {
  @apply flex flex-col items-center justify-center gap-0.5 rounded-lg bg-blue-100/80 px-1 py-2 text-[10px] font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:hover:bg-blue-900/70;
}
</style>
