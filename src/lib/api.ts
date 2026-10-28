import { invoke } from "@tauri-apps/api/core";
import type { FileCheck, GitStatus, LibraryFile, ScannedProject, SshConfig } from "../types";

/** Open the project folder in VS Code. */
export function openInVsCode(path: string): Promise<void> {
  return invoke("open_in_vscode", { path });
}

/** Open a terminal already cd'd into the project root. */
/** Open a link in the user's real browser (see open_url in Rust). */
export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

export function openTerminal(path: string): Promise<void> {
  return invoke("open_terminal", { path });
}

/** Open a terminal running an ssh session from a saved profile. */
export function openSshTerminal(config: SshConfig): Promise<void> {
  return invoke("open_ssh_terminal", {
    host: config.host,
    username: config.username,
    port: config.port,
    identityFile: config.identityFile,
  });
}

/* SSH passwords live only in the OS keychain — these never return the
   password to the frontend. */
export function sshSetPassword(configId: number, password: string): Promise<void> {
  return invoke("ssh_set_password", { configId, password });
}

export function sshHasPassword(configId: number): Promise<boolean> {
  return invoke("ssh_has_password", { configId });
}

export function sshDeletePassword(configId: number): Promise<void> {
  return invoke("ssh_delete_password", { configId });
}

/** Copy the saved password to the clipboard (done inside Rust). */
export function sshCopyPassword(configId: number): Promise<void> {
  return invoke("ssh_copy_password", { configId });
}

/**
 * Clone `repoUrl` into `parentDir` (folder name derived from the URL when
 * omitted). Resolves to the new project's absolute path.
 */
export function gitClone(
  repoUrl: string,
  parentDir: string,
  folderName?: string,
): Promise<string> {
  return invoke("git_clone", { repoUrl, parentDir, folderName });
}

/** Scan the parent directory for project folders. */
export function scanProjects(parentDir: string): Promise<ScannedProject[]> {
  return invoke("scan_projects", { parentDir });
}

/** Branch, dirty state and ahead/behind counts for a project folder. */
export function getGitStatus(path: string): Promise<GitStatus> {
  return invoke("git_status", { path });
}

/** Detect the stacks used by the project at `path`. */
export function detectStacks(path: string): Promise<string[]> {
  return invoke("detect_stacks", { path });
}

/** Read the project's README.md (null when it has none). */
export function readReadme(path: string): Promise<string | null> {
  return invoke("read_readme", { path });
}

/* ---------------------------- file manager ---------------------------- */
/* Future feature — see docs/file-manager.md.                         */

/** Is this file free to move (not locked, open, or a running program)? */
export function checkFileFree(path: string): Promise<FileCheck> {
  return invoke("check_file_free", { path });
}

/**
 * Move a file into the managed library folder, categorized by type.
 * Rejects while the file is in use. Resolves to the new absolute path.
 */
export function moveFileToLibrary(
  source: string,
  libraryDir: string,
): Promise<string> {
  return invoke("move_file_to_library", { source, libraryDir });
}

/** List every file in the managed library folder (recursive). */
export function listLibraryFiles(libraryDir: string): Promise<LibraryFile[]> {
  return invoke("list_library_files", { libraryDir });
}

/** Open a file or folder with the OS default application. */
export function openPath(path: string): Promise<void> {
  return invoke("open_path", { path });
}

/** Allow the asset protocol to serve this folder (library thumbnails). */
export function allowAssetDir(dir: string): Promise<void> {
  return invoke("allow_asset_dir", { dir });
}

/** Permanently delete a file from the library (must live inside it). */
export function deleteLibraryFile(libraryDir: string, path: string): Promise<void> {
  return invoke("delete_library_file", { libraryDir, path });
}

/** Permanently delete a folder (and everything in it) from the library. */
export function deleteLibraryFolder(libraryDir: string, folder: string): Promise<void> {
  return invoke("delete_library_folder", { libraryDir, folder });
}

/** Move a file or folder inside the library into another library folder
 *  ("" = the library root). Returns the new absolute path. */
export function moveLibraryItem(
  libraryDir: string,
  source: string,
  destFolder: string,
): Promise<string> {
  return invoke("move_library_item", { libraryDir, source, destFolder });
}

/** Duplicate a file or folder inside the library, next to the original.
 *  Returns the new absolute path. */
export function duplicateLibraryItem(
  libraryDir: string,
  source: string,
): Promise<string> {
  return invoke("duplicate_library_item", { libraryDir, source });
}

export interface ImportResult {
  path: string;
  warning: string | null;
}

/** Move or copy an existing folder into the projects parent folder. */
export function importProjectFolder(
  source: string,
  name: string,
  mode: "move" | "copy",
  projectsDir: string,
): Promise<ImportResult> {
  return invoke("import_project_folder", { source, name, mode, projectsDir });
}

/** Copy a user-picked .ico into app storage for a project; returns the stored path. */
export function saveProjectIcon(source: string, projectId: number): Promise<string> {
  return invoke("save_project_icon", { source, projectId });
}

/** Delete a project's stored .ico file (if any). */
export function deleteProjectIcon(projectId: number): Promise<void> {
  return invoke("delete_project_icon", { projectId });
}

/**
 * Save a newly created document into the library. The backend validates
 * the name, keeps the file inside the library, and never overwrites an
 * existing file (it adds " - Copy" like Duplicate does). Resolves to the
 * new file's absolute path.
 */
export function saveDocumentFile(
  libraryDir: string,
  folder: string,
  filename: string,
  dataBase64: string,
): Promise<string> {
  return invoke("save_document_file", {
    libraryDir,
    folder,
    filename,
    dataBase64,
  });
}

/** Move or copy a folder into the file library, keeping its structure. */
export function importFolderToLibrary(
  source: string,
  name: string,
  mode: "move" | "copy",
  libraryDir: string,
): Promise<ImportResult> {
  return invoke("import_folder_to_library", { source, name, mode, libraryDir });
}
