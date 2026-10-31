<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown, ChevronUp, SquareTerminal, Trash2, X } from "@lucide/vue";

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
const outputEl = ref<HTMLElement | null>(null);
const input = ref("");

watch(
  [() => activeTab.value?.lines.length, () => activeTab.value?.id],
  async () => {
    await nextTick();
    const el = outputEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function send() {
  const tab = activeTab.value;
  const value = input.value;
  if (!tab || !value.trim() || !tab.running) return;
  input.value = "";
  emit("send", tab.id, value);
}
</script>

<template>
  <section
    class="mx-auto w-full max-w-6xl px-6 pb-2"
    aria-label="Internal terminal"
  >
    <div
      class="overflow-hidden rounded-2xl bg-neutral-950 text-neutral-100 ring-1 ring-neutral-800"
    >
      <!-- Minimized: a slim bar, processes keep running. -->
      <div
        v-if="minimized"
        class="flex items-center gap-2 px-3 py-2"
      >
        <SquareTerminal class="h-4 w-4 shrink-0" />
        <span class="text-sm font-medium">Terminal</span>
        <span class="text-xs text-neutral-400">
          {{ tabs.length }} tab{{ tabs.length === 1 ? "" : "s" }}
          <span v-if="activeTab">— {{ activeTab.projectName }}</span>
        </span>
        <span class="ml-auto flex items-center gap-1">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="truncate rounded px-2 py-1 text-xs hover:bg-neutral-800"
            :class="tab.id === activeTabId ? 'text-white' : 'text-neutral-400'"
            @click="emit('selectTab', tab.id); emit('restore')"
          >
            {{ tab.projectName }}
          </button>
          <button
            class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            title="Restore terminal"
            @click="emit('restore')"
          >
            <ChevronUp class="h-4 w-4" />
          </button>
        </span>
      </div>

      <template v-else>
        <!-- Tab bar: one tab per run command, new runs add a tab. -->
        <div class="flex items-center gap-1 border-b border-neutral-800 px-2 pt-2">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="flex min-w-0 max-w-56 items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-xs"
            :class="
              tab.id === activeTabId
                ? 'bg-neutral-800 text-white'
                : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100'
            "
            @click="emit('selectTab', tab.id)"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="tab.running ? 'bg-emerald-400' : 'bg-neutral-500'"
            />
            <span class="truncate">{{ tab.projectName }} — {{ tab.command }}</span>
            <span
              class="shrink-0 rounded p-0.5 hover:bg-neutral-700"
              title="Stop and close this tab"
              @click.stop="emit('closeTab', tab.id)"
            >
              <X class="h-3 w-3" />
            </span>
          </button>
          <span class="ml-auto flex shrink-0 items-center gap-1 pb-1">
            <button
              v-if="activeTab?.running"
              class="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500"
              @click="activeTab && emit('stopTab', activeTab.id)"
            >
              Stop
            </button>
            <button
              v-if="activeTab"
              class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              title="Clear output"
              @click="emit('clearTab', activeTab.id)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
            <button
              class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
              title="Minimize terminal (keeps running)"
              @click="emit('minimize')"
            >
              <ChevronDown class="h-4 w-4" />
            </button>
          </span>
        </div>

        <div
          v-if="activeTab"
          ref="outputEl"
          class="max-h-64 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
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
          class="flex items-center gap-2 border-t border-neutral-800 px-3 py-2"
        >
          <span class="shrink-0 font-mono text-xs text-emerald-400">&gt;</span>
          <input
            v-model="input"
            class="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-neutral-500"
            :disabled="!activeTab.running"
            :placeholder="
              activeTab.running
                ? 'Type input for the running command, press Enter to send'
                : 'No command running in this tab'
            "
            @keyup.enter="send"
          />
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
      </template>
    </div>
    <p v-if="!minimized" class="mt-1 text-xs text-neutral-500">
      Internal terminal, v1: output is piped lines, not a full terminal
      emulator — programs that need a real terminal (password prompts,
      interactive menus) will not work here. Minimizing keeps commands
      running; closing a tab stops its command.
    </p>
  </section>
</template>
