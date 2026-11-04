<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  ChevronDown,
  ChevronRight,
  Heart,
  ListMusic,
  Music,
  Pencil,
  Play,
  Plus,
  Settings2,
  Trash2,
} from "@lucide/vue";
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
  renamePlaylist,
  loadPlaylists,
  removeTrackFromPlaylist,
  renameYoutubeTrack,
  youtubeVideoIdFromUrl,
  type Playlist,
  type PlaylistTrack,
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

// --- Row menu: one Settings2 icon button per playlist, opening a
// small fixed-position menu with Rename and Delete. Fixed (not
// absolute) on purpose: the playlist list scrolls, and an absolute
// menu would be clipped by that scroll container. The menu flips
// above the button when there is no room below it.
const menuId = ref<string | null>(null);
const menuPos = ref({ top: 0, left: 0 });

function openMenu(event: MouseEvent, id: string) {
  if (menuId.value === id) {
    menuId.value = null;
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const width = 176; // w-44
  const height = 100; // two rows + padding, roughly
  menuPos.value = {
    top:
      rect.bottom + height + 4 <= window.innerHeight
        ? rect.bottom + 4
        : rect.top - height - 4,
    left: Math.max(8, rect.right - width),
  };
  menuId.value = id;
}

function closeMenu() {
  menuId.value = null;
}

const menuPlaylist = computed(
  () => playlists.value.find((p) => p.id === menuId.value) ?? null,
);

async function deleteMenuPlaylist() {
  if (!menuId.value) return;
  const id = menuId.value;
  closeMenu();
  await deleteById(id);
}

// --- Playlist rename, edited inline in the name block.
const renamingId = ref<string | null>(null);
const renameName = ref("");

function startRename(playlist: Playlist) {
  closeMenu();
  renamingId.value = playlist.id;
  renameName.value = playlist.name;
}

async function saveRename(id: string) {
  await renamePlaylist(id, renameName.value);
  renamingId.value = null;
  renameName.value = "";
  await refresh();
}

// --- Playlist items: view, play one, remove one, rename a link,
// add a library file. Only one playlist is expanded at a time, so
// the add/edit drafts are single refs reset on every expand switch.
const expandedId = ref<string | null>(null);
const editingIndex = ref<number | null>(null);
const editTitle = ref("");
const addFilePath = ref("");

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
  editingIndex.value = null;
  editTitle.value = "";
  addFilePath.value = "";
}

function trackLabel(track: PlaylistTrack): string {
  if (track.kind === "youtube") return track.title;
  const parts = track.path.split(/[\\/]/);
  return parts[parts.length - 1] || track.path;
}

// A file track whose path is no longer in the library (moved or
// deleted) still shows in the list, marked, and is skipped on play.
function trackMissing(track: PlaylistTrack): boolean {
  return (
    track.kind === "file" &&
    !audioFiles.value.some((f) => f.path === track.path)
  );
}

// Each stored track paired with the PlayerTrack it resolves to, or
// null when it cannot play (a missing file). YouTube tracks always
// resolve; file tracks resolve only against the library.
function resolvedTracks(
  playlist: Playlist,
): { track: PlaylistTrack; player: PlayerTrack | null }[] {
  const byPath = new Map(audioFiles.value.map((f) => [f.path, f]));
  return playlist.tracks.map((track) => {
    if (track.kind === "youtube") {
      return {
        track,
        player: {
          kind: "youtube" as const,
          videoId: track.videoId,
          title: track.title,
        },
      };
    }
    const file = byPath.get(track.path);
    return { track, player: file ? { kind: "file" as const, file } : null };
  });
}

function playTrack(playlist: Playlist, index: number) {
  const resolved = resolvedTracks(playlist);
  const entry = resolved[index];
  if (!entry?.player) return;
  const queue = resolved
    .map((r) => r.player)
    .filter((p): p is PlayerTrack => p !== null);
  emit("play", entry.player, queue, playlist.id);
  emit("close");
}

async function removeTrack(id: string, index: number) {
  await removeTrackFromPlaylist(id, index);
  await refresh();
}

function startEditTitle(index: number, title: string) {
  editingIndex.value = index;
  editTitle.value = title;
}

async function saveEditTitle(id: string, index: number) {
  await renameYoutubeTrack(id, index, editTitle.value);
  editingIndex.value = null;
  editTitle.value = "";
  await refresh();
}

function availableFiles(playlist: Playlist): LibraryFile[] {
  return audioFiles.value.filter(
    (f) => !playlist.tracks.some((t) => t.kind === "file" && t.path === f.path),
  );
}

async function addFile(id: string) {
  if (!addFilePath.value) return;
  const playlist = playlists.value.find((p) => p.id === id);
  await addToPlaylist(id, addFilePath.value);
  addFilePath.value = "";
  await refresh();
  if (playlist) showToast(`Added to ${playlist.name}.`);
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
    <div ref="dialogPanel" class="glass-panel w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900 dark:text-neutral-100">
      <h2 ref="dialogHandle" class="mb-4 flex cursor-grab items-center gap-2 text-lg font-semibold active:cursor-grabbing">
        <ListMusic class="h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" /> Playlists
      </h2>

      <ul class="mb-4 max-h-80 space-y-1 overflow-y-auto pr-1">
        <li
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          :class="activeSource === 'all' ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
        >
          <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-600 text-white disabled:opacity-40" title="Play" :disabled="!audioFiles.length" @click="playSource('all')"><Play class="h-4 w-4" /></button>
          <button class="min-w-0 flex-1 text-left" @click="playSource('all')">
            <span class="block truncate font-medium">All tracks</span>
            <span class="block text-xs text-neutral-500">{{ audioFiles.length }} tracks</span>
          </button>
        </li>
        <li
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          :class="activeSource === 'favorites' ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
        >
          <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-600 text-white disabled:opacity-40" title="Play" :disabled="!favoriteFiles.length" @click="playSource('favorites')"><Play class="h-4 w-4" /></button>
          <button class="min-w-0 flex-1 text-left" @click="playSource('favorites')">
            <span class="block truncate font-medium"><Heart class="mr-1 inline h-4 w-4 fill-red-500 text-red-500" /> Favorites</span>
            <span class="block text-xs text-neutral-500">{{ favoriteFiles.length }} tracks</span>
          </button>
        </li>
        <li
          v-for="playlist in playlists"
          :key="playlist.id"
          class="rounded-lg px-2 py-1.5 text-sm"
          :class="activeSource === playlist.id ? 'bg-blue-100 dark:bg-blue-900/40' : ''"
        >
          <div class="flex items-center gap-2">
            <button class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-600 text-white disabled:opacity-40" title="Play" :disabled="!queueFor(playlist.id).length" @click="playSource(playlist.id)"><Play class="h-4 w-4" /></button>
            <template v-if="renamingId === playlist.id">
              <input
                v-model="renameName"
                type="text"
                class="h-8 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                @keyup.enter="saveRename(playlist.id)"
                @keyup.escape="renamingId = null"
              />
              <button class="flex h-8 shrink-0 items-center rounded bg-blue-600 px-2.5 text-xs font-medium text-white" @click="saveRename(playlist.id)">Save</button>
              <button class="flex h-8 shrink-0 items-center rounded px-2 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700" @click="renamingId = null">Cancel</button>
            </template>
            <template v-else>
              <button class="flex min-w-0 flex-1 items-center gap-1 text-left" @click="toggleExpand(playlist.id)">
                <ChevronDown v-if="expandedId === playlist.id" class="h-4 w-4 shrink-0" />
                <ChevronRight v-else class="h-4 w-4 shrink-0" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium">{{ playlist.name }}</span>
                  <span class="block text-xs text-neutral-500">{{ queueFor(playlist.id).length }} tracks</span>
                </span>
              </button>
              <button
                class="flex h-8 shrink-0 items-center rounded px-2 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-40"
                :disabled="currentFilePath === null || playlist.tracks.some((t) => t.kind === 'file' && t.path === currentFilePath)"
                title="Add the currently playing local track to this playlist"
                @click="addCurrent(playlist.id)"
              >
                + Current
              </button>
              <button
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                title="More actions"
                @click="openMenu($event, playlist.id)"
              >
                <Settings2 class="h-4 w-4" />
              </button>
            </template>
          </div>

          <div v-if="expandedId === playlist.id" class="ml-10 mt-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <p v-if="!playlist.tracks.length" class="py-1 text-xs text-neutral-500">
              No items yet — add a library file below, or a YouTube link in the section under the playlists.
            </p>
            <ul v-else class="space-y-0.5">
              <li
                v-for="(entry, index) in resolvedTracks(playlist)"
                :key="index"
                class="flex items-center gap-2 rounded px-1 py-1 text-xs"
              >
                <Music v-if="entry.track.kind === 'file'" class="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <span v-else class="shrink-0 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">YouTube</span>
                <template v-if="editingIndex === index && entry.track.kind === 'youtube'">
                  <input
                    v-model="editTitle"
                    type="text"
                    class="h-7 min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    @keyup.enter="saveEditTitle(playlist.id, index)"
                    @keyup.escape="editingIndex = null"
                  />
                  <button class="shrink-0 rounded bg-blue-600 px-2 py-1 font-medium text-white" @click="saveEditTitle(playlist.id, index)">Save</button>
                  <button class="shrink-0 rounded px-2 py-1 hover:bg-neutral-200 dark:hover:bg-neutral-700" @click="editingIndex = null">Cancel</button>
                </template>
                <template v-else>
                  <span
                    class="min-w-0 flex-1 truncate"
                    :class="trackMissing(entry.track) ? 'text-neutral-400 line-through' : ''"
                    :title="entry.track.kind === 'file' ? entry.track.path : `https://www.youtube.com/watch?v=${entry.track.videoId}`"
                  >
                    {{ trackLabel(entry.track) }}
                  </span>
                  <span v-if="trackMissing(entry.track)" class="shrink-0 text-neutral-400">file missing</span>
                  <button
                    v-if="entry.track.kind === 'youtube'"
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    title="Rename this link"
                    @click="startEditTitle(index, entry.track.title)"
                  >
                    <Pencil class="h-3.5 w-3.5" />
                  </button>
                  <button
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-blue-600 text-white disabled:opacity-40"
                    title="Play this item (in this playlist's order)"
                    :disabled="!entry.player"
                    @click="playTrack(playlist, index)"
                  >
                    <Play class="h-3.5 w-3.5" />
                  </button>
                  <button
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-950"
                    title="Remove this item from the playlist"
                    @click="removeTrack(playlist.id, index)"
                  >
                    <Trash2 class="h-3.5 w-3.5" />
                  </button>
                </template>
              </li>
            </ul>
            <div class="mt-2 flex gap-2">
              <select
                v-model="addFilePath"
                class="h-8 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                :disabled="!availableFiles(playlist).length"
              >
                <option value="" disabled>
                  {{ audioFiles.length ? "Add a library file…" : "Set your library folder in the Files tab first" }}
                </option>
                <option v-for="f in availableFiles(playlist)" :key="f.path" :value="f.path">
                  {{ f.name }}
                </option>
              </select>
              <button
                class="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 text-xs font-medium text-white disabled:opacity-40"
                :disabled="!addFilePath"
                @click="addFile(playlist.id)"
              >
                <Plus class="h-3.5 w-3.5" /> Add file
              </button>
            </div>
            <p v-if="audioFiles.length && !availableFiles(playlist).length" class="mt-1 text-xs text-neutral-500">
              Every library audio file is already in this playlist.
            </p>
          </div>
        </li>
      </ul>

      <div class="mb-5 flex gap-2">
        <input
          v-model="newPlaylistName"
          type="text"
          placeholder="New playlist name…"
          class="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          @keyup.enter="createNew"
        />
        <button
          class="flex h-10 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-40"
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
            class="h-10 rounded-lg border border-neutral-300 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
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
            class="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            @keyup.enter="addYoutube"
          />
        </div>
        <div class="flex gap-2">
          <input
            v-model="youtubeTitle"
            type="text"
            placeholder="Name for this link (optional — defaults to the video id)"
            class="h-10 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            @keyup.enter="addYoutube"
          />
          <button
            class="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-40"
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
        Click a playlist's name to see its items, play one
        in place, remove one, rename a YouTube link, or add a library
        file to it. Rename or delete a playlist from its settings
        menu on the right.
      </p>

      <div class="flex justify-end">
        <button class="btn btn-ghost btn-sm" @click="emit('close')">Close</button>
      </div>
    </div>

    <template v-if="menuPlaylist">
      <div class="fixed inset-0 z-40" @click="closeMenu"></div>
      <div
        class="fixed z-50 w-44 rounded-2xl bg-white p-2 text-sm text-neutral-900 shadow-xl ring-1 ring-neutral-200 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/10"
        :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
      >
        <button
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
          @click="startRename(menuPlaylist)"
        >
          <Pencil class="h-4 w-4" /> Rename
        </button>
        <button
          class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
          @click="deleteMenuPlaylist"
        >
          <Trash2 class="h-4 w-4" /> Delete
        </button>
      </div>
    </template>
  </div>
</template>
