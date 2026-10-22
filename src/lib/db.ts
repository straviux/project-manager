import Database from "@tauri-apps/plugin-sql";
import type {
  Project,
  ProjectDraft,
  SshConfig,
  SshConfigDraft,
} from "../types";

let dbPromise: Promise<Database> | null = null;

function loadDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await Database.load("sqlite:project-manager.db");
      await db.execute("PRAGMA foreign_keys = ON");
      await db.execute(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS projects (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          path        TEXT NOT NULL UNIQUE,
          repo_url    TEXT,
          description TEXT,
          created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
      await db.execute(`
        CREATE TABLE IF NOT EXISTS project_stacks (
          project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          stack      TEXT NOT NULL,
          PRIMARY KEY (project_id, stack)
        )`);
      // Migrations for existing databases (columns added after v0.1).
      const cols = await db.select<{ name: string }[]>(
        "PRAGMA table_info(projects)",
      );
      const colNames = new Set(cols.map((c) => c.name));
      if (!colNames.has("pinned")) {
        await db.execute(
          "ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
        );
      }
      if (!colNames.has("sort_order")) {
        await db.execute(
          "ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
        );
      }
      // NOTE: SSH passwords are intentionally NOT stored here.
      // Profiles hold connection details only; auth uses SSH keys.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS ssh_configs (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          host          TEXT NOT NULL,
          username      TEXT NOT NULL,
          port          INTEGER NOT NULL DEFAULT 22,
          identity_file TEXT,
          created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
      return db;
    })();
  }
  return dbPromise;
}

/* ------------------------------ settings ------------------------------ */

export async function getSetting(key: string): Promise<string | null> {
  const db = await loadDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows.length ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await loadDb();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export const PROJECTS_DIR_KEY = "projects_dir";
export const FILES_DIR_KEY = "files_dir";

/* ------------------------------ projects ------------------------------ */

interface ProjectRow {
  id: number;
  name: string;
  path: string;
  repo_url: string | null;
  description: string | null;
  pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function listProjects(): Promise<Project[]> {
  const db = await loadDb();
  const rows = await db.select<ProjectRow[]>(
    "SELECT * FROM projects ORDER BY pinned DESC, sort_order ASC, name COLLATE NOCASE ASC",
  );
  const projects: Project[] = [];
  for (const row of rows) {
    const stackRows = await db.select<{ stack: string }[]>(
      "SELECT stack FROM project_stacks WHERE project_id = $1 ORDER BY stack",
      [row.id],
    );
    projects.push({
      id: row.id,
      name: row.name,
      path: row.path,
      repoUrl: row.repo_url,
      description: row.description,
      stacks: stackRows.map((s) => s.stack),
      pinned: row.pinned === 1,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
  return projects;
}

async function replaceStacks(
  db: Database,
  projectId: number,
  stacks: string[],
): Promise<void> {
  await db.execute("DELETE FROM project_stacks WHERE project_id = $1", [
    projectId,
  ]);
  for (const stack of stacks) {
    await db.execute(
      "INSERT OR IGNORE INTO project_stacks (project_id, stack) VALUES ($1, $2)",
      [projectId, stack],
    );
  }
}

export async function createProject(draft: ProjectDraft): Promise<void> {
  const db = await loadDb();
  const result = await db.execute(
    "INSERT INTO projects (name, path, repo_url, description) VALUES ($1, $2, $3, $4)",
    [draft.name, draft.path, draft.repoUrl, draft.description],
  );
  if (result.lastInsertId != null) {
    await replaceStacks(db, result.lastInsertId, draft.stacks);
  }
}

export async function updateProject(
  id: number,
  draft: ProjectDraft,
): Promise<void> {
  const db = await loadDb();
  await db.execute(
    "UPDATE projects SET name = $1, path = $2, repo_url = $3, description = $4, " +
      "updated_at = CURRENT_TIMESTAMP WHERE id = $5",
    [draft.name, draft.path, draft.repoUrl, draft.description, id],
  );
  await replaceStacks(db, id, draft.stacks);
}

export async function deleteProject(id: number): Promise<void> {
  const db = await loadDb();
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
}

export async function setProjectPinned(
  id: number,
  pinned: boolean,
): Promise<void> {
  const db = await loadDb();
  await db.execute("UPDATE projects SET pinned = $1 WHERE id = $2", [
    pinned ? 1 : 0,
    id,
  ]);
}

/** Persist display order: ids in the order they should appear. */
export async function setProjectOrder(ids: number[]): Promise<void> {
  const db = await loadDb();
  for (let i = 0; i < ids.length; i++) {
    await db.execute("UPDATE projects SET sort_order = $1 WHERE id = $2", [
      i,
      ids[i],
    ]);
  }
}

/* ----------------------------- ssh configs ---------------------------- */

interface SshRow {
  id: number;
  project_id: number | null;
  name: string;
  host: string;
  username: string;
  port: number;
  identity_file: string | null;
}

function mapSsh(row: SshRow): SshConfig {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    host: row.host,
    username: row.username,
    port: row.port,
    identityFile: row.identity_file,
  };
}

export async function listSshConfigs(projectId: number): Promise<SshConfig[]> {
  const db = await loadDb();
  const rows = await db.select<SshRow[]>(
    "SELECT * FROM ssh_configs WHERE project_id = $1 ORDER BY name",
    [projectId],
  );
  return rows.map(mapSsh);
}

export async function saveSshConfig(
  draft: SshConfigDraft,
  id?: number,
): Promise<void> {
  const db = await loadDb();
  if (id != null) {
    await db.execute(
      "UPDATE ssh_configs SET name = $1, host = $2, username = $3, port = $4, " +
        "identity_file = $5 WHERE id = $6",
      [draft.name, draft.host, draft.username, draft.port, draft.identityFile, id],
    );
  } else {
    await db.execute(
      "INSERT INTO ssh_configs (project_id, name, host, username, port, identity_file) " +
        "VALUES ($1, $2, $3, $4, $5, $6)",
      [
        draft.projectId,
        draft.name,
        draft.host,
        draft.username,
        draft.port,
        draft.identityFile,
      ],
    );
  }
}

export async function deleteSshConfig(id: number): Promise<void> {
  const db = await loadDb();
  await db.execute("DELETE FROM ssh_configs WHERE id = $1", [id]);
}
