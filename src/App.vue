<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, type Component } from "vue";
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
  LayoutGrid,
  Network,
  Pencil,
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
import SettingsDialog from "./components/SettingsDialog.vue";
import FilesView from "./components/FilesView.vue";
import ContextMenu, {
  type ContextMenuItem,
} from "./components/ContextMenu.vue";
import {
  createProject,
  deleteProject,
  FILES_DIR_KEY,
  getSetting,
  listProjects,
  PROJECTS_DIR_KEY,
  setProjectOrder,
  setProjectPinned,
} from "./lib/db";
import {
  deleteProjectIcon,
  importProjectFolder,
  openInVsCode,
  openPath,
  openTerminal,
  scanProjects,
} from "./lib/api";
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
const sshProject = ref<Project | null>(null);
const readmeProject = ref<Project | null>(null);

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
  if (projectsDir.value) await refresh();
  ready.value = true;
}
onMounted(boot);

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
      <header class="relative border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" :class="{ dark: chromeDark }">
        <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <h1 class="flex items-center gap-2 text-xl font-bold min-[1600px]:absolute min-[1600px]:left-6 min-[1600px]:top-1/2 min-[1600px]:-translate-y-1/2">
            <LayoutGrid class="h-6 w-6 text-blue-600" /> Project Manager
          </h1>

          <nav class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              :class="tab === 'projects' ? 'switch-active' : ''"
              @click="tab = 'projects'"
            >
              <LayoutGrid class="h-4 w-4" /> Projects
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              :class="tab === 'files' ? 'switch-active' : ''"
              @click="tab = 'files'"
            >
              <Files class="h-4 w-4" /> Files
            </button>
          </nav>

          <div class="ml-auto flex items-center gap-2 min-[1600px]:absolute min-[1600px]:right-6 min-[1600px]:top-1/2 min-[1600px]:ml-0 min-[1600px]:-translate-y-1/2">
          <button class="toolbar-btn tooltip tooltip-bottom" data-tip="Settings" @click="showSettings = true">
            <Settings class="h-4 w-4" />
          </button>
          <button class="toolbar-btn tooltip tooltip-bottom" data-tip="Check for updates" @click="checkForUpdates(true)">
            <ArrowDownToLine class="h-4 w-4" :class="checkingUpdates ? 'animate-pulse' : ''" />
          </button>
          </div>
        </div>
      </header>

      <div
        v-if="pendingUpdate"
        class="mx-auto mt-4 flex w-full max-w-6xl flex-wrap items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100"
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
        class="mx-auto mt-4 w-full max-w-6xl rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
      >
        {{ notice }}
      </div>
      <div
        v-if="error"
        class="mx-auto mt-4 w-full max-w-6xl rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
      >
        {{ error }}
      </div>

      <main class="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-6" @contextmenu="onBodyContext">
        <div v-show="tab === 'projects'">
        <div class="mb-4 flex flex-wrap items-center gap-2">
          <div class="relative min-w-52 flex-1 sm:max-w-md">
            <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <input
              ref="searchInput"
              v-model="search"
              class="on-bg w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
              placeholder="Search by name or stack…  ( / )"
            />
          </div>
          <button class="toolbar-btn" title="Move or copy an existing folder into your projects folder" @click="showImport = true">
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
          />
        </div>
      </main>
      <footer @contextmenu="onBodyContext"
        class="border-t border-neutral-200 bg-white px-6 py-2.5 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900"
        :class="{ dark: chromeDark }"
      >
        <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
          <template v-if="tab === 'projects'">
          <span class="flex min-w-0 items-baseline gap-1.5">
            <span class="shrink-0">Projects folder:</span>
            <span class="truncate font-mono" :title="projectsDir ?? ''">{{ projectsDir }}</span>
          </span>
          </template>
          <template v-else>
            <span class="flex min-w-0 items-baseline gap-1.5">
              <span class="shrink-0">Library:</span>
              <span class="truncate font-mono" :title="filesDir ?? ''">{{ filesDir }}</span>
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
  </div>
</template>

<style scoped>
.toolbar-btn {
  @apply flex items-center gap-1.5 rounded-lg bg-blue-100/80 px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-100 dark:hover:bg-blue-900/70;
}
.theme-btn {
  @apply rounded-md p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100;
}
.theme-btn-active {
  @apply bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100;
}
</style>
