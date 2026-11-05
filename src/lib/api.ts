import { invoke } from "@tauri-apps/api/core";
import type { FileCheck, GitStatus, LibraryFile, PrintPrerequisites, PrintServerStatus, ScannedProject, SshConfig } from "../types";

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

/** Open a terminal at `path` already running `command`. */
export function openTerminalWithCommand(
  path: string,
  command: string,
): Promise<void> {
  return invoke("open_terminal_command", { path, command });
}

/** Pull the current branch fast-forward only. Resolves to git's output. */
export function gitPull(path: string): Promise<string> {
  return invoke("git_pull", { path });
}

/**
 * Fetch remote refs without touching the working tree (autofetch).
 * Rejects on no remote / offline / auth failure; callers ignore it.
 */
export function gitFetch(path: string): Promise<void> {
  return invoke("git_fetch", { path });
}

/* ------------------------- internal terminal ------------------------ */

/** Start `command` in an internal-terminal tab (output arrives as events). */
export function startRun(
  runId: number,
  path: string,
  command: string,
): Promise<void> {
  return invoke("start_run", { runId, path, command });
}

/** Stop the internal-terminal command in one tab, if it is running. */
export function stopRun(runId: number): Promise<void> {
  return invoke("stop_run", { runId });
}

/** Send a line of input to the command in one terminal tab. */
export function terminalInput(runId: number, input: string): Promise<void> {
  return invoke("terminal_input", { runId, input });
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

/* Password manager: secrets live only in the OS keychain (Rust
   password_*), never in SQLite or frontend storage except briefly
   while revealed. See the PasswordEntry type. */

/** Save (or overwrite) the keychain secret for a password entry. */
export function passwordSetPassword(
  entryId: number,
  password: string,
): Promise<void> {
  return invoke("password_set_password", { entryId, password });
}

/** Reveal a password entry's secret on demand. */
export function passwordGetPassword(entryId: number): Promise<string> {
  return invoke("password_get_password", { entryId });
}

/** Whether a keychain secret exists for this entry. */
export function passwordHasPassword(entryId: number): Promise<boolean> {
  return invoke("password_has_password", { entryId });
}

/** Delete the keychain secret for an entry (metadata is deleted separately). */
export function passwordDeletePassword(entryId: number): Promise<void> {
  return invoke("password_delete_password", { entryId });
}

/** Copy the secret to the clipboard inside Rust (clears after 60s). */
export function passwordCopyPassword(entryId: number): Promise<void> {
  return invoke("password_copy_password", { entryId });
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

/**
 * Convert a .doc/.ppt/.pptx/.xls file to PDF with Microsoft Office
 * (assumed installed) and return the cached PDF's absolute path. The
 * Rust side caches by file stem + size + modified time, so an
 * unchanged file converts only once.
 */
export function convertOfficeToPdf(path: string): Promise<string> {
  return invoke("convert_office_to_pdf", { path });
}

/* ------------------------- print server (Level 1) ----------------------- */
/* Setup panel only: the Python print server still does the real work.
   These commands check host readiness and start/stop it; uploading
   and the queue stay in the browser print page. */

/** This PC's LAN address (for the host URL shown after starting). */
export function printLanIp(): Promise<string> {
  return invoke("print_lan_ip");
}

/** Best-effort auto-detect for the print-server folder ("" when not found). */
export function printDefaultServerDir(): Promise<string> {
  return invoke("print_default_server_dir");
}

/** One-click readiness check for hosting the print server. */
export function printCheckPrerequisites(serverDir: string): Promise<PrintPrerequisites> {
  return invoke("print_check_prerequisites", { serverDir });
}

/** Start `python server.py` in the print-server folder. Resolves to the host URL. */
export function printStartServer(serverDir: string, port: number, printer: string): Promise<string> {
  return invoke("print_start_server", { serverDir, port, printer });
}

/** Stop the print server started from this app. */
export function printStopServer(): Promise<void> {
  return invoke("print_stop_server");
}

/** Whether the print server (started from this app) is still running. */
export function printServerStatus(): Promise<PrintServerStatus> {
  return invoke("print_server_status");
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
