<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  Dices,
  ExternalLink,
  Heart,
  ListMusic,
  Music,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "@lucide/vue";
import { openPath } from "../lib/api";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
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
  /** The source App selected ('all', 'favorites', or a playlist id). */
  source: string;
}>();
const emit = defineEmits<{ close: []; openPlaylists: [] }>();

const index = ref(0);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(100);
const muted = ref(false);
const error = ref(false);

const shuffle = ref(false);
const shuffleHistory = ref<number[]>([]);
const playlists = ref<Playlist[]>([]);
const favorites = ref<string[]>([]);
// The playing source is owned by App (it also opens the playlist
// manager modal from the main nav, even when nothing is playing yet),
// so this widget only mirrors it — it never switches source itself.
const source = ref<string>(props.source);

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

// Marquee: the track name is truncated by default, so a long mp3 name
// can't be read in full. When the plain name overflows its container,
// switch to a scrolling marquee (the name twice, so the loop is
// seamless); short names stay still. Re-checked on track change and
// on window resize, since the bar's width changes with wrapping.
const nameEl = ref<HTMLElement | null>(null);
const marquee = ref(false);
async function checkMarquee() {
  marquee.value = false;
  await nextTick();
  const el = nameEl.value;
  if (el) marquee.value = el.scrollWidth > el.clientWidth + 1;
}
watch(current, () => void checkMarquee());
function onResize() {
  void checkMarquee();
}

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




function close() {
  audio?.pause();
  playing.value = false;
  emit("close");
}

watch(
  () => [props.track, props.source] as const,
  ([file, newSource]) => {
    // One watcher for both, so a single App update (new track + new
    // source + new queue) is applied atomically: set the source first,
    // then find the track in the queue that source resolves to.
    source.value = newSource;
    shuffleHistory.value = [];
    const i = effectiveQueue.value.findIndex((f) => f.path === file.path);
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
  window.addEventListener("resize", onResize);
  source.value = props.source;
  const i = effectiveQueue.value.findIndex(
    (f) => f.path === props.track.path,
  );
  load(i >= 0 ? i : 0);
  void checkMarquee();
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  audio?.pause();
  audio = null;
});
</script>

<template>
  <div
    class="border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    :class="{ dark: chromeDark }"
  >
    <div class="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <Music class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
        <div class="min-w-0 overflow-hidden">
          <p
            v-if="!marquee"
            ref="nameEl"
            class="truncate text-sm font-medium"
            :title="current?.name ?? ''"
          >
            {{ current ? current.name : `No tracks in ${sourceLabel} yet` }}
          </p>
          <div v-else class="overflow-hidden" :title="current?.name ?? ''">
            <div
              class="marquee-track flex w-max items-center whitespace-nowrap text-sm font-medium"
              :style="{ animationDuration: `${Math.max(6, (current?.name.length ?? 0) * 0.25)}s` }"
            >
              <span class="pr-12">{{ current?.name }}</span>
              <span class="pr-12">{{ current?.name }}</span>
            </div>
          </div>
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
          class="flex items-center gap-1.5 rounded px-2 py-2 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Open the playlist manager"
          @click="emit('openPlaylists')"
        >
          <ListMusic class="h-4 w-4" /> Playlists
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

<style scoped>
@keyframes marquee-scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}
.marquee-track {
  animation-name: marquee-scroll;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
.marquee-track:hover {
  animation-play-state: paused;
}
</style>
