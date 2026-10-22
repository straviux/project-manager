<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  Download,
  Files,
  FolderCog,
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
} from "@lucide/vue";
import SetupWizard from "./components/SetupWizard.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectDialog from "./components/ProjectDialog.vue";
import CloneDialog from "./components/CloneDialog.vue";
import SshDialog from "./components/SshDialog.vue";
import ReadmeDialog from "./components/ReadmeDialog.vue";
import FilesView from "./components/FilesView.vue";
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
  openInVsCode,
  openTerminal,
  scanProjects,
} from "./lib/api";
import type { Project } from "./types";

const ready = ref(false);
const statusKey = ref(0);
const dragId = ref<number | null>(null);
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
  await deleteProject(project.id);
  await refresh();
  flash(`Removed ${project.name} from the list (files untouched).`);
}

function openNewProject() {
  editingProject.value = null;
  showProjectDialog.value = true;
}

async function togglePin(project: Project) {
  await setProjectPinned(project.id, !project.pinned);
  await refresh();
}

function onDragStart(id: number) {
  dragId.value = id;
}

async function onDrop(targetId: number) {
  const from = dragId.value;
  dragId.value = null;
  if (from == null || from === targetId) return;
  const list = [...projects.value];
  const fromIdx = list.findIndex((p) => p.id === from);
  const toIdx = list.findIndex((p) => p.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  if (list[fromIdx].pinned !== list[toIdx].pinned) {
    flash("Pinned and unpinned projects sort in separate groups.");
    return;
  }
  const [moved] = list.splice(fromIdx, 1);
  list.splice(toIdx, 0, moved);
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
  if (readmeProject.value) readmeProject.value = null;
  else if (sshProject.value) sshProject.value = null;
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
    <SetupWizard v-if="ready && !projectsDir" @done="onSetupDone" />
    <SetupWizard v-else-if="showSetup" @done="onSetupDone" />

    <template v-else-if="ready">
      <header class="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-4">
          <h1 class="flex items-center gap-2 text-xl font-bold">
            <LayoutGrid class="h-6 w-6 text-blue-600" /> Project Manager
          </h1>

          <nav class="flex overflow-hidden rounded-lg ring-1 ring-neutral-300 dark:ring-neutral-700">
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              :class="tab === 'projects' ? 'bg-blue-600 text-white' : ''"
              @click="tab = 'projects'"
            >
              <LayoutGrid class="h-4 w-4" /> Projects
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              :class="tab === 'files' ? 'bg-blue-600 text-white' : ''"
              @click="tab = 'files'"
            >
              <Files class="h-4 w-4" /> Files
            </button>
          </nav>

          <div v-if="tab === 'projects'" class="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
            <Search class="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-neutral-400" />
            <input
              ref="searchInput"
              v-model="search"
              class="w-full rounded-lg border border-neutral-300 bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
              placeholder="Search by name or stack…  ( / )"
            />
          </div>

          <button v-if="tab === 'projects'" class="toolbar-btn" title="Scan the projects folder for new projects" @click="scan">
            <RefreshCw class="h-4 w-4" /> Scan
          </button>
          <button v-if="tab === 'projects'" class="toolbar-btn" @click="showClone = true">
            <Download class="h-4 w-4" /> Clone
          </button>
          <button v-if="tab === 'projects'" class="toolbar-btn" @click="openNewProject">
            <Plus class="h-4 w-4" /> Add project
          </button>
          <button
            v-if="tab === 'projects'"
            class="toolbar-btn"
            :title="`Projects folder: ${projectsDir}`"
            @click="showSetup = true"
          >
            <FolderCog class="h-4 w-4" />
          </button>
        </div>
        <p v-if="tab === 'projects'" class="mx-auto max-w-6xl px-6 pb-3 text-xs text-neutral-500">
          Projects folder: <span class="font-mono">{{ projectsDir }}</span>
          <span class="ml-3 text-neutral-400">
            Shortcuts: / or Ctrl+K search · 1 Projects · 2 Files · S scan · N new project · Esc close
          </span>
        </p>
      </header>

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

      <main class="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-6">
        <div
          v-if="tab === 'projects' && filtered.length"
          class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          <ProjectCard
            v-for="project in filtered"
            :key="project.id"
            :project="project"
            :status-key="statusKey"
            :reorder-enabled="!search.trim()"
            @pin="togglePin(project)"
            @drag-start="onDragStart(project.id)"
            @drop="onDrop(project.id)"
            @vscode="runAction(() => openInVsCode(project.path), 'Could not open VS Code')"
            @terminal="runAction(() => openTerminal(project.path), 'Could not open terminal')"
            @ssh="sshProject = project"
            @readme="readmeProject = project"
            @edit="openEdit(project)"
            @remove="remove(project)"
          />
        </div>
        <div v-if="tab === 'projects' && !filtered.length" class="py-20 text-center text-neutral-500">
          <p class="mb-2 text-lg font-medium">No projects yet</p>
          <p class="text-sm">
            Use <strong>Scan</strong> to import the folders inside your projects
            directory, <strong>Clone</strong> a repository, or
            <strong>Add project</strong> manually.
          </p>
        </div>
        <FilesView
          v-if="tab === 'files'"
          :files-dir="filesDir"
          @dir-changed="(d) => (filesDir = d)"
        />
      </main>
    </template>

    <ProjectDialog
      v-if="showProjectDialog"
      :project="editingProject"
      @close="showProjectDialog = false"
      @saved="showProjectDialog = false; refresh()"
    />
    <CloneDialog
      v-if="showClone && projectsDir"
      :projects-dir="projectsDir"
      @close="showClone = false"
      @cloned="showClone = false; refresh(); flash('Repository cloned and added.')"
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
  @apply flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700;
}
</style>
