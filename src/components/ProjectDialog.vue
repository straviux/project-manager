<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { computed, reactive, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { pickerDefaultPath } from "../lib/paths";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FolderOpen, X } from "@lucide/vue";
import { createProject, setProjectIcon, updateProject } from "../lib/db";
import { deleteProjectIcon, detectStacks, saveProjectIcon } from "../lib/api";
import {
  PROJECT_ICON_COLOR_NAMES,
  PROJECT_ICON_COLORS,
  PROJECT_ICONS,
  PROJECT_ICON_NAMES,
} from "../lib/projectIcons";
import { KNOWN_STACKS, type Project, type ProjectDraft } from "../types";

const props = defineProps<{ project: Project | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const form = reactive<ProjectDraft>({
  name: props.project?.name ?? "",
  path: props.project?.path ?? "",
  repoUrl: props.project?.repoUrl ?? "",
  description: props.project?.description ?? "",
  stacks: [...(props.project?.stacks ?? [])],
});
const error = ref<string | null>(null);
const saving = ref(false);

/* ------------------------------- icon ------------------------------- */
const iconKind = ref<"none" | "lucide" | "ico">(
  props.project?.iconKind ?? "none",
);
const iconName = ref<string>(
  props.project?.iconKind === "lucide"
    ? (props.project.iconValue ?? "Folder")
    : "Folder",
);
const iconColor = ref<string>(props.project?.iconColor ?? "blue");
const icoStored = ref<string | null>(
  props.project?.iconKind === "ico" ? props.project.iconValue : null,
);
const icoSource = ref<string | null>(null);
const icoFileLabel = computed(() => {
  const p = icoSource.value ?? icoStored.value;
  return p ? (p.split(/[\\/]/).pop() ?? p) : "No file chosen";
});

async function browseIco() {
  const picked = await open({
    multiple: false,
    defaultPath: await pickerDefaultPath(),
    filters: [{ name: "Icon", extensions: ["ico"] }],
  });
  if (typeof picked === "string") icoSource.value = picked;
}

async function browse() {
  const picked = await open({ directory: true, multiple: false, defaultPath: await pickerDefaultPath() });
  if (typeof picked === "string") {
    form.path = picked;
    if (!form.name) form.name = picked.split(/[\\/]/).pop() ?? "";
    if (!form.stacks.length) {
      form.stacks = await detectStacks(picked).catch(() => []);
    }
  }
}

function toggleStack(stack: string) {
  const i = form.stacks.indexOf(stack);
  if (i >= 0) form.stacks.splice(i, 1);
  else form.stacks.push(stack);
}

async function save() {
  error.value = null;
  saving.value = true;
  try {
    const draft: ProjectDraft = {
      name: form.name.trim(),
      path: form.path.trim(),
      repoUrl: form.repoUrl?.trim() ? form.repoUrl.trim() : null,
      description: form.description?.trim() ? form.description.trim() : null,
      stacks: [...form.stacks],
    };
    if (!draft.name || !draft.path) throw new Error("Name and path are required.");
    let id: number;
    if (props.project) {
      await updateProject(props.project.id, draft);
      id = props.project.id;
    } else {
      id = await createProject(draft);
    }
    // Icon: resolve after the project exists so a custom .ico can be
    // stored under its id.
    if (iconKind.value === "lucide") {
      if (icoStored.value) await deleteProjectIcon(id).catch(() => {});
      await setProjectIcon(id, "lucide", iconName.value, iconColor.value);
    } else if (iconKind.value === "ico") {
      if (icoSource.value) {
        const stored = await saveProjectIcon(icoSource.value, id);
        await setProjectIcon(id, "ico", stored, iconColor.value);
      } else if (!icoStored.value) {
        await setProjectIcon(id, null, null, iconColor.value);
      }
      // Otherwise the previously stored .ico stays as-is.
    } else {
      if (icoStored.value) await deleteProjectIcon(id).catch(() => {});
      await setProjectIcon(id, null, null, iconColor.value);
    }
    emit("saved");
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" :class="{ dark: chromeDark }" @click.self="emit('close')">
    <div class="glass-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 max-h-[90vh] overflow-y-auto">
      <header class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ project ? "Edit project" : "Add project" }}</h2>
        <button class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </header>

      <label class="field">
        <span>Name</span>
        <input v-model="form.name" class="input" placeholder="my-awesome-app" />
      </label>

      <label class="field">
        <span>Folder</span>
        <div class="flex gap-2">
          <input v-model="form.path" class="input" placeholder="/home/you/projects/my-awesome-app" />
          <button class="btn btn-sm shrink-0" @click="browse">
            <FolderOpen class="h-4 w-4" />
          </button>
        </div>
      </label>

      <label class="field">
        <span>GitHub repository URL</span>
        <input v-model="form.repoUrl" class="input" placeholder="https://github.com/you/my-awesome-app" />
      </label>

      <label class="field">
        <span>Description</span>
        <textarea v-model="form.description" class="input" rows="2" />
      </label>

      <div class="field">
        <span>Stacks</span>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="stack in KNOWN_STACKS"
            :key="stack"
            type="button"
            class="rounded-full px-2.5 py-1 text-xs font-medium ring-1"
            :class="form.stacks.includes(stack)
              ? 'switch-active ring-blue-500'
              : 'bg-transparent ring-neutral-300 hover:ring-blue-400 dark:ring-neutral-700'"
            @click="toggleStack(stack)"
          >
            {{ stack }}
          </button>
        </div>
      </div>

      <div class="field">
        <span>Icon</span>
        <div class="mb-2 flex gap-1.5">
          <button
            type="button"
            class="icon-mode-btn"
            :class="iconKind === 'none' ? 'icon-mode-active' : ''"
            @click="iconKind = 'none'"
          >
            Default
          </button>
          <button
            type="button"
            class="icon-mode-btn"
            :class="iconKind === 'lucide' ? 'icon-mode-active' : ''"
            @click="iconKind = 'lucide'"
          >
            Lucide
          </button>
          <button
            type="button"
            class="icon-mode-btn"
            :class="iconKind === 'ico' ? 'icon-mode-active' : ''"
            @click="iconKind = 'ico'"
          >
            .ico file
          </button>
        </div>

        <div v-if="iconKind === 'lucide'" class="grid grid-cols-8 gap-1.5">
          <button
            v-for="name in PROJECT_ICON_NAMES"
            :key="name"
            type="button"
            :data-tip="name"
            class="tooltip tooltip-bottom flex items-center justify-center rounded-lg p-2 ring-1"
            :class="iconName === name
              ? 'switch-active ring-blue-500'
              : 'ring-neutral-300 hover:ring-blue-400 dark:ring-neutral-700'"
            @click="iconName = name"
          >
            <component
              :is="PROJECT_ICONS[name]"
              class="h-5 w-5"
              :class="(PROJECT_ICON_COLORS[iconColor] ?? PROJECT_ICON_COLORS.blue).text"
            />
          </button>
        </div>

        <div v-if="iconKind === 'lucide'" class="mt-2 flex items-center gap-2">
          <span class="text-xs font-medium text-neutral-500">Color</span>
          <button
            v-for="colorName in PROJECT_ICON_COLOR_NAMES"
            :key="colorName"
            type="button"
            :data-tip="colorName"
            class="tooltip tooltip-bottom h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900"
            :class="[
              PROJECT_ICON_COLORS[colorName].dot,
              iconColor === colorName ? 'ring-blue-500' : 'ring-transparent',
            ]"
            @click="iconColor = colorName"
          />
        </div>

        <div v-else-if="iconKind === 'ico'">
          <div class="flex items-center gap-3">
            <img
              v-if="!icoSource && icoStored"
              :src="convertFileSrc(icoStored)"
              alt=""
              class="h-10 w-10 shrink-0 rounded"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-neutral-500">
              {{ icoFileLabel }}
            </span>
            <button type="button" class="btn btn-sm shrink-0" @click="browseIco">
              Choose .ico…
            </button>
          </div>
          <p v-if="icoSource" class="mt-1 text-xs text-neutral-500">
            The file will be copied into the app's storage when you save.
          </p>
        </div>
      </div>

      <p v-if="error" class="mb-3 text-sm text-red-600">{{ error }}</p>

      <footer class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Cancel</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? "Saving…" : "Save project" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.field {
  @apply mb-4 block;
}
.field > span {
  @apply mb-1 block text-sm font-medium;
}
.input {
  @apply w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700;
}
.icon-mode-btn {
  @apply rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-neutral-300 hover:ring-blue-400 dark:ring-neutral-700;
}
.icon-mode-active {
  @apply font-bold text-blue-700 ring-2 ring-blue-500 hover:ring-blue-500 dark:text-blue-300;
  text-shadow:
    0 0 7px rgb(59 130 246 / 0.24),
    0 0 2px rgb(59 130 246 / 0.18);
}
</style>
