<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Heart, ListMusic, Play, Plus, Trash2 } from "@lucide/vue";
import { useDialogDrag } from "../lib/useDialogDrag";
import { useEscapeClose } from "../lib/useEscapeClose";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import { listLibraryFiles } from "../lib/api";
import { isAudioFile } from "../lib/fileTypes";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  loadFavorites,
  loadPlaylists,
  type Playlist,
} from "../lib/playlists";
import type { LibraryFile } from "../types";

// The playlist manager, as a modal (not the panel that used to sit
// above the player bar). It can be opened from two places: the
// "Playlists" button in the main nav (even when nothing is playing)
// and the labeled "Playlists" button on the player bar. Playing a
// source from here starts the player with that source's tracks, in
// order; the player itself stays a bar, not a modal, so music keeps
// playing while you browse. Tracks are resolved against the library's
// audio files, so a file that was moved or deleted is skipped.
const props = defineProps<{
  filesDir: string;
  currentTrack: LibraryFile | null;
  activeSource: string;
}>();
const emit = defineEmits<{
  close: [];
  play: [file: LibraryFile, queue: LibraryFile[], source: string];
}>();

const dialogPanel = ref<HTMLElement | null>(null);
const dialogHandle = ref<HTMLElement | null>(null);
useDialogDrag(dialogPanel, dialogHandle);
useEscapeClose(() => emit("close"));

const audioFiles = ref<LibraryFile[]>([]);
const playlists = ref<Playlist[]>([]);
const favorites = ref<string[]>([]);
const newPlaylistName = ref("");

const favoriteFiles = computed(() =>
  audioFiles.value.filter((f) => favorites.value.includes(f.path)),
);

function queueFor(source: string): LibraryFile[] {
  if (source === "all") return audioFiles.value;
  if (source === "favorites") return favoriteFiles.value;
  const playlist = playlists.value.find((p) => p.id === source);
  if (!playlist) return audioFiles.value;
  const byPath = new Map(audioFiles.value.map((f) => [f.path, f]));
  return playlist.tracks
    .map((path) => byPath.get(path))
    .filter((f): f is LibraryFile => !!f);
}

function playSource(source: string) {
  const queue = queueFor(source);
  if (!queue.length) return;
  emit("play", queue[0], queue, source);
  emit("close");
}

async function refresh() {
  playlists.value = await loadPlaylists();
  favorites.value = await loadFavorites();
  if (props.filesDir) {
    try {
      const files = await listLibraryFiles(props.filesDir);
      audioFiles.value = files.filter((f) => isAudioFile(f.name));
    } catch {
      audioFiles.value = [];
    }
  }
}

async function createNew() {
  const name = newPlaylistName.value.trim();
  if (!name) return;
  await createPlaylist(name);
  newPlaylistName.value = "";
  await refresh();
}

async function deleteById(id: string) {
  await deletePlaylist(id);
  await refresh();
}

async function addCurrent(id: string) {
  if (!props.currentTrack) return;
  const playlist = playlists.value.find((p) => p.id === id);
  await addToPlaylist(id, props.currentTrack.path);
  await refresh();
  if (playlist) showToast(`Added to ${playlist.name}.`);
}

onMounted(refresh);
</script>

<template>
  <div
    class="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4"
    :class="{ dark: chromeDark }"
    @click.self="emit('close')"
  >
    <div ref="dialogPanel" class="glass-panel w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="dialogHandle" class="mb-4 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
        <ListMusic class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" /> Playlists
      </h2>

      <ul class="mb-4 max-h-80 space-y-1 overflow-y-auto pr-1">
        <li
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          :class="activeSource === 'all' ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
        >
          <button class="min-w-0 flex-1 text-left font-medium" @click="playSource('all')">
            All tracks
            <span class="text-neutral-500">· {{ audioFiles.length }} tracks</span>
          </button>
          <button class="rounded bg-blue-600 p-1.5 text-white disabled:opacity-40" title="Play" :disabled="!audioFiles.length" @click="playSource('all')"><Play class="h-4 w-4" /></button>
        </li>
        <li
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          :class="activeSource === 'favorites' ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
        >
          <button class="min-w-0 flex-1 text-left font-medium" @click="playSource('favorites')">
            <Heart class="mr-1 inline h-4 w-4 fill-red-500 text-red-500" /> Favorites
            <span class="text-neutral-500">· {{ favoriteFiles.length }} tracks</span>
          </button>
          <button class="rounded bg-blue-600 p-1.5 text-white disabled:opacity-40" title="Play" :disabled="!favoriteFiles.length" @click="playSource('favorites')"><Play class="h-4 w-4" /></button>
        </li>
        <li
          v-for="playlist in playlists"
          :key="playlist.id"
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          :class="activeSource === playlist.id ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
        >
          <button class="min-w-0 flex-1 truncate text-left font-medium" @click="playSource(playlist.id)">
            {{ playlist.name }}
            <span class="text-neutral-500">· {{ queueFor(playlist.id).length }} tracks</span>
          </button>
          <button
            class="rounded px-2 py-1 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-40"
            :disabled="!currentTrack || playlist.tracks.includes(currentTrack.path)"
            title="Add the currently playing track to this playlist"
            @click="addCurrent(playlist.id)"
          >
            + Current
          </button>
          <button class="rounded bg-blue-600 p-1.5 text-white disabled:opacity-40" title="Play" :disabled="!queueFor(playlist.id).length" @click="playSource(playlist.id)"><Play class="h-4 w-4" /></button>
          <button
            class="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
            title="Delete playlist"
            @click="deleteById(playlist.id)"
          >
            <Trash2 class="h-4 w-4" />
          </button>
        </li>
      </ul>

      <div class="mb-5 flex gap-2">
        <input
          v-model="newPlaylistName"
          type="text"
          placeholder="New playlist name…"
          class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          @keyup.enter="createNew"
        />
        <button
          class="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          :disabled="!newPlaylistName.trim()"
          @click="createNew"
        >
          <Plus class="h-4 w-4" /> Create
        </button>
      </div>

      <p class="mb-5 text-xs text-neutral-500">
        Playlists and favorites are saved in the app database, so they
        survive restarts. Tracks are matched by file path — a file that
        was moved or deleted is skipped when its playlist plays.
      </p>

      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
