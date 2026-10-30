<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { computed, onMounted, ref } from "vue";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { FileText, X } from "@lucide/vue";
import { openUrl, readReadme } from "../lib/api";
import type { Project } from "../types";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const raw = ref<string | null>(null);
const loading = ref(true);

// A README is untrusted content: it can come from any repo the user
// cloned, and marked passes raw HTML straight through. Rendering that
// with v-html unsanitized would let a hostile README run JavaScript inside
// the app window — and that window can call every backend command
// (terminal, file delete, keychain...). DOMPurify strips scripts, event
// handlers and other active content while keeping normal formatting.
const html = computed(() =>
  raw.value
    ? DOMPurify.sanitize(marked.parse(raw.value) as string)
    : "",
);

// Links inside a README used to navigate the whole app window away to
// the linked site. Route them to the real browser instead: http(s) and
// mailto links go through the backend's allowlisted opener, in-page
// (#section) anchors keep working, and anything else (relative links,
// odd schemes) is swallowed so the app never leaves its own page.
function onReadmeLink(event: MouseEvent) {
  const el = event.target as HTMLElement | null;
  const anchor = el?.closest?.("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) return;
  event.preventDefault();
  if (/^(https?:|mailto:)/i.test(href)) {
    openUrl(href).catch(() => {});
  }
}

onMounted(async () => {
  try {
    raw.value = await readReadme(props.project.path);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" :class="{ dark: chromeDark }" @click.self="emit('close')">
    <div ref="dialogPanel" class="glass-panel flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-xl dark:bg-neutral-900">
      <header ref="dialogHandle" class="flex cursor-grab items-center justify-between border-b border-neutral-200 p-4 active:cursor-grabbing dark:border-neutral-800">
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
        <div v-else class="readme-body" v-html="html" @click="onReadmeLink" @auxclick="onReadmeLink" />
      </div>
    </div>
  </div>
</template>
