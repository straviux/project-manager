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
- **Add projects three ways**
  - Scan the parent directory (auto-detects stacks and git remotes)
  - Add manually
  - **Git clone** — paste a repository URL and it clones into the parent
    directory, detects the stacks and registers the project
- **SSH profiles** — save host, user, port and identity file per project.
  Passwords are never stored in the database; authentication uses SSH keys,
  and secrets belong in your OS keychain (keychain storage is on the roadmap).
- **Local-first** — all data lives in a local SQLite database. No account, no
  cloud, no telemetry.

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

- **File Manager** — a managed file library: files are moved into a parent
  folder and categorized by type or browsed by folder, with a hard safety
  rule — a file is only moved after verifying it isn't running or in use.
  Spec: [docs/file-manager.md](docs/file-manager.md). The backend checks
  (`check_file_free`, `move_file_to_library`) are already implemented.
- Store SSH secrets in the OS keychain (`keyring`)
- Git status at a glance (branch, dirty, ahead/behind) on each project card
- "Open remote" and copy-clone-URL actions
- Global search & keyboard shortcuts
- Drag-to-reorder / pin favorite projects

## License

MIT
