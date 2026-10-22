# Project Manager

A desktop app to organize all your local development projects in one place —
their stacks, their GitHub repositories, and one-click actions to get working.

Built with **Tauri 2**, **Vue 3 + TypeScript**, **SQLite**, **TailwindCSS** and
**Lucide** icons.

## Features

- **First-run setup** — on first launch the app asks where your projects live
  (a parent directory). Everything else revolves around that folder.
- **Project list** — every project with its name, local path, tech stacks and
  GitHub repository link.
- **One-click actions per project**
  - Open in **VS Code**
  - Open a **terminal** already `cd`'d into the project root
  - Open an **SSH terminal** using a saved connection profile
  - Open and read the project's **README.md** (rendered Markdown)
- **Git status at a glance** — every project card shows its current branch,
  whether the working tree is clean or how many uncommitted changes it has,
  and ahead/behind counts versus its upstream.
- **Pin & reorder** — pin favorite projects to the top and drag cards to
  reorder them (order and pins persist in SQLite, with an automatic column
  migration for existing databases).
- **Keyboard shortcuts** — `/` or `Ctrl+K` search, `1`/`2` switch
  Projects/Files tabs, `S` scan, `I` import, `N` new project, `Esc` closes
  the topmost dialog.
- **Add projects three ways**
  - Scan the parent directory (auto-detects stacks and git remotes)
  - Add manually
  - **Git clone** — paste a repository URL and it clones into the parent
    directory, detects the stacks and registers the project
  - **Import a folder** — move or copy an existing project folder from
    anywhere on disk into the parent directory (stacks and git remote are
    picked up automatically by the follow-up scan)
- **SSH profiles** — save host, user, port and identity file per project.
  Passwords are never stored in the database: they go to your **OS keychain**
  (Windows Credential Manager / macOS Keychain / Linux Secret Service), and
  on connect the password is copied to your clipboard so you can paste it at
  the ssh prompt. The secret never passes through the frontend.
- **Local-first** — all data lives in a local SQLite database. No account, no
  cloud, no telemetry.
- **Themes** — Light, Dark, or **Mix** (dark header/nav, dialogs and menus
  over light content), switchable from the header and remembered between
  launches. First run follows your OS setting.
- **Auto-updates** — the app checks GitHub Releases a few seconds after
  launch (or via the header button) and can download and install signed
  updates on restart. Release process: [docs/releases.md](docs/releases.md).
- **File Manager** — a managed file library in the Files tab: pick a library
  folder, then add files by picker or drag & drop. Files are *moved* in and
  categorized (Images, Videos, Audio, Documents, Archives, Code, Other),
  browsable **by type** or **by folder** — but only after a safety check
  verifies each file isn't running or open in another app. Busy files are
  skipped with the reason shown and a Retry button, never forced.
  Spec: [docs/file-manager.md](docs/file-manager.md)

## Tech stack

| Layer    | Technology                                  |
| -------- | ------------------------------------------- |
| Shell    | Tauri 2 (Rust)                              |
| Frontend | Vue 3 + TypeScript + Vite                  |
| Styling  | TailwindCSS                                 |
| Icons    | Lucide (`lucide-vue-next`)                  |
| Database | SQLite via `tauri-plugin-sql`               |
| Markdown | `marked`                                    |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Tauri's [system dependencies](https://tauri.app/start/prerequisites/)
  for your OS
- VS Code (`code` on your PATH) for the "Open in VS Code" action
- Git for the clone feature

### Install & run

```bash
npm install
npm run tauri dev
```

App icons are generated automatically the first time you run a Tauri
command: the repo stores them base64-encoded in `src-tauri/icons/base64/`
and a `pretauri` hook (`scripts/ensure-icons.mjs`) materializes
`icon.ico` / `icon.png` / `icon.icns` into `src-tauri/icons/`. To use your
own logo instead, run `npm run tauri icon path/to/your-logo.png`.

### Build

```bash
npm run tauri icon path/to/your-logo.png   # first time only, generates app icons
npm run tauri build
```

## How stack detection works

When scanning a folder or after a clone, the app inspects marker files:

`package.json` (Vue, React, Angular, Svelte, Nuxt, Next.js, Tauri, Node.js),
`Cargo.toml` (Rust / Tauri), `go.mod` (Go), `pyproject.toml` /
`requirements.txt` (Python), `Gemfile` (Ruby), `composer.json` (PHP / Laravel),
`pom.xml` / `build.gradle` (Java), `*.csproj` / `*.sln` (.NET),
`Dockerfile` (Docker) and more. You can always edit a project's stacks by hand.

## Data model (SQLite)

- `settings` — key/value store (e.g. the parent projects directory)
- `projects` — name, path, repo URL, description
- `project_stacks` — many-to-many between projects and stack labels
- `ssh_configs` — saved SSH connection profiles per project (no passwords)

## Roadmap

- **File Manager extras** — SQLite index for instant search, hash-based
  dedupe, watch folder, image thumbnails.
  Spec: [docs/file-manager.md](docs/file-manager.md)
- "Open remote" and copy-clone-URL actions

## License

MIT
