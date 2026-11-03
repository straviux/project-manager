<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  Clock,
  ExternalLink,
  Eye,
  File,
  Pin,
  Play,
  Search,
  Star,
} from "@lucide/vue";
import { listLibraryFiles, openPath } from "../lib/api";
import {
  getAllFileMeta,
  recordFileOpen,
  setFileMeta,
} from "../lib/db";
import { isPreviewable } from "../lib/documents";
import {
  fileTypeBadgeClasses,
  fileTypeIconClasses,
  fileTypeLabel,
  isAudioFile,
  isMediaPreviewable,
  FILE_TYPE_BADGE_BASE,
} from "../lib/fileTypes";
import type { FileMeta, LibraryFile } from "../types";
import DocumentPreviewDialog from "./DocumentPreviewDialog.vue";
import MediaPreviewDialog from "./MediaPreviewDialog.vue";

/**
 * Quick Access tab: the files the user works with most, flat (no
 * folder browsing — that is what the Files tab is for), in two
 * sections.
 *
 * Pinned (top): files starred in the Files tab (file_meta.starred).
 * A pinned file never also appears under Most opened, even if it is
 * frequently opened — one row per file, in the section the user
 * chose for it.
 *
 * Most opened (below): library files with an open count, most opens
 * first, then most recently opened. Opens are recorded by
 * FilesView and by this view itself for opens, previews and audio
 * plays (see recordFileOpen in db.ts); a file with no opens yet
 * simply does not appear here until it is opened. Top 30 only, so
 * the tab stays a short list instead of a second library.
 */
const props = defineProps<{ filesDir: string | null; active: boolean }>();
const emit = defineEmits<{
  playAudio: [file: LibraryFile, queue: LibraryFile[]];
}>();

const MAX_FREQUENT = 30;

const files = ref<LibraryFile[]>([]);
const meta = ref<Record<string, FileMeta>>({});
const query = ref("");
const loading = ref(false);
const error = ref<string | null>(null);

const previewTarget = ref<LibraryFile | null>(null);
const mediaPreviewTarget = ref<LibraryFile | null>(null);

function metaOf(file: LibraryFile): FileMeta {
  return (
    meta.value[file.path] ?? {
      status: "",
      notes: "",
      starred: false,
      openCount: 0,
      lastOpened: null,
    }
  );
}

async function refresh() {
  if (!props.filesDir) return;
  loading.value = true;
  try {
    files.value = await listLibraryFiles(props.filesDir);
    meta.value = await getAllFileMeta();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

// The view stays mounted while hidden (v-show in App), so refresh
// whenever the Quick Access tab becomes active again — stars and
// open counts changed in the Files tab show up immediately.
watch(
  () => props.active,
  (a) => {
    if (a) refresh();
  },
);

const searched = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return files.value;
  return files.value.filter((f) => f.name.toLowerCase().includes(q));
});

const pinned = computed(() =>
  searched.value
    .filter((f) => metaOf(f).starred)
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const frequent = computed(() => {
  const pinnedPaths = new Set(pinned.value.map((f) => f.path));
  return searched.value
    .filter((f) => !pinnedPaths.has(f.path) && metaOf(f).openCount > 0)
    .sort((a, b) => {
      const byCount = metaOf(b).openCount - metaOf(a).openCount;
      if (byCount !== 0) return byCount;
      return (metaOf(b).lastOpened ?? "").localeCompare(
        metaOf(a).lastOpened ?? "",
      );
    })
    .slice(0, MAX_FREQUENT);
});

async function toggleStar(file: LibraryFile) {
  try {
    await setFileMeta(file.path, {
      ...metaOf(file),
      starred: !metaOf(file).starred,
    });
    meta.value = {
      ...meta.value,
      [file.path]: { ...metaOf(file), starred: !metaOf(file).starred },
    };
  } catch (e) {
    error.value = String(e);
  }
}

function openFile(file: LibraryFile) {
  void recordFileOpen(file.path).catch(() => {});
  const m = metaOf(file);
  meta.value = {
    ...meta.value,
    [file.path]: {
      ...m,
      openCount: m.openCount + 1,
      lastOpened: new Date().toISOString(),
    },
  };
  void openPath(file.path);
}

function openPreview(file: LibraryFile) {
  void recordFileOpen(file.path).catch(() => {});
  if (isPreviewable(file.name)) previewTarget.value = file;
  else if (isMediaPreviewable(file.name)) mediaPreviewTarget.value = file;
}

function playAudio(file: LibraryFile) {
  void recordFileOpen(file.path).catch(() => {});
  const queue = [...pinned.value, ...frequent.value].filter((f) =>
    isAudioFile(f.name),
  );
  emit("playAudio", file, queue);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

function formatLastOpened(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay)
    return `today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function folderOf(file: LibraryFile): string {
  return file.folder || "Library root";
}
</script>

<template>
  <div>
    <div class="relative z-20 mb-4 flex flex-wrap items-center gap-2">
      <div class="relative min-w-52 flex-1 sm:max-w-md">
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <input
          v-model="query"
          class="on-bg w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          placeholder="Search Quick Access…"
        />
      </div>
      <span class="text-xs text-neutral-500">
        Pinned files on top, most opened below.
      </span>
    </div>

    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {{ error }}
    </div>
    <div v-else-if="!filesDir" class="on-bg py-20 text-center text-neutral-500">
      <p class="mb-2 text-lg font-medium">No library folder yet</p>
      <p class="text-sm">
        Set your library folder in the Files tab first — Quick Access
        lists files from that library.
      </p>
    </div>
    <div v-else-if="loading && !files.length" class="on-bg py-20 text-center text-neutral-500">
      Loading…
    </div>
    <div v-else-if="!pinned.length && !frequent.length" class="on-bg py-20 text-center text-neutral-500">
      <p class="mb-2 text-lg font-medium">Nothing here yet</p>
      <p class="text-sm">
        Star a file in the Files tab to pin it here, and files you open
        will appear under Most opened.
      </p>
    </div>
    <template v-else>
      <section v-if="pinned.length" class="mb-8">
        <h2 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Pin class="h-4 w-4" /> Pinned
          <span class="font-normal text-neutral-500">({{ pinned.length }})</span>
        </h2>
        <ul class="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
          <li
            v-for="file in pinned"
            :key="file.path"
            class="flex items-center gap-3 px-2 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            title="Double-click to open"
            @dblclick="openFile(file)"
          >
            <File class="h-5 w-5 shrink-0" :class="fileTypeIconClasses(file.name)" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ file.name }}</span>
              <span class="block truncate text-xs text-neutral-500">
                {{ folderOf(file) }} · {{ formatSize(file.size) }}
              </span>
            </span>
            <span :class="`${FILE_TYPE_BADGE_BASE} ${fileTypeBadgeClasses(file.name)}`">
              {{ fileTypeLabel(file.name) }}
            </span>
            <span class="flex shrink-0 items-center gap-1">
              <button
                v-if="isPreviewable(file.name) || isMediaPreviewable(file.name)"
                class="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Preview"
                @click="openPreview(file)"
              >
                <Eye class="h-4 w-4" />
              </button>
              <button
                v-if="isAudioFile(file.name)"
                class="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Play"
                @click="playAudio(file)"
              >
                <Play class="h-4 w-4" />
              </button>
              <button
                class="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Open in its own app"
                @click="openFile(file)"
              >
                <ExternalLink class="h-4 w-4" />
              </button>
              <button
                class="rounded p-1.5 text-amber-500 hover:bg-neutral-200/70 dark:hover:bg-neutral-800"
                title="Unpin (remove star)"
                @click="toggleStar(file)"
              >
                <Star class="h-4 w-4 fill-amber-500" />
              </button>
            </span>
          </li>
        </ul>
      </section>

      <section v-if="frequent.length">
        <h2 class="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Clock class="h-4 w-4" /> Most opened
          <span class="font-normal text-neutral-500">(top {{ MAX_FREQUENT }})</span>
        </h2>
        <ul class="divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
          <li
            v-for="file in frequent"
            :key="file.path"
            class="flex items-center gap-3 px-2 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            title="Double-click to open"
            @dblclick="openFile(file)"
          >
            <File class="h-5 w-5 shrink-0" :class="fileTypeIconClasses(file.name)" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ file.name }}</span>
              <span class="block truncate text-xs text-neutral-500">
                {{ folderOf(file) }} · {{ formatSize(file.size) }}
                <span v-if="metaOf(file).lastOpened">
                  · last opened {{ formatLastOpened(metaOf(file).lastOpened) }}
                </span>
              </span>
            </span>
            <span class="shrink-0 text-xs text-neutral-500">
              {{ metaOf(file).openCount }} open{{ metaOf(file).openCount === 1 ? "" : "s" }}
            </span>
            <span :class="`${FILE_TYPE_BADGE_BASE} ${fileTypeBadgeClasses(file.name)}`">
              {{ fileTypeLabel(file.name) }}
            </span>
            <span class="flex shrink-0 items-center gap-1">
              <button
                v-if="isPreviewable(file.name) || isMediaPreviewable(file.name)"
                class="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Preview"
                @click="openPreview(file)"
              >
                <Eye class="h-4 w-4" />
              </button>
              <button
                v-if="isAudioFile(file.name)"
                class="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Play"
                @click="playAudio(file)"
              >
                <Play class="h-4 w-4" />
              </button>
              <button
                class="rounded p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Open in its own app"
                @click="openFile(file)"
              >
                <ExternalLink class="h-4 w-4" />
              </button>
              <button
                class="rounded p-1.5 text-neutral-400 hover:bg-neutral-200/70 hover:text-amber-500 dark:hover:bg-neutral-800"
                title="Pin (star)"
                @click="toggleStar(file)"
              >
                <Star class="h-4 w-4" />
              </button>
            </span>
          </li>
        </ul>
      </section>
    </template>

    <DocumentPreviewDialog
      v-if="previewTarget"
      :file="previewTarget"
      @close="previewTarget = null"
    />
    <MediaPreviewDialog
      v-if="mediaPreviewTarget"
      :file="mediaPreviewTarget"
      @close="mediaPreviewTarget = null"
    />
  </div>
</template>
