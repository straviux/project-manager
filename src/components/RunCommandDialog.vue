<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { ref, watch } from "vue";
import { Play, X } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";

const props = defineProps<{
  projectName: string;
  /** Prefilled command: saved command, else the README find, else "". */
  initialCommand: string;
  /** Where the prefill came from, for the helper text. */
  source: "saved" | "readme" | "none";
  /** The README find, for "Reset to README" (null when there is none). */
  readmeCommand: string | null;
}>();
const emit = defineEmits<{
  close: [];
  run: [command: string];
}>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const command = ref(props.initialCommand);
watch(
  () => props.initialCommand,
  (v) => {
    command.value = v;
  },
);

function run() {
  const cmd = command.value.trim();
  if (!cmd) return;
  emit("run", cmd);
}
</script>

<template>
  <div
    class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div
      ref="dialogPanel"
      class="glass-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900"
    >
      <header
        ref="dialogHandle"
        class="mb-4 flex cursor-grab items-center justify-between active:cursor-grabbing"
      >
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <Play class="h-5 w-5" /> Run {{ projectName }}
        </h2>
        <button
          class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="emit('close')"
        >
          <X class="h-5 w-5" />
        </button>
      </header>

      <label class="mb-2 block">
        <span class="mb-1 block text-sm font-medium">Run command</span>
        <input
          v-model="command"
          class="w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 font-mono text-sm outline-none focus:border-blue-500 dark:border-neutral-700"
          placeholder="npm run tauri dev"
          @keyup.enter="run"
        />
      </label>
      <p class="mb-4 text-xs text-neutral-500">
        <template v-if="source === 'saved'">
          Saved for this project — edit it here, it is saved again when you
          run.
        </template>
        <template v-else-if="source === 'readme'">
          Found in README.md — edit it here, it is saved for this project
          when you run.
        </template>
        <template v-else>
          No run command found in README.md — type one, it is saved for
          this project when you run.
        </template>
      </p>

      <div class="flex items-center justify-between">
        <button
          v-if="readmeCommand && command !== readmeCommand"
          class="text-sm font-medium text-neutral-500 hover:underline dark:text-neutral-400"
          @click="command = readmeCommand"
        >
          Reset to README
        </button>
        <span v-else></span>
        <span class="flex gap-2">
          <button class="btn btn-ghost btn-sm" @click="emit('close')">
            Cancel
          </button>
          <button
            class="btn btn-primary btn-sm"
            :disabled="!command.trim()"
            @click="run"
          >
            Run
          </button>
        </span>
      </div>
    </div>
  </div>
</template>
