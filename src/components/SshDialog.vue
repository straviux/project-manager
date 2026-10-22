<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { KeyRound, Play, Trash2, X } from "lucide-vue-next";
import {
  deleteSshConfig,
  listSshConfigs,
  saveSshConfig,
} from "../lib/db";
import { openSshTerminal } from "../lib/api";
import type { Project, SshConfig, SshConfigDraft } from "../types";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: [] }>();

const configs = ref<SshConfig[]>([]);
const error = ref<string | null>(null);
const form = reactive<SshConfigDraft>({
  projectId: props.project.id,
  name: "",
  host: "",
  username: "",
  port: 22,
  identityFile: "",
});

async function refresh() {
  configs.value = await listSshConfigs(props.project.id);
}
onMounted(refresh);

async function save() {
  error.value = null;
  try {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      throw new Error("Name, host and username are required.");
    }
    await saveSshConfig({
      projectId: props.project.id,
      name: form.name.trim(),
      host: form.host.trim(),
      username: form.username.trim(),
      port: Number(form.port) || 22,
      identityFile: form.identityFile?.trim() ? form.identityFile.trim() : null,
    });
    form.name = "";
    form.host = "";
    form.username = "";
    form.port = 22;
    form.identityFile = "";
    await refresh();
  } catch (e) {
    error.value = String(e);
  }
}

async function connect(config: SshConfig) {
  error.value = null;
  try {
    await openSshTerminal(config);
  } catch (e) {
    error.value = String(e);
  }
}

async function remove(id: number) {
  await deleteSshConfig(id);
  await refresh();
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" @click.self="emit('close')">
    <div class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
      <header class="mb-4 flex items-center justify-between">
        <h2 class="flex items-center gap-2 text-lg font-semibold">
          <KeyRound class="h-5 w-5" /> SSH — {{ project.name }}
        </h2>
        <button class="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </header>

      <ul class="mb-6 space-y-2">
        <li
          v-for="config in configs"
          :key="config.id"
          class="flex items-center justify-between rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ config.name }}</p>
            <p class="truncate font-mono text-xs text-neutral-500">
              {{ config.username }}@{{ config.host }}:{{ config.port }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <button class="rounded bg-blue-600 p-2 text-white" title="Connect" @click="connect(config)">
              <Play class="h-4 w-4" />
            </button>
            <button class="rounded p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950" title="Delete profile" @click="remove(config.id)">
              <Trash2 class="h-4 w-4" />
            </button>
          </div>
        </li>
        <li v-if="!configs.length" class="text-sm text-neutral-500">
          No saved connections yet.
        </li>
      </ul>

      <h3 class="mb-2 text-sm font-semibold">New connection profile</h3>
      <div class="grid grid-cols-2 gap-3">
        <input v-model="form.name" class="input" placeholder="Profile name (e.g. Production)" />
        <input v-model="form.host" class="input" placeholder="Host (e.g. example.com)" />
        <input v-model="form.username" class="input" placeholder="Username" />
        <input v-model.number="form.port" class="input" type="number" placeholder="Port (22)" />
        <input v-model="form.identityFile" class="input col-span-2" placeholder="Identity file (optional, e.g. ~/.ssh/id_ed25519)" />
      </div>
      <p class="mt-2 text-xs text-neutral-500">
        Only connection details are saved — never passwords. Authentication
        uses your SSH keys / agent.
      </p>

      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <footer class="mt-4 flex justify-end gap-2">
        <button class="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium hover:bg-neutral-200 dark:bg-neutral-800" @click="emit('close')">
          Close
        </button>
        <button class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white" @click="save">
          Save profile
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.input {
  @apply w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-neutral-700;
}
</style>
