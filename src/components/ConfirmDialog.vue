<script setup lang="ts">
import { TriangleAlert } from "@lucide/vue";
import { chromeDark } from "../lib/theme";

defineProps<{
  title: string;
  message: string;
  confirmLabel?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('cancel')"
  >
    <div class="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 class="mb-2 flex items-center gap-2 text-lg font-semibold">
        <TriangleAlert class="h-5 w-5 shrink-0 text-red-500" /> {{ title }}
      </h2>
      <p class="mb-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{{ message }}</p>
      <div class="flex justify-end gap-2">
        <button
          class="rounded-lg bg-neutral-100 px-3 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          @click="emit('cancel')"
        >
          Cancel
        </button>
        <button
          class="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
          @click="emit('confirm')"
        >
          {{ confirmLabel ?? "Delete" }}
        </button>
      </div>
    </div>
  </div>
</template>
