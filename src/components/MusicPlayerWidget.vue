<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ExternalLink,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "@lucide/vue";
import { openPath } from "../lib/api";
import { chromeDark } from "../lib/theme";
import type { LibraryFile } from "../types";

// A persistent mini player bar (not a modal): it sits between the main
// content and the footer in App.vue, so music keeps playing while the
// user switches between the Projects and Files tabs or browses the
// library. The queue is the audio files in the library, in library
// order; FilesView tells App which file to start on.
const props = defineProps<{
  track: LibraryFile;
  queue: LibraryFile[];
}>();
const emit = defineEmits<{ close: [] }>();

const index = ref(0);
const current = computed(() => props.queue[index.value] ?? props.track);
const playing = ref(false);
const currentTime = ref(0);
const duration = ref(0);
const volume = ref(100);
const muted = ref(false);
const error = ref(false);

let audio: HTMLAudioElement | null = null;

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function load(i: number) {
  const file = props.queue[i] ?? props.track;
  if (!file) return;
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

function prev() {
  if (currentTime.value > 3) {
    // Like most players: pressing previous near the start of a track
    // restarts it; further in, it goes to the previous track.
    if (audio) audio.currentTime = 0;
    currentTime.value = 0;
    return;
  }
  load(index.value > 0 ? index.value - 1 : props.queue.length - 1);
}

function next(auto = false) {
  if (index.value < props.queue.length - 1) {
    load(index.value + 1);
  } else if (!auto) {
    load(0);
  } else {
    // End of the queue on natural playback: stop, don't loop.
    playing.value = false;
    currentTime.value = 0;
  }
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

function close() {
  audio?.pause();
  playing.value = false;
  emit("close");
}

watch(
  () => props.track,
  (file) => {
    const i = props.queue.findIndex((f) => f.path === file.path);
    load(i >= 0 ? i : 0);
  },
);

onMounted(() => {
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
    class="border-t border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900"
    :class="{ dark: chromeDark }"
  >
    <div class="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <Music class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
        <div class="min-w-0">
          <p class="truncate text-sm font-medium" :title="current.name">
            {{ current.name }}
          </p>
          <p class="text-xs text-neutral-500">
            {{ index + 1 }} / {{ queue.length || 1 }}
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
          @click="prev"
        >
          <SkipBack class="h-5 w-5" />
        </button>
        <button
          class="rounded-full bg-blue-600 p-2.5 text-white hover:bg-blue-700"
          :title="playing ? 'Pause' : 'Play'"
          @click="togglePlay"
        >
          <Pause v-if="playing" class="h-5 w-5" />
          <Play v-else class="h-5 w-5" />
        </button>
        <button
          class="rounded p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          title="Next track"
          @click="next()"
        >
          <SkipForward class="h-5 w-5" />
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
          @click="openPath(current.path)"
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
