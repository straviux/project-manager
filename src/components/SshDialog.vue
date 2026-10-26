<script setup lang="ts">
import { chromeDark } from "../lib/theme";
import { onMounted, reactive, ref } from "vue";
import { Check, KeyRound, Play, Trash2, X } from "@lucide/vue";
import {
  deleteSshConfig,
  listSshConfigs,
  saveSshConfig,
} from "../lib/db";
import {
  openSshTerminal,
  sshCopyPassword,
  sshDeletePassword,
  sshHasPassword,
  sshSetPassword,
} from "../lib/api";
import type { Project, SshConfig, SshConfigDraft } from "../types";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: [] }>();

const configs = ref<SshConfig[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const hasPassword = ref<Record<number, boolean>>({});
const passwordInputs = reactive<Record<number, string>>({});
const openPwForm = ref<number | null>(null);

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
  const states: Record<number, boolean> = {};
  for (const config of configs.value) {
    states[config.id] = await sshHasPassword(config.id).catch(() => false);
  }
  hasPassword.value = states;
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
  notice.value = null;
  try {
    if (hasPassword.value[config.id]) {
      await sshCopyPassword(config.id);
      notice.value = `Password for "${config.name}" copied — paste it at the ssh password prompt (it clears from the clipboard after 60 seconds).`;
    }
    await openSshTerminal(config);
  } catch (e) {
    error.value = String(e);
  }
}

function togglePwForm(config: SshConfig) {
  openPwForm.value = openPwForm.value === config.id ? null : config.id;
}

async function savePassword(config: SshConfig) {
  const password = passwordInputs[config.id];
  if (!password) return;
  error.value = null;
  try {
    await sshSetPassword(config.id, password);
    // The backend already read the password back, but confirm from this
    // side too before claiming success — a stale badge is how this bug
    // hid in the first place.
    const verified = await sshHasPassword(config.id).catch(() => false);
    if (!verified) {
      throw new Error(
        "The keychain did not confirm the saved password. It may not actually be stored — check Windows Credential Manager for an entry named like ssh-config-<id>.dev.straviux.projectmanager.",
      );
    }
    passwordInputs[config.id] = "";
    hasPassword.value[config.id] = true;
    openPwForm.value = null;
    notice.value = `Password for "${config.name}" saved in your OS keychain.`;
  } catch (e) {
    error.value = String(e);
  }
}

async function removePassword(config: SshConfig) {
  error.value = null;
  try {
    await sshDeletePassword(config.id);
    hasPassword.value[config.id] = false;
    notice.value = `Password for "${config.name}" removed from the keychain.`;
  } catch (e) {
    error.value = String(e);
  }
}

async function remove(id: number) {
  await sshDeletePassword(id).catch(() => {});
  await deleteSshConfig(id);
  await refresh();
}
</script>

<template>
  <div class="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" :class="{ dark: chromeDark }" @click.self="emit('close')">
    <div class="glass-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
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
          class="rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-800"
        >
          <div class="flex items-center justify-between">
            <div class="min-w-0">
              <p class="flex items-center gap-1.5 truncate text-sm font-medium">
                {{ config.name }}
                <span
                  v-if="hasPassword[config.id]"
                  class="tooltip tooltip-bottom flex items-center gap-0.5 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-950 dark:text-green-300"
                  data-tip="Password saved in OS keychain"
                >
                  <Check class="h-3 w-3" /> keychain
                </span>
              </p>
              <p class="truncate font-mono text-xs text-neutral-500">
                {{ config.username }}@{{ config.host }}:{{ config.port }}
              </p>
            </div>
            <div class="flex shrink-0 gap-1">
              <button
                class="tooltip tooltip-bottom rounded p-2 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                data-tip="Manage keychain password"
                @click="togglePwForm(config)"
              >
                <KeyRound class="h-4 w-4" />
              </button>
              <button class="tooltip tooltip-bottom rounded bg-blue-600 p-2 text-white" data-tip="Connect (copies the saved password first, if any)" @click="connect(config)">
                <Play class="h-4 w-4" />
              </button>
              <button class="tooltip tooltip-bottom rounded p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950" data-tip="Delete profile" @click="remove(config.id)">
                <Trash2 class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div v-if="openPwForm === config.id" class="mt-2 border-t border-neutral-200 pt-2 dark:border-neutral-700">
            <div class="flex gap-2">
              <input
                v-model="passwordInputs[config.id]"
                type="password"
                class="input"
                :placeholder="hasPassword[config.id] ? 'Enter a new password to replace the saved one' : 'Password to store in keychain'"
                @keyup.enter="savePassword(config)"
              />
              <button class="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white" @click="savePassword(config)">
                Save
              </button>
              <button
                v-if="hasPassword[config.id]"
                class="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                @click="removePassword(config)"
              >
                Remove
              </button>
            </div>
            <p class="mt-1.5 text-xs text-neutral-500">
              Stored only in your OS keychain — never in the app's database.
              On connect, it's copied to your clipboard to paste at the prompt.
            </p>
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
        Only connection details are saved in the database. Passwords go to
        your OS keychain only (add one per profile with the key button above);
        key-based auth via your SSH agent works as usual.
      </p>

      <p v-if="notice" class="mt-3 text-sm text-green-600 dark:text-green-400">{{ notice }}</p>
      <p v-if="error" class="mt-3 text-sm text-red-600">{{ error }}</p>

      <footer class="mt-4 flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">
          Close
        </button>
        <button class="btn btn-primary btn-sm" @click="save">
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
