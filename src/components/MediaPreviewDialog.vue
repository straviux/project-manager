<script setup lang="ts">
import { computed, ref } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ExternalLink, Image, X } from "@lucide/vue";
import { chromeDark } from "../lib/theme";
import { openPath } from "../lib/api";
import { fileMediaKind } from "../lib/fileTypes";
import type { LibraryFile } from "../types";
import { useDialogDrag } from "../lib/useDialogDrag";

const props = defineProps<{ file: LibraryFile }>();
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);

const kind = fileMediaKind(props.file.name);
const url = computed(() => convertFileSrc(props.file.path));
</script>

<template>
  <div
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div
      ref="dialogPanel"
      class="glass-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-xl dark:bg-neutral-900"
    >
      <header
        ref="dialogHandle"
        class="flex cursor-grab items-center justify-between gap-2 border-b border-neutral-200 p-4 active:cursor-grabbing dark:border-neutral-800"
      >
        <h2 class="flex min-w-0 items-center gap-2 font-semibold">
          <Image class="h-5 w-5 shrink-0" />
          <span class="truncate">{{ file.name }}</span>
          <span class="shrink-0 text-xs font-normal text-neutral-500">
            Preview
          </span>
        </h2>
        <span class="flex shrink-0 gap-1">
          <button
            class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Open in its own app"
            @click="openPath(file.path)"
          >
            <ExternalLink class="h-5 w-5" />
          </button>
          <button
            class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="emit('close')"
          >
            <X class="h-5 w-5" />
          </button>
        </span>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        <img
          v-if="kind === 'image'"
          :src="url"
          class="mx-auto max-h-[70vh] max-w-full rounded-2xl object-contain shadow"
          :alt="file.name"
        />
        <template v-else-if="kind === 'video'">
          <video
            :src="url"
            class="mx-auto max-h-[70vh] w-full rounded-2xl object-contain shadow"
            controls
            preload="auto"
          />
          <p class="mt-2 text-xs text-neutral-500">
            If the video doesn't play here, use the open button above to
            view it in your media player — some formats (like .mkv or
            .avi) aren't supported by the app's built-in viewer.
          </p>
        </template>
        <p v-else class="text-sm text-neutral-500">
          This file can't be previewed here. Open it in its own app
          instead.
        </p>
      </div>

      <footer
        class="flex justify-end border-t border-neutral-200 p-4 dark:border-neutral-800"
      >
        <button class="btn btn-ghost btn-sm" @click="emit('close')">
          Close
        </button>
      </footer>
    </div>
  </div>
</template>
