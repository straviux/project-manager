<script setup lang="ts">
import { ref } from "vue";
import { TriangleAlert } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";
import { chromeDark } from "../lib/theme";

defineProps<{
  title: string;
  message: string;
  confirmLabel?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("cancel"));
</script>

<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('cancel')"
  >
    <div ref="dialogPanel" class="glass-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="dialogHandle" class="mb-2 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
        <TriangleAlert class="h-5 w-5 shrink-0 text-red-500" /> {{ title }}
      </h2>
      <p class="mb-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300">{{ message }}</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="emit('cancel')">Cancel</button>
        <button class="btn btn-error btn-sm" @click="emit('confirm')">
          {{ confirmLabel ?? "Delete" }}
        </button>
      </div>
    </div>
  </div>
</template>
