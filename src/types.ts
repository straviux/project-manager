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
 * A password entry's metadata only. The secret itself is NEVER in
 * this type, in SQLite, or in any frontend state except briefly
 * while revealed: it lives only in the OS keychain under
 * `password-<id>` (see the password_* Rust commands, same pattern
 * as SSH passwords). Revealing fetches it on demand; closing the
 * manager drops it.
 */
export interface PasswordEntry {
  id: number;
  name: string;
  username: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
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
