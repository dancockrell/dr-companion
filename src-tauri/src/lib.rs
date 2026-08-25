use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{Manager, WebviewWindow};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Keep console windows from flashing when we shell out on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.is_empty() {
            return None;
        }
        return Some(err);
    }
    Some(text)
}

#[derive(Serialize)]
pub struct ComponentStatus {
    /// Matches SetupComponentId on the TypeScript side.
    id: String,
    /// "ready" | "missing"
    status: String,
    detail: String,
    /// Where we found it, when we did. Shown so the user can check our work.
    path: Option<String>,
}

impl ComponentStatus {
    fn ready(id: &str, detail: String, path: Option<String>) -> Self {
        Self { id: id.into(), status: "ready".into(), detail, path }
    }
    fn missing(id: &str, detail: &str) -> Self {
        Self { id: id.into(), status: "missing".into(), detail: detail.into(), path: None }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Candidate install locations, in the order a Windows player is likely to
/// have them. We look rather than guess, and we report the path we used.
fn candidate_dirs(names: &[&str]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(h) = home_dir() {
        roots.push(h.clone());
        roots.push(h.join("Documents"));
        roots.push(h.join("Desktop"));
        roots.push(h.join("Downloads"));
        roots.push(h.join("AppData").join("Local"));
        roots.push(h.join("AppData").join("Roaming"));
    }
    for env in ["ProgramFiles", "ProgramFiles(x86)", "SystemDrive"] {
        if let Some(v) = std::env::var_os(env) {
            roots.push(PathBuf::from(v));
        }
    }
    roots.push(PathBuf::from("C:\\"));

    let mut out = Vec::new();
    for root in roots {
        for name in names {
            let p = root.join(name);
            if p.exists() {
                out.push(p);
            }
        }
    }
    out
}

fn first_existing(paths: &[PathBuf], leaf: &str) -> Option<PathBuf> {
    paths.iter().map(|p| p.join(leaf)).find(|p| p.exists())
}

fn detect_ruby() -> ComponentStatus {
    if let Some(v) = run_capture("ruby", &["--version"]) {
        let path = run_capture("where", &["ruby"])
            .or_else(|| run_capture("which", &["ruby"]))
            .and_then(|s| s.lines().next().map(|l| l.trim().to_string()));
        return ComponentStatus::ready("ruby", v, path);
    }
    // Not on PATH, but RubyInstaller may still be present.
    let dirs = candidate_dirs(&["Ruby34-x64", "Ruby33-x64", "Ruby32-x64", "Ruby31-x64"]);
    if let Some(exe) = first_existing(&dirs, "bin\\ruby.exe") {
        let v = run_capture(&exe.to_string_lossy(), &["--version"])
            .unwrap_or_else(|| "installed".into());
        return ComponentStatus::ready(
            "ruby",
            format!("{v} (installed, but not on PATH)"),
            Some(exe.to_string_lossy().into_owned()),
        );
    }
    ComponentStatus::missing("ruby", "Not found on PATH or in the usual install folders")
}

fn lich_dirs() -> Vec<PathBuf> {
    candidate_dirs(&["lich", "Lich", "lich5", "Lich5", "Ruby4Lich5", "ruby4lich5"])
}

fn detect_lich() -> ComponentStatus {
    let dirs = lich_dirs();
    for leaf in ["lich.rbw", "lich.rb"] {
        if let Some(p) = first_existing(&dirs, leaf) {
            let parent = p.parent().map(|d| d.to_string_lossy().into_owned());
            return ComponentStatus::ready("lich", format!("Found {leaf}"), parent);
        }
    }
    ComponentStatus::missing("lich", "No lich.rbw found in the usual locations")
}

fn detect_bridge() -> ComponentStatus {
    let dirs = lich_dirs();
    let mut script_dirs: Vec<PathBuf> = dirs.iter().map(|d| d.join("scripts")).collect();
    script_dirs.extend(dirs.iter().cloned());

    if let Some(p) = first_existing(&script_dirs, "companion_bridge.lic") {
        return ComponentStatus::ready(
            "bridge",
            "companion_bridge.lic is installed".into(),
            Some(p.to_string_lossy().into_owned()),
        );
    }
    ComponentStatus::missing(
        "bridge",
        "companion_bridge.lic is not in Lich's scripts folder yet",
    )
}

fn detect_maps() -> ComponentStatus {
    let dirs = lich_dirs();
    let map_dirs: Vec<PathBuf> = dirs.iter().map(|d| d.join("maps")).collect();
    for d in &map_dirs {
        if d.exists() {
            let count = std::fs::read_dir(d).map(|r| r.count()).unwrap_or(0);
            if count > 0 {
                return ComponentStatus::ready(
                    "maps",
                    format!("{count} map files"),
                    Some(d.to_string_lossy().into_owned()),
                );
            }
        }
    }
    ComponentStatus::missing("maps", "No Lich map database found")
}

fn detect_genie() -> ComponentStatus {
    let dirs = candidate_dirs(&["Genie", "Genie4", "GenieClient", "Simutronics"]);
    for leaf in ["Genie.exe", "GenieClient.exe", "Genie4.exe"] {
        if let Some(p) = first_existing(&dirs, leaf) {
            return ComponentStatus::ready(
                "genie",
                format!("Found {leaf}"),
                Some(p.to_string_lossy().into_owned()),
            );
        }
    }
    if !dirs.is_empty() {
        return ComponentStatus::ready(
            "genie",
            "Genie folder found".into(),
            Some(dirs[0].to_string_lossy().into_owned()),
        );
    }
    ComponentStatus::missing("genie", "Genie not found. Any Simutronics frontend works.")
}

/// Look for what is actually installed. Reports only what it can see, and says
/// where it looked. Never claims to have installed anything.
#[tauri::command]
fn detect_components() -> Vec<ComponentStatus> {
    vec![
        detect_genie(),
        detect_ruby(),
        detect_lich(),
        detect_bridge(),
        detect_maps(),
    ]
}

/// Copy the bundled bridge script into Lich's scripts folder.
///
/// This is the one install step we perform ourselves, because it is our own
/// file going to a known location. Everything else (Ruby, Lich) is handed to
/// the user with the exact command to run, rather than downloaded silently.
#[tauri::command]
fn install_bridge_script(source: String) -> Result<String, String> {
    let src = Path::new(&source);
    if !src.exists() {
        return Err(format!("bridge script not found at {source}"));
    }
    let dirs = lich_dirs();
    let target_dir = dirs
        .iter()
        .map(|d| d.join("scripts"))
        .find(|d| d.exists())
        .ok_or_else(|| "Could not find Lich's scripts folder".to_string())?;

    let dest = target_dir.join("companion_bridge.lic");
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// The exact command a user should run to install Ruby, shown before it runs.
/// We hand this to winget rather than fetching an installer ourselves so the
/// signature checking is not ours to get wrong.
#[tauri::command]
fn ruby_install_command() -> String {
    "winget install --id RubyInstallerTeam.RubyWithDevKit.3.3 --source winget".into()
}

#[tauri::command]
fn bridge_default_url() -> String {
    "ws://127.0.0.1:7415/companion".into()
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, value: bool) -> Result<(), String> {
    window.set_always_on_top(value).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_components,
            install_bridge_script,
            ruby_install_command,
            bridge_default_url,
            set_always_on_top
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("DR Companion");
                let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 520.0,
                    height: 780.0,
                }));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DR Companion");
}
