<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { computed, ref } from "vue";
import { Copy, FolderInput, FolderOpen, Move, X } from "@lucide/vue";
import { open } from "@tauri-apps/plugin-dialog";
import { pickerDefaultPath } from "../lib/paths";
import type { ImportResult } from "../lib/api";
import { useDialogDrag } from "../lib/useDialogDrag";

export type FolderImporter = (
  source: string,
  name: string,
  mode: "move" | "copy",
  parentDir: string,
) => Promise<ImportResult>;

const props = defineProps<{
  parentDir: string;
  title: string;
  parentLabel: string;
  importer: FolderImporter;
}>();
const emit = defineEmits<{
  close: [];
  imported: [warning: string | null, path?: string];
}>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);

const source = ref("");
const name = ref("");
const mode = ref<"copy" | "move">("copy");
const busy = ref(false);
const error = ref("");

const sep = computed(() => (props.parentDir.includes("\\") ? "\\" : "/"));
const destPreview = computed(() => {
  const n = name.value.trim();
  return n
    ? `${props.parentDir}${sep.value}${n}`
    : `${props.parentDir}${sep.value}…`;
});
const canImport = computed(
  () => !!source.value && !!name.value.trim() && !busy.value,
);

async function pick() {
  const picked = await open({
    directory: true,
    multiple: false,
    defaultPath: await pickerDefaultPath(),
    title: "Choose a folder to import",
  });
  if (typeof picked === "string") {
    source.value = picked;
    name.value =
      picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? name.value;
  }
}

async function submit() {
  if (!canImport.value) return;
  busy.value = true;
  error.value = "";
  try {
    const res = await props.importer(
      source.value,
      name.value.trim(),
      mode.value,
      props.parentDir,
    );
    emit("imported", res.warning, res.path);
  } catch (e) {
    error.value = String(e);
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div
      ref="dialogPanel"
      class="glass-panel w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-neutral-900"
    >
      <div ref="dialogHandle" class="mb-4 flex cursor-grab items-center justify-between active:cursor-grabbing">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <FolderInput class="h-5 w-5" /> {{ title }}
        </h2>
        <button
          class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <label class="mb-1 block text-sm font-medium">Folder to import</label>
      <div class="mb-4 flex gap-2">
        <input
          :value="source"
          readonly
          placeholder="No folder chosen"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
        />
        <button
          class="flex shrink-0 items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          @click="pick"
        >
          <FolderOpen class="h-4 w-4" /> Choose…
        </button>
      </div>

      <label class="mb-1 block text-sm font-medium">
        Folder name in your {{ parentLabel }}
      </label>
      <input
        v-model="name"
        placeholder="folder-name"
        class="mb-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      />
      <p class="mb-4 truncate text-xs text-neutral-500">
        Destination: <span class="font-mono">{{ destPreview }}</span>
      </p>

      <label class="mb-1 block text-sm font-medium">How to import</label>
      <div class="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          :class="[
            'rounded-lg border px-3 py-2.5 text-left',
            mode === 'copy'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800',
          ]"
          @click="mode = 'copy'"
        >
          <span class="flex items-center gap-1.5 text-sm font-medium">
            <Copy class="h-4 w-4" /> Copy
          </span>
          <span class="mt-0.5 block text-xs text-neutral-500">
            Duplicate the folder; the original stays where it is.
          </span>
        </button>
        <button
          type="button"
          :class="[
            'rounded-lg border px-3 py-2.5 text-left',
            mode === 'move'
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800',
          ]"
          @click="mode = 'move'"
        >
          <span class="flex items-center gap-1.5 text-sm font-medium">
            <Move class="h-4 w-4" /> Move
          </span>
          <span class="mt-0.5 block text-xs text-neutral-500">
            Relocate the folder; the original location is emptied.
          </span>
        </button>
      </div>
      <p
        v-if="mode === 'move'"
        class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        If files inside the folder are open (editor, terminal, running app),
        the move can fail partway — close them first, or use Copy instead.
      </p>

      <p
        v-if="error"
        class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
      >
        {{ error }}
      </p>

      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Cancel</button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="!canImport"
          @click="submit"
        >
          {{ busy ? "Importing…" : "Import" }}
        </button>
      </div>
    </div>
  </div>
</template>
