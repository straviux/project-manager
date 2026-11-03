<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, X } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
  createPasswordEntry,
  deletePasswordEntry,
  listPasswordEntries,
  updatePasswordEntry,
} from "../lib/db";
import {
  passwordCopyPassword,
  passwordDeletePassword,
  passwordGetPassword,
  passwordHasPassword,
  passwordSetPassword,
} from "../lib/api";
import type { PasswordEntry } from "../types";

// Password manager, opened from the header "Passwords" button next to
// Playlists. Secrets live ONLY in the OS keychain (Rust password_*,
// same service as SSH passwords) — the database holds name, username
// and notes, never a password, and this component only holds a
// revealed password in memory while its eye toggle is on for that
// entry. Closing the dialog unmounts it and drops every revealed
// value. Reveal is explicit per entry (eye button); copy uses the
// Rust path, which clears the clipboard after 60 seconds.
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const entries = ref<PasswordEntry[]>([]);
const hasSecret = ref<Record<number, boolean>>({});
const revealed = ref<Record<number, string>>({});
const error = ref<string | null>(null);

const newName = ref("");
const newUsername = ref("");
const newNotes = ref("");
const newPassword = ref("");
const editingId = ref<number | null>(null);
const editName = ref("");
const editUsername = ref("");
const editNotes = ref("");
const editPassword = ref("");
const confirmDeleteId = ref<number | null>(null);

async function refresh() {
  entries.value = await listPasswordEntries();
  const flags: Record<number, boolean> = {};
  for (const e of entries.value) {
    flags[e.id] = await passwordHasPassword(e.id).catch(() => false);
  }
  hasSecret.value = flags;
}

async function add() {
  const name = newName.value.trim();
  const password = newPassword.value;
  if (!name || !password) return;
  error.value = null;
  try {
    const id = await createPasswordEntry(
      name,
      newUsername.value.trim(),
      newNotes.value.trim(),
    );
    if (!id) throw new Error("Could not create the entry.");
    try {
      await passwordSetPassword(id, password);
    } catch (e) {
      // Metadata without a secret is a half-saved entry: remove it
      // rather than leaving a name that looks saved but has no password.
      await deletePasswordEntry(id).catch(() => {});
      throw e;
    }
    newName.value = "";
    newUsername.value = "";
    newNotes.value = "";
    newPassword.value = "";
    await refresh();
  } catch (e) {
    error.value = String(e);
  }
}

async function toggleReveal(entry: PasswordEntry) {
  if (revealed.value[entry.id] !== undefined) {
    const next = { ...revealed.value };
    delete next[entry.id];
    revealed.value = next;
    return;
  }
  try {
    const password = await passwordGetPassword(entry.id);
    revealed.value = { ...revealed.value, [entry.id]: password };
  } catch (e) {
    error.value = String(e);
  }
}

async function copy(entry: PasswordEntry) {
  try {
    await passwordCopyPassword(entry.id);
    showToast("Password copied — it clears from the clipboard after 60 seconds.");
  } catch (e) {
    error.value = String(e);
  }
}

function startEdit(entry: PasswordEntry) {
  editingId.value = entry.id;
  editName.value = entry.name;
  editUsername.value = entry.username;
  editNotes.value = entry.notes;
  editPassword.value = "";
}

async function saveEdit(entry: PasswordEntry) {
  const name = editName.value.trim();
  if (!name) return;
  error.value = null;
  try {
    await updatePasswordEntry(
      entry.id,
      name,
      editUsername.value.trim(),
      editNotes.value.trim(),
    );
    // A blank password field means "keep the existing secret".
    if (editPassword.value) {
      await passwordSetPassword(entry.id, editPassword.value);
    }
    editingId.value = null;
    await refresh();
  } catch (e) {
    error.value = String(e);
  }
}

async function remove(entry: PasswordEntry) {
  confirmDeleteId.value = null;
  try {
    await passwordDeletePassword(entry.id).catch(() => {});
    await deletePasswordEntry(entry.id);
    await refresh();
    showToast("Password deleted.");
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(refresh);
</script>

<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div ref="dialogPanel" class="glass-panel w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="dialogHandle" class="mb-4 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
        <KeyRound class="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" /> Passwords
        <button class="ml-auto rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="emit('close')">
          <X class="h-5 w-5" />
        </button>
      </h2>

      <p class="mb-4 text-xs text-neutral-500">
        Passwords are stored only in your operating system's keychain
        (Windows Credential Manager) — never in the app database.
        Reveal shows a password here until you hide it or close this
        dialog; Copy clears it from the clipboard after 60 seconds.
      </p>

      <div v-if="error" class="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
        {{ error }}
      </div>

      <ul class="mb-4 max-h-80 space-y-1 overflow-y-auto pr-1">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="rounded-lg px-2 py-1.5 text-sm"
        >
          <template v-if="editingId === entry.id">
            <input
              v-model="editName"
              class="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Name (site or service)"
              @keyup.enter="saveEdit(entry)"
            />
            <input
              v-model="editUsername"
              class="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Username (optional)"
            />
            <input
              v-model="editNotes"
              class="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="Notes (optional)"
            />
            <input
              v-model="editPassword"
              type="password"
              class="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
              placeholder="New password (blank keeps the current one)"
            />
            <span class="flex gap-2">
              <button class="btn btn-primary btn-sm" :disabled="!editName.trim()" @click="saveEdit(entry)">Save</button>
              <button class="btn btn-ghost btn-sm" @click="editingId = null">Cancel</button>
            </span>
          </template>
          <template v-else-if="confirmDeleteId === entry.id">
            <span class="block font-medium">Delete "{{ entry.name }}"?</span>
            <span class="mb-2 block text-xs text-neutral-500">
              This removes the entry and its keychain password.
            </span>
            <span class="flex gap-2">
              <button class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white" @click="remove(entry)">Delete</button>
              <button class="btn btn-ghost btn-sm" @click="confirmDeleteId = null">Cancel</button>
            </span>
          </template>
          <template v-else>
            <span class="flex items-start gap-2">
              <span class="min-w-0 flex-1">
                <span class="block font-medium">{{ entry.name }}</span>
                <span v-if="entry.username" class="block text-xs text-neutral-500">{{ entry.username }}</span>
                <span v-if="entry.notes" class="block text-xs text-neutral-500">{{ entry.notes }}</span>
                <span v-if="revealed[entry.id] !== undefined" class="mt-1 block select-all break-all rounded bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800">
                  {{ revealed[entry.id] }}
                </span>
                <span v-else-if="!hasSecret[entry.id]" class="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                  No password saved for this entry.
                </span>
              </span>
              <button
                v-if="hasSecret[entry.id]"
                class="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                :title="revealed[entry.id] !== undefined ? 'Hide password' : 'Reveal password'"
                @click="toggleReveal(entry)"
              >
                <EyeOff v-if="revealed[entry.id] !== undefined" class="h-4 w-4" />
                <Eye v-else class="h-4 w-4" />
              </button>
              <button
                v-if="hasSecret[entry.id]"
                class="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                title="Copy password"
                @click="copy(entry)"
              >
                <Copy class="h-4 w-4" />
              </button>
              <button class="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700" title="Edit entry" @click="startEdit(entry)">
                <Pencil class="h-4 w-4" />
              </button>
              <button class="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950" title="Delete entry" @click="confirmDeleteId = entry.id">
                <Trash2 class="h-4 w-4" />
              </button>
            </span>
          </template>
        </li>
        <li v-if="!entries.length" class="px-2 py-4 text-center text-sm text-neutral-500">
          No passwords yet.
        </li>
      </ul>

      <div class="mb-2 flex gap-2">
        <input
          v-model="newName"
          type="text"
          placeholder="Name (site or service)"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <input
          v-model="newUsername"
          type="text"
          placeholder="Username (optional)"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>
      <div class="mb-2 flex gap-2">
        <input
          v-model="newNotes"
          type="text"
          placeholder="Notes (optional)"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <input
          v-model="newPassword"
          type="password"
          placeholder="Password"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          @keyup.enter="add"
        />
        <button
          class="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          :disabled="!newName.trim() || !newPassword"
          @click="add"
        >
          <Plus class="h-4 w-4" /> Add
        </button>
      </div>
      <p class="mb-5 text-xs text-neutral-500">
        If saving to the keychain fails, the entry is removed again
        rather than left looking saved with no password behind it.
      </p>

      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
