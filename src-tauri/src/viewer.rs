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
use std::process::{Child, Command};
use std::sync::Mutex;

use serde::Serialize;

/// The viewer this app started, for as long as it is ours to answer for.
///
/// Two things need it. Closing the app must close the viewer it opened -
/// otherwise a window with a live socket to a bridge that no longer exists
/// outlives the thing that made it, and the only way to be rid of it is Task
/// Manager. And the process list cannot tell *our* viewer from one somebody
/// started by hand or from another session's, so a held child is the only
/// honest answer to "is the viewer we launched still up".
#[derive(Default)]
pub struct ViewerProcess(Mutex<Option<Child>>);

/// What a held child is doing, with "we could not tell" kept separate from
/// "it is gone" - the same three-state rule `viewer_running` follows.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Held {
    /// Nothing is held: this app has not launched a viewer this session.
    None,
    Running,
    Exited(Option<i32>),
    /// A held child that could not be waited on. Never collapse into Exited:
    /// killing on exit is worth attempting even when the answer is unclear.
    Unknown,
}

/// Pure so the mapping can be tested without spawning anything, which is the
/// half that has actually been wrong before: `running: false` and
/// `running_known: false` mean different things and only one of them is a no.
fn apply_held(status: &mut ViewerStatus, held: Held) {
    match held {
        Held::None => {}
        Held::Running => {
            status.running = true;
            status.running_known = true;
        }
        Held::Exited(code) => {
            status.running = false;
            status.running_known = true;
            status.exit_code = code;
        }
        Held::Unknown => {}
    }
}

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
    /// The exit status of the viewer *this app started*, once it has one.
    ///
    /// A crashed viewer and a viewer nobody opened both read as "ready", and
    /// the difference is the whole question when somebody says the window
    /// vanished. `None` means either: no viewer was launched this session, or
    /// one is still running. Read alongside `running`, never alone.
    ///
    /// `Some(None)` is not representable here on purpose - a process killed by
    /// a signal has no code, and `Option<i32>` flattened to null is the same
    /// as "still running" to the panel, which would be a lie. Windows always
    /// has a code, so this is a Windows-shaped simplification and is written
    /// down rather than discovered later.
    pub exit_code: Option<i32>,
}

fn status_for(candidates: &[PathBuf], held: Held) -> ViewerStatus {
    let found = candidates.iter().find(|p| p.is_file());
    let running = viewer_running();
    let mut status = ViewerStatus {
        installed: found.is_some(),
        path: found.map(|p| p.to_string_lossy().into_owned()),
        running: running.unwrap_or(false),
        running_known: running.is_some(),
        // Only a held child can say this; the process list cannot.
        exit_code: None,
    };
    // The held child wins over the process list where it has anything to say:
    // it is about the viewer this app started, and `tasklist` is about anything
    // sharing the name.
    apply_held(&mut status, held);
    status
}

/// What the held child says, waiting on it without blocking.
///
/// `try_wait` remembers the status once it has reaped it, so this stays
/// truthful on every later call rather than only the first.
fn held_state(process: &ViewerProcess) -> Held {
    let mut guard = match process.0.lock() {
        Ok(g) => g,
        // A poisoned lock means a panic while holding it. That is a real
        // "cannot tell", not a "no viewer".
        Err(_) => return Held::Unknown,
    };
    match guard.as_mut() {
        None => Held::None,
        Some(child) => match child.try_wait() {
            Ok(None) => Held::Running,
            Ok(Some(status)) => Held::Exited(status.code()),
            Err(_) => Held::Unknown,
        },
    }
}

/// Close the viewer this app opened. Called on the app's own exit.
///
/// Kills by the handle we created, never by image name: several sessions run
/// on this machine and more than one viewer can be open, so a name-based kill
/// would take somebody else's window with it.
pub fn close_viewer(process: &ViewerProcess) {
    let Ok(mut guard) = process.0.lock() else {
        return;
    };
    if let Some(child) = guard.as_mut() {
        // Already gone is the ordinary case when somebody closed the window
        // themselves; `kill` errors on it and there is nothing to do about it.
        let _ = child.kill();
        let _ = child.wait();
    }
    *guard = None;
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
pub fn viewer_status<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    process: tauri::State<'_, ViewerProcess>,
) -> ViewerStatus {
    status_for(&resolved_candidates(&app), held_state(&process))
}

#[tauri::command]
pub fn launch_viewer<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    process: tauri::State<'_, ViewerProcess>,
) -> Result<String, String> {
    let candidates = resolved_candidates(&app);
    let status = status_for(&candidates, held_state(&process));

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

    let child = Command::new(&exe)
        .args(viewer_launch_args())
        .current_dir(
            Path::new(&exe)
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| PathBuf::from(".")),
        )
        .spawn()
        .map_err(|e| format!("Could not start the world viewer: {e}"))?;

    // Held so the app can close it again, and so status can answer about this
    // viewer rather than about anything with the same name. A previous child
    // in the slot has already exited or been refused above, so dropping it
    // here leaks nothing.
    if let Ok(mut guard) = process.0.lock() {
        *guard = Some(child);
    }

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

    /// Answer, from the GDScript's own text, the only question that matters
    /// here: **which literal does the script's command-line check actually
    /// read?**
    ///
    /// Not "does this string appear in the file" - that was the old assertion,
    /// and hoisting the literal into `const LIVE_FLAG` moved its sole
    /// occurrence out of the use site, so the check went on passing over a
    /// script that read something else entirely (issue #343).
    ///
    /// So: find the one call to `OS.get_cmdline_user_args()`, take the
    /// argument the `.has(...)` beside it reads, and follow a
    /// `const NAME := "value"` indirection when that argument is an
    /// identifier. The site is located by *behaviour* rather than by function
    /// name, so renaming `_live_requested` does not quietly disarm this.
    ///
    /// Returns `Err` with the reason whenever the question cannot be answered.
    /// Three states, never two: matched, mismatched, and could-not-tell - and
    /// the last is a red test, because a parser that no longer understands the
    /// script has to say so rather than pass.
    fn flag_the_gdscript_reads(gd: &str) -> Result<String, String> {
        fn string_literal(s: &str) -> Option<&str> {
            s.strip_prefix('"')?.split('"').next()
        }

        // File-scope `const NAME := "value"` / `const NAME = "value"`.
        let mut consts: Vec<(&str, &str)> = Vec::new();
        for line in gd.lines() {
            let Some(rest) = line.trim_start().strip_prefix("const ") else {
                continue;
            };
            let Some((name, value)) = rest.split_once('=') else {
                continue;
            };
            if let Some(literal) = string_literal(value.trim()) {
                consts.push((name.trim().trim_end_matches(':').trim(), literal));
            }
        }

        let sites: Vec<&str> = gd
            .lines()
            .filter(|l| l.contains("get_cmdline_user_args"))
            .collect();
        let [site] = sites.as_slice() else {
            return Err(format!(
                "expected exactly one call to get_cmdline_user_args in world_root.gd, \
                 found {}: {sites:?}",
                sites.len()
            ));
        };

        let after = site
            .split_once("get_cmdline_user_args")
            .map(|(_, rest)| rest)
            .unwrap_or_default();
        let Some(arg) = after
            .split_once(".has(")
            .and_then(|(_, rest)| rest.split_once(')'))
            .map(|(arg, _)| arg.trim())
            .filter(|arg| !arg.is_empty())
        else {
            return Err(format!(
                "the command-line call is not the `.has(<flag>)` shape this parser \
                 reads: {}",
                site.trim()
            ));
        };

        if let Some(literal) = string_literal(arg) {
            return Ok(literal.to_string());
        }

        consts
            .iter()
            .find(|(name, _)| *name == arg)
            .map(|(_, value)| value.to_string())
            .ok_or_else(|| {
                format!(
                    "the check reads `{arg}`, which is neither a string literal nor a \
                     file-scope string const in world_root.gd (consts seen: {:?})",
                    consts.iter().map(|(n, _)| *n).collect::<Vec<_>>()
                )
            })
    }

    #[test]
    fn the_flag_rust_passes_is_the_flag_the_gdscript_reads() {
        // The two ends of this are in different languages, so nothing else
        // compares them. A silent disagreement here is a viewer that starts in
        // the mock world and looks entirely healthy doing it.
        let gd = include_str!("../../godot/scripts/world_root.gd");
        let read = flag_the_gdscript_reads(gd)
            .unwrap_or_else(|why| panic!("cannot tell what world_root.gd reads: {why}"));
        assert_eq!(
            read, LIVE_FLAG,
            "world_root.gd's command-line check reads {read:?}, but this module \
             launches the viewer with {LIVE_FLAG:?} - the viewer would boot into the \
             mock world"
        );
    }

    #[test]
    fn the_gdscript_reader_reports_the_use_site_not_the_declaration() {
        // Issue #343's own sabotage, kept as a case: the const still declares
        // the real flag and the check reads a different one. The old assertion
        // passed on exactly this.
        let sabotaged = concat!(
            "const LIVE_FLAG := \"--live-presentation\"\n",
            "func _live_requested() -> bool:\n",
            "\treturn OS.get_cmdline_user_args().has(\"--live\")\n"
        );
        assert_eq!(flag_the_gdscript_reads(sabotaged).unwrap(), "--live");

        // Positive control on the same parser: the shape the repo actually
        // ships must resolve through the const to the real flag.
        let honest = concat!(
            "const LIVE_FLAG := \"--live-presentation\"\n",
            "func _live_requested() -> bool:\n",
            "\treturn OS.get_cmdline_user_args().has(LIVE_FLAG)\n"
        );
        assert_eq!(
            flag_the_gdscript_reads(honest).unwrap(),
            "--live-presentation"
        );
    }

    #[test]
    fn the_gdscript_reader_refuses_rather_than_guesses() {
        // A parser that cannot find its answer must fail, not return a
        // plausible one. Each case names what went wrong.
        let cases = [
            (
                "no command-line check at all",
                "const LIVE_FLAG := \"--live-presentation\"\n",
            ),
            (
                "two checks, so `the` flag is not well defined",
                "func a():\n\treturn OS.get_cmdline_user_args().has(\"--x\")\n\
                 func b():\n\treturn OS.get_cmdline_user_args().has(\"--y\")\n",
            ),
            (
                "an identifier with no const behind it",
                "func a():\n\treturn OS.get_cmdline_user_args().has(MISSING)\n",
            ),
            (
                "not the .has() shape",
                "func a():\n\treturn OS.get_cmdline_user_args().size() > 0\n",
            ),
        ];
        for (why, gd) in cases {
            assert!(
                flag_the_gdscript_reads(gd).is_err(),
                "{why}: the reader returned an answer it could not have known"
            );
        }
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
    fn a_held_child_answers_about_our_viewer_rather_than_the_process_list() {
        // The process list cannot tell this app's viewer from another
        // session's, so where the held child has an answer it is the better
        // one. Both directions, because only overriding one way would let a
        // stale tasklist reading keep a dead viewer alive on screen.
        let mut running = ViewerStatus {
            running: false,
            running_known: true,
            ..Default::default()
        };
        apply_held(&mut running, Held::Running);
        assert!(running.running && running.running_known);

        let mut exited = ViewerStatus {
            running: true,
            running_known: true,
            ..Default::default()
        };
        apply_held(&mut exited, Held::Exited(Some(1)));
        assert!(!exited.running && exited.running_known);
        assert_eq!(
            exited.exit_code,
            Some(1),
            "a viewer that crashed must be distinguishable from one nobody opened"
        );
    }

    #[test]
    fn an_exit_code_is_only_reported_for_a_viewer_that_actually_exited() {
        // Otherwise the panel says "viewer exited (code N)" over a running
        // window, or over a session in which nothing was ever launched.
        for held in [Held::None, Held::Running, Held::Unknown] {
            let mut s = ViewerStatus::default();
            apply_held(&mut s, held);
            assert_eq!(s.exit_code, None, "{held:?} produced an exit code");
        }
    }

    #[test]
    fn holding_nothing_and_failing_to_wait_both_leave_the_process_list_alone() {
        // The two cases that must not become an answer. Held::Unknown in
        // particular is a panic or a failed wait, and reading it as "no
        // viewer" is what would let the app start a second one.
        for held in [Held::None, Held::Unknown] {
            let mut s = ViewerStatus {
                running: true,
                running_known: true,
                ..Default::default()
            };
            apply_held(&mut s, held);
            assert!(s.running, "{held:?} overrode the process list");
            let mut unknown = ViewerStatus::default();
            apply_held(&mut unknown, held);
            assert!(
                !unknown.running_known,
                "{held:?} invented knowledge the app does not have"
            );
        }
    }

    #[test]
    fn closing_an_empty_slot_is_not_an_error() {
        // The ordinary case on exit: the app is closed without a viewer ever
        // having been opened, and nothing about that is exceptional.
        let process = ViewerProcess::default();
        assert_eq!(held_state(&process), Held::None);
        close_viewer(&process);
        assert_eq!(held_state(&process), Held::None);
    }

    #[test]
    fn a_real_child_is_held_then_killed_and_the_status_follows() {
        // The whole B5 behaviour against an actual process, because the pure
        // mapping above cannot show that `try_wait` reports what this module
        // thinks it does. `cmd /c pause` waits on stdin forever and is on
        // every Windows machine.
        let child = Command::new("cmd")
            .args(["/c", "pause"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("could not spawn a test child");
        let process = ViewerProcess::default();
        *process.0.lock().unwrap() = Some(child);

        assert_eq!(held_state(&process), Held::Running);
        close_viewer(&process);
        assert_eq!(
            held_state(&process),
            Held::None,
            "the slot must be cleared, or the next launch is refused forever"
        );
    }

    #[test]
    fn nothing_installed_reports_absence_rather_than_claiming_a_path() {
        let s = status_for(
            &[PathBuf::from(
                "/definitely/not/here/DRCompanionWorldViewer.exe",
            )],
            Held::None,
        );
        assert!(!s.installed);
        assert!(
            s.path.is_none(),
            "reported a path for a file that is not there"
        );
    }
}
