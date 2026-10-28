<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ExternalLink, FileText, X } from "@lucide/vue";
import { chromeDark } from "../lib/theme";
import { convertOfficeToPdf, openPath } from "../lib/api";
import {
  documentKind,
  fetchLibraryFile,
  previewDocx,
  previewXlsx,
  type XlsxSheet,
} from "../lib/documents";
import type { LibraryFile } from "../types";
import { useDialogDrag } from "../lib/useDialogDrag";

const props = defineProps<{ file: LibraryFile }>();
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);

const kind = documentKind(props.file.name);
const loading = ref(true);
const error = ref<string | null>(null);
const docxHtml = ref("");
const convertedPdfUrl = ref<string | null>(null);
const sheets = ref<XlsxSheet[]>([]);
const activeSheet = ref(0);
const pdfUrl = computed(() =>
  kind === "office"
    ? (convertedPdfUrl.value ?? "")
    : convertFileSrc(props.file.path),
);

onMounted(async () => {
  if (!kind) {
    error.value =
      "This kind of document can't be previewed here yet. Open it in its own app instead.";
    loading.value = false;
    return;
  }
  try {
    if (kind === "pdf") {
      // The webview renders PDFs itself (iframe below); nothing to parse.
    } else if (kind === "office") {
      // Convert with Microsoft Office (assumed installed), then show
      // the cached PDF in the same iframe as a native PDF.
      const pdfPath = await convertOfficeToPdf(props.file.path);
      convertedPdfUrl.value = convertFileSrc(pdfPath);
    } else {
      const buffer = await fetchLibraryFile(props.file.path);
      if (kind === "docx") docxHtml.value = await previewDocx(buffer);
      else sheets.value = await previewXlsx(buffer);
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
});
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
          <FileText class="h-5 w-5 shrink-0" />
          <span class="truncate">{{ file.name }}</span>
          <span class="shrink-0 text-xs font-normal text-neutral-500">
            Preview — read-only
          </span>
        </h2>
        <span class="flex shrink-0 gap-1">
          <button
            class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            title="Open in its own app (Word, Excel, or your PDF viewer)"
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
        <p v-if="loading" class="text-sm text-neutral-500">{{ kind === "office" ? "Converting with Microsoft Office… first preview of a file takes a few seconds, later ones reuse the cached PDF." : "Loading preview…" }}</p>
        <p
          v-else-if="error"
          class="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {{ error }}
        </p>

        <template v-else-if="kind === 'pdf' || kind === 'office'">
          <iframe
            :src="pdfUrl"
            class="h-[70vh] w-full rounded-2xl ring-1 ring-neutral-200 dark:ring-neutral-800"
            title="PDF preview"
          />
          <p class="mt-2 text-xs text-neutral-500">
            {{
              kind === "office"
                ? "Converted to PDF with Microsoft Office for preview — open the file to edit it in Office."
                : "If the PDF doesn't show here, use the open button above to view it in your PDF viewer."
            }}
          </p>
        </template>

        <template v-else-if="kind === 'docx'">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="readme-body" v-html="docxHtml" />
          <p class="mt-4 text-xs text-neutral-500">
            Word preview shows text and tables. Fancy formatting may look
            simpler here than in Word — open the file to see it exactly.
          </p>
        </template>

        <template v-else-if="kind === 'xlsx'">
          <div v-if="sheets.length > 1" class="mb-3 flex flex-wrap gap-1.5">
            <button
              v-for="(sheet, i) in sheets"
              :key="sheet.name"
              class="rounded-lg px-3 py-1.5 text-sm font-medium"
              :class="
                i === activeSheet
                  ? 'bg-blue-600 text-white'
                  : 'bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700'
              "
              @click="activeSheet = i"
            >
              {{ sheet.name }}
            </button>
          </div>
          <div
            v-if="sheets[activeSheet]"
            class="overflow-x-auto rounded-2xl ring-1 ring-neutral-200 dark:ring-neutral-800"
          >
            <table class="w-full text-sm">
              <tbody>
                <tr
                  v-for="(row, ri) in sheets[activeSheet].rows"
                  :key="ri"
                  class="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                  :class="ri === 0 ? 'bg-neutral-50 font-medium dark:bg-neutral-800/60' : ''"
                >
                  <td
                    v-for="(cell, ci) in row"
                    :key="ci"
                    class="whitespace-nowrap px-3 py-1.5"
                  >
                    {{ cell }}
                  </td>
                  <td v-if="!row.length" class="px-3 py-1.5">&nbsp;</td>
                </tr>
              </tbody>
            </table>
            <p
              v-if="!sheets[activeSheet].rows.length"
              class="px-3 py-4 text-sm text-neutral-500"
            >
              This sheet is empty.
            </p>
          </div>
          <p
            v-if="sheets[activeSheet]?.truncated"
            class="mt-2 text-xs text-neutral-500"
          >
            Showing the first 500 rows — open the file in Excel for the rest.
          </p>
          <p class="mt-2 text-xs text-neutral-500">
            Excel preview shows values, not live formulas. Open the file in
            Excel to edit it.
          </p>
        </template>
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
