//! Does Lich actually run? Asked by running it.
//!
//! # Why this is not a list of things to look for
//!
//! The obvious health check enumerates: is Ruby installed, is each gem in the
//! Gemfile present, is `lich.rbw` there. Every one of those can pass while Lich
//! cannot start, and on this machine every one of them did.
//!
//! What was actually wrong, found on 27 Aug 2026 the slow way:
//!
//!   1. None of Lich's gems were installed. It had never been run.
//!   2. `ox` and `gtk3` are native extensions and the Ruby had no compiler, so
//!      installing the gems needed an MSYS2 toolchain first.
//!   3. **24 source files were missing from the Lich tree.** Not a truncated
//!      download - they were scattered across four directories with their
//!      neighbours intact, and every one of them was over 65,536 bytes while
//!      every file under 64,147 bytes was present. The same threshold had
//!      already eaten two `.rs` files out of an extracted cargo crate the day
//!      before.
//!
//! A file-by-file checklist would have to have known to look for the third,
//! and nobody writes that check before it happens to them. Running
//! `lich.rbw --version` catches all three, because Lich requires its whole tree
//! at boot and exits non-zero when any require fails. It is the outcome, not a
//! proxy for it.
//!
//! # The error is not on stdout or stderr - read it before believing a blank one
//!
//! Found while building this, not while using it, and worth keeping: the
//! first version read the child process's stdout and stderr pipes and got
//! nothing back for the exact failure it exists to catch. `exit == 1` with an
//! empty `text` looks identical whether Lich is fine and something else went
//! wrong, or Lich hit precisely the failure this file is for - which is
//! rule-1 shaped, an absent result standing in for a negative one.
//!
//! The reason: `lib/init.rb` runs `$stderr = File.open(debug_filename, 'w')`
//! during boot, before the first `require` that can fail, so a Windows build
//! with no console (`rubyw.exe`, or `--login`'s default) has somewhere for a
//! crash to go. Ruby's own uncaught-exception printer writes through the
//! `$stderr` *global*, not the `STDERR` constant, so once that reassignment
//! runs, the failure goes into `<TEMP_DIR>/debug-<timestamp>.log` and the
//! child's actual stderr pipe carries nothing at all - confirmed by writing
//! directly to the `STDERR` constant immediately before the failing require
//! and watching it reach the pipe while the LoadError one line later did not.
//!
//! So the log file is read after the process exits, picking the most recently
//! created `debug-*.log` under `<install_dir>/temp`, and it is treated as the
//! primary source; the pipes are kept only because a launch failure severe
//! enough to happen before `$stderr` is reassigned - a bad path, a missing
//! Ruby - still lands there.
//!
//! # Three answers, not two
//!
//! `boots: None` means we could not find out - no Ruby, no launcher, the check
//! timed out. That is not "broken" and must never be rendered as such, because
//! the remedies are different and telling somebody to reinstall Lich when the
//! real problem is that Ruby is missing sends them down the wrong hour.

use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime};

/// How long Lich gets to print its version before this gives up and kills it.
///
/// Was 45 seconds, and that was short enough to be its own bug: Lich's own
/// `GemCheck` self-heals missing gems on Windows by showing a native consent
/// dialog and waiting - `CONSENT_TIMEOUT_SECONDS` in `lib/gemcheck.rb`, 120
/// seconds, implemented as a `WScript.Shell` `Popup` with that same timeout
/// baked in, so the dialog auto-dismisses itself if nobody answers. A health
/// check is still a launch as far as Lich is concerned, so this exact
/// diagnostic call could trigger that dialog - and at 45 seconds, this file
/// would kill the process out from under a player who was about to click it,
/// on a check whose entire purpose is to help them get unstuck.
///
/// 150 seconds gives Lich's own 120-second dialog room to auto-dismiss on its
/// own first, so the kill below only fires for a genuine hang - something
/// with no timeout of its own to have already given up by then.
const TIMEOUT: Duration = Duration::from_secs(150);

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LichHealth {
    /// True when Lich started and exited cleanly. `None` means not determined -
    /// see the module note. Never collapse `None` into `false`.
    pub boots: Option<bool>,
    /// What Lich called itself, when it got far enough to say.
    pub version: Option<String>,
    /// The line that actually failed, verbatim, not a summary of it.
    pub problem: Option<String>,
    /// What this particular failure means, when it is one we recognise.
    pub diagnosis: Option<String>,
    /// What to do, in words a person can act on.
    pub remedy: Option<String>,
    /// Plain English for whatever the fields above cannot say alone.
    pub note: String,
}

/// Run a command with a ceiling on how long it may take.
///
/// `std::process::Command` has no timeout, and the honest failure of a health
/// check is "I could not tell", not "it hung and so did the app". `TIMEOUT`
/// itself carries the reasoning for why 150 seconds and not less - short
/// version: Lich's own consent dialog needs the room to auto-dismiss first.
fn run_bounded(ruby: &str, dir: &Path, args: &[&str]) -> Result<(bool, String), String> {
    let mut child = Command::new(ruby)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not run {ruby}: {e}"))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if start.elapsed() > TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Lich did not answer within {}s", TIMEOUT.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("could not wait on {ruby}: {e}")),
        }
    }

    let out = child
        .wait_with_output()
        .map_err(|e| format!("could not read output from {ruby}: {e}"))?;

    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok((out.status.success(), text))
}

/// The debug log this specific run wrote, if it wrote one.
///
/// Lich names each run's log `debug-<timestamp>.log` and reassigns `$stderr`
/// to it before the first require that can fail - see the module note. There
/// is no run id to match on, so this takes the newest `debug-*.log` under
/// `<dir>/temp` created no earlier than `not_before`, which is read just
/// before the child is spawned. A log from a previous run sits in the same
/// folder and predates that mark, so it cannot be mistaken for this one.
///
/// `None` is a legitimate answer - a launch failure early enough (bad Ruby
/// path, folder does not exist) never reaches the line that opens the file at
/// all, and the process's own stdout/stderr already carries that case.
fn this_runs_debug_log(dir: &Path, not_before: SystemTime) -> Option<String> {
    let temp = dir.join("temp");
    let mut newest: Option<(SystemTime, std::path::PathBuf)> = None;

    for entry in fs::read_dir(&temp).ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with("debug-") && name.ends_with(".log")) {
            continue;
        }
        let Some(created) = entry
            .metadata()
            .ok()
            .and_then(|m| m.created().or_else(|_| m.modified()).ok())
        else {
            continue;
        };
        if created < not_before {
            continue;
        }
        let is_newer = match &newest {
            Some((t, _)) => created > *t,
            None => true,
        };
        if is_newer {
            newest = Some((created, entry.path()));
        }
    }

    let (_, path) = newest?;
    fs::read_to_string(&path).ok()
}

/// Turn a Ruby failure into something a person can act on.
///
/// Only shapes we have actually seen on this machine. An unrecognised failure
/// returns `None` rather than a guess: a confident wrong diagnosis costs more
/// than an honest "I do not know what this means, here is the error".
fn diagnose(text: &str, lich_dir: &Path) -> Option<(String, String)> {
    let dir = lich_dir.to_string_lossy().replace('\\', "/").to_lowercase();

    for line in text.lines() {
        let lower = line.to_lowercase();

        if let Some(idx) = lower.find("cannot load such file -- ") {
            let what = line[idx + "cannot load such file -- ".len()..].trim();
            let what_norm = what.replace('\\', "/").to_lowercase();
            let bare = what_norm.trim_end_matches(" (loaderror)").trim();

            // Inside the Lich tree: a source file is gone, not a gem.
            if bare.starts_with(&dir) || bare.contains("/lich5/lib/") {
                return Some((
                    format!("A source file is missing from the Lich install: {what}"),
                    "Lich's own files are incomplete, so reinstalling gems will not help. \
                     Re-extract Lich over this folder from \
                     https://github.com/elanthia-online/lich-5/releases - it will not \
                     touch your saved characters, which live in data/."
                        .into(),
                ));
            }

            return Some((
                format!("A Ruby gem Lich needs is not installed: {what}"),
                format!(
                    "Install it into the Ruby that runs Lich: `gem install {}`. \
                     If it fails to build, that Ruby has no compiler and needs one: \
                     run `ridk install 1 3` from its bin folder first.",
                    bare.split('/').next().unwrap_or(bare).trim()
                ),
            ));
        }

        if lower.contains("missing required ruby gems") {
            return Some((
                "Lich's own gem check found gems missing.".into(),
                "Run `bundle install` in the Lich folder, or let Lich's own recovery \
                 prompt do it. A native build needs a compiler: `ridk install 1 3`."
                    .into(),
            ));
        }
    }
    None
}

/// Ask Lich whether it can start, by starting it.
#[tauri::command]
pub fn lich_health() -> LichHealth {
    // Blocking form - see lich.rs. `lich_status` is now async so it cannot
    // freeze the window; internal callers want the plain function.
    let status = crate::lich::lich_status_blocking();

    let (Some(launcher), Some(ruby), Some(install_dir)) =
        (&status.launcher, &status.ruby, &status.install_dir)
    else {
        return LichHealth {
            boots: None,
            note: format!(
                "Not checked: {}",
                if status.ruby.is_none() {
                    "no Ruby found to run Lich with."
                } else {
                    "no lich.rbw found."
                }
            ),
            remedy: Some(
                "The setup wizard can install both. Nothing here is broken - it has \
                 not been set up yet."
                    .into(),
            ),
            ..Default::default()
        };
    };

    let dir = Path::new(install_dir);

    // `ruby`, not `rubyw`: the windowed interpreter detaches from the console
    // and there would be no output to read from the pipe. It does not matter
    // for the failure case either way - see the module note - but the success
    // case still wants `--version`'s text back, and only the console
    // interpreter's pipe reliably carries it.
    let console_ruby = ruby.replace("rubyw.exe", "ruby.exe");

    let started_at = SystemTime::now();
    match run_bounded(&console_ruby, dir, &[launcher.as_str(), "--version"]) {
        Err(why) => LichHealth {
            boots: None,
            note: format!("Not checked: {why}"),
            remedy: Some(
                "If a Lich window appeared and then vanished, this may have interrupted a \
                 first-run gem check - it shows its own dialog and waits up to two minutes \
                 for an answer. Try again and answer it there if it reappears."
                    .into(),
            ),
            ..Default::default()
        },
        Ok((true, text)) => {
            let version = text
                .lines()
                .find(|l| l.to_lowercase().contains("lich"))
                .map(|l| l.trim().to_string());
            LichHealth {
                boots: Some(true),
                version: version.clone(),
                note: match version {
                    Some(v) => format!("{v} starts cleanly."),
                    None => "Lich starts cleanly.".into(),
                },
                ..Default::default()
            }
        }
        Ok((false, pipe_text)) => {
            // The real failure is almost never on the pipe - see the module
            // note on `$stderr` reassignment. Prefer the debug log this run
            // wrote; fall back to the pipe only when there is no log, which
            // means the failure happened before Lich got that far.
            let text = this_runs_debug_log(dir, started_at).unwrap_or(pipe_text);
            // The line that failed, not the backtrace under it. A stack of
            // mkmf frames tells a person nothing and buries the one line that
            // does.
            let problem = text
                .lines()
                .find(|l| {
                    let s = l.to_lowercase();
                    s.contains("cannot load such file")
                        || s.contains("error")
                        || s.contains("missing")
                })
                .map(|l| l.trim().to_string())
                .or_else(|| {
                    text.lines()
                        .find(|l| !l.trim().is_empty())
                        .map(|l| l.trim().to_string())
                });

            let found = problem.as_deref().and_then(|_| diagnose(&text, dir));

            LichHealth {
                boots: Some(false),
                version: None,
                note: "Lich is installed but does not start.".into(),
                problem,
                diagnosis: found.as_ref().map(|(d, _)| d.clone()),
                remedy: found.map(|(_, r)| r).or(Some(
                    "Not a failure this app recognises. The error above is Lich's own, \
                     verbatim, and is the thing to search for."
                        .into(),
                )),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact line this machine produced, before the files were restored.
    #[test]
    fn a_missing_source_file_is_not_reported_as_a_missing_gem() {
        let text = "lich.rbw:104:in 'Kernel#require': cannot load such file -- \
                    C:/Ruby4Lich5/Lich5/lib/common/script.rb (LoadError)";
        let (diagnosis, remedy) =
            diagnose(text, Path::new("C:\\Ruby4Lich5\\Lich5")).expect("should recognise this");
        assert!(
            diagnosis.contains("missing from the Lich install"),
            "{diagnosis}"
        );
        // The remedy has to send them to the right place. Telling somebody to
        // install gems when 24 source files are gone is an hour of their life.
        assert!(remedy.contains("Re-extract"), "{remedy}");
        assert!(!remedy.contains("gem install"), "{remedy}");
    }

    #[test]
    fn a_missing_gem_is_reported_as_one() {
        let text = "lich.rbw:56:in 'require': cannot load such file -- ox (LoadError)";
        let (diagnosis, remedy) =
            diagnose(text, Path::new("C:\\Ruby4Lich5\\Lich5")).expect("should recognise this");
        assert!(diagnosis.contains("gem"), "{diagnosis}");
        assert!(remedy.contains("gem install ox"), "{remedy}");
        // The compiler hint matters: `gem install ox` is what fails on a Ruby
        // with no toolchain, which is the state this machine was in.
        assert!(remedy.contains("ridk install"), "{remedy}");
    }

    /// An unrecognised failure must not be given a confident wrong answer.
    #[test]
    fn an_unknown_failure_is_not_diagnosed() {
        let text = "lich.rbw:1: some entirely novel catastrophe";
        assert!(diagnose(text, Path::new("C:\\Ruby4Lich5\\Lich5")).is_none());
    }

    /// A few places this Ruby install has shown up on this machine. Not a
    /// general-purpose `which` - just enough to let this test run where it
    /// matters without hardcoding one path.
    fn find_ruby() -> Option<String> {
        for p in ["C:/Ruby4Lich5/4.0.6/bin/ruby.exe", "C:/Ruby/bin/ruby.exe"] {
            if Path::new(p).exists() {
                return Some(p.to_string());
            }
        }
        None
    }

    /// The mechanism itself, against a real `ruby.exe`, not a string fixture.
    ///
    /// Every other test in this file asserts against text a human typed in as
    /// a fixture. This is the one that matters more: it reproduces the exact
    /// shape Lich uses - `$stderr = File.open(debug_filename, 'w')` followed
    /// by a require that fails - with a script this test writes itself, and
    /// checks that `this_runs_debug_log` finds the right file and `diagnose`
    /// reads it correctly. Written after the first version of this file was
    /// built, run, and returned an empty `problem` against the real broken
    /// install: `run_bounded`'s pipe was empty because Lich's own `$stderr`
    /// reassignment had already swallowed it, and no fixture-based test would
    /// have caught that, because a human-typed fixture does not reproduce a
    /// mechanism the human did not know was there.
    #[test]
    fn the_debug_log_mechanism_is_read_correctly_not_just_the_pipe() {
        let Some(ruby) = find_ruby() else {
            // Loud, not a silent pass: a check that cannot run must not read
            // as a check that found nothing wrong.
            eprintln!(
                "SKIPPED the_debug_log_mechanism_is_read_correctly_not_just_the_pipe: \
                 no ruby.exe found at a known path on this machine"
            );
            return;
        };

        let dir = std::env::temp_dir().join(format!("drc-lich-health-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("temp")).unwrap();

        // A script.rb standing in for Lich's boot: redirect $stderr to a
        // per-run debug log exactly as lib/init.rb does, then fail a require.
        // If this test ever needs updating because Lich changed how it logs,
        // that is exactly the signal this test exists to give.
        fs::write(
            dir.join("boot.rb"),
            r##"
TEMP_DIR = File.join(__dir__, 'temp')
debug_filename = "#{TEMP_DIR}/debug-#{Time.now.strftime('%Y-%m-%d-%H-%M-%S-%L')}.log"
$stderr = File.open(debug_filename, 'w')
require File.join(__dir__, 'lib', 'common', 'script.rb')
"##,
        )
        .unwrap();
        // lib/common/script.rb is deliberately never created.

        let started_at = SystemTime::now();
        let (ok, pipe_text) = run_bounded(&ruby, &dir, &["boot.rb"]).expect("ruby should run");
        assert!(!ok, "the require was supposed to fail");
        assert!(
            pipe_text.trim().is_empty(),
            "the pipe should be empty once $stderr is reassigned, got: {pipe_text:?}"
        );

        let log = this_runs_debug_log(&dir, started_at)
            .expect("the debug log this run wrote should be found");
        assert!(
            log.contains("cannot load such file"),
            "the log should contain the real LoadError, got: {log}"
        );

        let (diagnosis, _) =
            diagnose(&log, &dir).expect("this shape should be recognised as a missing file");
        assert!(
            diagnosis.contains("missing from the Lich install"),
            "{diagnosis}"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
