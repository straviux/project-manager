import { getSetting, setSetting } from "./db";

/**
 * Internal-terminal input history, persisted in the settings table as
 * JSON (same pattern as playlists — no new DB table). This is the
 * command line typed into a running terminal tab, not the per-project
 * run command the Run dialog already saves: the history is shared
 * across tabs, oldest first in storage, and recalled most-recent-first
 * with Up/Down in the input. Typing a prefix before pressing Up
 * filters to history entries starting with that prefix.
 */

const TERMINAL_HISTORY_KEY = "terminal_history";
const MAX_HISTORY = 100;

export async function loadTerminalHistory(): Promise<string[]> {
  try {
    const raw = await getSetting(TERMINAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

export async function saveTerminalHistory(history: string[]): Promise<void> {
  await setSetting(
    TERMINAL_HISTORY_KEY,
    JSON.stringify(history.slice(-MAX_HISTORY)),
  );
}
