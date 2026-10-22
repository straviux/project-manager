export interface Project {
  id: number;
  name: string;
  path: string;
  repoUrl: string | null;
  description: string | null;
  stacks: string[];
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
