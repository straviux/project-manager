import { getSetting, setSetting } from "./db";

/**
 * Music playlists and favorites, persisted in the settings table as
 * JSON (no new DB tables needed — playlists are just lists of library
 * file paths, small enough for a settings value). Tracks are stored
 * by path, not by name, so two files with the same name stay distinct.
 * A track whose file was moved or deleted simply won't resolve to a
 * library file when a playlist is played, and is skipped then.
 */

export interface Playlist {
  id: string;
  name: string;
  /** Library file paths, in playlist order. */
  tracks: string[];
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

export async function loadPlaylists(): Promise<Playlist[]> {
  const list = await loadJson<Playlist[]>(PLAYLISTS_KEY, []);
  return Array.isArray(list) ? list : [];
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
  if (!playlist || playlist.tracks.includes(path)) return;
  playlist.tracks.push(path);
  await savePlaylists(playlists);
}

export async function removeFromPlaylist(id: string, path: string): Promise<void> {
  const playlists = await loadPlaylists();
  const playlist = playlists.find((p) => p.id === id);
  if (!playlist) return;
  playlist.tracks = playlist.tracks.filter((t) => t !== path);
  await savePlaylists(playlists);
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
