//! Finding and starting the Godot world viewer.
//!
//! Everything else for the 3D viewer already exists: the Godot project builds,
//! `tools/export-godot-viewer.mjs` produces a real Windows executable, the
//! presentation bridge is listening on an authenticated loopback socket and
//! publishing snapshots to it. What was missing was the last link - nothing in
//! the app could *start* the thing, it was not bundled, and no control opened
//! it. A renderer a player cannot reach is exactly as useful as no renderer.
//!
//! # No *secrets* go on the command line
//!
//! `presentation_bridge::start` writes the port and the session token into the
//! app data directory, and the Godot client reads them from there. Neither is
//! ever passed here.
//!
//! That is the same rule `lich.rs` states about passwords: a command line is
//! visible in the process list to every other program on the machine, and
//! lands in crash dumps and parent-process logs. The bridge token is a
//! credential for a socket that can turn into a game command, so it belongs in
//! a file with the app's own permissions, not in `argv`.
//!
//! A mode flag is not a credential, and one is now passed. Until this was
//! written the launch passed no arguments at all, and
//! `godot/scripts/world_root.gd` goes live only when `--live-presentation` is
//! among the user arguments - so every viewer the app had ever started came up
//! in the mock Crossing fixture, showing a world that was not the player's.
//! Nothing errored, which is why it survived: a mock world and a live one look
//! the same until you read the room names.
//!
//! # The app has to stay usable when the viewer is absent
//!
//! `docs/THREE_D_REBUILD_HANDOFF.md` makes it an acceptance rule: "client
//! remains usable if Godot is absent/crashed". So every path here reports
//! rather than throws, "not installed" is an ordinary answer rather than an
//! error, and nothing in the app's startup depends on any of it.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// The name the export writes, and therefore the name to look for and the one
/// the process list will show. Kept in one place because it is the join
/// between `tools/export-godot-viewer.mjs` and this module - two spellings of
/// it would mean a viewer that launches and can never be found again.
pub const VIEWER_EXE: &str = "DRCompanionWorldViewer.exe";

/// The flag `godot/scripts/world_root.gd::_live_requested` looks for. Spelled
/// once, here, because the two halves live in different languages and a
/// typo in either produces a viewer that starts happily in the mock world.
pub const LIVE_FLAG: &str = "--live-presentation";

/// What the viewer is started with.
///
/// The bare `--` matters: Godot itself consumes everything before it, and
/// `OS.get_cmdline_user_args()` - which is what the viewer reads - returns
/// only what follows. Passed as a slice from a pure function so a test can
/// assert both the separator and the flag without spawning anything.
pub fn viewer_launch_args() -> [&'static str; 2] {
    ["--", LIVE_FLAG]
}

/// Where the viewer might be, in the order worth trying.
///
/// Two real cases and they are genuinely different. In a shipped build the
/// exe is a bundled resource beside the app. On a development machine it is
/// whatever `npm run godot:export` last wrote into `godot/build/`, which is
/// not committed and frequently absent.
///
/// Pure, and takes both roots as arguments rather than reaching for an
/// `AppHandle`, so the ordering can be tested without constructing a Tauri
/// app - which `setup.rs`'s module doc already documents as impractical for a
/// standalone test binary.
pub fn viewer_candidates(resource_dir: Option<&Path>, repo_root: Option<&Path>) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(dir) = resource_dir {
        out.push(dir.join("viewer").join(VIEWER_EXE));
        out.push(dir.join(VIEWER_EXE));
    }
    if let Some(root) = repo_root {
        out.push(root.join("godot").join("build").join(VIEWER_EXE));
    }
    out
}

/// Is the viewer already up?
///
/// `None` means the question could not be answered, which is a third state
/// and not a no - the same distinction `lich.rs::lich_running` draws, for the
/// same reason: an unreadable process list must not read as permission to
/// start a second copy, and must not read as a refusal forever either.
fn viewer_running() -> Option<bool> {
    let out = Command::new("tasklist")
        .args([
            "/FI",
            &format!("IMAGENAME eq {VIEWER_EXE}"),
            "/FO",
            "CSV",
            "/NH",
        ])
        .output()
        .ok()?;
    let listed = String::from_utf8_lossy(&out.stdout);
    if listed.trim().is_empty() {
        // tasklist prints an informational line when its filter matches
        // nothing, so entirely empty output means the call failed rather than
        // that the process is absent.
        return None;
    }
    Some(listed.to_lowercase().contains(&VIEWER_EXE.to_lowercase()))
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ViewerStatus {
    /// An executable was found at one of the candidate paths.
    pub installed: bool,
    /// Where it is, when there is one. Shown so a person can check they are
    /// about to run the build they think they are.
    pub path: Option<String>,
    /// Whether a viewer process is up. Meaningless unless `running_known`.
    pub running: bool,
    /// False when the process list could not be read at all. Never collapse
    /// this into `running: false` - "no viewer" and "could not look" send a
    /// person to two different places.
    pub running_known: bool,
}

fn status_for(candidates: &[PathBuf]) -> ViewerStatus {
    let found = candidates.iter().find(|p| p.is_file());
    let running = viewer_running();
    ViewerStatus {
        installed: found.is_some(),
        path: found.map(|p| p.to_string_lossy().into_owned()),
        running: running.unwrap_or(false),
        running_known: running.is_some(),
    }
}

fn resolved_candidates<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
    use tauri::Manager;
    let resource_dir = app.path().resource_dir().ok();
    // Two levels up from src-tauri's manifest dir is the repo root in a dev
    // checkout. Absent in a shipped build, which is why it is only ever one
    // candidate among others rather than the answer.
    let repo_root = std::env::var("CARGO_MANIFEST_DIR")
        .ok()
        .map(PathBuf::from)
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
    viewer_candidates(resource_dir.as_deref(), repo_root.as_deref())
}

#[tauri::command]
pub fn viewer_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> ViewerStatus {
    status_for(&resolved_candidates(&app))
}

#[tauri::command]
pub fn launch_viewer<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    let candidates = resolved_candidates(&app);
    let status = status_for(&candidates);

    // Refuse rather than race, and only when we actually know. A second viewer
    // would open a second window onto the same world and both would answer the
    // same clicks, which reads as the app sending every command twice.
    if status.running_known && status.running {
        return Err("The world viewer is already open.".into());
    }

    let exe = status.path.ok_or_else(|| {
        format!(
            "No world viewer found. Build one with `npm run godot:export`, \
             which writes {VIEWER_EXE} into godot/build."
        )
    })?;

    Command::new(&exe)
        .args(viewer_launch_args())
        .current_dir(
            Path::new(&exe)
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(".")),
        )
        .spawn()
        .map_err(|e| format!("Could not start the world viewer: {e}"))?;

    Ok("Opening the world viewer.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shipped_resource_dir_is_preferred_over_a_dev_build() {
        let c = viewer_candidates(Some(Path::new("/app/res")), Some(Path::new("/repo")));
        let first = c.first().unwrap().to_string_lossy().replace('\\', "/");
        assert!(
            first.starts_with("/app/res"),
            "a shipped build must not silently run a stale dev export: {c:?}"
        );
        assert!(c.iter().any(|p| p
            .to_string_lossy()
            .replace('\\', "/")
            .contains("/repo/godot/build")));
    }

    #[test]
    fn each_root_is_optional_and_absence_is_not_a_panic() {
        assert!(viewer_candidates(None, None).is_empty());
        assert_eq!(viewer_candidates(None, Some(Path::new("/repo"))).len(), 1);
        assert!(!viewer_candidates(Some(Path::new("/app/res")), None).is_empty());
    }

    #[test]
    fn every_candidate_names_the_one_executable_the_export_writes() {
        // The join between this module and export-godot-viewer.mjs. A second
        // spelling here would launch nothing and find nothing, with no error.
        for p in viewer_candidates(Some(Path::new("/app/res")), Some(Path::new("/repo"))) {
            assert_eq!(p.file_name().unwrap(), VIEWER_EXE);
        }
    }

    #[test]
    fn the_launch_asks_for_live_mode_after_the_user_argument_separator() {
        let args = viewer_launch_args();
        assert_eq!(
            args[0], "--",
            "Godot keeps everything before `--` for itself, so a flag without \
             the separator never reaches get_cmdline_user_args"
        );
        assert_eq!(args[1], LIVE_FLAG);
    }

    #[test]
    fn the_live_flag_is_spelled_the_way_the_gdscript_reads_it() {
        // The two ends of this are in different languages, so nothing else
        // compares them. A silent disagreement here is a viewer that starts in
        // the mock world and looks entirely healthy doing it.
        let gd = include_str!("../../godot/scripts/world_root.gd");
        assert!(
            gd.contains(&format!("\"{LIVE_FLAG}\"")),
            "world_root.gd does not look for {LIVE_FLAG}"
        );
    }

    #[test]
    fn no_launch_argument_is_a_secret() {
        // The module header's rule, asserted rather than promised: the port
        // and token are files, and a mode flag is the only thing allowed here.
        for arg in viewer_launch_args() {
            assert!(
                !arg.contains("token") && !arg.contains("port"),
                "a credential reached argv: {arg}"
            );
        }
    }

    #[test]
    fn nothing_installed_reports_absence_rather_than_claiming_a_path() {
        let s = status_for(&[PathBuf::from(
            "/definitely/not/here/DRCompanionWorldViewer.exe",
        )]);
        assert!(!s.installed);
        assert!(
            s.path.is_none(),
            "reported a path for a file that is not there"
        );
    }
}
