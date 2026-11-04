<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Copy, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, X } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
  clearAllPasswordSecrets,
  createPasswordEntry,
  deletePasswordEntry,
  getPasswordSecret,
  listPasswordEntries,
  updatePasswordEntry,
  updatePasswordSecret,
} from "../lib/db";
import { passwordDeletePassword } from "../lib/api";
import type { PasswordEntry } from "../types";
import {
  clearPin,
  createPin,
  hasPin,
  replacePin,
  verifyPin,
} from "../lib/pinLock";
import {
  VaultNotInitialized,
  vaultChangePin,
  vaultDecrypt,
  vaultEncrypt,
  vaultInit,
  vaultReset,
  vaultUnlock,
} from "../lib/vault";

// Password manager, opened from the header "Passwords" button next to
// Playlists. Secrets live in the app-local vault (see vault.ts):
// AES-GCM ciphertext in the password_entries table, decrypted only
// with the vault key that the PIN unwraps into this dialog's memory.
// Closing the dialog unmounts it and drops the vault key plus every
// revealed value. Nothing here touches the OS keychain anymore —
// passwordDeletePassword is called best-effort only to clean up a
// stale keychain copy when an entry's password is re-saved or the
// entry is deleted. Reveal is explicit per entry (eye button); copy
// clears the clipboard after 60 seconds.
// Before any of that shows, a 4-digit PIN gates the dialog: the first
// open creates it, every later open asks for it. The PIN itself is
// stored only as a salted hash (see pinLock.ts). Forgetting it
// resets the lock AND deletes the vault secrets (they cannot be
// decrypted without the PIN); entry names, usernames and notes stay.
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const entries = ref<PasswordEntry[]>([]);
const revealed = ref<Record<number, string>>({});
const error = ref<string | null>(null);
// The unwrapped vault key, held only while this dialog is unlocked.
// Dropped on close with everything else (component unmount).
const vaultKey = ref<CryptoKey | null>(null);

// --- PIN gate. The dialog mounts locked every time it opens; nothing
// below loads until the PIN passes, so entries are never even listed
// before unlock.
const unlocked = ref(false);
const pinMode = ref<"create" | "enter" | "change">("enter");
const pin = ref("");
const pinConfirm = ref("");
const pinCurrent = ref("");
const pinError = ref<string | null>(null);
const confirmReset = ref(false);

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

async function initLock() {
  unlocked.value = false;
  pinMode.value = (await hasPin().catch(() => false)) ? "enter" : "create";
}

async function submitPin() {
  pinError.value = null;
  try {
    if (pinMode.value === "create") {
      if (pin.value !== pinConfirm.value)
        throw new Error("The PINs do not match.");
      await createPin(pin.value);
      vaultKey.value = await vaultInit(pin.value);
    } else if (pinMode.value === "change") {
      if (pin.value !== pinConfirm.value)
        throw new Error("The new PINs do not match.");
      if (!(await verifyPin(pinCurrent.value)))
        throw new Error("The current PIN is incorrect.");
      try {
        vaultKey.value = await vaultChangePin(pinCurrent.value, pin.value);
        await replacePin(pin.value);
      } catch (e) {
        // If the hash change failed after the re-wrap, wrap back
        // with the old PIN so the old PIN still opens the vault.
        await vaultChangePin(pin.value, pinCurrent.value).catch(() => {});
        throw e;
      }
    } else {
      if (!(await verifyPin(pin.value)))
        throw new Error("Incorrect PIN — try again.");
      try {
        vaultKey.value = await vaultUnlock(pin.value);
      } catch (e) {
        if (e instanceof VaultNotInitialized) {
          // A PIN from before the vault existed (gate-only build):
          // initialize the vault with this PIN and carry on.
          vaultKey.value = await vaultInit(pin.value);
        } else {
          throw e;
        }
      }
    }
    pin.value = "";
    pinConfirm.value = "";
    pinCurrent.value = "";
    confirmReset.value = false;
    unlocked.value = true;
    await refresh();
  } catch (e) {
    pinError.value = String(e);
  }
}

function startChangePin() {
  pin.value = "";
  pinConfirm.value = "";
  pinCurrent.value = "";
  pinError.value = null;
  pinMode.value = "change";
  unlocked.value = false;
}

function cancelChangePin() {
  pin.value = "";
  pinConfirm.value = "";
  pinCurrent.value = "";
  pinError.value = null;
  unlocked.value = true;
}

async function resetPin() {
  // A forgotten PIN cannot be recovered: the wrapped vault key is
  // destroyed with it, so every vault secret goes too. Metadata
  // (names, usernames, notes) is kept — only the secrets are wiped.
  await clearPin().catch(() => {});
  await vaultReset().catch(() => {});
  await clearAllPasswordSecrets().catch(() => {});
  vaultKey.value = null;
  pin.value = "";
  pinConfirm.value = "";
  pinCurrent.value = "";
  pinError.value = null;
  confirmReset.value = false;
  pinMode.value = "create";
}

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
  // No keychain calls anymore: whether an entry has a secret comes
  // from the listing itself (secret IS NOT NULL).
  entries.value = await listPasswordEntries();
}

function requireVaultKey(): CryptoKey {
  if (!vaultKey.value) throw new Error("Unlock the manager first.");
  return vaultKey.value;
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
      const ciphertext = await vaultEncrypt(requireVaultKey(), password);
      await updatePasswordSecret(id, ciphertext);
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
    // The listing carries only the hasSecret flag, not the
    // ciphertext — fetch it fresh so secrets never sit in the list.
    const stored = await getPasswordSecret(entry.id);
    if (!stored) throw new Error("No password saved for this entry.");
    const password = await vaultDecrypt(requireVaultKey(), stored);
    revealed.value = { ...revealed.value, [entry.id]: password };
  } catch (e) {
    error.value = String(e);
  }
}

async function copy(entry: PasswordEntry) {
  try {
    const stored = await getPasswordSecret(entry.id);
    if (!stored) throw new Error("No password saved for this entry.");
    const password = await vaultDecrypt(requireVaultKey(), stored);
    await navigator.clipboard.writeText(password);
    showToast("Password copied — it clears from the clipboard after 60 seconds.");
    // Clear it after 60s, but only if the clipboard still holds
    // exactly this password, so we never wipe something the user
    // copied afterwards.
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === password) {
          await navigator.clipboard.writeText("");
        }
      } catch {
        // Clipboard unreadable (permissions) — leave it alone.
      }
    }, 60_000);
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
      const ciphertext = await vaultEncrypt(
        requireVaultKey(),
        editPassword.value,
      );
      await updatePasswordSecret(entry.id, ciphertext);
      // Best-effort cleanup of a stale keychain copy for this entry
      // (from before the vault move). Failures are ignored: the
      // vault already holds the secret.
      await passwordDeletePassword(entry.id).catch(() => {});
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
    // Best-effort keychain cleanup (see saveEdit); the row delete
    // below removes the vault secret with the entry itself.
    await passwordDeletePassword(entry.id).catch(() => {});
    await deletePasswordEntry(entry.id);
    await refresh();
    showToast("Password deleted.");
  } catch (e) {
    error.value = String(e);
  }
}

onMounted(initLock);
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

      <div v-if="!unlocked">
        <p class="mb-1 text-sm font-medium">
          <template v-if="pinMode === 'create'">Create a 4-digit PIN to protect this manager.</template>
          <template v-else-if="pinMode === 'change'">Change your PIN.</template>
          <template v-else>Enter your PIN to view your passwords.</template>
        </p>
        <p class="mb-4 text-xs text-neutral-500">
          The PIN unlocks this screen and the vault behind it.
          Resetting a forgotten PIN also deletes every saved vault
          password (they cannot be decrypted without it) — entry
          names, usernames and notes are kept.
        </p>

        <div v-if="pinError" class="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {{ pinError }}
        </div>

        <input
          v-if="pinMode === 'change'"
          v-model="pinCurrent"
          type="password"
          inputmode="numeric"
          maxlength="4"
          placeholder="Current PIN"
          class="mb-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
          @input="pinCurrent = digitsOnly(pinCurrent)"
          @keyup.enter="submitPin"
        />
        <input
          v-model="pin"
          type="password"
          inputmode="numeric"
          maxlength="4"
          :placeholder="pinMode === 'enter' ? '4-digit PIN' : 'New 4-digit PIN'"
          class="mb-2 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
          @input="pin = digitsOnly(pin)"
          @keyup.enter="submitPin"
        />
        <input
          v-if="pinMode !== 'enter'"
          v-model="pinConfirm"
          type="password"
          inputmode="numeric"
          maxlength="4"
          placeholder="Confirm PIN"
          class="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
          @input="pinConfirm = digitsOnly(pinConfirm)"
          @keyup.enter="submitPin"
        />
        <div class="flex gap-2">
          <button
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            :disabled="pin.length !== 4 || (pinMode !== 'enter' && pinConfirm.length !== 4) || (pinMode === 'change' && pinCurrent.length !== 4)"
            @click="submitPin"
          >
            {{ pinMode === "create" ? "Create PIN" : pinMode === "change" ? "Save new PIN" : "Unlock" }}
          </button>
          <button v-if="pinMode === 'change'" class="btn btn-ghost btn-sm" @click="cancelChangePin">Cancel</button>
        </div>

        <div v-if="pinMode === 'enter'" class="mt-4 text-xs">
          <button v-if="!confirmReset" class="text-neutral-500 underline hover:text-neutral-700 dark:hover:text-neutral-300" @click="confirmReset = true">
            Forgot PIN?
          </button>
          <span v-else class="flex flex-wrap items-center gap-2 text-neutral-500">
            Resetting also deletes all saved vault passwords.
            <button class="rounded bg-red-600 px-2 py-1 font-medium text-white" @click="resetPin">Reset PIN</button>
            <button class="hover:text-neutral-700 dark:hover:text-neutral-300" @click="confirmReset = false">Cancel</button>
          </span>
        </div>
      </div>

      <div v-else>
      <p class="mb-4 text-xs text-neutral-500">
        Passwords are encrypted in the app's own database and unlocked
        only by your PIN — never in Windows Credential Manager.
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
                <span v-else-if="!entry.hasSecret" class="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                  No password saved for this entry.
                </span>
              </span>
              <button
                v-if="entry.hasSecret"
                class="rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                :title="revealed[entry.id] !== undefined ? 'Hide password' : 'Reveal password'"
                @click="toggleReveal(entry)"
              >
                <EyeOff v-if="revealed[entry.id] !== undefined" class="h-4 w-4" />
                <Eye v-else class="h-4 w-4" />
              </button>
              <button
                v-if="entry.hasSecret"
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
        If saving fails, the entry is removed again rather than left
        looking saved with no password behind it.
      </p>

      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" @click="startChangePin">Change PIN</button>
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
      </div>
    </div>
  </div>
</template>
