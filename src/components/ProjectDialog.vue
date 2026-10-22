<script setup lang="ts">
import { reactive, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X } from "lucide-vue-next";
import { createProject, updateProject } from "../lib/db";
import { detectStacks } from "../lib/api";
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

async function browse() {
  const picked = await open({ directory: true, multiple: false });
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
    if (props.project) await updateProject(props.project.id, draft);
    else await createProject(draft);
    emit("saved");
  } catch (e) {
    error.value = String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
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
          <button class="btn-secondary shrink-0" @click="browse">
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
              ? 'bg-blue-600 text-white ring-blue-600'
              : 'bg-transparent ring-neutral-300 hover:ring-blue-400 dark:ring-neutral-700'"
            @click="toggleStack(stack)"
          >
            {{ stack }}
          </button>
        </div>
      </div>

      <p v-if="error" class="mb-3 text-sm text-red-600">{{ error }}</p>

      <footer class="flex justify-end gap-2">
        <button class="btn-secondary" @click="emit('close')">Cancel</button>
        <button class="btn-primary" :disabled="saving" @click="save">
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
.btn-primary {
  @apply rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40;
}
.btn-secondary {
  @apply rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700;
}
</style>
