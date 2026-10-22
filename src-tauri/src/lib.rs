use serde::Serialize;
use tauri::Manager;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

/* ================================ types ================================ */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedProject {
    name: String,
    path: String,
    repo_url: Option<String>,
    stacks: Vec<String>,
    has_readme: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitStatus {
    is_repo: bool,
    branch: Option<String>,
    dirty: bool,
    changed_files: u32,
    ahead: u32,
    behind: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileCheck {
    free: bool,
    reason: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryFile {
    name: String,
    path: String,
    relative_path: String,
    folder: String,
    category: String,
    size: u64,
}

/* ============================ terminal helper =========================== */

/// Spawn a new terminal window, optionally in `cwd` and/or running `command`.
fn spawn_terminal(cwd: Option<&Path>, command: Option<&str>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Set the working directory on the child process itself instead of
        // embedding `cd /d "<path>"` into a `cmd /K` string: nested quotes
        // get mangled by cmd's quote-stripping (and `start` reads the first
        // quoted chunk as a window title), so the cd silently never ran.
        // Spawning cmd directly still gets a fresh console window, so the
        // `start` wrapper is not needed either.
        let mut c = Command::new("cmd");
        c.arg("/K");
        if let Some(dir) = cwd {
            c.current_dir(dir);
        }
        if let Some(cmd) = command {
            // One argument after /K: Rust passes it as a single quoted
            // string, cmd strips those quotes and runs it (documented case).
            c.arg(cmd);
        }
        c.spawn()
            .map_err(|e| format!("Failed to open terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let mut script_cmd = String::new();
        if let Some(dir) = cwd {
            script_cmd.push_str(&format!("cd '{}'", dir.display().to_string().replace('\'', "'\\''")));
        }
        if let Some(cmd) = command {
            if !script_cmd.is_empty() {
                script_cmd.push_str(" && ");
            }
            script_cmd.push_str(cmd);
        }
        let escaped = script_cmd.replace('\\', "\\\\").replace('"', "\\\"");
        let osa = format!(
            "tell application \"Terminal\"\n do script \"{escaped}\"\n activate\nend tell"
        );
        Command::new("osascript")
            .args(["-e", &osa])
            .spawn()
            .map_err(|e| format!("Failed to open terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        let cwd_str = cwd.map(|p| p.display().to_string());
        let attempts: Vec<(String, Vec<String>)> = match command {
            Some(cmd) => vec![
                ("gnome-terminal".into(), vec!["--".into(), "bash".into(), "-c".into(), format!("{cmd}; exec bash")]),
                ("konsole".into(), vec!["-e".into(), "bash".into(), "-c".into(), format!("{cmd}; exec bash")]),
                ("xfce4-terminal".into(), vec!["-e".into(), format!("bash -c '{cmd}; exec bash'")]),
                ("alacritty".into(), vec!["-e".into(), "bash".into(), "-c".into(), format!("{cmd}; exec bash")]),
                ("xterm".into(), vec!["-e".into(), "bash".into(), "-c".into(), format!("{cmd}; exec bash")]),
            ],
            None => vec![
                ("gnome-terminal".into(), Vec::new()),
                ("konsole".into(), Vec::new()),
                ("xfce4-terminal".into(), Vec::new()),
                ("alacritty".into(), Vec::new()),
                ("xterm".into(), Vec::new()),
            ],
        };
        for (bin, mut args) in attempts {
            // gnome-terminal / xfce4-terminal take the working dir as a flag.
            if command.is_none() {
                if let Some(dir) = &cwd_str {
                    match bin.as_str() {
                        "gnome-terminal" | "xfce4-terminal" => {
                            args.insert(0, format!("--working-directory={dir}"));
                        }
                        "alacritty" => {
                            args.insert(0, dir.clone());
                            args.insert(0, "--working-directory".into());
                        }
                        _ => {}
                    }
                }
            }
            let mut cmd = Command::new(&bin);
            cmd.args(&args);
            if let Some(dir) = cwd {
                cmd.current_dir(dir);
            }
            if cmd.spawn().is_ok() {
                return Ok(());
            }
        }
        return Err("No supported terminal emulator found".into());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (cwd, command);
        Err("Opening a terminal is not supported on this platform yet".into())
    }
}

/* ============================ project actions =========================== */

#[tauri::command]
fn open_in_vscode(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {path}"));
    }
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "code", &path]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("code");
        c.arg(&path);
        c
    };
    cmd.spawn()
        .map_err(|e| format!("Failed to launch VS Code (is `code` on your PATH?): {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_terminal(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {path}"));
    }
    spawn_terminal(Some(&dir), None)
}

#[tauri::command]
fn open_ssh_terminal(
    host: String,
    username: String,
    port: u16,
    identity_file: Option<String>,
) -> Result<(), String> {
    // Values come from the user's own saved profiles (see SshDialog).
    let mut ssh = format!("ssh -p {port} ");
    if let Some(key) = identity_file.filter(|k| !k.trim().is_empty()) {
        ssh.push_str(&format!("-i {key} "));
    }
    ssh.push_str(&format!("{username}@{host}"));
    spawn_terminal(None, Some(&ssh))
}

/* ============================ ssh keychain ==============================
   Passwords live ONLY in the OS keychain (Windows Credential Manager,
   macOS Keychain, Linux Secret Service) — never in SQLite, never in the
   frontend. Copying fetches the secret inside Rust and writes it straight
   to the clipboard. */

const KEYRING_SERVICE: &str = "dev.straviux.projectmanager";

fn ssh_entry(config_id: i64) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("ssh-config-{config_id}"))
        .map_err(|e| format!("Keychain unavailable: {e}"))
}

#[tauri::command]
fn ssh_set_password(config_id: i64, password: String) -> Result<(), String> {
    ssh_entry(config_id)?
        .set_password(&password)
        .map_err(|e| format!("Could not save password to keychain: {e}"))
}

#[tauri::command]
fn ssh_has_password(config_id: i64) -> bool {
    match ssh_entry(config_id) {
        Ok(entry) => entry.get_password().is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
fn ssh_delete_password(config_id: i64) -> Result<(), String> {
    match ssh_entry(config_id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete password: {e}")),
    }
}

#[tauri::command]
fn ssh_copy_password(config_id: i64) -> Result<(), String> {
    let password = ssh_entry(config_id)?
        .get_password()
        .map_err(|e| format!("Could not read password from keychain: {e}"))?;
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard unavailable: {e}"))?;
    clipboard
        .set_text(password)
        .map_err(|e| format!("Could not copy password: {e}"))?;
    Ok(())
}

/* ================================ git ================================== */

fn folder_name_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    trimmed
        .rsplit(['/', ':'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("project")
        .to_string()
}

fn git_clone_impl(
    repo_url: String,
    parent_dir: String,
    folder_name: Option<String>,
) -> Result<String, String> {
    let parent = PathBuf::from(&parent_dir);
    fs::create_dir_all(&parent).map_err(|e| format!("Cannot create parent directory: {e}"))?;
    let name = folder_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| folder_name_from_url(&repo_url));
    let dest = parent.join(&name);
    if dest.exists() {
        return Err(format!("Destination already exists: {}", dest.display()));
    }
    let output = Command::new("git")
        .arg("clone")
        .arg(&repo_url)
        .arg(&dest)
        .output()
        .map_err(|e| format!("Failed to run git (is git installed?): {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_dir_all(&dest);
        return Err(format!(
            "git clone failed:\n{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(dest.display().to_string())
}

fn parse_count(info: &str, key: &str) -> u32 {
    // Extracts N from "... [ahead N, behind M]" style branch info.
    if let Some(pos) = info.find(key) {
        let rest = &info[pos + key.len()..];
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        return digits.parse().unwrap_or(0);
    }
    0
}

/// Working-tree status for the project card: branch, dirty state,
/// number of changed files, and ahead/behind counts vs upstream.
fn git_status_impl(path: String) -> GitStatus {
    let not_repo = GitStatus {
        is_repo: false,
        branch: None,
        dirty: false,
        changed_files: 0,
        ahead: 0,
        behind: 0,
    };
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["status", "--porcelain=v1", "--branch"])
        .output();
    let output = match output {
        Ok(o) if o.status.success() => o,
        _ => return not_repo,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branch: Option<String> = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changed: u32 = 0;
    for line in stdout.lines() {
        if let Some(info) = line.strip_prefix("## ") {
            ahead = parse_count(info, "ahead ");
            behind = parse_count(info, "behind ");
            if let Some(rest) = info.strip_prefix("No commits yet on ") {
                branch = Some(rest.trim().to_string());
            } else if info.starts_with("HEAD") {
                branch = None; // detached HEAD
            } else {
                let name = info
                    .split("...")
                    .next()
                    .unwrap_or("")
                    .split(' ')
                    .next()
                    .unwrap_or("")
                    .trim();
                if !name.is_empty() {
                    branch = Some(name.to_string());
                }
            }
        } else if !line.trim().is_empty() {
            changed += 1;
        }
    }
    GitStatus {
        is_repo: true,
        branch,
        dirty: changed > 0,
        changed_files: changed,
        ahead,
        behind,
    }
}

fn read_git_remote(project: &Path) -> Option<String> {
    let config = fs::read_to_string(project.join(".git").join("config")).ok()?;
    let mut in_origin = false;
    for line in config.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_origin = line.starts_with("[remote \"origin\"]");
            continue;
        }
        if in_origin && line.starts_with("url") {
            if let Some((_, value)) = line.split_once('=') {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

/* ============================ stack detection =========================== */

fn push_unique(list: &mut Vec<String>, value: &str) {
    if !list.iter().any(|v| v == value) {
        list.push(value.to_string());
    }
}

fn detect_stacks_for(dir: &Path) -> Vec<String> {
    let mut stacks: Vec<String> = Vec::new();

    let pkg_path = dir.join("package.json");
    if let Ok(pkg) = fs::read_to_string(&pkg_path) {
        if pkg.contains("\"vue\"") {
            push_unique(&mut stacks, "Vue");
        }
        if pkg.contains("\"react\"") {
            push_unique(&mut stacks, "React");
        }
        if pkg.contains("\"@angular/core\"") {
            push_unique(&mut stacks, "Angular");
        }
        if pkg.contains("\"svelte\"") {
            push_unique(&mut stacks, "Svelte");
        }
        if pkg.contains("\"nuxt\"") {
            push_unique(&mut stacks, "Nuxt");
        }
        if pkg.contains("\"next\"") {
            push_unique(&mut stacks, "Next.js");
        }
        if pkg.contains("\"@tauri-apps/api\"") {
            push_unique(&mut stacks, "Tauri");
        }
        if pkg.contains("\"typescript\"") {
            push_unique(&mut stacks, "TypeScript");
        }
        push_unique(&mut stacks, "Node.js");
    }

    let cargo_path = dir.join("Cargo.toml");
    if let Ok(cargo) = fs::read_to_string(&cargo_path) {
        if cargo.contains("tauri") {
            push_unique(&mut stacks, "Tauri");
        }
        push_unique(&mut stacks, "Rust");
    } else if cargo_path.exists() {
        push_unique(&mut stacks, "Rust");
    }

    if dir.join("go.mod").exists() {
        push_unique(&mut stacks, "Go");
    }
    if dir.join("requirements.txt").exists() || dir.join("pyproject.toml").exists() {
        push_unique(&mut stacks, "Python");
    }
    if dir.join("Gemfile").exists() {
        push_unique(&mut stacks, "Ruby");
    }
    if let Ok(composer) = fs::read_to_string(dir.join("composer.json")) {
        push_unique(&mut stacks, "PHP");
        if composer.contains("laravel/framework") {
            push_unique(&mut stacks, "Laravel");
        }
    }
    if dir.join("pom.xml").exists() || dir.join("build.gradle").exists() {
        push_unique(&mut stacks, "Java");
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".csproj") || name.ends_with(".sln") {
                push_unique(&mut stacks, ".NET");
                break;
            }
        }
    }
    if dir.join("Dockerfile").exists() {
        push_unique(&mut stacks, "Docker");
    }

    stacks
}

fn detect_stacks_impl(path: String) -> Vec<String> {
    detect_stacks_for(Path::new(&path))
}

/* ============================ scan & readme ============================= */

fn find_readme(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if name == "readme.md" || name == "readme" {
            return Some(entry.path());
        }
    }
    None
}

fn scan_projects_impl(parent_dir: String) -> Result<Vec<ScannedProject>, String> {
    let parent = PathBuf::from(&parent_dir);
    let entries = fs::read_dir(&parent)
        .map_err(|e| format!("Cannot read projects directory: {e}"))?;
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        found.push(ScannedProject {
            name,
            repo_url: read_git_remote(&path),
            stacks: detect_stacks_for(&path),
            has_readme: find_readme(&path).is_some(),
            path: path.display().to_string(),
        });
    }
    found.sort_by_key(|p| p.name.to_lowercase());
    Ok(found)
}

#[tauri::command]
fn read_readme(path: String) -> Option<String> {
    let readme = find_readme(Path::new(&path))?;
    fs::read_to_string(readme).ok()
}

/* ============================== file manager ============================
   Future feature foundation (see docs/file-manager.md):
   files added to the library are MOVED into a managed parent folder,
   categorized by type — but only after verifying the file is not
   running or in use. */

fn categorize_file(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico" | "avif" => "Images",
        "mp4" | "mkv" | "mov" | "avi" | "webm" => "Videos",
        "mp3" | "wav" | "flac" | "ogg" | "m4a" => "Audio",
        "pdf" | "doc" | "docx" | "txt" | "md" | "xls" | "xlsx" | "ppt" | "pptx" | "odt"
        | "csv" => "Documents",
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" => "Archives",
        "rs" | "js" | "ts" | "tsx" | "jsx" | "vue" | "py" | "go" | "java" | "c" | "cpp"
        | "h" | "cs" | "rb" | "php" | "html" | "css" | "json" | "toml" => "Code",
        _ => "Other",
    }
}

/// Is `path` safe to move right now? A file is NOT free when it is locked,
/// open in another process, or is a currently running executable.
fn file_free_check(path: &Path) -> FileCheck {
    if path.is_dir() {
        return FileCheck {
            free: false,
            reason: Some("That's a folder - use Add folder instead.".into()),
        };
    }
    if !path.is_file() {
        return FileCheck {
            free: false,
            reason: Some("File does not exist".into()),
        };
    }

    // Windows: opening with share_mode(0) fails if anyone else has it open.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::OpenOptionsExt;
        match fs::OpenOptions::new().read(true).share_mode(0).open(path) {
            Ok(_) => {}
            Err(e) => {
                return FileCheck {
                    free: false,
                    reason: Some(format!("File is in use by another process ({e})")),
                }
            }
        }
    }

    // Cross-platform: an exclusive advisory lock must be obtainable.
    match fs::File::open(path) {
        Ok(file) => {
            use fs2::FileExt;
            if file.try_lock_exclusive().is_err() {
                return FileCheck {
                    free: false,
                    reason: Some("File is locked by another process".into()),
                };
            }
            let _ = file.unlock();
        }
        Err(e) => {
            return FileCheck {
                free: false,
                reason: Some(format!("Cannot open file: {e}")),
            }
        }
    }

    // Linux: also catch processes that hold the file open without locking,
    // and executables that are currently running.
    #[cfg(target_os = "linux")]
    {
        if let Ok(canonical) = path.canonicalize() {
            if let Ok(procs) = fs::read_dir("/proc") {
                for proc_entry in procs.flatten() {
                    let name = proc_entry.file_name();
                    let Some(pid) = name.to_str() else { continue };
                    if !pid.chars().all(|c| c.is_ascii_digit()) {
                        continue;
                    }
                    let base = proc_entry.path();
                    if let Ok(exe) = fs::read_link(base.join("exe")) {
                        if exe == canonical {
                            return FileCheck {
                                free: false,
                                reason: Some(format!("File is a running program (pid {pid})")),
                            };
                        }
                    }
                    if let Ok(fds) = fs::read_dir(base.join("fd")) {
                        for fd in fds.flatten() {
                            if let Ok(target) = fs::read_link(fd.path()) {
                                if target == canonical {
                                    return FileCheck {
                                        free: false,
                                        reason: Some(format!(
                                            "File is open in another process (pid {pid})"
                                        )),
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    FileCheck {
        free: true,
        reason: None,
    }
}

fn check_file_free_impl(path: String) -> FileCheck {
    file_free_check(Path::new(&path))
}

/// Move `source` into `<library_dir>/<Category>/`, refusing while the file
/// is in use. Duplicate names are suffixed ("name (1).ext") — never overwritten.
fn move_file_to_library_impl(source: String, library_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&source);
    let check = file_free_check(&src);
    if !check.free {
        return Err(check
            .reason
            .unwrap_or_else(|| "File is in use".into()));
    }

    let category = categorize_file(&src);
    let dest_dir = PathBuf::from(&library_dir).join(category);
    fs::create_dir_all(&dest_dir).map_err(|e| format!("Cannot create library folder: {e}"))?;

    let file_name = src
        .file_name()
        .ok_or("Source has no file name")?
        .to_string_lossy()
        .to_string();
    let stem = Path::new(&file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let ext = Path::new(&file_name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    let mut dest = dest_dir.join(&file_name);
    let mut n = 1;
    while dest.exists() {
        dest = dest_dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }

    match fs::rename(&src, &dest) {
        Ok(()) => Ok(dest.display().to_string()),
        Err(_) => {
            // Cross-device move: copy, verify size, then remove the source.
            let copied = fs::copy(&src, &dest).map_err(|e| format!("Move failed: {e}"))?;
            let src_len = fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
            if copied != src_len {
                let _ = fs::remove_file(&dest);
                return Err("Move failed: copied size does not match the original".into());
            }
            fs::remove_file(&src).map_err(|e| format!("Copied but could not remove original: {e}"))?;
            Ok(dest.display().to_string())
        }
    }
}

const CATEGORIES: [&str; 7] = [
    "Images", "Videos", "Audio", "Documents", "Archives", "Code", "Other",
];

fn collect_library_files(dir: &Path, base: &Path, out: &mut Vec<LibraryFile>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_library_files(&path, base, out);
        } else if path.is_file() {
            let relative = path.strip_prefix(base).unwrap_or(&path).to_path_buf();
            let relative_str = relative.display().to_string();
            let folder = relative
                .parent()
                .map(|p| p.display().to_string())
                .unwrap_or_default();
            let first = relative
                .components()
                .next()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .unwrap_or_default();
            let category = if CATEGORIES.contains(&first.as_str()) {
                first
            } else {
                categorize_file(&path).to_string()
            };
            out.push(LibraryFile {
                name: entry.file_name().to_string_lossy().to_string(),
                path: path.display().to_string(),
                relative_path: relative_str,
                folder,
                category,
                size: entry.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
}

/// List every file inside the managed library folder (recursively).
fn list_library_files_impl(library_dir: String) -> Result<Vec<LibraryFile>, String> {
    let base = PathBuf::from(&library_dir);
    if !base.is_dir() {
        return Err(format!("Library folder does not exist: {library_dir}"));
    }
    let mut out = Vec::new();
    collect_library_files(&base, &base, &mut out);
    out.sort_by_key(|f| f.relative_path.to_lowercase());
    Ok(out)
}

/// Open a file or folder with the OS default application.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open: {e}"))?;
    }
    Ok(())
}

/* ================================= run ================================== */

#[cfg_attr(mobile, tauri::mobile_entry_point)]

/* ========================= import project folder ========================= */

#[derive(Serialize)]
struct ImportResult {
    path: String,
    warning: Option<String>,
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let meta = fs::symlink_metadata(&from).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            // fs::copy follows symlinks, so links become regular files.
            fs::copy(&from, &to)
                .map_err(|e| format!("Could not copy {}: {e}", from.display()))?;
        }
    }
    Ok(())
}

fn do_import_project_folder(
    source: String,
    name: String,
    mode: String,
    projects_dir: String,
) -> Result<ImportResult, String> {
    let src = PathBuf::from(&source);
    if !src.is_dir() {
        return Err("The source folder does not exist.".into());
    }
    let trimmed = name.trim().trim_matches(|c| c == '/' || c == '\\');
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        return Err("Invalid folder name.".into());
    }
    let parent = PathBuf::from(&projects_dir);
    if !parent.is_dir() {
        return Err("The projects folder does not exist.".into());
    }
    let dest = parent.join(trimmed);
    if dest.exists() {
        return Err(format!(
            "A folder named '{trimmed}' already exists in your projects folder."
        ));
    }
    let src_c = src.canonicalize().map_err(|e| e.to_string())?;
    let parent_c = parent.canonicalize().map_err(|e| e.to_string())?;
    if src_c.starts_with(&parent_c) {
        return Err(
            "That folder is already inside your projects folder — use Scan instead.".into(),
        );
    }
    if parent_c.starts_with(&src_c) {
        return Err(
            "Cannot import the projects folder itself or one of its parent folders.".into(),
        );
    }
    let dest_str = dest.to_string_lossy().to_string();
    match mode.as_str() {
        "copy" => {
            copy_dir_recursive(&src, &dest)?;
            Ok(ImportResult { path: dest_str, warning: None })
        }
        "move" => match fs::rename(&src, &dest) {
            Ok(()) => Ok(ImportResult { path: dest_str, warning: None }),
            Err(_) => {
                // Different drive, or the folder is in use: copy, then remove.
                copy_dir_recursive(&src, &dest)?;
                match fs::remove_dir_all(&src) {
                    Ok(()) => Ok(ImportResult { path: dest_str, warning: None }),
                    Err(e) => Ok(ImportResult {
                        path: dest_str,
                        warning: Some(format!(
                            "Copied into your projects folder, but the original could not be fully removed ({e}). Some files may be open in another program."
                        )),
                    }),
                }
            }
        },
        _ => Err("Unknown import mode.".into()),
    }
}

/// Move or copy an existing folder into the projects parent folder.
#[tauri::command]
async fn import_project_folder(
    source: String,
    name: String,
    mode: String,
    projects_dir: String,
) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        do_import_project_folder(source, name, mode, projects_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}


/* ===== async command wrappers: blocking git/fs work runs on a worker
   thread (spawn_blocking) instead of the UI thread, so invoking these
   can never freeze the window. ===== */

#[tauri::command]
async fn git_clone(
    repo_url: String,
    parent_dir: String,
    folder_name: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        git_clone_impl(repo_url, parent_dir, folder_name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn git_status(path: String) -> GitStatus {
    tauri::async_runtime::spawn_blocking(move || git_status_impl(path))
        .await
        .unwrap_or(GitStatus {
            is_repo: false,
            branch: None,
            dirty: false,
            changed_files: 0,
            ahead: 0,
            behind: 0,
        })
}

#[tauri::command]
async fn detect_stacks(path: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || detect_stacks_impl(path))
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn scan_projects(parent_dir: String) -> Result<Vec<ScannedProject>, String> {
    tauri::async_runtime::spawn_blocking(move || scan_projects_impl(parent_dir))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_file_free(path: String) -> FileCheck {
    tauri::async_runtime::spawn_blocking(move || check_file_free_impl(path))
        .await
        .unwrap_or(FileCheck {
            free: false,
            reason: Some("Could not check the file.".into()),
        })
}

#[tauri::command]
async fn move_file_to_library(
    source: String,
    library_dir: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        move_file_to_library_impl(source, library_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_library_files(library_dir: String) -> Result<Vec<LibraryFile>, String> {
    tauri::async_runtime::spawn_blocking(move || list_library_files_impl(library_dir))
        .await
        .map_err(|e| e.to_string())?
}

fn delete_library_file_impl(library_dir: String, path: String) -> Result<(), String> {
    let lib = PathBuf::from(&library_dir)
        .canonicalize()
        .map_err(|e| format!("Library folder not found: {e}"))?;
    let target = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| format!("File not found: {e}"))?;
    if target == lib || !target.starts_with(&lib) {
        return Err("That file is not inside the library folder.".into());
    }
    if !target.is_file() {
        return Err("That is not a file.".into());
    }
    fs::remove_file(&target).map_err(|e| format!("Could not delete the file: {e}"))
}

#[tauri::command]
async fn delete_library_file(library_dir: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_library_file_impl(library_dir, path))
        .await
        .map_err(|e| e.to_string())?
}

fn delete_library_folder_impl(library_dir: String, folder: String) -> Result<(), String> {
    let lib = PathBuf::from(&library_dir)
        .canonicalize()
        .map_err(|e| format!("Library folder not found: {e}"))?;
    let target = lib
        .join(&folder)
        .canonicalize()
        .map_err(|e| format!("Folder not found: {e}"))?;
    if target == lib || !target.starts_with(&lib) {
        return Err("That folder is not inside the library folder.".into());
    }
    if !target.is_dir() {
        return Err("That is not a folder.".into());
    }
    fs::remove_dir_all(&target).map_err(|e| format!("Could not delete the folder: {e}"))
}

#[tauri::command]
async fn delete_library_folder(library_dir: String, folder: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_library_folder_impl(library_dir, folder))
        .await
        .map_err(|e| e.to_string())?
}


fn do_import_folder_to_library(
    source: String,
    name: String,
    mode: String,
    library_dir: String,
) -> Result<ImportResult, String> {
    let src = PathBuf::from(&source);
    if !src.is_dir() {
        return Err("The source folder does not exist.".into());
    }
    let trimmed = name.trim().trim_matches(|c| c == '/' || c == '\\');
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        return Err("Invalid folder name.".into());
    }
    let parent = PathBuf::from(&library_dir);
    if !parent.is_dir() {
        return Err("The file library folder does not exist.".into());
    }
    let dest = parent.join(trimmed);
    if dest.exists() {
        return Err(format!(
            "A folder named '{trimmed}' already exists in your file library."
        ));
    }
    let src_c = src.canonicalize().map_err(|e| e.to_string())?;
    let parent_c = parent.canonicalize().map_err(|e| e.to_string())?;
    if src_c.starts_with(&parent_c) {
        return Err("That folder is already inside your file library.".into());
    }
    if parent_c.starts_with(&src_c) {
        return Err(
            "Cannot import the library folder itself or one of its parent folders.".into(),
        );
    }
    let dest_str = dest.to_string_lossy().to_string();
    match mode.as_str() {
        "copy" => {
            copy_dir_recursive(&src, &dest)?;
            Ok(ImportResult { path: dest_str, warning: None })
        }
        "move" => match fs::rename(&src, &dest) {
            Ok(()) => Ok(ImportResult { path: dest_str, warning: None }),
            Err(_) => {
                copy_dir_recursive(&src, &dest)?;
                match fs::remove_dir_all(&src) {
                    Ok(()) => Ok(ImportResult { path: dest_str, warning: None }),
                    Err(e) => Ok(ImportResult {
                        path: dest_str,
                        warning: Some(format!(
                            "Copied into your file library, but the original could not be fully removed ({e}). Some files may be open in another program."
                        )),
                    }),
                }
            }
        },
        _ => Err("Unknown import mode.".into()),
    }
}

/// Move or copy a folder into the file library, keeping its structure.
#[tauri::command]
async fn import_folder_to_library(
    source: String,
    name: String,
    mode: String,
    library_dir: String,
) -> Result<ImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        do_import_folder_to_library(source, name, mode, library_dir)
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ========================== project icons ============================ */

fn project_icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("project-icons");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Copy a user-picked .ico file into app storage for a project and return
/// the stored path. Validates extension, size, and the ICO magic bytes so
/// a renamed random file is rejected.
#[tauri::command]
fn save_project_icon(
    app: tauri::AppHandle,
    source: String,
    project_id: i64,
) -> Result<String, String> {
    use std::io::Read;
    let src = PathBuf::from(&source);
    let ext_ok = src
        .extension()
        .map(|e| e.eq_ignore_ascii_case("ico"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("Please choose an .ico file.".into());
    }
    let meta = fs::metadata(&src).map_err(|e| format!("Could not read the file: {e}"))?;
    if !meta.is_file() {
        return Err("Please choose an .ico file.".into());
    }
    if meta.len() > 2 * 1024 * 1024 {
        return Err("Icon file is too large (max 2 MB).".into());
    }
    let mut header = [0u8; 4];
    let mut f = fs::File::open(&src).map_err(|e| e.to_string())?;
    f.read_exact(&mut header).map_err(|e| e.to_string())?;
    if header != [0, 0, 1, 0] {
        return Err("That file doesn't look like a valid .ico file.".into());
    }
    let dest = project_icons_dir(&app)?.join(format!("{project_id}.ico"));
    fs::copy(&src, &dest).map_err(|e| format!("Could not save the icon: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

/// Remove a project's stored .ico file, if it has one.
#[tauri::command]
fn delete_project_icon(app: tauri::AppHandle, project_id: i64) -> Result<(), String> {
    let dest = project_icons_dir(&app)?.join(format!("{project_id}.ico"));
    if dest.exists() {
        fs::remove_file(&dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            open_in_vscode,
            open_terminal,
            open_ssh_terminal,
            ssh_set_password,
            ssh_has_password,
            ssh_delete_password,
            ssh_copy_password,
            git_clone,
            git_status,
            scan_projects,
            detect_stacks,
            read_readme,
            check_file_free,
            move_file_to_library,
            import_project_folder,
            import_folder_to_library,
            save_project_icon,
            delete_project_icon,
            list_library_files,
            delete_library_file,
            delete_library_folder,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
