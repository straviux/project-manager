<script setup lang="ts">
import { AlertCircle, CheckCircle2, X } from "@lucide/vue";
import { dismissToast, toasts } from "../lib/toast";
</script>

<template>
  <div
    class="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm flex-col gap-2"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-xl ring-1"
      :class="
        toast.kind === 'error'
          ? 'bg-red-600 text-white ring-red-700'
          : 'bg-neutral-900 text-neutral-100 ring-neutral-700'
      "
      @click="dismissToast(toast.id)"
    >
      <CheckCircle2
        v-if="toast.kind === 'success'"
        class="mt-0.5 h-4 w-4 shrink-0 text-green-400"
      />
      <AlertCircle v-else class="mt-0.5 h-4 w-4 shrink-0" />
      <span class="min-w-0 flex-1 leading-snug">{{ toast.message }}</span>
      <button
        class="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        @click.stop="dismissToast(toast.id)"
      >
        <X class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
