<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Check, ListMusic, Plus } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
  addToPlaylist,
  createPlaylist,
  loadPlaylists,
  type Playlist,
} from "../lib/playlists";
import type { LibraryFile } from "../types";

// Picker opened from an audio file's context menu ("Add to playlist…").
// The context menu is flat (no submenus), so picking happens here:
// tap a playlist to add the file (stays open, so one file can go into
// several playlists), or create a new playlist with the file already in
// it. Rows already containing the file show "Added" and are disabled.
const props = defineProps<{ file: LibraryFile }>();
const emit = defineEmits<{ close: [] }>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const playlists = ref<Playlist[]>([]);
const newPlaylistName = ref("");

async function refresh() {
  playlists.value = await loadPlaylists();
}

async function addTo(playlist: Playlist) {
  await addToPlaylist(playlist.id, props.file.path);
  await refresh();
  showToast(`Added ${props.file.name} to ${playlist.name}.`);
}

async function createAndAdd() {
  const name = newPlaylistName.value.trim();
  if (!name) return;
  const playlist = await createPlaylist(name);
  await addToPlaylist(playlist.id, props.file.path);
  newPlaylistName.value = "";
  await refresh();
  showToast(`Added ${props.file.name} to ${playlist.name}.`);
}

onMounted(refresh);
</script>

<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div ref="dialogPanel" class="glass-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="dialogHandle" class="mb-1 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
        <ListMusic class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" /> Add to playlist
      </h2>
      <p class="mb-4 truncate text-sm text-neutral-500">{{ file.name }}</p>

      <ul v-if="playlists.length" class="mb-4 max-h-64 space-y-1 overflow-y-auto pr-1">
        <li v-for="playlist in playlists" :key="playlist.id">
          <button
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
            :disabled="playlist.tracks.includes(file.path)"
            @click="addTo(playlist)"
          >
            <span class="min-w-0 flex-1 truncate font-medium">{{ playlist.name }}</span>
            <span class="text-xs text-neutral-500">{{ playlist.tracks.length }} tracks</span>
            <span v-if="playlist.tracks.includes(file.path)" class="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check class="h-4 w-4" /> Added
            </span>
          </button>
        </li>
      </ul>
      <p v-else class="mb-4 text-sm text-neutral-500">
        No playlists yet — create one below and this track goes straight in.
      </p>

      <div class="mb-5 flex gap-2">
        <input
          v-model="newPlaylistName"
          type="text"
          placeholder="New playlist name…"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          @keyup.enter="createAndAdd"
        />
        <button
          class="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          :disabled="!newPlaylistName.trim()"
          @click="createAndAdd"
        >
          <Plus class="h-4 w-4" /> Create
        </button>
      </div>

      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
