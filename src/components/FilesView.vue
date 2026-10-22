<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { pickerDefaultPath } from "../lib/paths";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Archive,
  ArrowUp,
  ChevronRight,
  Code,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderCog,
  FolderOpen,
  FolderPlus,
  Image,
  LayoutGrid,
  Library,
  List,
  Music,
  RefreshCw,
  Search,
  StickyNote,
  Tag,
  Trash2,
  TriangleAlert,
  Video,
  X,
} from "@lucide/vue";
import { FILES_DIR_KEY, setSetting } from "../lib/db";
import {
  allowAssetDir,
  checkFileFree,
  deleteLibraryFile,
  deleteLibraryFolder,
  importFolderToLibrary,
  listLibraryFiles,
  moveFileToLibrary,
  openPath,
} from "../lib/api";
import ImportDialog from "./ImportDialog.vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type FileMeta, LibraryFile } from "../types";
import { deleteFileMeta, getAllFileMeta, setFileMeta } from "../lib/db";
import { chromeDark } from "../lib/theme";
import ConfirmDialog from "./ConfirmDialog.vue";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu.vue";

const props = defineProps<{ filesDir: string | null; active: boolean }>();
const emit = defineEmits<{ dirChanged: [dir: string] }>();

const files = ref<LibraryFile[]>([]);
const query = ref("");
const loading = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

interface BusyItem {
  source: string;
  name: string;
  reason: string;
}
const busyItems = ref<BusyItem[]>([]);
const showAddFolder = ref(false);

async function onFolderImported(warning: string | null) {
  showAddFolder.value = false;
  await refresh();
  if (warning) error.value = warning;
  else notice.value = "Folder added to the library.";
}

/* --------------------- layout & per-file actions --------------------- */
const layout = ref<"table" | "grid">(
  localStorage.getItem("pm-files-layout") === "grid" ? "grid" : "table",
);
function setLayout(v: "table" | "grid") {
  layout.value = v;
  localStorage.setItem("pm-files-layout", v);
}

/* ------------------- per-file status & notes (SQLite) ------------------- */
const meta = ref<Record<string, FileMeta>>({});
async function loadMeta() {
  meta.value = await getAllFileMeta().catch(() => meta.value);
}
function metaOf(file: LibraryFile): FileMeta {
  return meta.value[file.path] ?? { status: "", notes: "" };
}
async function saveMeta(file: LibraryFile, next: FileMeta) {
  await setFileMeta(file.path, next);
  meta.value = { ...meta.value, [file.path]: next };
}

const STATUS_PRESETS = ["To review", "In progress", "Done", "Important", "On hold"];
const STATUS_CLASSES: Record<string, string> = {
  "To review": "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  "In progress": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  Done: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  Important: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  "On hold": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
};
function statusClasses(status: string): string {
  return (
    STATUS_CLASSES[status] ??
    "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
  );
}

const notePreview = ref("");
const statusTarget = ref<LibraryFile | null>(null);
const customStatus = ref("");
function openStatus(file: LibraryFile) {
  statusTarget.value = file;
  customStatus.value = "";
}
async function applyStatus(status: string) {
  const file = statusTarget.value;
  if (!file) return;
  statusTarget.value = null;
  try {
    await saveMeta(file, { ...metaOf(file), status });
  } catch (e) {
    error.value = String(e);
  }
}

const notesTarget = ref<LibraryFile | null>(null);
const notesDraft = ref("");
function openNotes(file: LibraryFile) {
  notesTarget.value = file;
  notesDraft.value = metaOf(file).notes;
}
async function saveNotes() {
  const file = notesTarget.value;
  if (!file) return;
  notesTarget.value = null;
  try {
    await saveMeta(file, { ...metaOf(file), notes: notesDraft.value.trim() });
  } catch (e) {
    error.value = String(e);
  }
}

/* ------------------------------ deletion ------------------------------ */
type DeleteRequest =
  | { kind: "file"; file: LibraryFile }
  | { kind: "folder"; folder: string; count: number; paths: string[] };
const confirmDelete = ref<DeleteRequest | null>(null);
function askDeleteFolderPath(folder: string) {
  if (!folder) return;
  const items = filesUnder(folder);
  confirmDelete.value = {
    kind: "folder",
    folder,
    count: items.length,
    paths: items.map((f) => f.path),
  };
}
async function doDelete() {
  const req = confirmDelete.value;
  if (!req || !props.filesDir) return;
  confirmDelete.value = null;
  try {
    if (req.kind === "file") {
      await deleteLibraryFile(props.filesDir, req.file.path);
      await deleteFileMeta(req.file.path).catch(() => {});
      notice.value = `Deleted ${req.file.name}.`;
    } else {
      await deleteLibraryFolder(props.filesDir, req.folder);
      for (const path of req.paths) await deleteFileMeta(path).catch(() => {});
      notice.value = `Deleted folder ${req.folder} (${req.count} files).`;
    }
    await refresh();
  } catch (e) {
    error.value = String(e);
  }
}

function openFolder(file: LibraryFile) {
  const i = Math.max(file.path.lastIndexOf("\\"), file.path.lastIndexOf("/"));
  if (i > 0) void openPath(file.path.slice(0, i));
}

const CATEGORY_ICONS: Record<string, unknown> = {
  Images: Image,
  Videos: Video,
  Audio: Music,
  Documents: FileText,
  Archives: Archive,
  Code: Code,
  Other: File,
};

function iconFor(category: string) {
  return CATEGORY_ICONS[category] ?? File;
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

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return files.value;
  return files.value.filter((f) => f.name.toLowerCase().includes(q));
});

const groups = computed(() => {
  const map = new Map<string, LibraryFile[]>();
  for (const f of filtered.value) {
    const key = f.folder || "Library root";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  const entries = [...map.entries()];
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  return entries;
});

/* --------------------- folder drill-in navigation --------------------- */
const currentFolder = ref("");
const SEP = computed(() =>
  files.value.some((f) => f.folder.includes("\\")) ? "\\" : "/",
);
const drillIn = computed(() => !query.value.trim());
const crumbs = computed(() =>
  currentFolder.value ? currentFolder.value.split(SEP.value) : [],
);
function crumbPath(index: number): string {
  return crumbs.value.slice(0, index + 1).join(SEP.value);
}
function filesUnder(folder: string): LibraryFile[] {
  return files.value.filter(
    (f) => f.folder === folder || f.folder.startsWith(folder + SEP.value),
  );
}
const childFolders = computed(() => {
  if (!drillIn.value) return [] as { name: string; path: string; count: number }[];
  const cur = currentFolder.value;
  const prefix = cur ? cur + SEP.value : "";
  const names = new Map<string, string>();
  for (const f of files.value) {
    if (!f.folder || f.folder === cur) continue;
    if (prefix && !f.folder.startsWith(prefix)) continue;
    const rest = prefix ? f.folder.slice(prefix.length) : f.folder;
    const name = rest.split(SEP.value)[0];
    if (name && !names.has(name)) names.set(name, prefix + name);
  }
  return [...names.entries()]
    .map(([name, path]) => ({ name, path, count: filesUnder(path).length }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
const filesHere = computed(() =>
  drillIn.value
    ? files.value.filter((f) => f.folder === currentFolder.value)
    : [],
);
const displayGroups = computed(() =>
  drillIn.value
    ? filesHere.value.length
      ? [["", filesHere.value] as [string, LibraryFile[]]]
      : []
    : groups.value,
);
function goFolder(path: string) {
  currentFolder.value = path;
}
function goUp() {
  currentFolder.value = crumbs.value.slice(0, -1).join(SEP.value);
}
watch(
  () => props.filesDir,
  () => (currentFolder.value = ""),
);
// If the folder we are in disappears (deleted/renamed), walk up to the
// nearest ancestor that still exists.
watch(files, () => {
  let cur = currentFolder.value;
  while (
    cur &&
    !files.value.some(
      (f) => f.folder === cur || f.folder.startsWith(cur + SEP.value),
    )
  ) {
    cur = cur.split(SEP.value).slice(0, -1).join(SEP.value);
  }
  if (cur !== currentFolder.value) currentFolder.value = cur;
});

async function refresh() {
  if (!props.filesDir) return;
  loading.value = true;
  try {
    files.value = await listLibraryFiles(props.filesDir);
    void allowAssetDir(props.filesDir).catch(() => {});
    await loadMeta();
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}
onMounted(refresh);

// The view stays mounted while hidden (v-show in App), so refresh the
// listing whenever the Files tab becomes active again.
watch(
  () => props.active,
  (a) => {
    if (a) refresh();
  },
);

async function chooseFolder() {
  const picked = await open({ directory: true, multiple: false, defaultPath: await pickerDefaultPath() });
  if (typeof picked === "string") {
    await setSetting(FILES_DIR_KEY, picked);
    emit("dirChanged", picked);
    // filesDir prop updates from the parent; refresh on next tick.
    setTimeout(refresh, 50);
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

async function addFiles(paths: string[]) {
  if (!props.filesDir || !paths.length) return;
  error.value = null;
  notice.value = null;
  let moved = 0;
  for (const source of paths) {
    const check = await checkFileFree(source);
    if (!check.free) {
      busyItems.value.push({
        source,
        name: baseName(source),
        reason: check.reason ?? "File is in use",
      });
      continue;
    }
    try {
      await moveFileToLibrary(source, props.filesDir);
      moved++;
    } catch (e) {
      busyItems.value.push({
        source,
        name: baseName(source),
        reason: String(e),
      });
    }
  }
  if (moved) notice.value = `Moved ${moved} file${moved === 1 ? "" : "s"} into the library.`;
  await refresh();
}

async function pickFiles() {
  const picked = await open({ multiple: true, defaultPath: await pickerDefaultPath() });
  if (Array.isArray(picked)) await addFiles(picked);
}

async function retryBusy(item: BusyItem) {
  busyItems.value = busyItems.value.filter((b) => b.source !== item.source);
  await addFiles([item.source]);
}

function dismissBusy(item: BusyItem) {
  busyItems.value = busyItems.value.filter((b) => b.source !== item.source);
}

/* ------------------------- context menu ------------------------- */
const ctx = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
function openFileCtx(event: MouseEvent, file: LibraryFile) {
  ctx.value = {
    x: event.clientX,
    y: event.clientY,
    items: [
      { label: "Open", icon: ExternalLink, action: () => openPath(file.path) },
      {
        label: "Open containing folder",
        icon: FolderOpen,
        action: () => openFolder(file),
      },
      { label: "Set status", icon: Tag, action: () => openStatus(file) },
      {
        label: metaOf(file).notes ? "Edit note" : "Add a note",
        icon: StickyNote,
        action: () => openNotes(file),
      },
      {
        label: "Delete",
        icon: Trash2,
        danger: true,
        action: () => (confirmDelete.value = { kind: "file", file }),
      },
    ],
  };
}
function openContainerCtx(event: MouseEvent) {
  // Leave the normal text menu alone inside form fields.
  if ((event.target as HTMLElement).closest("input, textarea, select")) return;
  event.preventDefault();
  const items: ContextMenuItem[] = [
    { label: "Add files", icon: FilePlus2, action: () => pickFiles() },
    {
      label: "Import folder",
      icon: FolderPlus,
      action: () => (showAddFolder.value = true),
    },
    { label: "Refresh list", icon: RefreshCw, action: () => refresh() },
    {
      label: "Open library folder",
      icon: FolderOpen,
      action: () => {
        if (props.filesDir) void openPath(props.filesDir);
      },
    },
  ];
  if (currentFolder.value) {
    items.unshift({
      label: "Go up one level",
      icon: ArrowUp,
      action: () => goUp(),
    });
  }
  ctx.value = { x: event.clientX, y: event.clientY, items };
}
function openFolderCtx(event: MouseEvent, folder: { path: string }) {
  ctx.value = {
    x: event.clientX,
    y: event.clientY,
    items: [
      {
        label: "Open folder",
        icon: FolderOpen,
        action: () => goFolder(folder.path),
      },
      {
        label: "Delete folder",
        icon: Trash2,
        danger: true,
        action: () => askDeleteFolderPath(folder.path),
      },
    ],
  };
}

/* Drag & drop: dropping files anywhere on this view adds them. */
let unlisten: (() => void) | null = null;
onMounted(async () => {
  try {
    unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
      if (
        props.active &&
        event.payload.type === "drop" &&
        event.payload.paths.length
      ) {
        await addFiles(event.payload.paths);
      }
    });
  } catch {
    /* drag & drop unavailable — the file picker still works */
  }
});
onUnmounted(() => unlisten?.());
</script>

<template>
  <!-- Setup state: no library folder chosen yet -->
  <div v-if="!filesDir" class="flex items-center justify-center py-16">
    <div class="w-full max-w-lg rounded-2xl bg-white p-8 shadow dark:bg-neutral-900">
      <h2 class="mb-2 text-xl font-bold">Your file library</h2>
      <p class="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
        Pick a parent folder for the file library. Files you add are
        <strong>moved</strong> there and organized into category folders
        (Images, Videos, Documents, …). A file is only moved after checking
        it isn't running or open in another app.
      </p>
      <button
        class="w-full rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white"
        @click="chooseFolder"
      >
        Choose library folder…
      </button>
    </div>
  </div>

  <div v-else @contextmenu="openContainerCtx">
    <!-- Toolbar -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative min-w-52 flex-1 sm:max-w-md">
        <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
        <input
          v-model="query"
          class="on-bg w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          placeholder="Search files…"
        />
      </div>

      <div class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
        <button
          class="toggle-btn"
          :class="layout === 'table' ? 'switch-active' : ''"
          title="Show files as a list"
          @click="setLayout('table')"
        >
          <List class="h-4 w-4" /> List
        </button>
        <button
          class="toggle-btn"
          :class="layout === 'grid' ? 'switch-active' : ''"
          title="Show files as big icons, like Windows Explorer"
          @click="setLayout('grid')"
        >
          <LayoutGrid class="h-4 w-4" /> Icons
        </button>
      </div>

      <button class="toolbar-btn" @click="pickFiles">
        <FilePlus2 class="h-4 w-4" /> Add files
      </button>
      <button class="toolbar-btn" @click="showAddFolder = true">
        <FolderPlus class="h-4 w-4" /> Import folder
      </button>
      <button class="toolbar-btn tooltip tooltip-bottom" data-tip="Refresh the list" @click="refresh">
        <RefreshCw class="h-4 w-4" />
      </button>
      <button class="toolbar-btn tooltip tooltip-bottom" :data-tip="`Library folder: ${filesDir}`" @click="chooseFolder">
        <FolderCog class="h-4 w-4" />
      </button>
    </div>

    <p class="on-bg mb-4 text-xs text-neutral-500">
      Library: <span class="font-mono">{{ filesDir }}</span> — drop files
      anywhere here to add them.
    </p>

    <div v-if="notice" class="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
      {{ notice }}
    </div>
    <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
      {{ error }}
    </div>

    <!-- Busy files: skipped, never forced -->
    <div v-if="busyItems.length" class="mb-4 rounded-lg bg-amber-50 px-4 py-3 dark:bg-amber-950">
      <p class="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <TriangleAlert class="h-4 w-4" />
        {{ busyItems.length }} file{{ busyItems.length === 1 ? "" : "s" }} skipped — in use
      </p>
      <ul class="space-y-1.5">
        <li v-for="item in busyItems" :key="item.source" class="flex items-center justify-between gap-2 text-sm">
          <span class="min-w-0">
            <span class="font-medium">{{ item.name }}</span>
            <span class="text-amber-700 dark:text-amber-300"> — {{ item.reason }}</span>
          </span>
          <span class="flex shrink-0 gap-1">
            <button class="rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white" @click="retryBusy(item)">
              Retry
            </button>
            <button class="rounded p-1 hover:bg-amber-100 dark:hover:bg-amber-900" @click="dismissBusy(item)">
              <X class="h-4 w-4" />
            </button>
          </span>
        </li>
      </ul>
    </div>

    <!-- File groups -->
    <p v-if="loading" class="on-bg py-10 text-center text-sm text-neutral-500">Loading…</p>
    <div v-else-if="!filtered.length" class="on-bg py-16 text-center text-neutral-500">
      <p class="mb-1 text-lg font-medium">The library is empty</p>
      <p class="text-sm">Use <strong>Add files</strong>, <strong>Import folder</strong>, or drag &amp; drop files here — they'll be moved in and categorized.</p>
    </div>
    <div v-else class="space-y-6">
      <template v-if="drillIn">
        <nav class="on-bg flex flex-wrap items-center gap-1 text-sm">
          <button class="crumb" :class="!currentFolder ? 'crumb-active' : ''" @click="goFolder('')">
            <Library class="h-4 w-4" /> Library
          </button>
          <template v-for="(seg, i) in crumbs" :key="i">
            <ChevronRight class="h-4 w-4 shrink-0 text-neutral-400" />
            <button class="crumb" :class="i === crumbs.length - 1 ? 'crumb-active' : ''" @click="goFolder(crumbPath(i))">
              {{ seg }}
            </button>
          </template>
          <span class="ml-auto flex items-center gap-1">
            <button v-if="currentFolder" class="file-action tooltip tooltip-bottom" data-tip="Go up one level" @click="goUp">
              <ArrowUp class="h-4 w-4" />
            </button>
            <button
              v-if="currentFolder"
              class="file-action file-action-danger"
              :title="`Delete folder ${currentFolder} and everything in it`"
              @click="askDeleteFolderPath(currentFolder)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </span>
        </nav>

        <ul
          v-if="layout === 'grid' && childFolders.length"
          class="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
        >
          <li
            v-for="folder in childFolders"
            :key="folder.path"
            class="group relative flex cursor-pointer flex-col items-center rounded-xl px-2 pb-3 pt-4 text-center transition hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"
            :title="`Open folder ${folder.name}`"
            @click="goFolder(folder.path)"
            @contextmenu.prevent.stop="openFolderCtx($event, folder)"
          >
            <span class="absolute right-1 top-1 z-10 opacity-0 transition group-hover:opacity-100">
              <button
                class="file-action-sm file-action-danger"
                title="Delete this folder and everything in it"
                @click.stop="askDeleteFolderPath(folder.path)"
              >
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </span>
            <Folder class="h-16 w-16 text-amber-500" />
            <span class="mt-2 line-clamp-2 max-w-full break-words text-xs leading-snug" :title="folder.name">{{ folder.name }}</span>
            <span class="mt-0.5 text-[11px] text-neutral-500">{{ folder.count }} item{{ folder.count === 1 ? "" : "s" }}</span>
          </li>
        </ul>

        <div
          v-if="layout === 'table' && childFolders.length"
          class="card-glass overflow-hidden rounded-xl bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
        >
          <div
            v-for="folder in childFolders"
            :key="folder.path"
            class="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            @click="goFolder(folder.path)"
            @contextmenu.prevent.stop="openFolderCtx($event, folder)"
          >
            <Folder class="h-5 w-5 shrink-0 text-amber-500" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ folder.name }}</span>
            <span class="shrink-0 text-xs text-neutral-500">{{ folder.count }} item{{ folder.count === 1 ? "" : "s" }}</span>
            <button
              class="file-action-sm file-action-danger shrink-0"
              title="Delete this folder and everything in it"
              @click.stop="askDeleteFolderPath(folder.path)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </button>
            <ChevronRight class="h-4 w-4 shrink-0 text-neutral-400" />
          </div>
        </div>

        <p v-if="!childFolders.length && !filesHere.length" class="py-10 text-center text-sm text-neutral-500">
          This folder is empty.
          <button class="ml-1 font-medium text-blue-600 hover:underline" @click="goFolder('')">
            Back to the library root
          </button>
        </p>
      </template>

      <section v-for="[group, items] in displayGroups" :key="group">
        <div v-if="!drillIn" class="mb-2 flex items-center justify-between gap-2">
          <h3 class="on-bg text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {{ group }} <span class="font-normal normal-case">({{ items.length }})</span>
          </h3>
          <button
            v-if="items[0]?.folder"
            class="file-action file-action-danger"
            :title="`Delete folder ${items[0]?.folder ?? ''} and everything in it`"
            @click="askDeleteFolderPath(items[0]?.folder ?? '')"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </div>
        <div
          v-if="layout === 'table'"
          class="card-glass overflow-x-auto rounded-xl bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
        >
          <table class="w-full table-fixed text-sm">
            <colgroup>
              <col style="width: 46%" />
              <col style="width: 16%" />
              <col style="width: 9%" />
              <col style="width: 13%" />
              <col style="width: 16%" />
            </colgroup>
            <thead>
              <tr class="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                <th class="px-4 py-2 font-medium">Name</th>
                <th class="px-4 py-2 font-medium">Category</th>
                <th class="px-4 py-2 font-medium">Size</th>
                <th class="px-4 py-2 font-medium">Status</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
              <tr v-for="file in items" :key="file.path" class="hover:bg-neutral-50 dark:hover:bg-neutral-800/50" @contextmenu.prevent.stop="openFileCtx($event, file)">
                <td class="max-w-0 px-4 py-2.5">
                  <span class="flex min-w-0 items-center gap-2.5">
                    <component :is="iconFor(file.category)" class="h-5 w-5 shrink-0 text-blue-600" />
                    <span class="truncate font-medium">{{ file.name }}</span>
                    <span
                        v-if="metaOf(file).notes"
                        class="shrink-0 cursor-default text-blue-500 dark:text-blue-400"
                        @mouseenter="notePreview = metaOf(file).notes"
                        @mouseleave="notePreview = ''"
                      >
                        <StickyNote class="h-3.5 w-3.5" />
                      </span>
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-neutral-500">{{ file.category }}</td>
                <td class="whitespace-nowrap px-4 py-2.5 text-neutral-500">{{ formatSize(file.size) }}</td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <button v-if="metaOf(file).status" class="status-badge" :class="statusClasses(metaOf(file).status)" title="Change status" @click="openStatus(file)">{{ metaOf(file).status }}</button>
                  <button v-else class="text-xs text-neutral-400 hover:text-blue-600" title="Set a status for this file" @click="openStatus(file)">Set status</button>
                </td>
                <td class="px-4 py-2.5">
                  <span class="flex justify-end gap-1">
                    <button class="file-action" title="Set status" @click="openStatus(file)">
                      <Tag class="h-4 w-4" />
                    </button>
                    <button class="file-action" :title="metaOf(file).notes ? 'Edit note' : 'Add a note'" @click="openNotes(file)">
                      <StickyNote class="h-4 w-4" :class="metaOf(file).notes ? 'text-blue-600 dark:text-blue-400' : ''" />
                    </button>
                    <button class="file-action" title="Open the folder containing this file" @click="openFolder(file)">
                      <FolderOpen class="h-4 w-4" />
                    </button>
                    <button class="file-action" title="Open this file" @click="openPath(file.path)">
                      <ExternalLink class="h-4 w-4" />
                    </button>
                    <button class="file-action file-action-danger" title="Delete this file" @click="confirmDelete = { kind: 'file', file }">
                      <Trash2 class="h-4 w-4" />
                    </button>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul v-else class="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          <li
            v-for="file in items"
            :key="file.path"
            class="group relative flex flex-col items-center rounded-xl px-2 pb-3 pt-4 text-center transition hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60"
            title="Double-click to open"
            @dblclick="openPath(file.path)"
            @contextmenu.prevent.stop="openFileCtx($event, file)"
          >
            <span
              class="absolute right-1 top-1 z-10 flex gap-0.5 opacity-0 transition group-hover:opacity-100"
              @dblclick.stop
            >
              <button class="file-action-sm" title="Set status" @click="openStatus(file)">
                <Tag class="h-3.5 w-3.5" />
              </button>
              <button class="file-action-sm" :title="metaOf(file).notes ? 'Edit note' : 'Add a note'" @click="openNotes(file)">
                <StickyNote class="h-3.5 w-3.5" :class="metaOf(file).notes ? 'text-blue-600 dark:text-blue-400' : ''" />
              </button>
              <button class="file-action-sm" title="Open the folder containing this file" @click="openFolder(file)">
                <FolderOpen class="h-3.5 w-3.5" />
              </button>
              <button class="file-action-sm" title="Open this file" @click="openPath(file.path)">
                <ExternalLink class="h-3.5 w-3.5" />
              </button>
              <button class="file-action-sm file-action-danger" title="Delete this file" @click="confirmDelete = { kind: 'file', file }">
                <Trash2 class="h-3.5 w-3.5" />
              </button>
            </span>
            <span class="flex h-20 items-center justify-center">
              <img
                v-if="file.category === 'Images'"
                :src="convertFileSrc(file.path)"
                class="max-h-20 max-w-full rounded object-contain shadow"
                alt=""
                loading="lazy"
              />
              <video
                v-else-if="file.category === 'Videos'"
                :src="convertFileSrc(file.path)"
                class="max-h-20 max-w-full rounded object-contain shadow"
                muted
                preload="metadata"
              ></video>
              <component v-else :is="iconFor(file.category)" class="h-16 w-16 text-blue-600" />
            </span>
            <span class="mt-2 flex max-w-full items-start justify-center gap-1">
              <span class="line-clamp-2 break-words text-xs leading-snug" :title="file.name">{{ file.name }}</span>
              <span
                v-if="metaOf(file).notes"
                class="mt-px shrink-0 cursor-default text-blue-500 dark:text-blue-400"
                @mouseenter="notePreview = metaOf(file).notes"
                @mouseleave="notePreview = ''"
              >
                <StickyNote class="h-3.5 w-3.5" />
              </span>
            </span>
            <span class="mt-0.5 text-[11px] text-neutral-500">
              {{ file.category }} · {{ formatSize(file.size) }}
            </span>
            <span v-if="metaOf(file).status" class="status-badge mt-1" :class="statusClasses(metaOf(file).status)">{{ metaOf(file).status }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>

  <div
    v-if="notePreview"
    class="pointer-events-none fixed bottom-6 left-1/2 z-40 w-full max-w-md -translate-x-1/2 rounded-xl bg-neutral-900/95 px-4 py-3 text-sm text-neutral-100 shadow-xl ring-1 ring-neutral-700"
  >
    <p class="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
      <StickyNote class="h-3.5 w-3.5" /> Note preview
    </p>
    <p class="whitespace-pre-wrap leading-relaxed">{{ notePreview }}</p>
  </div>

  <div
    v-if="statusTarget"
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="statusTarget = null"
  >
    <div class="glass-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 class="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Tag class="h-5 w-5" /> Set status
      </h2>
      <p class="mb-4 truncate text-sm text-neutral-500">{{ statusTarget.name }}</p>
      <div class="mb-4 flex flex-wrap gap-1.5">
        <button
          v-for="preset in STATUS_PRESETS"
          :key="preset"
          class="status-badge px-2.5 py-1 text-xs"
          :class="statusClasses(preset)"
          @click="applyStatus(preset)"
        >
          {{ preset }}
        </button>
      </div>
      <label class="mb-1 block text-sm font-medium">Custom status</label>
      <div class="flex gap-2">
        <input
          v-model="customStatus"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          placeholder="Type your own…"
          @keyup.enter="customStatus.trim() && applyStatus(customStatus.trim())"
        />
        <button
          class="btn btn-primary btn-sm"
          :disabled="!customStatus.trim()"
          @click="applyStatus(customStatus.trim())"
        >
          Set
        </button>
      </div>
      <div class="mt-5 flex items-center justify-between">
        <button
          v-if="metaOf(statusTarget).status"
          class="text-sm font-medium text-red-600 hover:underline"
          @click="applyStatus('')"
        >
          Clear status
        </button>
        <span v-else></span>
        <button class="btn btn-ghost btn-sm" @click="statusTarget = null">Cancel</button>
      </div>
    </div>
  </div>

  <div
    v-if="notesTarget"
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="notesTarget = null"
  >
    <div class="glass-panel w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 class="mb-1 flex items-center gap-2 text-lg font-semibold">
        <StickyNote class="h-5 w-5" /> Notes
      </h2>
      <p class="mb-3 truncate text-sm text-neutral-500">{{ notesTarget.name }}</p>
      <textarea
        v-model="notesDraft"
        rows="4"
        class="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
        placeholder="Write a note about this file…"
      ></textarea>
      <div class="mt-4 flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="notesTarget = null">Cancel</button>
        <button class="btn btn-primary btn-sm" @click="saveNotes">Save note</button>
      </div>
    </div>
  </div>

  <ContextMenu
    v-if="ctx"
    :x="ctx.x"
    :y="ctx.y"
    :items="ctx.items"
    @close="ctx = null"
  />

  <ConfirmDialog
    v-if="confirmDelete"
    :title="confirmDelete.kind === 'file' ? 'Delete file?' : 'Delete folder?'"
    :message="
      confirmDelete.kind === 'file'
        ? `${confirmDelete.file.name} will be permanently deleted from the library folder. This cannot be undone.`
        : `The folder “${confirmDelete.folder}” and the ${confirmDelete.count} file(s) in this view will be permanently deleted. This cannot be undone.`
    "
    confirm-label="Delete"
    @confirm="doDelete"
    @cancel="confirmDelete = null"
  />

  <ImportDialog
    v-if="showAddFolder && filesDir"
    :parent-dir="filesDir"
    title="Import folder"
    parent-label="file library"
    :importer="importFolderToLibrary"
    @close="showAddFolder = false"
    @imported="onFolderImported"
  />
</template>

<style scoped>
.toggle-btn {
  @apply flex items-center gap-1.5 px-3 py-2 text-sm font-medium;
}
.file-action {
  @apply flex items-center rounded-lg bg-blue-100/80 p-2 text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:hover:bg-blue-900/70;
}
.file-action-sm {
  @apply flex items-center rounded-md bg-blue-100/90 p-1.5 text-blue-900 shadow ring-1 ring-blue-200 hover:bg-blue-200 dark:bg-blue-950/90 dark:text-blue-100 dark:ring-blue-900 dark:hover:bg-blue-900;
}
.file-action-danger {
  @apply hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300;
}
.crumb {
  @apply flex items-center gap-1 rounded-lg px-2 py-1 font-medium hover:bg-neutral-200/70 dark:hover:bg-neutral-800;
}
.crumb-active {
  @apply text-blue-600 dark:text-blue-400;
}
.status-badge {
  @apply inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium;
}
.toolbar-btn {
  @apply flex items-center gap-1.5 rounded-lg bg-blue-100/80 px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:hover:bg-blue-900/70;
}
</style>
