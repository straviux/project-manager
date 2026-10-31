<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue";
import {
  ArrowDownToLine,
  BookOpen,
  Code,
  Copy,
  Download,
  Files,
  FolderCog,
  FolderInput,
  FolderOpen,
  Grip,
  History,
  LayoutGrid,
  Music,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquareTerminal,
  Star,
  Trash2,
} from "@lucide/vue";
import { chromeDark } from "./lib/theme";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import SetupWizard from "./components/SetupWizard.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectDialog from "./components/ProjectDialog.vue";
import CloneDialog from "./components/CloneDialog.vue";
import ImportDialog from "./components/ImportDialog.vue";
import SshDialog from "./components/SshDialog.vue";
import ReadmeDialog from "./components/ReadmeDialog.vue";
import RunCommandDialog from "./components/RunCommandDialog.vue";
import TerminalPanel, { type TerminalTab } from "./components/TerminalPanel.vue";
import { listen } from "@tauri-apps/api/event";
import SettingsDialog from "./components/SettingsDialog.vue";
import FilesView from "./components/FilesView.vue";
import MusicPlayerWidget from "./components/MusicPlayerWidget.vue";
import PlaylistManagerDialog from "./components/PlaylistManagerDialog.vue";
import Toasts from "./components/Toasts.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import {
  clearActionHistory,
  getActionHistory,
  type ActionHistoryEntry,
} from "./lib/db";
import { showToast } from "./lib/toast";
import { useDialogDrag } from "./lib/useDialogDrag";
import { useEscapeClose } from "./lib/useEscapeClose";
import ContextMenu, {
  type ContextMenuItem,
} from "./components/ContextMenu.vue";
import {
  createProject,
  deleteProject,
  FILES_DIR_KEY,
  getSetting,
  setSetting,
  listProjects,
  PROJECTS_DIR_KEY,
  setProjectOrder,
  setProjectPinned,
} from "./lib/db";
import {
  deleteProjectIcon,
  gitPull,
  importProjectFolder,
  openInVsCode,
  openPath,
  gitFetch,
  openTerminal,
  readReadme,
  startRun,
  stopRun,
  terminalInput,
  scanProjects,
} from "./lib/api";
import { findRunCommand } from "./lib/findRunCommand";
import type { Project } from "./types";

const ready = ref(false);
const statusKey = ref(0);
// Pointer-drag session: which card is being dragged and where it would
// land (target card + before/after its middle). Owned here so every card
// can render the insertion indicator.
const pointerDrag = ref<{
  id: number;
  targetId: number | null;
  after: boolean;
} | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const tab = ref<"projects" | "files">("projects");
// Tab persistency: the last active tab is saved in settings on every
// switch and restored at boot, so the app reopens where you left it
// instead of always landing on Projects.
const ACTIVE_TAB_KEY = "active_tab";
watch(tab, (value) => void setSetting(ACTIVE_TAB_KEY, value));
const projectsDir = ref<string | null>(null);
const filesDir = ref<string | null>(null);
const projects = ref<Project[]>([]);
const search = ref("");
const notice = ref<string | null>(null);
const error = ref<string | null>(null);

const showSetup = ref(false);
const editingProject = ref<Project | null>(null);
const showProjectDialog = ref(false);
const showClone = ref(false);
const showImport = ref(false);
const showSettings = ref(false);

/* Nav actions menu: Settings, updates, and history grouped under one
 * grid icon (the app's standard ContextMenu, which clamps to the window). */
const navMenu = ref<{ x: number; y: number } | null>(null);
const navMenuItems = [
  { label: "Settings", icon: Settings, action: () => (showSettings.value = true) },
  { label: "Check for updates", icon: ArrowDownToLine, action: () => checkForUpdates(true) },
  { label: "Action history", icon: History, action: () => openHistory() },
];
function openNavMenu(event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  navMenu.value = { x: rect.right - 224, y: rect.bottom + 4 };
}

/* ------------------------- action history ------------------------- */
const historyPanel = ref<HTMLElement | null>(null);
const historyHandle = ref<HTMLElement | null>(null);
useDialogDrag(historyPanel, historyHandle);
useEscapeClose(() => {
  if (!showHistory.value) return false;
  showHistory.value = false;
});

const showHistory = ref(false);
const historyEntries = ref<ActionHistoryEntry[]>([]);
const confirmClearHistory = ref(false);
async function openHistory() {
  showHistory.value = true;
  historyEntries.value = await getActionHistory().catch(() => []);
}
async function doClearHistory() {
  confirmClearHistory.value = false;
  await clearActionHistory().catch(() => {});
  historyEntries.value = [];
  showToast("Action history cleared.");
}
const HISTORY_KIND_LABELS: Record<string, string> = {
  added: "Added",
  imported: "Imported",
  moved: "Moved",
  deleted: "Deleted",
  duplicated: "Duplicated",
};
const HISTORY_KIND_CLASSES: Record<string, string> = {
  added: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  imported: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  moved: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  deleted: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  duplicated: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
};
const sshProject = ref<Project | null>(null);
const readmeProject = ref<Project | null>(null);
const runProject = ref<Project | null>(null);
const runInitialCommand = ref("");
const runSource = ref<"saved" | "readme" | "none">("none");
const runReadmeCommand = ref<string | null>(null);
// Internal terminal panel state (see TerminalPanel.vue): one tab
// per run command, so a new run adds a tab instead of stopping
// the previous command. Minimizing keeps all tabs running.
const terminalTabs = ref<TerminalTab[]>([]);
const terminalActiveTabId = ref<number | null>(null);
const terminalMinimized = ref(false);
let terminalTabCounter = 0;

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return projects.value;
  return projects.value.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.stacks.some((s) => s.toLowerCase().includes(q)),
  );
});

async function refresh() {
  projects.value = await listProjects();
  statusKey.value++;
}

async function boot() {
  projectsDir.value = await getSetting(PROJECTS_DIR_KEY);
  filesDir.value = await getSetting(FILES_DIR_KEY);
  const savedTab = await getSetting(ACTIVE_TAB_KEY);
  if (savedTab === "projects" || savedTab === "files") tab.value = savedTab;
  if (projectsDir.value) await refresh();
  ready.value = true;
}
onMounted(boot);

/**
 * VS Code-style autofetch: every 3 minutes, fetch remote refs for
 * every project, then refresh all card statuses once. Fetch never
 * touches the working tree, so it is safe with local edits, and
 * every failure is swallowed silently — a background fetch must
 * never surface an error, and a repo with no remote just skips.
 * The first run is delayed 10s so it does not compete with the
 * initial status load at boot. There is no toggle yet: it is
 * always on while the app is open.
 */
const AUTOFETCH_MS = 3 * 60 * 1000;
let autofetchTimer: ReturnType<typeof setInterval> | null = null;
async function autofetch() {
  const snapshot = [...projects.value];
  if (!snapshot.length) return;
  for (const project of snapshot) {
    await gitFetch(project.path).catch(() => {});
  }
  statusKey.value++;
}
onMounted(() => {
  setTimeout(() => {
    void autofetch();
  }, 10_000);
  autofetchTimer = setInterval(() => {
    void autofetch();
  }, AUTOFETCH_MS);
});
onUnmounted(() => {
  if (autofetchTimer !== null) clearInterval(autofetchTimer);
});

// Internal terminal output events from Rust (start_run threads),
// each payload carrying its run id so it lands in the right tab.
onMounted(async () => {
  await listen<{ runId: number; line: string }>("run-output", (event) => {
    const tab = terminalTabs.value.find((t) => t.id === event.payload.runId);
    if (!tab) return;
    tab.lines.push(event.payload.line);
    // Keep the buffer bounded: a dev server can run for hours.
    if (tab.lines.length > 2000) {
      tab.lines.splice(0, tab.lines.length - 2000);
    }
  });
  await listen<{ runId: number; code: number | null }>("run-exit", (event) => {
    const tab = terminalTabs.value.find((t) => t.id === event.payload.runId);
    if (!tab) return;
    tab.running = false;
    tab.exitCode = event.payload.code;
    tab.lines.push(`Process exited with code ${event.payload.code}`);
  });
});

function onSetupDone(dir: string) {
  projectsDir.value = dir;
  showSetup.value = false;
  refresh();
}

function flash(message: string) {
  notice.value = message;
  setTimeout(() => (notice.value = null), 4000);
}

/* ------------------------------ updates ------------------------------ */
const pendingUpdate = ref<Update | null>(null);
const checkingUpdates = ref(false);
const updatePhase = ref<"idle" | "downloading" | "installing">("idle");
const updatePercent = ref(0);
const DISMISSED_UPDATE_KEY = "pm-update-dismissed";

async function checkForUpdates(manual: boolean) {
  if (checkingUpdates.value) return;
  checkingUpdates.value = true;
  try {
    const update = await check();
    if (update) {
      if (
        !manual &&
        localStorage.getItem(DISMISSED_UPDATE_KEY) === update.version
      ) {
        return;
      }
      pendingUpdate.value = update;
    } else if (manual) {
      flash("You're on the latest version.");
    }
  } catch (e) {
    if (manual) error.value = `Update check failed: ${String(e)}`;
  } finally {
    checkingUpdates.value = false;
  }
}

function dismissUpdate() {
  if (pendingUpdate.value) {
    localStorage.setItem(DISMISSED_UPDATE_KEY, pendingUpdate.value.version);
  }
  pendingUpdate.value = null;
}

async function installUpdate() {
  const update = pendingUpdate.value;
  if (!update || updatePhase.value !== "idle") return;
  updatePhase.value = "downloading";
  updatePercent.value = 0;
  let total = 0;
  let downloaded = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total > 0) {
          updatePercent.value = Math.round((downloaded / total) * 100);
        }
      } else if (event.event === "Finished") {
        updatePhase.value = "installing";
      }
    });
    await relaunch();
  } catch (e) {
    error.value = `Update failed: ${String(e)}`;
    updatePhase.value = "idle";
  }
}

onMounted(() => {
  // Quiet background check a few seconds after launch.
  setTimeout(() => checkForUpdates(false), 4000);
});

async function runAction(fn: () => Promise<unknown>, failMsg: string) {
  error.value = null;
  try {
    await fn();
  } catch (e) {
    error.value = `${failMsg}: ${String(e)}`;
  }
}

/** Pull latest changes, then refresh the card's git status. */
async function pullProject(project: Project) {
  error.value = null;
  try {
    const output = await gitPull(project.path);
    const summary = output.split("\n").find((l) => l.trim()) ?? "Up to date.";
    showToast(`Pulled ${project.name}: ${summary}`);
    statusKey.value++;
  } catch (e) {
    error.value = `Could not pull ${project.name}: ${String(e)}`;
  }
}

/**
 * Build & Run: open the editable run-command dialog. Prefill order:
 * a command saved for this project (from a previous run), else the
 * command found in README.md, else empty. Nothing runs until the
 * user taps Run in the dialog, and the edited command is saved for
 * this project when they do.
 */
async function buildRunProject(project: Project) {
  error.value = null;
  try {
    const saved = await getSetting(`run_command_${project.id}`);
    const readme = await readReadme(project.path);
    const readmeCommand = findRunCommand(readme);
    runReadmeCommand.value = readmeCommand;
    if (saved?.trim()) {
      runInitialCommand.value = saved;
      runSource.value = "saved";
    } else if (readmeCommand) {
      runInitialCommand.value = readmeCommand;
      runSource.value = "readme";
    } else {
      runInitialCommand.value = "";
      runSource.value = "none";
    }
    runProject.value = project;
  } catch (e) {
    error.value = `Could not prepare run for ${project.name}: ${String(e)}`;
  }
}

/** Run the edited command in the internal terminal, and save it. */
async function runWithCommand(command: string) {
  const project = runProject.value;
  if (!project) return;
  runProject.value = null;
  error.value = null;
  try {
    await setSetting(`run_command_${project.id}`, command);
    await openInternalTerminal(project, command);
  } catch (e) {
    error.value = `Could not run ${project.name}: ${String(e)}`;
  }
}

/**
 * Start a command in a new internal-terminal tab. Previous tabs
 * keep running — a new run never stops an old one. The panel
 * un-minimizes and the new tab becomes active.
 */
async function openInternalTerminal(project: Project, command: string) {
  const id = ++terminalTabCounter;
  const tab: TerminalTab = {
    id,
    projectName: project.name,
    command,
    lines: [`$ ${command}`],
    running: true,
    exitCode: null,
  };
  terminalTabs.value.push(tab);
  terminalActiveTabId.value = id;
  terminalMinimized.value = false;
  try {
    await startRun(id, project.path, command);
    showToast(`Running ${project.name}: ${command}`);
  } catch (e) {
    tab.running = false;
    tab.lines.push(`Failed to start: ${String(e)}`);
    throw e;
  }
}

/** Stop one tab's command but keep the tab open to see its output. */
async function stopTerminalTab(id: number) {
  const tab = terminalTabs.value.find((t) => t.id === id);
  if (!tab || !tab.running) return;
  tab.running = false;
  await stopRun(id).catch(() => {});
}

/** Stop a tab's command (if running) and remove the tab. */
async function closeTerminalTab(id: number) {
  await stopTerminalTab(id);
  terminalTabs.value = terminalTabs.value.filter((t) => t.id !== id);
  if (terminalActiveTabId.value === id) {
    terminalActiveTabId.value =
      terminalTabs.value[terminalTabs.value.length - 1]?.id ?? null;
  }
}

async function sendTerminalInput(id: number, input: string) {
  const tab = terminalTabs.value.find((t) => t.id === id);
  if (!tab || !tab.running) return;
  tab.lines.push(`> ${input}`);
  await terminalInput(id, input).catch((e) => {
    tab.lines.push(`Could not send input: ${String(e)}`);
  });
}

async function scan() {
  if (!projectsDir.value) return;
  error.value = null;
  try {
    const found = await scanProjects(projectsDir.value);
    const known = new Set(projects.value.map((p) => p.path));
    let added = 0;
    for (const f of found) {
      if (known.has(f.path)) continue;
      await createProject({
        name: f.name,
        path: f.path,
        repoUrl: f.repoUrl,
        description: null,
        stacks: f.stacks,
      });
      added++;
    }
    await refresh();
    flash(
      added
        ? `Scan complete — added ${added} new project${added === 1 ? "" : "s"}.`
        : "Scan complete — no new projects found.",
    );
  } catch (e) {
    error.value = `Scan failed: ${String(e)}`;
  }
}

async function remove(project: Project) {
  await deleteProjectIcon(project.id).catch(() => {});
  await deleteProject(project.id);
  await refresh();
  flash(`Removed ${project.name} from the list (files untouched).`);
}

async function onImported(warning: string | null) {
  showImport.value = false;
  await scan();
  if (warning) error.value = warning;
}

function openNewProject() {
  editingProject.value = null;
  showProjectDialog.value = true;
}

async function togglePin(project: Project) {
  await setProjectPinned(project.id, !project.pinned);
  await refresh();
}

/* ------------------------- context menu ------------------------- */
const projectCtx = ref<{ x: number; y: number; project: Project } | null>(null);
const projectCtxItems = computed<ContextMenuItem[]>(() => {
  const project = projectCtx.value?.project;
  if (!project) return [];
  return [
    {
      label: "Open in VS Code",
      icon: Code,
      action: () =>
        runAction(() => openInVsCode(project.path), "Could not open VS Code"),
    },
    {
      label: "Open source folder",
      icon: FolderOpen,
      action: () =>
        runAction(() => openPath(project.path), "Could not open folder"),
    },
    {
      label: "Open terminal",
      icon: SquareTerminal,
      action: () =>
        runAction(() => openTerminal(project.path), "Could not open terminal"),
    },
    {
      label: "SSH connections",
      icon: Network,
      action: () => (sshProject.value = project),
    },
    {
      label: "Open README",
      icon: BookOpen,
      action: () => (readmeProject.value = project),
    },
    {
      label: "Pull latest changes",
      icon: ArrowDownToLine,
      action: () => pullProject(project),
    },
    {
      label: "Build & run (from README)",
      icon: Play,
      action: () => buildRunProject(project),
    },
    ...(project.repoUrl
      ? [
          {
            label: "Copy clone URL",
            icon: Copy,
            action: () => copyClone(project),
          },
        ]
      : []),
    {
      label: project.pinned ? "Remove star" : "Star",
      icon: Star,
      action: () => togglePin(project),
    },
    { label: "Edit", icon: Pencil, action: () => openEdit(project) },
    { label: "Remove", icon: Trash2, danger: true, action: () => remove(project) },
  ];
});
async function copyClone(project: Project) {
  if (!project.repoUrl) return;
  const base = project.repoUrl.replace(/\/+$/, "");
  const cloneUrl = base.endsWith(".git") ? base : `${base}.git`;
  try {
    await navigator.clipboard.writeText(cloneUrl);
  } catch {
    // Clipboard API can be unavailable in some webviews; fall back to the
    // classic hidden-textarea copy.
    const ta = document.createElement("textarea");
    ta.value = cloneUrl;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  flash("Clone URL copied");
}
function onProjectContext(event: MouseEvent, project: Project) {
  containerCtx.value = null;
  projectCtx.value = { x: event.clientX, y: event.clientY, project };
}

/* Right-clicking empty space in the Projects pane: the "add" actions. */
const containerCtx = ref<{ x: number; y: number } | null>(null);
const containerCtxItems: ContextMenuItem[] = [
  { label: "Add project", icon: Plus, action: () => openNewProject() },
  { label: "Scan for new projects", icon: RefreshCw, action: () => scan() },
  { label: "Import folder", icon: FolderInput, action: () => (showImport.value = true) },
  { label: "Clone repository", icon: Download, action: () => (showClone.value = true) },
];
const filesViewRef = ref<InstanceType<typeof FilesView> | null>(null);
const filesStats = ref("");
// Music player: FilesView tells App which audio file to play and the
// audio queue (all audio files in the library); the widget lives in
// App (between main and footer) so playback survives tab switches.
const audioTrack = ref<import("./types").LibraryFile | null>(null);
const audioQueue = ref<import("./types").LibraryFile[]>([]);
// The playing source ('all', 'favorites', or a playlist id) is owned
// here so the playlist manager modal can change it from the main nav
// even when nothing is playing yet; the widget mirrors it.
const playerSource = ref<string>("all");
const showPlaylistManager = ref(false);
function onPlayAudio(
  file: import("./types").LibraryFile,
  queue: import("./types").LibraryFile[],
) {
  audioTrack.value = file;
  audioQueue.value = queue;
  playerSource.value = "all";
}
function onManagerPlay(
  file: import("./types").LibraryFile,
  queue: import("./types").LibraryFile[],
  source: string,
) {
  audioTrack.value = file;
  audioQueue.value = queue;
  playerSource.value = source;
  showPlaylistManager.value = false;
}
function onBodyContext(event: MouseEvent) {
  if ((event.target as HTMLElement).closest("input, textarea, select")) return;
  if (tab.value === "projects") {
    onContainerContext(event);
  } else {
    filesViewRef.value?.openContainerCtx(event);
  }
}
function onContainerContext(event: MouseEvent) {
  // Leave the normal text menu alone inside form fields.
  if ((event.target as HTMLElement).closest("input, textarea, select")) return;
  event.preventDefault();
  projectCtx.value = null;
  containerCtx.value = { x: event.clientX, y: event.clientY };
}

function onPointerDragStart(id: number) {
  pointerDrag.value = { id, targetId: null, after: false };
}

function onPointerDragMove(pos: { x: number; y: number }) {
  const session = pointerDrag.value;
  if (!session) return;
  // The card under the cursor carries its project id, so the drop target
  // is found geometrically — no browser drag system involved.
  const el = document
    .elementFromPoint(pos.x, pos.y)
    ?.closest?.("[data-project-id]");
  if (!el) {
    pointerDrag.value = { ...session, targetId: null, after: false };
    return;
  }
  const targetId = Number(el.getAttribute("data-project-id"));
  if (!targetId || targetId === session.id) {
    pointerDrag.value = { ...session, targetId: null, after: false };
    return;
  }
  const rect = el.getBoundingClientRect();
  pointerDrag.value = {
    ...session,
    targetId,
    after: pos.y > rect.top + rect.height / 2,
  };
}

async function onPointerDragEnd() {
  const session = pointerDrag.value;
  pointerDrag.value = null;
  if (!session || session.targetId == null) return;
  const list = [...projects.value];
  const fromIdx = list.findIndex((p) => p.id === session.id);
  if (fromIdx < 0) return;
  const [moved] = list.splice(fromIdx, 1);
  const toIdx = list.findIndex((p) => p.id === session.targetId);
  if (toIdx < 0) return;
  if (moved.pinned !== list[toIdx].pinned) {
    flash("Starred and unstarred projects sort in separate groups.");
    return;
  }
  list.splice(session.after ? toIdx + 1 : toIdx, 0, moved);
  projects.value = list;
  await setProjectOrder(list.map((p) => p.id));
}

/* --------------------------- keyboard shortcuts --------------------------- */

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
  );
}

function focusSearch() {
  if (tab.value !== "projects") tab.value = "projects";
  setTimeout(() => searchInput.value?.focus(), 30);
}

function closeTopmost() {
  if (showSettings.value) showSettings.value = false;
  else if (readmeProject.value) readmeProject.value = null;
  else if (sshProject.value) sshProject.value = null;
  else if (showImport.value) showImport.value = false;
  else if (showClone.value) showClone.value = false;
  else if (showProjectDialog.value) showProjectDialog.value = false;
  else if (showSetup.value) showSetup.value = false;
  else if (search.value) search.value = "";
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    focusSearch();
    return;
  }
  if (e.key === "Escape") {
    closeTopmost();
    return;
  }
  if (isTypingTarget(e.target)) return;
  if (e.key === "/") {
    e.preventDefault();
    focusSearch();
  } else if (e.key === "1") {
    tab.value = "projects";
  } else if (e.key === "2") {
    tab.value = "files";
  } else if (e.key.toLowerCase() === "s" && tab.value === "projects" && projectsDir.value) {
    scan();
  } else if (e.key.toLowerCase() === "i" && tab.value === "projects" && projectsDir.value) {
    showImport.value = true;
  } else if (e.key.toLowerCase() === "n" && tab.value === "projects") {
    openNewProject();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function openEdit(project: Project) {
  editingProject.value = project;
  showProjectDialog.value = true;
}
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- First-run setup -->
  <ContextMenu
    v-if="containerCtx"
    :x="containerCtx.x"
    :y="containerCtx.y"
    :items="containerCtxItems"
    @close="containerCtx = null"
  />
  <ContextMenu
    v-if="projectCtx"
    :x="projectCtx.x"
    :y="projectCtx.y"
    :items="projectCtxItems"
    @close="projectCtx = null"
  />

    <SetupWizard v-if="ready && !projectsDir" @done="onSetupDone" />
    <SetupWizard v-else-if="showSetup" @done="onSetupDone" />

    <template v-else-if="ready">
      <header class="relative z-30 border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" :class="{ dark: chromeDark }">
        <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-6 py-4">
          <h1 class="flex items-center gap-2 text-xl font-bold min-[1600px]:absolute min-[1600px]:left-6 min-[1600px]:top-1/2 min-[1600px]:-translate-y-1/2">
            <LayoutGrid class="h-6 w-6 text-blue-600" /> Project Manager
          </h1>

          <nav class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              :class="tab === 'projects' ? 'switch-active tab-active' : ''"
              @click="tab = 'projects'"
            >
              <LayoutGrid class="h-4 w-4" /> Projects
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              :class="tab === 'files' ? 'switch-active tab-active' : ''"
              @click="tab = 'files'"
            >
              <Files class="h-4 w-4" /> Files
            </button>
          </nav>

          <div class="ml-auto flex items-center gap-2 min-[1600px]:absolute min-[1600px]:right-6 min-[1600px]:top-1/2 min-[1600px]:ml-0 min-[1600px]:-translate-y-1/2">
          <button class="toolbar-btn" @click="showPlaylistManager = true">
            <Music class="h-4 w-4" /> Playlists
          </button>
          <button class="toolbar-btn tooltip tooltip-bottom" data-tip="Actions" @click="openNavMenu">
            <Grip class="h-4 w-4" />
          </button>
          </div>
        </div>
      </header>

      <div
        v-if="pendingUpdate"
        class="mx-auto mt-4 flex w-full max-w-7xl flex-wrap items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100"
      >
        <ArrowDownToLine class="h-4 w-4 shrink-0" />
        <span class="min-w-0 flex-1">
          <strong>Version {{ pendingUpdate.version }} is available.</strong>
          <span
            v-if="pendingUpdate.body"
            class="block truncate text-blue-700 dark:text-blue-300"
          >
            {{ pendingUpdate.body }}
          </span>
        </span>
        <span v-if="updatePhase === 'downloading'" class="text-xs">
          Downloading… {{ updatePercent }}%
        </span>
        <span v-else-if="updatePhase === 'installing'" class="text-xs">
          Installing — the app will restart…
        </span>
        <template v-else>
          <button
            class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            @click="installUpdate"
          >
            Download &amp; restart
          </button>
          <button
            class="rounded-lg px-3 py-1.5 text-sm hover:bg-blue-100 dark:hover:bg-blue-900"
            @click="dismissUpdate"
          >
            Later
          </button>
        </template>
      </div>
      <div
        v-if="notice"
        class="mx-auto mt-4 w-full max-w-7xl rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
      >
        {{ notice }}
      </div>
      <div
        v-if="error"
        class="mx-auto mt-4 w-full max-w-7xl rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
      >
        {{ error }}
      </div>

      <main class="mx-auto w-full max-w-7xl flex-1 overflow-y-auto px-6 py-6" @contextmenu="onBodyContext">
        <div v-show="tab === 'projects'">
        <div class="relative z-20 mb-4 flex flex-wrap items-center gap-2">
          <div class="relative min-w-52 flex-1 sm:max-w-md">
            <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <input
              ref="searchInput"
              v-model="search"
              class="on-bg w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
              placeholder="Search by name or stack…  ( / )"
            />
          </div>
          <button class="toolbar-btn tooltip tooltip-bottom" data-tip="Move or copy an existing folder into your projects folder" @click="showImport = true">
            <FolderInput class="h-4 w-4" /> Import
          </button>
          <button class="toolbar-btn" @click="showClone = true">
            <Download class="h-4 w-4" /> Clone
          </button>
          <button class="toolbar-btn" @click="openNewProject">
            <Plus class="h-4 w-4" /> Add project
          </button>
          <button
            class="toolbar-btn tooltip tooltip-bottom"
            data-tip="Scan for new projects"
            @click="scan"
          >
            <RefreshCw class="h-4 w-4" />
          </button>
          <button
            class="toolbar-btn tooltip tooltip-bottom"
            :data-tip="`Projects folder: ${projectsDir}`"
            @click="showSetup = true"
          >
            <FolderCog class="h-4 w-4" />
          </button>
        </div>
        <div
          v-if="filtered.length"
          class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <ProjectCard
            v-for="project in filtered"
            :key="project.id"
            :project="project"
            :status-key="statusKey"
            :reorder-enabled="!search.trim()"
            :drop-target="pointerDrag?.targetId === project.id"
            :drop-after="pointerDrag?.after ?? false"
            @pin="togglePin(project)"
            @copy-clone="copyClone(project)"
            @context="(e) => onProjectContext(e, project)"
            @pointer-drag-start="onPointerDragStart(project.id)"
            @pointer-drag-move="onPointerDragMove"
            @pointer-drag-end="onPointerDragEnd"
            @vscode="runAction(() => openInVsCode(project.path), 'Could not open VS Code')"
            @terminal="runAction(() => openTerminal(project.path), 'Could not open terminal')"
            @folder="runAction(() => openPath(project.path), 'Could not open folder')"
            @ssh="sshProject = project"
            @readme="readmeProject = project"
            @pull="pullProject(project)"
            @buildrun="buildRunProject(project)"
            @edit="openEdit(project)"
            @remove="remove(project)"
          />
        </div>
        <div v-if="!filtered.length" class="on-bg py-20 text-center text-neutral-500">
          <p class="mb-2 text-lg font-medium">No projects yet</p>
          <p class="text-sm">
            Use <strong>Scan</strong> to pick up the folders inside your projects
            directory, <strong>Import</strong> to move or copy one in from
            elsewhere, <strong>Clone</strong> a repository, or
            <strong>Add project</strong> manually.
          </p>
        </div>
        </div>
        <div v-show="tab === 'files'">
          <FilesView
            ref="filesViewRef"
            :files-dir="filesDir"
            :active="tab === 'files'"
            @dir-changed="(d) => (filesDir = d)"
            @stats="(text) => (filesStats = text)"
            @play-audio="onPlayAudio"
          />
        </div>
      </main>
      <MusicPlayerWidget
        v-if="audioTrack"
        :track="audioTrack"
        :queue="audioQueue"
        :source="playerSource"
        @close="audioTrack = null; playerSource = 'all'"
        @open-playlists="showPlaylistManager = true"
      />
      <TerminalPanel
        v-if="terminalTabs.length"
        :tabs="terminalTabs"
        :active-tab-id="terminalActiveTabId"
        :minimized="terminalMinimized"
        @select-tab="terminalActiveTabId = $event"
        @close-tab="closeTerminalTab"
        @stop-tab="stopTerminalTab"
        @clear-tab="(id) => { const tab = terminalTabs.find((t) => t.id === id); if (tab) tab.lines = []; }"
        @send="sendTerminalInput"
        @minimize="terminalMinimized = true"
        @restore="terminalMinimized = false"
      />
      <footer @contextmenu="onBodyContext"
        class="border-t border-neutral-200 bg-white px-6 py-2.5 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900"
        :class="{ dark: chromeDark }"
      >
        <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1">
          <template v-if="tab === 'projects'">
          <span class="flex min-w-0 items-baseline gap-1.5">
            <span class="shrink-0">Projects folder:</span>
            <span class="tooltip tooltip-top truncate font-mono" :data-tip="projectsDir ?? ''">{{ projectsDir }}</span>
          </span>
          </template>
          <template v-else>
            <span class="flex min-w-0 items-baseline gap-1.5">
              <span class="shrink-0">Library:</span>
              <span class="tooltip tooltip-top truncate font-mono" :data-tip="filesDir ?? ''">{{ filesDir }}</span>
              <span class="shrink-0">— drop files anywhere here to add them.</span>
            </span>
            <span v-if="filesStats" class="ml-auto shrink-0 whitespace-nowrap">{{ filesStats }}</span>
          </template>
        </div>
      </footer>
    </template>

    <ProjectDialog
      v-if="showProjectDialog"
      :project="editingProject"
      @close="showProjectDialog = false"
      @saved="showProjectDialog = false; refresh()"
    />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <PlaylistManagerDialog
      v-if="showPlaylistManager"
      :files-dir="filesDir ?? ''"
      :current-track="audioTrack"
      :active-source="playerSource"
      @close="showPlaylistManager = false"
      @play="onManagerPlay"
    />
    <CloneDialog
      v-if="showClone && projectsDir"
      :projects-dir="projectsDir"
      @close="showClone = false"
      @cloned="showClone = false; refresh(); flash('Repository cloned and added.')"
    />
    <ImportDialog
      v-if="showImport && projectsDir"
      :parent-dir="projectsDir"
      title="Import project folder"
      parent-label="projects folder"
      :importer="importProjectFolder"
      @close="showImport = false"
      @imported="onImported"
    />
    <SshDialog v-if="sshProject" :project="sshProject" @close="sshProject = null" />
    <ReadmeDialog
      v-if="readmeProject"
      :project="readmeProject"
      @close="readmeProject = null"
    />
    <RunCommandDialog
      v-if="runProject"
      :project-name="runProject.name"
      :initial-command="runInitialCommand"
      :source="runSource"
      :readme-command="runReadmeCommand"
      @close="runProject = null"
      @run="runWithCommand"
    />
    <div
      v-if="showHistory"
      class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
      :class="{ dark: chromeDark }"
      @click.self="showHistory = false"
    >
      <div ref="historyPanel" class="glass-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
        <h2 ref="historyHandle" class="mb-1 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
          <History class="h-5 w-5" /> Action history
        </h2>
        <p class="mb-4 text-sm text-neutral-500">
          Additions, imports, moves, and deletions in the file library, newest first.
        </p>
        <div v-if="!historyEntries.length" class="py-8 text-center text-sm text-neutral-500">
          No actions recorded yet.
        </div>
        <ul v-else class="max-h-96 space-y-2 overflow-y-auto pr-1">
          <li v-for="entry in historyEntries" :key="entry.id" class="flex items-start gap-2.5 text-sm">
            <span
              class="mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
              :class="HISTORY_KIND_CLASSES[entry.kind] ?? 'bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'"
            >{{ HISTORY_KIND_LABELS[entry.kind] ?? entry.kind }}</span>
            <span class="min-w-0 flex-1 break-words">{{ entry.detail }}</span>
            <span class="shrink-0 text-xs text-neutral-400">{{ new Date(entry.createdAt).toLocaleString() }}</span>
          </li>
        </ul>
        <div class="mt-5 flex items-center justify-between">
          <button
            v-if="historyEntries.length"
            class="text-sm font-medium text-red-600 hover:underline"
            @click="confirmClearHistory = true"
          >
            Clear history
          </button>
          <span v-else></span>
          <button class="btn btn-ghost btn-sm" @click="showHistory = false">Close</button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-if="confirmClearHistory"
      title="Clear history?"
      message="All recorded file actions will be removed. This cannot be undone."
      confirm-label="Clear"
      @confirm="doClearHistory"
      @cancel="confirmClearHistory = false"
    />

    <ContextMenu
      v-if="navMenu"
      :x="navMenu.x"
      :y="navMenu.y"
      :items="navMenuItems"
      @close="navMenu = null"
    />

    <Toasts />
  </div>
</template>

<style scoped>
.toolbar-btn {
  @apply flex items-center gap-1.5 rounded-lg bg-neutral-200/80 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700;
}
.theme-btn {
  @apply rounded-md p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100;
}
.theme-btn-active {
  @apply bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100;
}
</style>
