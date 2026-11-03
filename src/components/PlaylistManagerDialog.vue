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
  addYoutubeToPlaylist,
  createPlaylist,
  deletePlaylist,
  loadFavorites,
  loadPlaylists,
  youtubeVideoIdFromUrl,
  type Playlist,
} from "../lib/playlists";
import type { LibraryFile, PlayerTrack } from "../types";

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
  currentTrack: PlayerTrack | null;
  activeSource: string;
}>();
const emit = defineEmits<{
  close: [];
  play: [track: PlayerTrack, queue: PlayerTrack[], source: string];
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

// The currently playing local file's path, or null when nothing is
// playing or the current track is a YouTube link (+ Current is
// local-files only; see addCurrent).
const currentFilePath = computed(() =>
  props.currentTrack?.kind === "file" ? props.currentTrack.file.path : null,
);

function queueFor(source: string): PlayerTrack[] {
  const asTracks = (files: LibraryFile[]): PlayerTrack[] =>
    files.map((file) => ({ kind: "file" as const, file }));
  if (source === "all") return asTracks(audioFiles.value);
  if (source === "favorites") return asTracks(favoriteFiles.value);
  const playlist = playlists.value.find((p) => p.id === source);
  if (!playlist) return asTracks(audioFiles.value);
  const byPath = new Map(audioFiles.value.map((f) => [f.path, f]));
  const queue: PlayerTrack[] = [];
  for (const track of playlist.tracks) {
    if (track.kind === "youtube") {
      // YouTube links need no library file to resolve against, so
      // they always play even when the library folder is unset.
      queue.push({
        kind: "youtube",
        videoId: track.videoId,
        title: track.title,
      });
    } else {
      const file = byPath.get(track.path);
      if (file) queue.push({ kind: "file", file });
    }
  }
  return queue;
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
  // + Current only makes sense for a local file: a YouTube track is
  // already in the playlist it came from, and favorites/All tracks
  // have no playlist to add a link back into this way.
  if (!props.currentTrack || props.currentTrack.kind !== "file") return;
  const playlist = playlists.value.find((p) => p.id === id);
  await addToPlaylist(id, props.currentTrack.file.path);
  await refresh();
  if (playlist) showToast(`Added to ${playlist.name}.`);
}

// Add a YouTube link to a chosen playlist. The title is the user's
// own label (YouTube titles are not fetched), defaulting to the
// video id when left blank.
const youtubePlaylistId = ref("");
const youtubeUrl = ref("");
const youtubeTitle = ref("");

async function addYoutube() {
  const videoId = youtubeVideoIdFromUrl(youtubeUrl.value);
  if (!videoId || !youtubePlaylistId.value) return;
  const playlist = playlists.value.find((p) => p.id === youtubePlaylistId.value);
  await addYoutubeToPlaylist(
    youtubePlaylistId.value,
    videoId,
    youtubeTitle.value.trim() || `YouTube video ${videoId}`,
  );
  youtubeUrl.value = "";
  youtubeTitle.value = "";
  await refresh();
  if (playlist) showToast(`Added YouTube link to ${playlist.name}.`);
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
            :disabled="currentFilePath === null || playlist.tracks.some((t) => t.kind === 'file' && t.path === currentFilePath)"
            title="Add the currently playing local track to this playlist"
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

      <div v-if="playlists.length" class="mb-5 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p class="mb-2 text-sm font-medium">Add a YouTube link to a playlist</p>
        <div class="mb-2 flex gap-2">
          <select
            v-model="youtubePlaylistId"
            class="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="" disabled>Choose a playlist…</option>
            <option v-for="p in playlists" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
          <input
            v-model="youtubeUrl"
            type="text"
            placeholder="Paste a YouTube link…"
            class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            @keyup.enter="addYoutube"
          />
        </div>
        <div class="flex gap-2">
          <input
            v-model="youtubeTitle"
            type="text"
            placeholder="Name for this link (optional — defaults to the video id)"
            class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            @keyup.enter="addYoutube"
          />
          <button
            class="flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            :disabled="!youtubePlaylistId || !youtubeVideoIdFromUrl(youtubeUrl)"
            @click="addYoutube"
          >
            <Plus class="h-4 w-4" /> Add link
          </button>
        </div>
        <p class="mt-1 text-xs text-neutral-500">
          Watch, short, embed, and youtu.be links all work. The link
          plays in the player bar alongside your local files.
        </p>
      </div>

      <p class="mb-5 text-xs text-neutral-500">
        Playlists and favorites are saved in the app database, so they
        survive restarts. Tracks are matched by file path — a file that
        was moved or deleted is skipped when its playlist plays.
        YouTube links need no library file, so they always play.
      </p>

      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>
