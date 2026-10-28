<script setup lang="ts">
import { computed, ref } from "vue";
import { FilePlus2, X } from "@lucide/vue";
import { chromeDark } from "../lib/theme";
import { logAction } from "../lib/db";
import { saveDocumentFile } from "../lib/api";
import {
  bytesToBase64,
  createDocumentBytes,
  documentExtension,
  documentLabel,
  type DocumentKind,
} from "../lib/documents";

const props = defineProps<{
  libraryDir: string;
  folder: string;
}>();
const emit = defineEmits<{
  close: [];
  created: [path: string];
}>();

const kind = ref<DocumentKind>("docx");
const name = ref("Untitled document");
const busy = ref(false);
const error = ref("");

const filename = computed(() => {
  const base = name.value.trim() || "Untitled document";
  const ext = documentExtension(kind.value);
  return base.toLowerCase().endsWith(ext) ? base : base + ext;
});
const canCreate = computed(() => !!name.value.trim() && !busy.value);

async function submit() {
  if (!canCreate.value) return;
  busy.value = true;
  error.value = "";
  try {
    const bytes = await createDocumentBytes(kind.value, name.value.trim());
    const path = await saveDocumentFile(
      props.libraryDir,
      props.folder,
      filename.value,
      bytesToBase64(bytes),
    );
    await logAction(
      "created",
      `Created ${documentLabel(kind.value)} document ${path.split(/[\\/]/).pop()}.`,
    ).catch(() => {});
    emit("created", path);
  } catch (e) {
    error.value = String(e);
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div
      class="glass-panel w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <FilePlus2 class="h-5 w-5" /> New document
        </h2>
        <button
          class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </div>

      <p class="mb-4 text-sm text-neutral-500">
        Creates a blank document in
        <strong>{{ folder || "the library root" }}</strong
        >. It opens empty — edit it in Word, Excel, or your PDF viewer
        afterwards (PDFs can't be edited in-app, they're for reading).
      </p>

      <label class="mb-1 block text-sm font-medium">Type</label>
      <div class="mb-4 grid grid-cols-3 gap-2">
        <button
          v-for="k in (['docx', 'xlsx', 'pdf'] as const)"
          :key="k"
          type="button"
          class="rounded-lg border px-3 py-2.5 text-sm font-medium"
          :class="
            kind === k
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
              : 'border-neutral-300 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800'
          "
          @click="kind = k"
        >
          {{ documentLabel(k) }}
        </button>
      </div>

      <label class="mb-1 block text-sm font-medium">Name</label>
      <input
        v-model="name"
        class="mb-1 w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
        placeholder="Untitled document"
        @keyup.enter="submit"
      />
      <p class="mb-4 truncate text-xs text-neutral-500">
        Saved as: <span class="font-mono">{{ filename }}</span>
        <span v-if="folder"> in {{ folder }}</span>
      </p>

      <p
        v-if="error"
        class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
      >
        {{ error }}
      </p>

      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">
          Cancel
        </button>
        <button
          class="btn btn-primary btn-sm"
          :disabled="!canCreate"
          @click="submit"
        >
          {{ busy ? "Creating…" : "Create" }}
        </button>
      </div>
    </div>
  </div>
</template>
