import { desktopDir } from "@tauri-apps/api/path";

/**
 * Where native file/folder pickers should start. The app process working
 * directory is System32 when launched from an installer shortcut, which is
 * where pickers would otherwise open — the Desktop is the sane default.
 */
export async function pickerDefaultPath(): Promise<string | undefined> {
  try {
    return await desktopDir();
  } catch {
    return undefined;
  }
}
