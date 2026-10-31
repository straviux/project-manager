<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { SquareTerminal, Trash2, X } from "@lucide/vue";

const props = defineProps<{
  projectName: string;
  command: string;
  lines: string[];
  running: boolean;
  exitCode: number | null;
}>();
const emit = defineEmits<{
  close: [];
  stop: [];
  clear: [];
  send: [input: string];
}>();

const outputEl = ref<HTMLElement | null>(null);
const input = ref("");

watch(
  () => props.lines.length,
  async () => {
    await nextTick();
    const el = outputEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function send() {
  const value = input.value;
  if (!value.trim() || !props.running) return;
  input.value = "";
  emit("send", value);
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
      <header class="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <SquareTerminal class="h-4 w-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">
          {{ projectName }} — {{ command }}
        </span>
        <span
          class="shrink-0 text-xs"
          :class="running ? 'text-emerald-400' : 'text-neutral-400'"
        >
          {{
            running
              ? "Running…"
              : exitCode === null
                ? "Stopped"
                : `Exited (${exitCode})`
          }}
        </span>
        <button
          v-if="running"
          class="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500"
          @click="emit('stop')"
        >
          Stop
        </button>
        <button
          class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          title="Clear output"
          @click="emit('clear')"
        >
          <Trash2 class="h-4 w-4" />
        </button>
        <button
          class="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          title="Stop and close terminal"
          @click="emit('close')"
        >
          <X class="h-4 w-4" />
        </button>
      </header>
      <div
        ref="outputEl"
        class="max-h-64 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        <div
          v-for="(line, i) in lines"
          :key="i"
          class="whitespace-pre-wrap break-words"
        >
          {{ line }}
        </div>
        <div v-if="!lines.length" class="text-neutral-500">
          No output yet.
        </div>
      </div>
      <div class="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
        <span class="shrink-0 font-mono text-xs text-emerald-400">&gt;</span>
        <input
          v-model="input"
          class="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-neutral-500"
          :disabled="!running"
          :placeholder="
            running
              ? 'Type input for the running command, press Enter to send'
              : 'No command running'
          "
          @keyup.enter="send"
        />
      </div>
    </div>
    <p class="mt-1 text-xs text-neutral-500">
      Internal terminal, v1: output is piped lines, not a full terminal
      emulator — programs that need a real terminal (password prompts,
      interactive menus) will not work here. Closing the panel stops the
      command.
    </p>
  </section>
</template>
