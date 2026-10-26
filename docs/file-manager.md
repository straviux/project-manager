# File Manager — feature spec (future)

Status: **implemented (core)**. The backend safety primitives
(`check_file_free`, `move_file_to_library`) and the Files tab UI are in;
remaining extras are listed under Phases.

## What it is

A file manager inside Project Manager for a personal file library —
downloads, documents, media, installers — kept in one managed place and
easy to browse.

## Core ideas

1. **Managed parent folder.** During setup (its own step, separate from the
   projects folder) the user picks a *files library* folder, stored as the
   `files_dir` setting.
2. **Files are moved in, not copied.** When a file is added (drag & drop,
   file picker, or "watch" inbox folder later), it is *moved* into the
   library so there is exactly one copy, organized.
3. **Categorized two ways** (toggle in the UI):
   - **By type** — subfolders by category: `Images`, `Videos`, `Audio`,
     `Documents`, `Archives`, `Code`, `Other` (extension-based, see
     `categorize_file` in the Rust backend).
   - **By folder** — browse the library's real folder tree as-is.
4. **Index in SQLite.** A `files` table (name, path, category, size,
   added_at, hash) powers search and the by-type view without re-scanning.

## The in-use safety rule (hard requirement)

A file is **only moved when it is free**. Before any move, the app must
verify the file is not:

- locked by another process (Windows share-mode / advisory lock check),
- open in another process (on Linux, also scan `/proc/*/fd`),
- a currently **running executable** (on Linux, compare `/proc/*/exe`).

If a file is busy:

- the move is **skipped, never forced**;
- the UI shows *why* ("open in another process", "running program") and
  offers **Retry**;
- other files in the same batch still proceed.

The check runs again immediately before the move (not only when the file
was queued), because a file can become busy in between.

## Move semantics

- Same volume → atomic rename.
- Cross-volume → copy, verify size matches, then delete the original.
  If verification fails, the copy is removed and the original kept.
- **Never overwrite**: name collisions get `name (1).ext`, `name (2).ext`, …
- Optional dedupe by content hash: if an identical file already exists in
  the library, ask before keeping both.

## Proposed `files` table

```sql
CREATE TABLE files (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL,
  path      TEXT NOT NULL UNIQUE,
  category  TEXT NOT NULL,
  size      INTEGER NOT NULL,
  hash      TEXT,
  added_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Phases

1. ✅ Backend: `check_file_free` + `move_file_to_library` commands.
2. ✅ Settings: pick the files library folder (`files_dir`) from the Files tab.
3. ✅ UI: file list with By type / By folder toggle, add-by-picker +
   drag & drop, busy-file states with retry. Listing is disk-based
   (the folder is the source of truth).
4. Extras: SQLite index for instant search, hash dedupe, watch folder,
   thumbnails for images.

## Action feedback (2026-10-26)
- Move actions (add files, import folder, drag-move between folders) report
  via app-wide toast notifications (bottom-right; success auto-dismisses,
  errors stay until dismissed) instead of the inline banner.
- Every addition, import, move, and deletion is recorded in a SQLite
  `action_history` table (latest 500) and reviewable from the Files toolbar's
  History button, which also offers clearing the log.

## Batch actions, ⋮ menus, duplicate (2026-10-26)
- Files have checkboxes (list rows + grid tiles; header checkbox selects the
  whole current view). A batch bar appears with Move to folder, Duplicate,
  Star/Unstar, and Delete for the selection. Selection survives tab switches
  and refreshes (only pruned when a file no longer exists).
- Per-file and per-folder actions are grouped into a three-dot menu (the
  standard ContextMenu); right-click menus share the same items, so the two
  never drift apart. The status badge in list rows still changes status
  directly.
- Duplicate (file or folder, from the ⋮ menu or the batch bar) copies next
  to the original as "name - Copy.ext" (then " - Copy (2)", …) and carries
  status/notes/star along to the new path.
