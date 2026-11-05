export interface Project {
  id: number;
  name: string;
  path: string;
  repoUrl: string | null;
  description: string | null;
  stacks: string[];
  pinned: boolean;
  sortOrder: number;
  iconKind: "lucide" | "ico" | null;
  iconValue: string | null;
  iconColor: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDraft {
  name: string;
  path: string;
  repoUrl: string | null;
  description: string | null;
  stacks: string[];
}

/** A project folder discovered by scanning the parent directory (Rust side). */
export interface ScannedProject {
  name: string;
  path: string;
  repoUrl: string | null;
  stacks: string[];
  hasReadme: boolean;
}

/** Working-tree status shown on a project card. */
export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  dirty: boolean;
  changedFiles: number;
  ahead: number;
  behind: number;
}

export interface SshConfig {
  id: number;
  projectId: number | null;
  name: string;
  host: string;
  username: string;
  port: number;
  identityFile: string | null;
}

export interface SshConfigDraft {
  projectId: number | null;
  name: string;
  host: string;
  username: string;
  port: number;
  identityFile: string | null;
}

/** Result of the file-manager "is this file safe to move?" check. */
export interface FileCheck {
  free: boolean;
  reason: string | null;
}

/** A file inside the managed file library (from the Rust scanner). */
/** Per-file status & notes, stored in SQLite keyed by absolute path.
 * openCount/lastOpened drive the Quick Access "Most opened" section:
 * they are read here but never written by setFileMeta, which only
 * touches status/notes/starred, so starring a file can never wipe
 * its open count. Only recordFileOpen writes them. */
export interface FileMeta {
  status: string;
  notes: string;
  starred: boolean;
  openCount: number;
  lastOpened: string | null;
}

export interface LibraryFile {
  name: string;
  path: string;
  relativePath: string;
  folder: string;
  category: string;
  size: number;
}

/**
 * One track in the music player queue. Local files and YouTube links
 * play through the same bar and the same queue: a file track wraps a
 * LibraryFile, a YouTube track carries just its video id and the
 * title the user gave it when adding the link (YouTube titles are
 * not fetched — no API key, no extra network call).
 */
export type PlayerTrack =
  | { kind: "file"; file: LibraryFile }
  | { kind: "youtube"; videoId: string; title: string };

export function playerTrackName(track: PlayerTrack): string {
  return track.kind === "file" ? track.file.name : track.title;
}

/** Stable identity for finding a track in a queue: path or video id. */
export function playerTrackKey(track: PlayerTrack): string {
  return track.kind === "file" ? `file:${track.file.path}` : `youtube:${track.videoId}`;
}

/** A global todo. projectId is optional: a todo with no project is
 * just a global todo; one with a project shows up filtered per
 * project as well. Deleting a project unlinks (not deletes) its todos. */
export interface Todo {
  id: number;
  title: string;
  notes: string;
  done: boolean;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A password entry: metadata plus a flag saying whether a vault
 * secret is stored. The secret itself is NEVER plaintext in this
 * type — only its AES-GCM ciphertext sits in SQLite (see the
 * `secret` column and src/lib/vault.ts), and revealing decrypts it
 * into frontend memory only while the manager is unlocked; closing
 * the manager drops both the revealed values and the vault key.
 */
export interface PasswordEntry {
  id: number;
  name: string;
  username: string;
  notes: string;
  /** True when a vault secret is stored for this entry. */
  hasSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Print server (Level 1 setup panel): readiness checks and status
 * for the office print server. The server itself still runs as
 * Python in the print-server folder; these types only describe
 * whether this PC is ready to host it and whether it is running.
 */
export interface PrintPrerequisites {
  pythonOk: boolean;
  pythonDetail: string;
  sumatraOk: boolean;
  sumatraDetail: string;
  printers: string[];
  printersError: string;
  l3210Found: boolean;
  officeOk: boolean;
  officeDetail: string;
  serverFound: boolean;
  serverDir: string;
}

export interface PrintServerStatus {
  running: boolean;
  url: string;
  dir: string;
  port: number;
}

/** Library categories used by the (future) file manager. */
export const FILE_CATEGORIES = [
  "Images",
  "Videos",
  "Audio",
  "Documents",
  "Archives",
  "Code",
  "Other",
] as const;

/** Stack labels the detector can produce; also offered in the project form. */
export const KNOWN_STACKS = [
  "Vue",
  "React",
  "Angular",
  "Svelte",
  "Nuxt",
  "Next.js",
  "Node.js",
  "Tauri",
  "Rust",
  "Go",
  "Python",
  "Ruby",
  "PHP",
  "Laravel",
  "Java",
  ".NET",
  "Docker",
  "TypeScript",
] as const;
