use serde::Serialize;
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
struct FileCheck {
    free: bool,
    reason: Option<String>,
}

/* ============================ terminal helper =========================== */

/// Spawn a new terminal window, optionally in `cwd` and/or running `command`.
fn spawn_terminal(cwd: Option<&Path>, command: Option<&str>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut inner = String::new();
        if let Some(dir) = cwd {
            inner.push_str(&format!("cd /d \"{}\"", dir.display()));
        }
        if let Some(cmd) = command {
            if !inner.is_empty() {
                inner.push_str(" && ");
            }
            inner.push_str(cmd);
        }
        if inner.is_empty() {
            inner.push_str("cmd");
        }
        Command::new("cmd")
            .args(["/C", "start", "cmd", "/K", &inner])
            .spawn()
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

#[tauri::command]
fn git_clone(
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

#[tauri::command]
fn detect_stacks(path: String) -> Vec<String> {
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

#[tauri::command]
fn scan_projects(parent_dir: String) -> Result<Vec<ScannedProject>, String> {
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
fn check_file_free_impl(path: &Path) -> FileCheck {
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

#[tauri::command]
fn check_file_free(path: String) -> FileCheck {
    check_file_free_impl(Path::new(&path))
}

/// Move `source` into `<library_dir>/<Category>/`, refusing while the file
/// is in use. Duplicate names are suffixed ("name (1).ext") — never overwritten.
#[tauri::command]
fn move_file_to_library(source: String, library_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&source);
    let check = check_file_free_impl(&src);
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

/* ================================= run ================================== */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            open_in_vscode,
            open_terminal,
            open_ssh_terminal,
            git_clone,
            scan_projects,
            detect_stacks,
            read_readme,
            check_file_free,
            move_file_to_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
