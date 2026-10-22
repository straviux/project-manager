<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { marked } from "marked";
import { FileText, X } from "@lucide/vue";
import { readReadme } from "../lib/api";
import type { Project } from "../types";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: [] }>();

const raw = ref<string | null>(null);
const loading = ref(true);

// The README comes from the user's own local project, so rendering it as
// HTML is acceptable here. For untrusted content, sanitize first.
const html = computed(() =>
  raw.value ? (marked.parse(raw.value) as string) : "",
);

onMounted(async () => {
  try {
    raw.value = await readReadme(props.project.path);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div class="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-xl dark:bg-neutral-900">
      <header class="flex items-center justify-between border-b border-neutral-200 p-4 dark:border-neutral-800">
        <h2 class="flex items-center gap-2 font-semibold">
          <FileText class="h-5 w-5" /> {{ project.name }} — README.md
        </h2>
        <button class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </header>
      <div class="overflow-y-auto p-6">
        <p v-if="loading" class="text-sm text-neutral-500">Loading…</p>
        <p v-else-if="!raw" class="text-sm text-neutral-500">
          This project doesn't have a README.md yet.
        </p>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="readme-body" v-html="html" />
      </div>
    </div>
  </div>
</template>
