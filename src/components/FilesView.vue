<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { pickerDefaultPath } from "../lib/paths";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Archive,
  ArrowUp,
  Check,
  ChevronRight,
  Code,
  Copy,
  ExternalLink,
  Eye,
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
  Settings2,
  Heart,
  ListMusic,
  Music,
  Play,
  RefreshCw,
  Search,
  Star,
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
  duplicateLibraryItem,
  importFolderToLibrary,
  listLibraryFiles,
  moveFileToLibrary,
  moveLibraryItem,
  openPath,
} from "../lib/api";
import ImportDialog from "./ImportDialog.vue";
import DocumentPreviewDialog from "./DocumentPreviewDialog.vue";
import MediaPreviewDialog from "./MediaPreviewDialog.vue";
import PlaylistPickerDialog from "./PlaylistPickerDialog.vue";
import DocumentCreateDialog from "./DocumentCreateDialog.vue";
import { isPreviewable } from "../lib/documents";
import { convertFileSrc } from "@tauri-apps/api/core";
import { type FileMeta, LibraryFile } from "../types";
import {
  deleteFileMeta,
  getAllFileMeta,
  logAction,
  setFileMeta,
} from "../lib/db";
import { showToast } from "../lib/toast";
import { loadFavorites, toggleFavorite } from "../lib/playlists";
import { useDialogDrag } from "../lib/useDialogDrag";
import {
  FILE_TYPE_BADGE_BASE,
  fileTypeBadgeClasses,
  fileTypeIconClasses,
  fileTypeLabel,
  fileTypeTitle,
  isAudioFile,
  isMediaPreviewable,
} from "../lib/fileTypes";
import { chromeDark } from "../lib/theme";
import ConfirmDialog from "./ConfirmDialog.vue";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu.vue";

const props = defineProps<{ filesDir: string | null; active: boolean }>();
const emit = defineEmits<{ dirChanged: [dir: string]; stats: [text: string]; playAudio: [file: LibraryFile, queue: LibraryFile[]] }>();

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

// Draggable inline dialogs (status / notes / batch move).
const statusPanel = ref<HTMLElement | null>(null);
const statusHandle = ref<HTMLElement | null>(null);
useDialogDrag(statusPanel, statusHandle);
const notesPanel = ref<HTMLElement | null>(null);
const notesHandle = ref<HTMLElement | null>(null);
useDialogDrag(notesPanel, notesHandle);
const batchPanel = ref<HTMLElement | null>(null);
const batchHandle = ref<HTMLElement | null>(null);
useDialogDrag(batchPanel, batchHandle);

async function onFolderImported(warning: string | null, path?: string) {
  showAddFolder.value = false;
  await refresh();
  const name = path ? baseName(path) : "Folder";
  if (warning) {
    showToast(warning, "error");
    await logAction(
      "imported",
      `${name} imported with a warning: ${warning}`,
    ).catch(() => {});
  } else {
    showToast(`${name} added to the library.`);
    await logAction("imported", `${name} added to the library.`).catch(
      () => {},
    );
  }
}

/* --------------------- document preview & create --------------------- */
const previewTarget = ref<LibraryFile | null>(null);
const showCreateDoc = ref(false);
function openPreview(file: LibraryFile) {
  previewTarget.value = file;
}
const mediaPreviewTarget = ref<LibraryFile | null>(null);
const playlistTarget = ref<LibraryFile | null>(null);
function openMediaPreview(file: LibraryFile) {
  mediaPreviewTarget.value = file;
}
function playAudio(file: LibraryFile) {
  const queue = files.value.filter((f) => isAudioFile(f.name));
  emit("playAudio", file, queue);
}
const favoritePaths = ref<Set<string>>(new Set());
async function refreshFavorites() {
  favoritePaths.value = new Set(await loadFavorites());
}
async function toggleFileFavorite(file: LibraryFile) {
  const nowFavorite = await toggleFavorite(file.path);
  await refreshFavorites();
  showToast(
    nowFavorite
      ? `Added ${file.name} to favorites.`
      : `Removed ${file.name} from favorites.`,
  );
}
async function onDocumentCreated(path: string) {
  showCreateDoc.value = false;
  showToast(`Created ${baseName(path)}.`);
  await refresh();
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
  return meta.value[file.path] ?? { status: "", notes: "", starred: false };
}

async function toggleStar(file: LibraryFile) {
  try {
    await saveMeta(file, { ...metaOf(file), starred: !metaOf(file).starred });
  } catch (e) {
    error.value = String(e);
  }
}

// Starred files float to the top of their folder, keeping their relative
// order otherwise (Array.sort is stable).
function starredFirst(a: LibraryFile, b: LibraryFile): number {
  return (metaOf(a).starred ? 0 : 1) - (metaOf(b).starred ? 0 : 1);
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
      await logAction("deleted", `Deleted file ${req.file.name}.`).catch(
        () => {},
      );
    } else {
      await deleteLibraryFolder(props.filesDir, req.folder);
      for (const path of req.paths) await deleteFileMeta(path).catch(() => {});
      notice.value = `Deleted folder ${req.folder} (${req.count} files).`;
      await logAction(
        "deleted",
        `Deleted folder ${req.folder} (${req.count} files).`,
      ).catch(() => {});
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
  for (const [, items] of entries) items.sort(starredFirst);
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
    ? files.value
        .filter((f) => f.folder === currentFolder.value)
        .sort(starredFirst)
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
  files,
  () => {
    const total = files.value.reduce((sum, f) => sum + f.size, 0);
    emit(
      "stats",
      `${files.value.length} file${files.value.length === 1 ? "" : "s"} \u00b7 ${formatSize(total)}`,
    );
  },
  { immediate: true },
);
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
    await refreshFavorites();
    // A refresh (e.g. switching back to this tab) must not wipe a
    // selection in progress — just drop items that no longer exist.
    if (selected.value.size || selectedFolders.value.size) {
      const paths = new Set(files.value.map((f) => f.path));
      selected.value = new Set(
        [...selected.value].filter((p) => paths.has(p)),
      );
      // A folder still exists if any file lives in it or below it.
      const folderSet = new Set<string>();
      for (const f of files.value) {
        const parts = f.folder.split(SEP.value);
        for (let i = 1; i <= parts.length; i++)
          folderSet.add(parts.slice(0, i).join(SEP.value));
      }
      selectedFolders.value = new Set(
        [...selectedFolders.value].filter((p) => folderSet.has(p)),
      );
    }
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
  const movedNames: string[] = [];
  // Destination folders, in first-seen order. The move command already
  // returns the full destination path — previously it was discarded,
  // so the toast only said "into the library" and a file that was
  // categorized into Documents looked like it had vanished from the
  // library root. Name the folder(s) so the user knows where to look.
  const destFolders: string[] = [];
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
      const dest = await moveFileToLibrary(source, props.filesDir);
      moved++;
      movedNames.push(baseName(source));
      const relative = dest.startsWith(props.filesDir)
        ? dest.slice(props.filesDir.length).replace(/^[/\\]/, "")
        : dest;
      const folder = relative.split(/[\\/]/).slice(0, -1).join("/") || "Library root";
      if (!destFolders.includes(folder)) destFolders.push(folder);
      await logAction(
        "added",
        `${baseName(source)} added to the library (${folder}).`,
      ).catch(() => {});
    } catch (e) {
      busyItems.value.push({
        source,
        name: baseName(source),
        reason: String(e),
      });
    }
  }
  if (moved) {
    const where = destFolders.join(", ");
    showToast(
      moved === 1
        ? `Moved ${movedNames[0]} to ${where}.`
        : `Moved ${moved} files to ${where}.`,
    );
  }
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

/* ------------------------- batch selection ------------------------- */
// Checkboxes only exist in selection mode, switched on by the small
// Select button at the right end of the breadcrumbs row, inline with the
// current-directory buttons (Done switches it off again and clears the
// selection).
const selected = ref(new Set<string>());
const selectedFolders = ref(new Set<string>());
const selecting = ref(false);
const selectionMode = computed(() => selecting.value);
function toggleSelecting() {
  if (selecting.value) {
    selecting.value = false;
    clearSelection();
  } else {
    selecting.value = true;
  }
}
const totalSelected = computed(
  () => selected.value.size + selectedFolders.value.size,
);
function isSelected(path: string): boolean {
  return selected.value.has(path);
}
function isFolderSelected(path: string): boolean {
  return selectedFolders.value.has(path);
}
function toggleSelect(path: string) {
  const next = new Set(selected.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selected.value = next;
}
function toggleFolderSelect(path: string) {
  const next = new Set(selectedFolders.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  selectedFolders.value = next;
}
function clearSelection() {
  selected.value = new Set();
  selectedFolders.value = new Set();
}
const visibleFiles = computed(() =>
  displayGroups.value.flatMap(([, items]) => items),
);
const visibleFolders = computed(() =>
  drillIn.value ? childFolders.value : [],
);
const allVisibleSelected = computed(
  () =>
    visibleFiles.value.length > 0 &&
    visibleFiles.value.every((f) => selected.value.has(f.path)),
);
function toggleSelectAll() {
  const next = new Set(selected.value);
  const nextFolders = new Set(selectedFolders.value);
  const allFolders =
    visibleFolders.value.length === 0 ||
    visibleFolders.value.every((f) => nextFolders.has(f.path));
  if (allVisibleSelected.value && allFolders) {
    for (const f of visibleFiles.value) next.delete(f.path);
    for (const f of visibleFolders.value) nextFolders.delete(f.path);
  } else {
    for (const f of visibleFiles.value) next.add(f.path);
    for (const f of visibleFolders.value) nextFolders.add(f.path);
  }
  selected.value = next;
  selectedFolders.value = nextFolders;
}
function selectedFiles(): LibraryFile[] {
  return files.value.filter((f) => selected.value.has(f.path));
}
function selectedFolderPaths(): { path: string; name: string }[] {
  return [...selectedFolders.value].map((path) => ({
    path,
    name: baseName(path),
  }));
}

/* ------------------------- batch actions ------------------------- */
const confirmBatchDelete = ref(false);
const showBatchMove = ref(false);
const batchMoveDest = ref("");
const batchMoveFolders = computed(() => {
  const names = new Set<string>();
  for (const f of files.value) if (f.folder) names.add(f.folder);
  return [...names].sort((a, b) => a.localeCompare(b));
});
async function batchDelete() {
  const targets = selectedFiles();
  const folderTargets = selectedFolderPaths();
  confirmBatchDelete.value = false;
  if (!props.filesDir || (!targets.length && !folderTargets.length)) return;
  let deleted = 0;
  for (const file of targets) {
    try {
      await deleteLibraryFile(props.filesDir, file.path);
      await deleteFileMeta(file.path).catch(() => {});
      deleted++;
    } catch (e) {
      error.value = String(e);
    }
  }
  for (const folder of folderTargets) {
    try {
      await deleteLibraryFolder(props.filesDir, folder.path);
      for (const path of filesUnder(folder.path).map((f) => f.path))
        await deleteFileMeta(path).catch(() => {});
      deleted++;
    } catch (e) {
      error.value = String(e);
    }
  }
  clearSelection();
  if (deleted) {
    showToast(`Deleted ${deleted} item${deleted === 1 ? "" : "s"}.`);
    await logAction(
      "deleted",
      `Deleted ${deleted} item${deleted === 1 ? "" : "s"}.`,
    ).catch(() => {});
  }
  await refresh();
}
async function batchStar() {
  const targets = selectedFiles();
  if (!targets.length) return;
  const allStarred = targets.every((f) => metaOf(f).starred);
  for (const file of targets) {
    try {
      await saveMeta(file, { ...metaOf(file), starred: !allStarred });
    } catch (e) {
      error.value = String(e);
    }
  }
  showToast(
    allStarred
      ? `Removed star from ${targets.length} files.`
      : `Starred ${targets.length} files.`,
  );
  clearSelection();
}
async function batchDuplicate() {
  const targets = selectedFiles();
  const folderTargets = selectedFolderPaths();
  if (!props.filesDir || (!targets.length && !folderTargets.length)) return;
  let done = 0;
  for (const file of targets) {
    try {
      const newPath = await duplicateLibraryItem(props.filesDir, file.path);
      await copyMeta(file.path, newPath);
      done++;
    } catch (e) {
      error.value = String(e);
    }
  }
  for (const folder of folderTargets) {
    try {
      const base = props.filesDir.replace(/[\\/]+$/, "");
      const sep = folder.path.includes("\\") ? "\\" : "/";
      const oldFull = base + sep + folder.path;
      const newPath = await duplicateLibraryItem(props.filesDir, oldFull);
      await copyMetaSubtree(oldFull, newPath);
      done++;
    } catch (e) {
      error.value = String(e);
    }
  }
  clearSelection();
  if (done) {
    showToast(`Duplicated ${done} item${done === 1 ? "" : "s"}.`);
    await logAction(
      "duplicated",
      `Duplicated ${done} item${done === 1 ? "" : "s"}.`,
    ).catch(() => {});
  }
  await refresh();
}
async function batchMove() {
  const targets = selectedFiles();
  const folderTargets = selectedFolderPaths();
  const dest = batchMoveDest.value;
  showBatchMove.value = false;
  if (!props.filesDir || (!targets.length && !folderTargets.length)) return;
  let moved = 0;
  let skipped = 0;
  for (const file of targets) {
    if (file.folder === dest) continue;
    const check = await checkFileFree(file.path);
    if (!check.free) {
      skipped++;
      continue;
    }
    try {
      const newPath = await moveLibraryItem(props.filesDir, file.path, dest);
      await carryMeta(file.path, newPath);
      moved++;
    } catch (e) {
      error.value = String(e);
    }
  }
  for (const folder of folderTargets) {
    const base = props.filesDir.replace(/[\\/]+$/, "");
    const sep = folder.path.includes("\\") ? "\\" : "/";
    const fullPath = base + sep + folder.path;
    const pseudo: DragSource = {
      kind: "folder",
      fullPath,
      fromFolder: parentFolderOf(folder.path),
      key: folder.path,
      name: folder.name,
    };
    if (!isValidDropTarget(dest, pseudo)) continue;
    try {
      const newPath = await moveLibraryItem(props.filesDir, fullPath, dest);
      await remapMetaSubtree(fullPath, newPath);
      moved++;
    } catch (e) {
      error.value = String(e);
    }
  }
  clearSelection();
  if (moved) {
    const destLabel = dest || "the library root";
    showToast(`Moved ${moved} item${moved === 1 ? "" : "s"} to ${destLabel}.`);
    await logAction(
      "moved",
      `Moved ${moved} item${moved === 1 ? "" : "s"} to ${destLabel}.`,
    ).catch(() => {});
  }
  if (skipped)
    showToast(`${skipped} file${skipped === 1 ? "" : "s"} skipped — in use.`, "error");
  await refresh();
}

/* Carry/copy per-file meta (status/notes/star) to a new path. */
async function carryMeta(oldPath: string, newPath: string) {
  const m = meta.value[oldPath];
  if (!m) return;
  await setFileMeta(newPath, m).catch(() => {});
  await deleteFileMeta(oldPath).catch(() => {});
  const next = { ...meta.value };
  delete next[oldPath];
  next[newPath] = m;
  meta.value = next;
}
async function copyMeta(oldPath: string, newPath: string) {
  const m = meta.value[oldPath];
  if (!m) return;
  await setFileMeta(newPath, { ...m }).catch(() => {});
  meta.value = { ...meta.value, [newPath]: { ...m } };
}
// Subtree variants for folder moves/duplicates: every meta entry under the
// folder follows (move) or is copied to (duplicate) the new path.
async function remapMetaSubtree(oldFull: string, newPath: string) {
  const sep = newPath.includes("\\") ? "\\" : "/";
  const moves: { oldKey: string; newKey: string; value: FileMeta }[] = [];
  for (const [key, value] of Object.entries(meta.value)) {
    if (key === oldFull || key.startsWith(oldFull + sep)) {
      moves.push({
        oldKey: key,
        newKey: newPath + key.slice(oldFull.length),
        value,
      });
    }
  }
  for (const m of moves) {
    await setFileMeta(m.newKey, m.value).catch(() => {});
    await deleteFileMeta(m.oldKey).catch(() => {});
  }
  if (moves.length) {
    const next = { ...meta.value };
    for (const m of moves) {
      delete next[m.oldKey];
      next[m.newKey] = m.value;
    }
    meta.value = next;
  }
}
async function copyMetaSubtree(oldFull: string, newPath: string) {
  const sep = newPath.includes("\\") ? "\\" : "/";
  const next = { ...meta.value };
  for (const [key, value] of Object.entries(meta.value)) {
    if (key === oldFull || key.startsWith(oldFull + sep)) {
      const nk = newPath + key.slice(oldFull.length);
      await setFileMeta(nk, { ...value }).catch(() => {});
      next[nk] = { ...value };
    }
  }
  meta.value = next;
}

async function duplicateFile(file: LibraryFile) {
  if (!props.filesDir) return;
  try {
    const newPath = await duplicateLibraryItem(props.filesDir, file.path);
    await copyMeta(file.path, newPath);
    showToast(`Duplicated ${file.name} as ${baseName(newPath)}.`);
    await logAction(
      "duplicated",
      `Duplicated ${file.name} as ${baseName(newPath)}.`,
    ).catch(() => {});
    await refresh();
  } catch (e) {
    showToast(String(e), "error");
  }
}
async function duplicateFolder(folder: { path: string; name: string }) {
  if (!props.filesDir) return;
  try {
    const base = props.filesDir.replace(/[\\/]+$/, "");
    const sep = folder.path.includes("\\") ? "\\" : "/";
    const oldFull = base + sep + folder.path;
    const newPath = await duplicateLibraryItem(props.filesDir, oldFull);
    await copyMetaSubtree(oldFull, newPath);
    showToast(`Duplicated folder ${folder.name} as ${baseName(newPath)}.`);
    await logAction(
      "duplicated",
      `Duplicated folder ${folder.name} as ${baseName(newPath)}.`,
    ).catch(() => {});
    await refresh();
  } catch (e) {
    showToast(String(e), "error");
  }
}

/* ------------------------- context menu ------------------------- */
const ctx = ref<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
// One menu definition shared by the right-click menu and the ⋮ button,
// so the two never drift apart.
function fileMenuItems(file: LibraryFile): ContextMenuItem[] {
  return [
    ...(isAudioFile(file.name)
      ? [
          {
            label: "Play",
            icon: Play,
            action: () => playAudio(file),
          } as ContextMenuItem,
          {
            label: favoritePaths.value.has(file.path)
              ? "Remove from favorites"
              : "Add to favorites",
            icon: Heart,
            action: () => toggleFileFavorite(file),
          } as ContextMenuItem,
          {
            label: "Add to playlist…",
            icon: ListMusic,
            action: () => (playlistTarget.value = file),
          } as ContextMenuItem,
        ]
      : []),
    ...(isPreviewable(file.name)
      ? [
          {
            label: "Preview",
            icon: Eye,
            action: () => openPreview(file),
          } as ContextMenuItem,
        ]
      : isMediaPreviewable(file.name)
        ? [
            {
              label: "Preview",
              icon: Eye,
              action: () => openMediaPreview(file),
            } as ContextMenuItem,
          ]
        : []),
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
      label: metaOf(file).starred ? "Remove star" : "Star",
      icon: Star,
      action: () => toggleStar(file),
    },
    { label: "Duplicate", icon: Copy, action: () => duplicateFile(file) },
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      action: () => (confirmDelete.value = { kind: "file", file }),
    },
  ];
}
function folderMenuItems(folder: {
  path: string;
  name: string;
}): ContextMenuItem[] {
  return [
    {
      label: "Open folder",
      icon: FolderOpen,
      action: () => goFolder(folder.path),
    },
    {
      label: "Duplicate folder",
      icon: Copy,
      action: () => duplicateFolder(folder),
    },
    {
      label: "Delete folder",
      icon: Trash2,
      danger: true,
      action: () => askDeleteFolderPath(folder.path),
    },
  ];
}
function openFileCtx(event: MouseEvent, file: LibraryFile) {
  ctx.value = {
    x: event.clientX,
    y: event.clientY,
    items: fileMenuItems(file),
  };
}
function openFileMenu(event: MouseEvent, file: LibraryFile) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  ctx.value = { x: rect.right - 224, y: rect.bottom + 4, items: fileMenuItems(file) };
}
function openFolderMenu(event: MouseEvent, folder: { path: string; name: string }) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  ctx.value = { x: rect.right - 224, y: rect.bottom + 4, items: folderMenuItems(folder) };
}
function openContainerCtx(event: MouseEvent) {
  // Leave the normal text menu alone inside form fields.
  if ((event.target as HTMLElement).closest("input, textarea, select")) return;
  event.preventDefault();
  const items: ContextMenuItem[] = [
    { label: "Add files", icon: FilePlus2, action: () => pickFiles() },
    {
      label: "New document",
      icon: FileText,
      action: () => (showCreateDoc.value = true),
    },
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
defineExpose({ openContainerCtx });
function openFolderCtx(event: MouseEvent, folder: { path: string; name: string }) {
  ctx.value = {
    x: event.clientX,
    y: event.clientY,
    items: folderMenuItems(folder),
  };
}

/* ---- drag & drop: move files/folders between library folders ----
 * HTML5 drag & drop never engages in this WebView (same story as the
 * project cards), so this is pointer-based like the card reorder: press,
 * move past 5px, drop onto a folder tile/row, a breadcrumb, or a search
 * group header. Dropping anywhere else is a no-op. */
interface DragSource {
  kind: "file" | "folder";
  /** absolute disk path of the item being dragged */
  fullPath: string;
  /** library-relative folder the item currently lives in ("" = root) */
  fromFolder: string;
  /** template-side key: file.path for files, folder.path for folders */
  key: string;
  name: string;
}
const dragSource = ref<DragSource | null>(null);
const dragTarget = ref<string | null>(null);
const dragMoved = ref(false);
let dragStart: { x: number; y: number } | null = null;
// Set once a real drag starts, so the click that follows pointerup doesn't
// navigate into a folder tile that was only a drag source. Cleared by the
// next pointerdown (every click starts with one) — never by a timer.
let suppressClick = false;


function parentFolderOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf("\\"), relPath.lastIndexOf("/"));
  return i > 0 ? relPath.slice(0, i) : "";
}
function dragSourceForFile(file: LibraryFile): DragSource {
  return {
    kind: "file",
    fullPath: file.path,
    fromFolder: file.folder,
    key: file.path,
    name: file.name,
  };
}
function dragSourceForFolder(folder: { path: string; name: string }): DragSource {
  const base = (props.filesDir ?? "").replace(/[\\/]+$/, "");
  const sep = folder.path.includes("\\") ? "\\" : "/";
  return {
    kind: "folder",
    fullPath: base + sep + folder.path,
    fromFolder: parentFolderOf(folder.path),
    key: folder.path,
    name: folder.name,
  };
}
function isDragged(key: string): boolean {
  return dragMoved.value && dragSource.value?.key === key;
}
function isDropTarget(path: string): boolean {
  return dragTarget.value === path;
}
function isValidDropTarget(target: string, source: DragSource): boolean {
  if (target === source.fromFolder) return false;
  if (source.kind === "folder") {
    // The folder's own relative path, rebuilt from its parent + name.
    const sep = source.fullPath.includes("\\") ? "\\" : "/";
    const own = source.fromFolder
      ? source.fromFolder + sep + source.name
      : source.name;
    if (target === own || target.startsWith(own + sep)) return false;
  }
  return true;
}
function onDragPointerDown(event: PointerEvent, source: DragSource) {
  if (event.button !== 0) return;
  suppressClick = false;
  dragStart = { x: event.clientX, y: event.clientY };
  dragSource.value = source;
  dragMoved.value = false;
}
function onDragPointerMove(event: PointerEvent) {
  const source = dragSource.value;
  if (!source || !dragStart) return;
  if (!dragMoved.value) {
    if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 5)
      return;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* capture unavailable on this element; tracking still works over rows */
    }
    dragMoved.value = true;
    suppressClick = true;
    // Same as the project cards: no text selection while dragging.
    document.body.classList.add("select-none");
    window.getSelection()?.removeAllRanges();
  }
  const el = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest("[data-drop-folder]");
  const target = el ? el.getAttribute("data-drop-folder") : null;
  dragTarget.value =
    target !== null && isValidDropTarget(target, source) ? target : null;
}
async function onDragPointerUp() {
  const source = dragSource.value;
  const target = dragTarget.value;
  const wasDragging = dragMoved.value;
  dragSource.value = null;
  dragTarget.value = null;
  dragStart = null;
  dragMoved.value = false;
  document.body.classList.remove("select-none");
  if (!source || !wasDragging || target === null || !props.filesDir) return;
  try {
    if (source.kind === "file") {
      const check = await checkFileFree(source.fullPath);
      if (!check.free) {
        showToast(
          `${source.name} is in use (${check.reason ?? "file is in use"}).`,
          "error",
        );
        return;
      }
    }
    const newPath = await moveLibraryItem(props.filesDir, source.fullPath, target);
    // Meta is keyed by absolute path, so carry it along to the new path
    // (for a folder, every file under it).
    await remapMetaSubtree(source.fullPath, newPath);
    const destLabel = target || "the library root";
    showToast(`Moved ${source.name} to ${destLabel}.`);
    await logAction("moved", `${source.name} → ${destLabel}.`).catch(
      () => {},
    );
    await refresh();
  } catch (e) {
    showToast(String(e), "error");
  }
}
function onFolderTileClick(path: string) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (selectionMode.value) {
    toggleFolderSelect(path);
    return;
  }
  goFolder(path);
}
function onFileRowClick(file: LibraryFile) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (selectionMode.value) toggleSelect(file.path);
}
function onFileTileClick(file: LibraryFile) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (selectionMode.value) toggleSelect(file.path);
}
function onFileTileDblClick(file: LibraryFile) {
  if (selectionMode.value) return;
  void openPath(file.path);
}

/* External drag & drop: dropping files anywhere on this view adds them. */
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
onUnmounted(() => {
  unlisten?.();
  document.body.classList.remove("select-none");
});
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

  <div v-else @contextmenu.stop="openContainerCtx">
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

      <button class="toolbar-btn" @click="pickFiles">
        <FilePlus2 class="h-4 w-4" /> Add files
      </button>
      <button class="toolbar-btn" @click="showCreateDoc = true">
        <FileText class="h-4 w-4" /> New document
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

      <div class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
        <button
          class="toggle-btn tooltip tooltip-bottom"
          :class="layout === 'table' ? 'switch-active tab-active' : ''"
          data-tip="Show files as a list"
          @click="setLayout('table')"
        >
          <List class="h-4 w-4" /> List
        </button>
        <button
          class="toggle-btn tooltip tooltip-bottom"
          :class="layout === 'grid' ? 'switch-active tab-active' : ''"
          data-tip="Show files as big icons, like Windows Explorer"
          @click="setLayout('grid')"
        >
          <LayoutGrid class="h-4 w-4" /> Icons
        </button>
      </div>
    </div>

    <div v-if="totalSelected" class="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-4 py-2.5 text-sm text-blue-900 ring-1 ring-blue-200 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-900">
      <span class="font-medium">{{ totalSelected }} selected</span>
      <span class="flex flex-wrap gap-1.5">
        <button class="toolbar-btn" @click="showBatchMove = true">Move to folder</button>
        <button class="toolbar-btn" @click="batchDuplicate">Duplicate</button>
        <button v-if="selected.size" class="toolbar-btn" @click="batchStar">{{ selectedFiles().every((f) => metaOf(f).starred) ? "Unstar" : "Star" }}</button>
        <button class="rounded-lg bg-red-100/80 px-3 py-2 font-medium text-red-700 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900" @click="confirmBatchDelete = true">Delete</button>
      </span>
      <span class="ml-auto flex gap-3">
        <button class="font-medium hover:underline" @click="toggleSelectAll">Select all</button>
        <button class="font-medium hover:underline" @click="clearSelection">Clear</button>
      </span>
    </div>

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
          <button class="crumb" :class="[!currentFolder ? 'crumb-active' : '', isDropTarget('') ? 'ring-2 ring-blue-500' : '']" data-drop-folder="" @click="goFolder('')">
            <Library class="h-4 w-4" /> Library
          </button>
          <template v-for="(seg, i) in crumbs" :key="i">
            <ChevronRight class="h-4 w-4 shrink-0 text-neutral-400" />
            <button class="crumb" :class="[i === crumbs.length - 1 ? 'crumb-active' : '', isDropTarget(crumbPath(i)) ? 'ring-2 ring-blue-500' : '']" :data-drop-folder="crumbPath(i)" @click="goFolder(crumbPath(i))">
              {{ seg }}
            </button>
          </template>
          <span class="ml-auto flex items-center gap-1">
            <button v-if="currentFolder" class="file-action tooltip tooltip-bottom" data-tip="Go up one level" @click="goUp">
              <ArrowUp class="h-4 w-4" />
            </button>
            <button
              v-if="currentFolder"
              class="rounded p-2 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
              title="Actions"
              @click="openFolderMenu($event, { path: currentFolder, name: baseName(currentFolder) })"
            >
              <Settings2 class="h-4 w-4" />
            </button>
            <button
              class="tooltip tooltip-bottom flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
              :class="selecting ? 'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300' : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100'"
              :data-tip="selecting ? 'Exit selection mode' : 'Show checkboxes to select files and folders'"
              @click="toggleSelecting"
            >
              <Check class="h-3.5 w-3.5" /> {{ selecting ? "Done" : "Select" }}
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
            :class="[isDropTarget(folder.path) ? 'ring-2 ring-blue-500 bg-blue-100/60 dark:bg-blue-900/40' : '', isDragged(folder.path) ? 'z-10 cursor-grabbing opacity-70 shadow-xl ring-2 ring-blue-500 scale-[1.02]' : '']"
            :title="`Open folder ${folder.name}`"
            :data-drop-folder="folder.path"
            @click="onFolderTileClick(folder.path)"
            @pointerdown="onDragPointerDown($event, dragSourceForFolder(folder))"
            @pointermove="onDragPointerMove"
            @pointerup="onDragPointerUp"
            @pointercancel="onDragPointerUp"
            @contextmenu.prevent.stop="openFolderCtx($event, folder)"
          >
            <span v-if="selectionMode" class="absolute left-1 top-1 z-10">
              <input type="checkbox" class="h-4 w-4 accent-blue-600" :checked="isFolderSelected(folder.path)" @change="toggleFolderSelect(folder.path)" @click.stop />
            </span>
            <span class="absolute right-1 top-1 z-10 opacity-0 transition group-hover:opacity-100">
              <button
                class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
                title="Actions"
                @click.stop="openFolderMenu($event, folder)"
              >
                <Settings2 class="h-3.5 w-3.5" />
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
            :class="[isDropTarget(folder.path) ? 'ring-2 ring-blue-500 bg-blue-100/60 dark:bg-blue-900/40' : '', isDragged(folder.path) ? 'opacity-50' : '']"
            :data-drop-folder="folder.path"
            @click="onFolderTileClick(folder.path)"
            @pointerdown="onDragPointerDown($event, dragSourceForFolder(folder))"
            @pointermove="onDragPointerMove"
            @pointerup="onDragPointerUp"
            @pointercancel="onDragPointerUp"
            @contextmenu.prevent.stop="openFolderCtx($event, folder)"
          >
            <input v-if="selectionMode" type="checkbox" class="h-4 w-4 shrink-0 accent-blue-600" :checked="isFolderSelected(folder.path)" @change="toggleFolderSelect(folder.path)" @click.stop />
            <Folder class="h-5 w-5 shrink-0 text-amber-500" />
            <span class="min-w-0 flex-1 truncate font-medium">{{ folder.name }}</span>
            <span class="shrink-0 text-xs text-neutral-500">{{ folder.count }} item{{ folder.count === 1 ? "" : "s" }}</span>
            <button
              class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 shrink-0"
              title="Actions"
              @click.stop="openFolderMenu($event, folder)"
            >
              <Settings2 class="h-3.5 w-3.5" />
            </button>
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
        <div v-if="!drillIn" class="mb-2 flex items-center justify-between gap-2 rounded-lg" :class="isDropTarget(items[0]?.folder ?? '') ? 'ring-2 ring-blue-500' : ''" :data-drop-folder="items[0]?.folder ?? ''">
          <h3 class="on-bg text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {{ group }} <span class="font-normal normal-case">({{ items.length }})</span>
          </h3>
          <button
            v-if="items[0]?.folder"
            class="rounded p-2 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800"
            title="Actions"
            @click="openFolderMenu($event, { path: items[0].folder, name: baseName(items[0].folder) })"
          >
            <Settings2 class="h-4 w-4" />
          </button>
        </div>
        <div
          v-if="layout === 'table'"
          class="card-glass overflow-x-auto rounded-xl bg-white ring-1 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-800"
        >
          <table class="w-full table-fixed text-sm">
            <colgroup>
              <col v-if="selectionMode" style="width: 36px" />
              <col :style="{ width: selectionMode ? '42%' : '46%' }" />
              <col style="width: 16%" />
              <col style="width: 9%" />
              <col style="width: 13%" />
              <col style="width: 16%" />
            </colgroup>
            <thead>
              <tr class="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                <th v-if="selectionMode" class="px-2 py-2"><input type="checkbox" class="h-4 w-4 accent-blue-600" :checked="allVisibleSelected" @change="toggleSelectAll" /></th>
                <th class="px-4 py-2 font-medium">Name</th>
                <th class="px-4 py-2 font-medium">Category</th>
                <th class="px-4 py-2 font-medium">Size</th>
                <th class="px-4 py-2 font-medium">Status</th>
                <th class="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
              <tr v-for="file in items" :key="file.path" class="hover:bg-neutral-50 dark:hover:bg-neutral-800/50" :class="[isDragged(file.path) ? 'opacity-50' : '']" @pointerdown="onDragPointerDown($event, dragSourceForFile(file))" @pointermove="onDragPointerMove" @pointerup="onDragPointerUp" @pointercancel="onDragPointerUp" @click="onFileRowClick(file)" @contextmenu.prevent.stop="openFileCtx($event, file)">
                <td v-if="selectionMode" class="px-2 py-2.5"><input type="checkbox" class="h-4 w-4 accent-blue-600" :checked="isSelected(file.path)" @change="toggleSelect(file.path)" @click.stop /></td>
                <td class="max-w-0 px-4 py-2.5">
                  <span class="flex min-w-0 items-center gap-2.5">
                    <button class="shrink-0 rounded p-0.5" :title="metaOf(file).starred ? 'Remove star' : 'Star'" @click.stop="toggleStar(file)">
                      <Star class="h-4 w-4" :class="metaOf(file).starred ? 'fill-amber-500 text-amber-500' : 'text-neutral-300 hover:text-amber-400'" />
                    </button>
                    <component :is="iconFor(file.category)" class="h-5 w-5 shrink-0" :class="fileTypeIconClasses(file.name)" />
                    <span class="truncate font-medium">{{ file.name }}</span>
                    <span :class="[FILE_TYPE_BADGE_BASE, fileTypeBadgeClasses(file.name)]" :title="fileTypeTitle(file.name)">{{ fileTypeLabel(file.name) }}</span>
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
                    <button class="rounded p-2 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800" title="Actions" @click.stop="openFileMenu($event, file)">
                      <Settings2 class="h-4 w-4" />
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
            :class="[isDragged(file.path) ? 'z-10 cursor-grabbing opacity-70 shadow-xl ring-2 ring-blue-500 scale-[1.02]' : '']"
            title="Double-click to open"
            @click="onFileTileClick(file)"
            @dblclick="onFileTileDblClick(file)"
            @pointerdown="onDragPointerDown($event, dragSourceForFile(file))"
            @pointermove="onDragPointerMove"
            @pointerup="onDragPointerUp"
            @pointercancel="onDragPointerUp"
            @contextmenu.prevent.stop="openFileCtx($event, file)"
          >
            <span
              class="absolute left-1 top-1 z-10"
              :class="metaOf(file).starred ? '' : 'opacity-0 transition group-hover:opacity-100'"
              @dblclick.stop
            >
              <button class="file-action-sm" :title="metaOf(file).starred ? 'Remove star' : 'Star'" @click.stop="toggleStar(file)">
                <Star class="h-3.5 w-3.5" :class="metaOf(file).starred ? 'fill-amber-500 text-amber-500' : ''" />
              </button>
            </span>
            <span
              v-if="selectionMode"
              class="absolute left-1 top-9 z-10"
              @dblclick.stop
            >
              <input type="checkbox" class="h-4 w-4 accent-blue-600" :checked="isSelected(file.path)" @change="toggleSelect(file.path)" @click.stop />
            </span>
            <span
              class="absolute right-1 top-1 z-10 opacity-0 transition group-hover:opacity-100"
              @dblclick.stop
            >
              <button class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800" title="Actions" @click.stop="openFileMenu($event, file)">
                <Settings2 class="h-3.5 w-3.5" />
              </button>
            </span>
            <span class="relative flex h-20 items-center justify-center">
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
              <component v-else :is="iconFor(file.category)" class="h-16 w-16" :class="fileTypeIconClasses(file.name)" />
              <span :class="[FILE_TYPE_BADGE_BASE, fileTypeBadgeClasses(file.name), 'absolute bottom-0 right-1 shadow']" :title="fileTypeTitle(file.name)">{{ fileTypeLabel(file.name) }}</span>
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
   
  >
    <div ref="statusPanel" class="glass-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="statusHandle" class="mb-1 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
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
   
  >
    <div ref="notesPanel" class="glass-panel w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="notesHandle" class="mb-1 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
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

  <div
    v-if="showBatchMove"
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
   
  >
    <div ref="batchPanel" class="glass-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="batchHandle" class="mb-1 cursor-grab text-lg font-semibold active:cursor-grabbing">Move {{ totalSelected }} items</h2>
      <p class="mb-4 text-sm text-neutral-500">Choose the folder to move them into.</p>
      <label class="mb-1 block text-sm font-medium">Destination folder</label>
      <select
        v-model="batchMoveDest"
        class="mb-5 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
      >
        <option value="">Library root</option>
        <option v-for="folder in batchMoveFolders" :key="folder" :value="folder">{{ folder }}</option>
      </select>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="showBatchMove = false">Cancel</button>
        <button class="btn btn-primary btn-sm" @click="batchMove">Move</button>
      </div>
    </div>
  </div>

  <ConfirmDialog
    v-if="confirmBatchDelete"
    title="Delete selected files?"
    :message="`${totalSelected} item${totalSelected === 1 ? '' : 's'} will be permanently deleted. Folders are deleted with everything inside them. This cannot be undone.`"
    confirm-label="Delete"
    @confirm="batchDelete"
    @cancel="confirmBatchDelete = false"
  />

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

  <PlaylistPickerDialog
    v-if="playlistTarget"
    :file="playlistTarget"
    @close="playlistTarget = null"
  />

  <DocumentCreateDialog
    v-if="showCreateDoc && filesDir"
    :library-dir="filesDir"
    :folder="currentFolder"
    @close="showCreateDoc = false"
    @created="onDocumentCreated"
  />
</template>

<style scoped>
.toggle-btn {
  @apply flex items-center gap-1.5 px-3 py-2 text-sm font-medium;
}
.file-action {
  @apply flex items-center rounded-lg bg-neutral-200/80 p-2 text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700;
}
.file-action-sm {
  @apply flex items-center rounded-md bg-neutral-100/90 p-1.5 text-neutral-900 shadow ring-1 ring-neutral-300 hover:bg-neutral-200 dark:bg-neutral-900/90 dark:text-neutral-100 dark:ring-neutral-700 dark:hover:bg-neutral-700;
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
  @apply flex items-center gap-1.5 rounded-lg bg-neutral-200/80 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700;
}
</style>
