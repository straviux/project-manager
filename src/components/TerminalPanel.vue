<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ChevronDown, ChevronUp, ClipboardPaste, GripVertical, SquareTerminal, Trash2, X } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { loadTerminalHistory, saveTerminalHistory } from "../lib/terminalHistory";
import { showToast } from "../lib/toast";

export interface TerminalTab {
  id: number;
  projectName: string;
  command: string;
  lines: string[];
  running: boolean;
  exitCode: number | null;
}

const props = defineProps<{
  tabs: TerminalTab[];
  activeTabId: number | null;
  minimized: boolean;
}>();
const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  stopTab: [id: number];
  clearTab: [id: number];
  send: [id: number, input: string];
  minimize: [];
  restore: [];
}>();

const activeTab = computed(
  () => props.tabs.find((t) => t.id === props.activeTabId) ?? null,
);
const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
const outputEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const input = ref("");
const showHelp = ref(false);

watch(
  [() => activeTab.value?.lines.length, () => activeTab.value?.id],
  async () => {
    await nextTick();
    const el = outputEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

/* ------------------------- command history ------------------------ */
// Shared across tabs, persisted in the settings table (see
// terminalHistory.ts). historyIndex -1 means "not navigating": the
// input holds what the user typed. Pressing Up captures that as the
// draft/prefix, filters history (most recent first) to entries
// starting with it, and steps older; Down steps back, and past the
// newest match restores the draft.
const history = ref<string[]>([]);
let historyIndex = -1;
let historyDraft = "";
let historyMatches: string[] = [];

onMounted(async () => {
  history.value = await loadTerminalHistory();
});

// Switching tabs resets navigation, so an Up press in a new tab
// never recalls a half-stepped entry from the old one.
watch(
  () => activeTab.value?.id,
  () => {
    historyIndex = -1;
    historyMatches = [];
  },
);

async function recordHistory(command: string) {
  const trimmed = command.trim();
  if (!trimmed) return;
  if (history.value[history.value.length - 1] === trimmed) return;
  history.value = [...history.value, trimmed];
  try {
    await saveTerminalHistory(history.value);
  } catch {
    // History is a convenience, never a reason to fail a send.
  }
}

function onHistoryUp() {
  if (!history.value.length) return;
  // The user typed something new since the last Up press: restart
  // the search from that new prefix instead of continuing the old one.
  if (historyIndex >= 0 && input.value !== historyMatches[historyIndex]) {
    historyIndex = -1;
  }
  if (historyIndex === -1) {
    historyDraft = input.value;
    const prefix = input.value;
    historyMatches = [...history.value]
      .reverse()
      .filter((h) => h.startsWith(prefix));
    if (!historyMatches.length) return;
    historyIndex = 0;
  } else if (historyIndex < historyMatches.length - 1) {
    historyIndex++;
  }
  input.value = historyMatches[historyIndex];
}

function onHistoryDown() {
  if (historyIndex === -1) return;
  if (historyIndex > 0) {
    historyIndex--;
    input.value = historyMatches[historyIndex];
  } else {
    historyIndex = -1;
    input.value = historyDraft;
  }
}

/* ------------------------- paste + Ctrl+C ------------------------- */
// Pasting used to sometimes leave a stray `~` in the input. The
// usual suspect is a bracketed-paste marker (ESC[200~ … ESC[201~)
// leaking through the webview's native paste path, so paste is now
// handled here instead of left to the browser: markers and control
// characters are stripped, newlines collapse to a space (this is a
// single-line input — a pasted newline must never send the command
// early), and the cleaned text is inserted at the cursor.
function cleanPastedText(raw: string): string {
  return raw
    .replace(/\x1b\[[0-9;?]*[A-Za-z~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n?|\n/g, " ")
    .trim();
}

function insertAtCursor(text: string) {
  const el = inputEl.value;
  if (!el) {
    input.value += text;
    return;
  }
  const start = el.selectionStart ?? input.value.length;
  const end = el.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  nextTick(() => {
    el.focus();
    el.setSelectionRange(start + text.length, start + text.length);
  });
}

function onPaste(e: ClipboardEvent) {
  const raw = e.clipboardData?.getData("text");
  if (raw == null) return;
  e.preventDefault();
  const cleaned = cleanPastedText(raw);
  if (cleaned) insertAtCursor(cleaned);
}

// Fallback when Ctrl+V itself is blocked in the webview: the Paste
// button reads the clipboard directly. If that read is also blocked,
// say so instead of silently doing nothing.
async function pasteFromClipboard() {
  try {
    const raw = await navigator.clipboard.readText();
    const cleaned = cleanPastedText(raw);
    if (cleaned) insertAtCursor(cleaned);
  } catch {
    showToast(
      "Clipboard read was blocked — paste with Ctrl+V instead.",
      "error",
    );
  }
}

// Ctrl+C in a real terminal interrupts the running command; in a
// web input it only copies. So: copying a selection still copies,
// but Ctrl+C with nothing selected stops the running tab, like a
// terminal. Attached to the panel, so it works whether the input
// or the output area has focus.
function onPanelKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "c") return;
  const tab = activeTab.value;
  if (!tab?.running) return;
  const el = inputEl.value;
  if (
    el &&
    document.activeElement === el &&
    el.selectionStart !== el.selectionEnd
  )
    return;
  if (window.getSelection()?.toString()) return;
  e.preventDefault();
  emit("stopTab", tab.id);
}

function send() {
  const tab = activeTab.value;
  const value = input.value;
  if (!tab || !value.trim() || !tab.running) return;
  historyIndex = -1;
  historyMatches = [];
  input.value = "";
  void recordHistory(value);
  emit("send", tab.id, value);
}
</script>

<template>
  <!-- Minimized: a slim floating bar at bottom-left (toasts live at
       bottom-right, so they never overlap it). Processes keep running. -->
  <div
    v-if="minimized"
    class="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-2xl bg-neutral-900/85 px-3 py-2 text-neutral-200 backdrop-blur-xl shadow-2xl ring-1 ring-white/10"
    aria-label="Minimized terminal"
  >
    <SquareTerminal class="h-4 w-4 shrink-0" />
    <span class="text-sm font-medium">Terminal</span>
    <span class="text-xs text-neutral-400">
      {{ tabs.length }} tab{{ tabs.length === 1 ? "" : "s" }}
      <span v-if="activeTab">— {{ activeTab.projectName }}</span>
    </span>
    <span class="ml-2 flex items-center gap-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="truncate rounded px-2 py-1 text-xs hover:bg-white/10"
        :class="tab.id === activeTabId ? 'text-white' : 'text-neutral-400'"
        @click="emit('selectTab', tab.id); emit('restore')"
      >
        {{ tab.projectName }}
      </button>
      <button
        class="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
        title="Restore terminal"
        @click="emit('restore')"
      >
        <ChevronUp class="h-4 w-4" />
      </button>
    </span>
  </div>

  <!-- Floating, modal-style: a centered panel that does NOT block
       the app behind it (no backdrop dim, overlay is
       pointer-events-none, panel itself is pointer-events-auto),
       so a long-running command can stay open while you use the
       app. Drag it by the header, like every other dialog. -->
  <div
    v-else
    class="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4"
    aria-label="Internal terminal"
  >
    <div
      ref="dialogPanel"
      class="pointer-events-auto flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-neutral-900/85 text-neutral-200 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
      @keydown="onPanelKeydown"
    >
      <header
        ref="dialogHandle"
        class="flex cursor-grab items-center gap-2 border-b border-white/10 px-3 py-2 active:cursor-grabbing"
      >
        <GripVertical class="h-4 w-4 shrink-0 text-neutral-500" />
        <SquareTerminal class="h-4 w-4 shrink-0" />
        <span class="text-sm font-medium">Terminal</span>
        <span class="text-xs text-neutral-400">
          {{ tabs.length }} tab{{ tabs.length === 1 ? "" : "s" }}
        </span>
        <span class="ml-auto flex items-center gap-1">
          <button
            class="tooltip tooltip-bottom flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-neutral-300 hover:bg-white/20 hover:text-white"
            :class="showHelp ? 'bg-white/20 text-white' : ''"
            data-tip="About this terminal"
            aria-label="About this terminal"
            @click="showHelp = !showHelp"
          >
            ?
          </button>
          <button
            class="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
            title="Minimize terminal (keeps running)"
            @click="emit('minimize')"
          >
            <ChevronDown class="h-4 w-4" />
          </button>
        </span>
      </header>

      <!-- Help, hidden by default: the v1 note used to be a permanent
           paragraph at the bottom of the panel. -->
      <div
        v-if="showHelp"
        class="flex items-start gap-2 border-b border-white/10 bg-white/5 px-3 py-2 text-xs leading-relaxed text-neutral-300"
      >
        <span class="flex-1">
          Floating terminal, v1: output is piped lines, not a full
          terminal emulator — programs that need a real terminal
          (password prompts, interactive menus) will not work here. Drag
          the header to move it; minimizing keeps commands running;
          closing a tab stops its command. Ctrl+C stops the running
          command (when nothing is selected), Ctrl+V pastes, and
          Up/Down recalls saved command history — type a prefix first
          to search it. Esc does not close it, so a running command is
          never stopped by accident.
        </span>
        <button
          class="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
          title="Hide help"
          aria-label="Hide help"
          @click="showHelp = false"
        >
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <!-- Tab bar: one tab per run command, new runs add a tab. -->
      <div class="flex items-center gap-1 border-b border-white/10 px-2 pt-2">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex min-w-0 max-w-56 items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs"
          :class="
            tab.id === activeTabId
              ? 'bg-white/10 text-white'
              : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-100'
          "
          @click="emit('selectTab', tab.id)"
        >
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="tab.running ? 'bg-emerald-400' : 'bg-neutral-500'"
          />
          <span class="truncate">{{ tab.projectName }} — {{ tab.command }}</span>
          <span
            class="shrink-0 rounded p-0.5 hover:bg-white/20"
            title="Stop and close this tab"
            @click.stop="emit('closeTab', tab.id)"
          >
            <X class="h-3 w-3" />
          </span>
        </button>
        <span class="ml-auto flex shrink-0 items-center gap-1 pb-1">
          <button
            v-if="activeTab?.running"
            class="rounded bg-red-500/90 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500"
            @click="activeTab && emit('stopTab', activeTab.id)"
          >
            Stop
          </button>
          <button
            v-if="activeTab"
            class="rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
            title="Clear output"
            @click="emit('clearTab', activeTab.id)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </span>
      </div>

      <div
        v-if="activeTab"
        ref="outputEl"
        class="h-80 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        <div
          v-for="(line, i) in activeTab.lines"
          :key="i"
          class="whitespace-pre-wrap break-words"
        >
          {{ line }}
        </div>
        <div v-if="!activeTab.lines.length" class="text-neutral-500">
          No output yet.
        </div>
      </div>
      <div v-else class="px-3 py-4 text-sm text-neutral-500">
        No terminal tabs — run a project to open one.
      </div>

      <div
        v-if="activeTab"
        class="flex items-center gap-2 border-t border-white/10 px-3 py-2"
      >
        <span class="shrink-0 font-mono text-xs text-emerald-400">&gt;</span>
        <input
          ref="inputEl"
          v-model="input"
          class="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-neutral-500"
          :disabled="!activeTab.running"
          :placeholder="
            activeTab.running
              ? 'Type input, Enter to send — Up/Down for history, Ctrl+C stops'
              : 'No command running in this tab'
          "
          @keyup.enter="send"
          @keydown.up.prevent="onHistoryUp"
          @keydown.down.prevent="onHistoryDown"
          @paste="onPaste"
        />
        <button
          v-if="activeTab.running"
          class="shrink-0 rounded p-1 text-neutral-400 hover:bg-white/10 hover:text-neutral-100"
          title="Paste from clipboard"
          aria-label="Paste from clipboard"
          @click="pasteFromClipboard"
        >
          <ClipboardPaste class="h-4 w-4" />
        </button>
        <span class="shrink-0 text-xs text-neutral-500">
          {{
            activeTab.running
              ? "Running…"
              : activeTab.exitCode === null
                ? "Stopped"
                : `Exited (${activeTab.exitCode})`
          }}
        </span>
      </div>
    </div>
  </div>
</template>
