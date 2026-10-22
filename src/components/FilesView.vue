<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { pickerDefaultPath } from "../lib/paths";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Activity,
  Archive,
  Code,
  ExternalLink,
  File,
  FilePlus2,
  FileText,
  FolderCog,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Image,
  LayoutGrid,
  List,
  Music,
  RefreshCw,
  Shapes,
  TriangleAlert,
  Video,
  X,
} from "@lucide/vue";
import { FILES_DIR_KEY, setSetting } from "../lib/db";
import {
  checkFileFree,
  importFolderToLibrary,
  listLibraryFiles,
  moveFileToLibrary,
  openPath,
} from "../lib/api";
import ImportDialog from "./ImportDialog.vue";
import { FILE_CATEGORIES, type LibraryFile } from "../types";

const props = defineProps<{ filesDir: string | null; active: boolean }>();
const emit = defineEmits<{ dirChanged: [dir: string] }>();

const files = ref<LibraryFile[]>([]);
const view = ref<"type" | "folder">("type");
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

interface FileStatusEntry {
  free: boolean;
  reason: string | null;
  checking?: boolean;
}
const fileStatus = ref<Record<string, FileStatusEntry>>({});
function statusOf(path: string): FileStatusEntry | undefined {
  return fileStatus.value[path];
}
async function checkStatus(file: LibraryFile) {
  fileStatus.value = {
    ...fileStatus.value,
    [file.path]: { free: false, reason: null, checking: true },
  };
  try {
    const res = await checkFileFree(file.path);
    fileStatus.value = {
      ...fileStatus.value,
      [file.path]: { free: res.free, reason: res.reason },
    };
  } catch {
    fileStatus.value = {
      ...fileStatus.value,
      [file.path]: { free: false, reason: "Could not check this file." },
    };
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
    const key =
      view.value === "type" ? f.category : f.folder || "Library root";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(f);
  }
  const entries = [...map.entries()];
  if (view.value === "type") {
    entries.sort(
      (a, b) =>
        FILE_CATEGORIES.indexOf(a[0] as never) -
        FILE_CATEGORIES.indexOf(b[0] as never),
    );
  } else {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return entries;
});

async function refresh() {
  if (!props.filesDir) return;
  loading.value = true;
  try {
    files.value = await listLibraryFiles(props.filesDir);
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

  <div v-else>
    <!-- Toolbar -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
        <button
          class="toggle-btn"
          :class="view === 'type' ? 'bg-blue-600 text-white' : ''"
          @click="view = 'type'"
        >
          <Shapes class="h-4 w-4" /> By type
        </button>
        <button
          class="toggle-btn"
          :class="view === 'folder' ? 'bg-blue-600 text-white' : ''"
          @click="view = 'folder'"
        >
          <FolderTree class="h-4 w-4" /> By folder
        </button>
      </div>

      <div class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
        <button
          class="toggle-btn"
          :class="layout === 'table' ? 'bg-blue-600 text-white' : ''"
          title="Table view"
          @click="setLayout('table')"
        >
          <List class="h-4 w-4" />
        </button>
        <button
          class="toggle-btn"
          :class="layout === 'grid' ? 'bg-blue-600 text-white' : ''"
          title="Grid view"
          @click="setLayout('grid')"
        >
          <LayoutGrid class="h-4 w-4" />
        </button>
      </div>

      <input
        v-model="query"
        class="min-w-40 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 sm:max-w-xs"
        placeholder="Search files…"
      />

      <button class="toolbar-btn" @click="pickFiles">
        <FilePlus2 class="h-4 w-4" /> Add files
      </button>
      <button class="toolbar-btn" @click="showAddFolder = true">
        <FolderPlus class="h-4 w-4" /> Add folder
      </button>
      <button class="toolbar-btn" @click="refresh">
        <RefreshCw class="h-4 w-4" /> Refresh
      </button>
      <button class="toolbar-btn" :title="`Library folder: ${filesDir}`" @click="chooseFolder">
        <FolderCog class="h-4 w-4" />
      </button>
    </div>

    <p class="mb-4 text-xs text-neutral-500">
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
    <p v-if="loading" class="py-10 text-center text-sm text-neutral-500">Loading…</p>
    <div v-else-if="!filtered.length" class="py-16 text-center text-neutral-500">
      <p class="mb-1 text-lg font-medium">The library is empty</p>
      <p class="text-sm">Use <strong>Add files</strong>, <strong>Add folder</strong>, or drag &amp; drop files here — they'll be moved in and categorized.</p>
    </div>
    <div v-else class="space-y-6">
      <section v-for="[group, items] in groups" :key="group">
        <h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {{ group }} <span class="font-normal normal-case">({{ items.length }})</span>
        </h3>
        <div
          v-if="layout === 'table'"
          class="card-glass overflow-x-auto rounded-xl bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
        >
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                <th class="px-4 py-2 font-medium">Name</th>
                <th class="px-4 py-2 font-medium">{{ view === 'type' ? 'Folder' : 'Category' }}</th>
                <th class="px-4 py-2 font-medium">Size</th>
                <th class="px-4 py-2 font-medium">Status</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
              <tr v-for="file in items" :key="file.path" class="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                <td class="max-w-0 px-4 py-2.5">
                  <span class="flex min-w-0 items-center gap-2.5">
                    <component :is="iconFor(file.category)" class="h-5 w-5 shrink-0 text-blue-600" />
                    <span class="truncate font-medium">{{ file.name }}</span>
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-2.5 text-neutral-500">{{ view === 'type' ? file.folder || 'Library root' : file.category }}</td>
                <td class="whitespace-nowrap px-4 py-2.5 text-neutral-500">{{ formatSize(file.size) }}</td>
                <td class="whitespace-nowrap px-4 py-2.5">
                  <span v-if="statusOf(file.path)?.checking" class="text-xs text-neutral-400">Checking\u2026</span>
                  <span v-else-if="statusOf(file.path)" class="inline-flex items-center gap-1.5 text-xs font-medium" :class="statusOf(file.path)?.free ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'" :title="statusOf(file.path)?.reason ?? ''">
                    <span class="h-1.5 w-1.5 rounded-full" :class="statusOf(file.path)?.free ? 'bg-green-500' : 'bg-amber-500'"></span>
                    {{ statusOf(file.path)?.free ? 'Free' : 'In use' }}
                  </span>
                  <span v-else class="text-xs text-neutral-400">—</span>
                </td>
                <td class="px-4 py-2.5">
                  <span class="flex justify-end gap-1">
                    <button class="file-action" title="Check whether this file is in use right now" @click="checkStatus(file)">
                      <Activity class="h-3.5 w-3.5" /> Status
                    </button>
                    <button class="file-action" title="Open the folder containing this file" @click="openFolder(file)">
                      <FolderOpen class="h-3.5 w-3.5" /> Folder
                    </button>
                    <button class="file-action" title="Open this file" @click="openPath(file.path)">
                      <ExternalLink class="h-3.5 w-3.5" /> Open
                    </button>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <li
            v-for="file in items"
            :key="file.path"
            class="card-glass flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
          >
            <component :is="iconFor(file.category)" class="h-8 w-8 text-blue-600" />
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium" :title="file.name">{{ file.name }}</span>
              <span class="block truncate text-xs text-neutral-500">
                {{ view === 'type' ? file.folder || 'Library root' : file.category }} · {{ formatSize(file.size) }}
              </span>
              <span class="mt-0.5 block">
                <span v-if="statusOf(file.path)?.checking" class="text-xs text-neutral-400">Checking\u2026</span>
                  <span v-else-if="statusOf(file.path)" class="inline-flex items-center gap-1.5 text-xs font-medium" :class="statusOf(file.path)?.free ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'" :title="statusOf(file.path)?.reason ?? ''">
                    <span class="h-1.5 w-1.5 rounded-full" :class="statusOf(file.path)?.free ? 'bg-green-500' : 'bg-amber-500'"></span>
                    {{ statusOf(file.path)?.free ? 'Free' : 'In use' }}
                  </span>
              </span>
            </span>
            <span class="mt-auto flex flex-wrap gap-1 pt-1">
              <button class="file-action" title="Check whether this file is in use right now" @click="checkStatus(file)">
                      <Activity class="h-3.5 w-3.5" /> Status
                    </button>
                    <button class="file-action" title="Open the folder containing this file" @click="openFolder(file)">
                      <FolderOpen class="h-3.5 w-3.5" /> Folder
                    </button>
                    <button class="file-action" title="Open this file" @click="openPath(file.path)">
                      <ExternalLink class="h-3.5 w-3.5" /> Open
                    </button>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>

  <ImportDialog
    v-if="showAddFolder && filesDir"
    :parent-dir="filesDir"
    title="Add folder to library"
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
  @apply flex items-center gap-1 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700;
}
.toolbar-btn {
  @apply flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700;
}
</style>
