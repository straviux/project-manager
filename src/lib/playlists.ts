import { getSetting, setSetting } from "./db";

/**
 * Music playlists and favorites, persisted in the settings table as
 * JSON (no new DB tables needed — playlists are just lists of library
 * file paths, small enough for a settings value). Tracks are stored
 * by path, not by name, so two files with the same name stay distinct.
 * A track whose file was moved or deleted simply won't resolve to a
 * library file when a playlist is played, and is skipped then.
 */

/**
 * One entry in a playlist, in playlist order. A file track is a
 * library file path; a YouTube track is a video id plus the title
 * the user gave it. Older saved playlists stored tracks as plain
 * strings (file paths only) — loadPlaylists normalizes those to
 * file tracks, so nothing saved before is lost.
 */
export type PlaylistTrack =
  | { kind: "file"; path: string }
  | { kind: "youtube"; videoId: string; title: string };

export interface Playlist {
  id: string;
  name: string;
  tracks: PlaylistTrack[];
}

const PLAYLISTS_KEY = "playlists";
const FAVORITES_KEY = "favorite_tracks";

function newId(): string {
  return `pl_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getSetting(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTrack(raw: unknown): PlaylistTrack | null {
  if (typeof raw === "string") return { kind: "file", path: raw };
  if (raw && typeof raw === "object") {
    const t = raw as { kind?: unknown; path?: unknown; videoId?: unknown; title?: unknown };
    if (t.kind === "file" && typeof t.path === "string")
      return { kind: "file", path: t.path };
    if (
      t.kind === "youtube" &&
      typeof t.videoId === "string" &&
      typeof t.title === "string"
    )
      return { kind: "youtube", videoId: t.videoId, title: t.title };
  }
  return null;
}

export async function loadPlaylists(): Promise<Playlist[]> {
  const list = await loadJson<Playlist[]>(PLAYLISTS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p.id === "string" && Array.isArray(p.tracks))
    .map((p) => ({
      ...p,
      tracks: (p.tracks as unknown[])
        .map(normalizeTrack)
        .filter((t): t is PlaylistTrack => t !== null),
    }));
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  await setSetting(PLAYLISTS_KEY, JSON.stringify(playlists));
}

export async function createPlaylist(name: string): Promise<Playlist> {
  const playlists = await loadPlaylists();
  const playlist: Playlist = { id: newId(), name: name.trim() || "Playlist", tracks: [] };
  playlists.push(playlist);
  await savePlaylists(playlists);
  return playlist;
}

export async function deletePlaylist(id: string): Promise<void> {
  const playlists = await loadPlaylists();
  await savePlaylists(playlists.filter((p) => p.id !== id));
}

export async function addToPlaylist(id: string, path: string): Promise<void> {
  const playlists = await loadPlaylists();
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  const already = playlist.tracks.some(
    (t) => t.kind === "file" && t.path === path,
  );
  if (already) return;
  playlist.tracks.push({ kind: "file", path });
  await savePlaylists(playlists);
}

export async function removeFromPlaylist(id: string, path: string): Promise<void> {
  const playlists = await loadPlaylists();
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  playlist.tracks = playlist.tracks.filter(
    (t) => !(t.kind === "file" && t.path === path),
  );
  await savePlaylists(playlists);
}

/** Add a YouTube link to a playlist. No-op if that video is already in it. */
export async function addYoutubeToPlaylist(
  id: string,
  videoId: string,
  title: string,
): Promise<void> {
  const playlists = await loadPlaylists();
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  const already = playlist.tracks.some(
    (t) => t.kind === "youtube" && t.videoId === videoId,
  );
  if (already) return;
  playlist.tracks.push({ kind: "youtube", videoId, title });
  await savePlaylists(playlists);
}

/**
 * Pull a YouTube video id out of a pasted link. Accepts watch, short,
 * embed, live, and youtu.be links, plus music.youtube.com — anything
 * else returns null so the UI can say the link was not understood.
 */
export function youtubeVideoIdFromUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtube\.com\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function loadFavorites(): Promise<string[]> {
  const list = await loadJson<string[]>(FAVORITES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export async function saveFavorites(paths: string[]): Promise<void> {
  await setSetting(FAVORITES_KEY, JSON.stringify(paths));
}

/** Toggle a track's favorite state. Returns true if it is now a favorite. */
export async function toggleFavorite(path: string): Promise<boolean> {
  const favorites = await loadFavorites();
  const i = favorites.indexOf(path);
  if (i >= 0) {
    favorites.splice(i, 1);
    await saveFavorites(favorites);
    return false;
  }
  favorites.push(path);
  await saveFavorites(favorites);
  return true;
}
