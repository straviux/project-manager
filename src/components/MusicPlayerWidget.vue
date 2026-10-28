<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Dices,
  ExternalLink,
  Heart,
  ListMusic,
  Music,
  Pause,
  Play,
  Plus,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from "@lucide/vue";
import { openPath } from "../lib/api";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  loadFavorites,
  loadPlaylists,
  toggleFavorite,
  type Playlist,
} from "../lib/playlists";
import type { LibraryFile } from "../types";

// A persistent mini player bar (not a modal): it sits between the main
// content and the footer in App.vue, so music keeps playing while the
// user switches between the Projects and Files tabs or browses the
// library. The queue prop is all audio files in the library, in library
// order; FilesView tells App which file to start on. Playlists and
// favorites (see lib/playlists.ts) are stored by file path in settings,
// so they survive restarts; the effective queue is whatever source is
// selected — All tracks, Favorites, or one custom playlist.
const props = defineProps<{
  track: LibraryFile;
  queue: LibraryFile[];
}>();
const emit = defineEmits<{ close: [] }>();

const index = ref(0);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(100);
const muted = ref(false);
const error = ref(false);

const shuffle = ref(false);
const shuffleHistory = ref<number[]>([]);
const showPanel = ref(false);
const playlists = ref<Playlist[]>([]);
const favorites = ref<string[]>([]);
const source = ref<string>("all");
const newPlaylistName = ref("");

const effectiveQueue = computed<LibraryFile[]>(() => {
  if (source.value === "all") return props.queue;
  if (source.value === "favorites")
    return props.queue.filter((f) => favorites.value.includes(f.path));
  const playlist = playlists.value.find((p) => p.id === source.value);
  if (!playlist) return props.queue;
  const byPath = new Map(props.queue.map((f) => [f.path, f]));
  return playlist.tracks
    .map((path) => byPath.get(path))
    .filter((f): f is LibraryFile => !!f);
});

const current = computed<LibraryFile | null>(
  () => effectiveQueue.value[index.value] ?? null,
);
const sourceLabel = computed(() => {
  if (source.value === "all") return "All tracks";
  if (source.value === "favorites") return "Favorites";
  return (
    playlists.value.find((p) => p.id === source.value)?.name ?? "All tracks"
  );
});
const isFavorite = computed(
  () => !!current.value && favorites.value.includes(current.value.path),
);

let audio: HTMLAudioElement | null = null;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function load(i: number) {
  const file = effectiveQueue.value[i];
  if (!file) {
    playing.value = false;
    return;
  }
  index.value = i;
  error.value = false;
  currentTime.value = 0;
  duration.value = 0;
  if (audio) {
    audio.src = convertFileSrc(file.path);
    audio.volume = muted.value ? 0 : volume.value / 100;
    void audio.play().then(
      () => (playing.value = true),
      () => (playing.value = false),
    );
  }
}

function togglePlay() {
  if (!audio || !current.value) return;
  if (playing.value) {
    audio.pause();
    playing.value = false;
  } else {
    void audio.play().then(
      () => (playing.value = true),
      () => (playing.value = false),
    );
  }
}

function randomIndex(exclude: number): number {
  const n = effectiveQueue.value.length;
  if (n <= 1) return 0;
  let i = exclude;
  while (i === exclude) i = Math.floor(Math.random() * n);
  return i;
}

function prev() {
  if (currentTime.value > 3) {
    // Like most players: pressing previous near the start of a track
    // restarts it; further in, it goes to the previous track.
    if (audio) audio.currentTime = 0;
    currentTime.value = 0;
    return;
  }
  if (shuffle.value) {
    const prevIndex = shuffleHistory.value.pop();
    load(prevIndex ?? randomIndex(index.value));
    return;
  }
  const n = effectiveQueue.value.length;
  if (!n) return;
  load(index.value > 0 ? index.value - 1 : n - 1);
}

function next(auto = false) {
  const n = effectiveQueue.value.length;
  if (!n) return;
  if (shuffle.value) {
    shuffleHistory.value.push(index.value);
    load(randomIndex(index.value));
    return;
  }
  if (index.value < n - 1) {
    load(index.value + 1);
  } else if (!auto) {
    load(0);
  } else {
    // End of the queue on natural playback: stop, don't loop.
    playing.value = false;
    currentTime.value = 0;
  }
}

/** Play a random track from the current source, shuffle mode or not. */
function playRandom() {
  if (!effectiveQueue.value.length) return;
  shuffleHistory.value.push(index.value);
  load(randomIndex(index.value));
}

function seek(value: number) {
  if (!audio) return;
  audio.currentTime = value;
  currentTime.value = value;
}

function setVolume(value: number) {
  volume.value = value;
  muted.value = false;
  if (audio) audio.volume = value / 100;
}

function toggleMute() {
  muted.value = !muted.value;
  if (audio) audio.volume = muted.value ? 0 : volume.value / 100;
}

async function refreshPlaylists() {
  playlists.value = await loadPlaylists();
  favorites.value = await loadFavorites();
}

async function togglePanel() {
  showPanel.value = !showPanel.value;
  if (showPanel.value) await refreshPlaylists();
}

function selectSource(id: string) {
  source.value = id;
  shuffleHistory.value = [];
  index.value = 0;
  load(0);
}

async function toggleCurrentFavorite() {
  if (!current.value) return;
  const nowFavorite = await toggleFavorite(current.value.path);
  await refreshPlaylists();
  showToast(
    nowFavorite
      ? `Added ${current.value.name} to favorites.`
      : `Removed ${current.value.name} from favorites.`,
  );
}

async function createNewPlaylist() {
  const name = newPlaylistName.value.trim();
  if (!name) return;
  await createPlaylist(name);
  newPlaylistName.value = "";
  await refreshPlaylists();
}

async function deletePlaylistById(id: string) {
  await deletePlaylist(id);
  if (source.value === id) source.value = "all";
  await refreshPlaylists();
}

async function addCurrentToPlaylist(id: string) {
  if (!current.value) return;
  const playlist = playlists.value.find((p) => p.id === id);
  await addToPlaylist(id, current.value.path);
  await refreshPlaylists();
  if (playlist) showToast(`Added to ${playlist.name}.`);
}

function close() {
  audio?.pause();
  playing.value = false;
  emit("close");
}

watch(
  () => props.track,
  (file) => {
    // Playing a file directly from Files always plays from All tracks,
    // even if a playlist was selected before.
    source.value = "all";
    shuffleHistory.value = [];
    const i = props.queue.findIndex((f) => f.path === file.path);
    load(i >= 0 ? i : 0);
  },
);

onMounted(async () => {
  audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => {
    if (audio) currentTime.value = audio.currentTime;
  });
  audio.addEventListener("loadedmetadata", () => {
    if (audio) duration.value = audio.duration;
  });
  audio.addEventListener("ended", () => next(true));
  audio.addEventListener("error", () => {
    error.value = true;
    playing.value = false;
  });
  await refreshPlaylists();
  const i = props.queue.findIndex((f) => f.path === props.track.path);
  load(i >= 0 ? i : 0);
});

onUnmounted(() => {
  audio?.pause();
  audio = null;
});
</script>

<template>
  <div
    class="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    :class="{ dark: chromeDark }"
  >
    <div
      v-if="showPanel"
      class="border-b border-neutral-200 bg-neutral-50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-800/50"
    >
      <div class="mx-auto w-full max-w-6xl">
        <h3 class="mb-2 text-sm font-semibold">Playlists</h3>
        <ul class="max-h-64 space-y-1 overflow-y-auto pr-1">
          <li
            class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
            :class="source === 'all' ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
          >
            <button class="min-w-0 flex-1 text-left font-medium" @click="selectSource('all')">
              All tracks
              <span class="text-neutral-500">· {{ queue.length }} tracks</span>
            </button>
            <button
              class="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white"
              @click="selectSource('all')"
            >
              Play
            </button>
          </li>
          <li
            class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
            :class="source === 'favorites' ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
          >
            <button class="min-w-0 flex-1 text-left font-medium" @click="selectSource('favorites')">
              <Heart class="mr-1 inline h-4 w-4 fill-red-500 text-red-500" /> Favorites
              <span class="text-neutral-500">· {{ queue.filter((f) => favorites.includes(f.path)).length }} tracks</span>
            </button>
            <button
              class="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white"
              @click="selectSource('favorites')"
            >
              Play
            </button>
          </li>
          <li
            v-for="playlist in playlists"
            :key="playlist.id"
            class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
            :class="source === playlist.id ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
          >
            <button class="min-w-0 flex-1 truncate text-left font-medium" @click="selectSource(playlist.id)">
              {{ playlist.name }}
              <span class="text-neutral-500">· {{ playlist.tracks.length }} tracks</span>
            </button>
            <button
              class="rounded px-2 py-1 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700"
              :disabled="!current"
              title="Add the currently playing track to this playlist"
              @click="addCurrentToPlaylist(playlist.id)"
            >
              + Current
            </button>
            <button
              class="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white"
              @click="selectSource(playlist.id)"
            >
              Play
            </button>
            <button
              class="rounded p-1 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
              title="Delete playlist"
              @click="deletePlaylistById(playlist.id)"
            >
              <Trash2 class="h-4 w-4" />
            </button>
          </li>
        </ul>
        <div class="mt-3 flex gap-2">
          <input
            v-model="newPlaylistName"
            type="text"
            placeholder="New playlist name…"
            class="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            @keyup.enter="createNewPlaylist"
          />
          <button
            class="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            :disabled="!newPlaylistName.trim()"
            @click="createNewPlaylist"
          >
            <Plus class="h-4 w-4" /> Create
          </button>
        </div>
        <p class="mt-2 text-xs text-neutral-500">
          Playlists and favorites are saved in the app database, so they
          survive restarts. Tracks are matched by file path — a file that
          was moved or deleted is skipped when its playlist plays.
        </p>
      </div>
    </div>

    <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <Music class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
        <div class="min-w-0">
          <p class="truncate text-sm font-medium" :title="current?.name ?? ''">
            {{ current ? current.name : `No tracks in ${sourceLabel} yet` }}
          </p>
          <p class="text-xs text-neutral-500">
            <template v-if="current">
              {{ index + 1 }} / {{ effectiveQueue.length }} · {{ sourceLabel }}
              <span v-if="shuffle">· Shuffle on</span>
            </template>
            <span v-if="error" class="text-red-600 dark:text-red-400">
              — couldn't play this file
            </span>
          </p>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Previous track"
          :disabled="!current"
          @click="prev"
        >
          <SkipBack class="h-5 w-5" />
        </button>
        <button
          class="rounded-full bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:opacity-40"
          :title="playing ? 'Pause' : 'Play'"
          :disabled="!current"
          @click="togglePlay"
        >
          <Pause v-if="playing" class="h-5 w-5" />
          <Play v-else class="h-5 w-5" />
        </button>
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Next track"
          :disabled="!current"
          @click="next()"
        >
          <SkipForward class="h-5 w-5" />
        </button>
        <button
          class="rounded p-2"
          :class="shuffle ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'"
          title="Shuffle on/off — next track is random"
          :disabled="!current"
          @click="shuffle = !shuffle; shuffleHistory = []"
        >
          <Shuffle class="h-5 w-5" />
        </button>
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Play a random track"
          :disabled="!current"
          @click="playRandom"
        >
          <Dices class="h-5 w-5" />
        </button>
      </div>

      <div class="flex min-w-52 flex-1 items-center gap-2">
        <span class="w-10 shrink-0 text-right text-xs tabular-nums text-neutral-500">
          {{ formatTime(currentTime) }}
        </span>
        <input
          type="range"
          min="0"
          :max="duration || 0"
          step="0.1"
          :value="currentTime"
          class="h-1.5 flex-1 cursor-pointer accent-blue-600"
          :disabled="!duration"
          @input="seek(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="w-10 shrink-0 text-xs tabular-nums text-neutral-500">
          {{ formatTime(duration) }}
        </span>
      </div>

      <div class="flex items-center gap-1">
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          :title="isFavorite ? 'Remove from favorites' : 'Add to favorites'"
          :disabled="!current"
          @click="toggleCurrentFavorite"
        >
          <Heart
            class="h-4 w-4"
            :class="isFavorite ? 'fill-red-500 text-red-500' : ''"
          />
        </button>
        <button
          class="rounded p-2"
          :class="showPanel ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'"
          title="Playlists"
          @click="togglePanel"
        >
          <ListMusic class="h-4 w-4" />
        </button>
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          :title="muted ? 'Unmute' : 'Mute'"
          @click="toggleMute"
        >
          <VolumeX v-if="muted || volume === 0" class="h-4 w-4" />
          <Volume2 v-else class="h-4 w-4" />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          :value="muted ? 0 : volume"
          class="h-1.5 w-20 cursor-pointer accent-blue-600"
          @input="setVolume(Number(($event.target as HTMLInputElement).value))"
        />
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Open in its own app"
          :disabled="!current"
          @click="current && openPath(current.path)"
        >
          <ExternalLink class="h-4 w-4" />
        </button>
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Stop and close player"
          @click="close"
        >
          <X class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>
