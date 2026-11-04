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
import { openPath, openUrl } from "../lib/api";
import { chromeDark } from "../lib/theme";
import { showToast } from "../lib/toast";
import {
  loadFavorites,
  loadPlaylists,
  toggleFavorite,
  type Playlist,
} from "../lib/playlists";
import {
  playerTrackKey,
  playerTrackName,
  type PlayerTrack,
} from "../types";

// A persistent mini player bar (not a modal): it sits between the main
// content and the footer in App.vue, so music keeps playing while the
// user switches between the Projects and Files tabs or browses the
// library. The queue prop is all audio files in the library, in library
// order; FilesView tells App which file to start on. Playlists and
// favorites (see lib/playlists.ts) are stored by file path in settings,
// so they survive restarts; the effective queue is whatever source is
// selected — All tracks, Favorites, or one custom playlist.
const props = defineProps<{
  track: PlayerTrack;
  queue: PlayerTrack[];
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

const effectiveQueue = computed<PlayerTrack[]>(() => {
  if (source.value === "all") return props.queue;
  if (source.value === "favorites")
    return props.queue.filter(
      (t) => t.kind === "file" && favorites.value.includes(t.file.path),
    );
  const playlist = playlists.value.find((p) => p.id === source.value);
  if (!playlist) return props.queue;
  const byPath = new Map(
    props.queue
      .filter((t) => t.kind === "file")
      .map((t) => [t.file.path, t]),
  );
  const queue: PlayerTrack[] = [];
  for (const track of playlist.tracks) {
    if (track.kind === "youtube") {
      // YouTube links resolve from the playlist itself, never from
      // the library, so they play even with no library folder set.
      queue.push({
        kind: "youtube",
        videoId: track.videoId,
        title: track.title,
      });
    } else {
      const file = byPath.get(track.path);
      if (file) queue.push(file);
    }
  }
  return queue;
});

const current = computed<PlayerTrack | null>(
  () => effectiveQueue.value[index.value] ?? null,
);
const isYoutube = computed(() => current.value?.kind === "youtube");
const currentName = computed(() =>
  current.value ? playerTrackName(current.value) : "",
);
const sourceLabel = computed(() => {
  if (source.value === "all") return "All tracks";
  if (source.value === "favorites") return "Favorites";
  return (
    playlists.value.find((p) => p.id === source.value)?.name ?? "All tracks"
  );
});
const isFavorite = computed(
  () =>
    !!current.value &&
    current.value.kind === "file" &&
    favorites.value.includes(current.value.file.path),
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

// YouTube playback, via the IFrame API, so a YouTube link plays
// through the same bar and queue as local files: same play/pause,
// seek, volume, prev/next, and end-of-track advance. The player
// itself is a small embed in the bar (v-if'd on the current track
// being a link), not a hidden frame — hidden YouTube players get
// throttled and the video is part of the track anyway. The API
// script is loaded lazily, only when a YouTube track first plays;
// the CSP in tauri.conf.json allows its script and frame hosts.
const ytEl = ref<HTMLElement | null>(null);
// Minimal typing for the IFrame API — the full @types/youtube
// package is not worth adding for one small player.
let ytPlayer: {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  destroy: () => void;
} | null = null;
let ytApiPromise: Promise<void> | null = null;
let ytInterval: ReturnType<typeof setInterval> | null = null;
// Last YouTube error code for the current track, shown in the bar
// text so the reason survives even if the toast is missed.
const ytError = ref<number | null>(null);

function loadYtApi(): Promise<void> {
  const win = window as unknown as {
    YT?: { Player: unknown };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (win.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve, reject) => {
    const previous = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    // Without this, a blocked or failed script load would hang the
    // track forever with no feedback at all.
    setTimeout(
      () => reject(new Error("YouTube player script did not load")),
      15000,
    );
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return ytApiPromise;
}

function destroyYt() {
  if (ytInterval) {
    clearInterval(ytInterval);
    ytInterval = null;
  }
  if (ytPlayer) {
    try {
      ytPlayer.destroy();
    } catch {
      // Already gone — destroying twice is harmless either way.
    }
    ytPlayer = null;
  }
}

async function setupYt(videoId: string) {
  try {
    await loadYtApi();
  } catch {
    // Script never arrived (offline, blocked): show the error state
    // instead of leaving a silent, unplayable track, and clear the
    // rejected promise so a later track retries the load.
    ytApiPromise = null;
    error.value = true;
    playing.value = false;
    return;
  }
  await nextTick();
  // The track may have changed while the API was loading.
  if (current.value?.kind !== "youtube" || current.value.videoId !== videoId)
    return;
  const el = ytEl.value;
  if (!el) return;
  const win = window as unknown as {
    YT: {
      Player: new (
        el: HTMLElement,
        opts: Record<string, unknown>,
      ) => typeof ytPlayer;
    };
  };
  ytPlayer = new win.YT.Player(el, {
    videoId,
    playerVars: { autoplay: 1, modestbranding: 1, rel: 0 },
    events: {
      onReady: () => {
        if (!ytPlayer) return;
        ytPlayer.setVolume(muted.value ? 0 : volume.value);
        if (muted.value) ytPlayer.mute();
        ytPlayer.playVideo();
        ytInterval = setInterval(() => {
          if (!ytPlayer) return;
          currentTime.value = ytPlayer.getCurrentTime();
          const d = ytPlayer.getDuration();
          if (d > 0) duration.value = d;
        }, 500);
      },
      onStateChange: (event: { data: number }) => {
        // PlayerState: 0 ended, 1 playing, 2 paused.
        if (event.data === 0) next(true);
        else if (event.data === 1) playing.value = true;
        else if (event.data === 2) playing.value = false;
      },
      onError: (event: { data: number }) => {
        error.value = true;
        playing.value = false;
        // YouTube's error codes, in plain words, so a failure says
        // WHY instead of just "couldn't play": 2 = bad video id,
        // 5 = YouTube's own player error, 100 = not found / removed
        // / private, 101 and 150 = the owner disabled embedding.
        // The last one is not fixable in-app — the fallback is the
        // open-on-YouTube button. The code is also kept in the bar
        // text (see ytError below) so it survives a missed toast.
        const code = event.data;
        ytError.value = code;
        const reason =
          code === 2
            ? "the video id looks invalid"
            : code === 5
              ? "YouTube's player hit an error"
              : code === 100
                ? "the video was not found, removed, or made private"
                : code === 101 || code === 150
                  ? "the owner doesn't allow embedding"
                  : `YouTube error ${code}`;
        showToast(
          `YouTube refused this video: ${reason}. Open it on YouTube with the open button instead.`,
        );
      },
    },
  });
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function load(i: number) {
  const track = effectiveQueue.value[i];
  if (!track) {
    playing.value = false;
    return;
  }
  index.value = i;
  error.value = false;
  ytError.value = null;
  currentTime.value = 0;
  duration.value = 0;
  destroyYt();
  if (track.kind === "youtube") {
    // The embed container renders from `current`, so the player is
    // created after the next render, guarded by video id above.
    void setupYt(track.videoId);
    return;
  }
  if (audio) {
    audio.src = convertFileSrc(track.file.path);
    audio.volume = muted.value ? 0 : volume.value / 100;
    void audio.play().then(
      () => (playing.value = true),
      () => (playing.value = false),
    );
  }
}

function togglePlay() {
  if (!current.value) return;
  if (current.value.kind === "youtube") {
    if (!ytPlayer) return;
    if (playing.value) ytPlayer.pauseVideo();
    else ytPlayer.playVideo();
    return;
  }
  if (!audio) return;
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
    if (current.value?.kind === "youtube") ytPlayer?.seekTo(0, true);
    else if (audio) audio.currentTime = 0;
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
  if (current.value?.kind === "youtube") {
    ytPlayer?.seekTo(value, true);
    currentTime.value = value;
    return;
  }
  if (!audio) return;
  audio.currentTime = value;
  currentTime.value = value;
}

function setVolume(value: number) {
  volume.value = value;
  muted.value = false;
  if (audio) audio.volume = value / 100;
  if (ytPlayer) {
    ytPlayer.setVolume(value);
    ytPlayer.unMute();
  }
}

function toggleMute() {
  muted.value = !muted.value;
  if (audio) audio.volume = muted.value ? 0 : volume.value / 100;
  if (ytPlayer) {
    if (muted.value) ytPlayer.mute();
    else ytPlayer.unMute();
  }
}

function openCurrent() {
  if (!current.value) return;
  if (current.value.kind === "youtube") {
    void openUrl(`https://www.youtube.com/watch?v=${current.value.videoId}`);
  } else {
    void openPath(current.value.file.path);
  }
}

async function refreshPlaylists() {
  playlists.value = await loadPlaylists();
  favorites.value = await loadFavorites();
}



async function toggleCurrentFavorite() {
  // Favorites are local file paths only — YouTube links are not
  // favoritable (the button is disabled for them).
  if (!current.value || current.value.kind !== "file") return;
  const name = current.value.file.name;
  const nowFavorite = await toggleFavorite(current.value.file.path);
  await refreshPlaylists();
  showToast(
    nowFavorite ? `Added ${name} to favorites.` : `Removed ${name} from favorites.`,
  );
}




function close() {
  audio?.pause();
  destroyYt();
  playing.value = false;
  emit("close");
}

watch(
  () => [props.track, props.source] as const,
  async ([track, newSource]) => {
    // One watcher for both, so a single App update (new track + new
    // source + new queue) is applied atomically: set the source first,
    // then find the track in the queue that source resolves to.
    source.value = newSource;
    shuffleHistory.value = [];
    // Playlists are otherwise loaded only on mount, but the manager
    // can add a track — e.g. a YouTube link — to an existing playlist
    // while the bar is already open. Re-reading here, before
    // resolving, is what makes a just-added link actually play:
    // without it the stale copy silently drops the new track from
    // the queue (a playlist of only that link looked empty).
    await refreshPlaylists();
    const i = effectiveQueue.value.findIndex(
      (t) => playerTrackKey(t) === playerTrackKey(track),
    );
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
    (t) => playerTrackKey(t) === playerTrackKey(props.track),
  );
  load(i >= 0 ? i : 0);
  void checkMarquee();
});

onUnmounted(() => {
  window.removeEventListener("resize", onResize);
  audio?.pause();
  audio = null;
  destroyYt();
});
</script>

<template>
  <div
    class="border-t border-neutral-200/70 bg-white/70 backdrop-blur-xl backdrop-saturate-150 dark:border-neutral-800/70 dark:bg-neutral-900/70"
    :class="{ dark: chromeDark }"
  >
    <div class="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
      <div
        v-if="isYoutube"
        ref="ytEl"
        class="h-24 w-44 shrink-0 overflow-hidden rounded-lg bg-black"
      ></div>
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <Music class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
        <div class="min-w-0 overflow-hidden">
          <p
            v-if="!marquee"
            ref="nameEl"
            class="truncate text-sm font-medium"
            :title="currentName"
          >
            {{ current ? currentName : `No tracks in ${sourceLabel} yet` }}
          </p>
          <div v-else class="overflow-hidden" :title="currentName">
            <div
              class="marquee-track flex w-max items-center whitespace-nowrap text-sm font-medium"
              :style="{ animationDuration: `${Math.max(6, currentName.length * 0.25)}s` }"
            >
              <span class="pr-12">{{ currentName }}</span>
              <span class="pr-12">{{ currentName }}</span>
            </div>
          </div>
          <p class="text-xs text-neutral-500">
            <template v-if="current">
              {{ index + 1 }} / {{ effectiveQueue.length }} · {{ sourceLabel }}
              <span v-if="isYoutube">· YouTube</span>
              <span v-if="shuffle">· Shuffle on</span>
            </template>
            <span v-if="error" class="text-red-600 dark:text-red-400">
              — couldn't play this {{ isYoutube ? "video" : "file" }}
              <span v-if="isYoutube && ytError !== null">
                (YouTube error {{ ytError }})
              </span>
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
          :title="isYoutube ? 'YouTube links cannot be favorited' : isFavorite ? 'Remove from favorites' : 'Add to favorites'"
          :disabled="!current || isYoutube"
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
          :title="isYoutube ? 'Open this video on YouTube' : 'Open in its own app'"
          :disabled="!current"
          @click="openCurrent"
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
