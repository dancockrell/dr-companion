//! Starting Lich, so the app is not permanently parked on somebody else doing
//! it by hand.
//!
//! Lich sits between this app and the game. Without it running there is no
//! bridge, no live data, and the whole companion is a demo of itself - which is
//! what it had been, for as long as launching Lich was a manual step somebody
//! had to remember and get the arguments right for.
//!
//! # The password does not come through here, and never reaches a command line
//!
//! This is the constraint the whole design is bent around, so it is stated
//! first rather than buried. **It changed in Lane N and the old wording is
//! kept nowhere:** the app now performs the Play.net account login itself
//! (`docs/LICH_NATIVE_LOGIN.md` §2), so it *does* handle a password, in one
//! command invocation, in memory. What has not changed is the part this
//! module owns.
//!
//! Lich accepts `--account=`, `--password=` and `--character=` on the command
//! line. This module does not use them and must not. A password on a command
//! line is visible in the process list to every other program on the machine,
//! and lands in crash dumps and parent-process logs; it is the wrong place for
//! a credential no matter how briefly it is there. Nothing secret is a
//! parameter of any function here: what [`launch_lich_with_launch_data`]
//! receives is the `L` reply's fields, and the one sensitive item among them -
//! the one-shot game `KEY` - goes into a file Lich reads and this app deletes,
//! never into `argv`. See [`crate::sal`] for that file's shape and lifetime.
//!
//! # The route that was removed, and why there is no fallback to it
//!
//! Until Lane N the character launch was
//! `--login <Character> --dragonrealms --stormfront --headless=<port>`.
//! `--login` asks Lich to resolve a *saved entry* out of its own
//! `data/entry.yaml` - and the only way to get an entry into that file on this
//! machine was to sign in through Genie first, because Lich's own login window
//! offers Wrayth, Wizard, Avalon and Saga and none of the four is installed
//! (`gui_login_usable` below is the check, and it is why that deadlock is
//! reported rather than presented as a button). That is the whole reason Genie
//! was ever in this picture.
//!
//! It is gone rather than kept beside the new one, per `CLAUDE.md` §0 and
//! `docs/LICH_NATIVE_LOGIN.md` §6. The two flags that went with it are gone
//! for reasons worth recording, because both look like losses and neither is:
//!
//!   - **`--dragonrealms`** picked the game. `GAMECODE=DR` in the launch file
//!     does that now (`main.rb:225`), and it is the server's answer rather
//!     than our constant.
//!   - **`--stormfront`** was already inert on this path and had been since
//!     issue #31. `--without-frontend` - which `--headless=<port>` expands to
//!     (`arg_normalization.rb:52-53`) - routes `Frontend.client` through
//!     `LoginHelpers.resolve_headless_frontend`
//!     (`login_helpers.rb:578-584`), which special-cases only `--saga` and
//!     `--genie` and returns a hardcoded `'profanity'` for everything else.
//!     So `--stormfront` never reached anything. Measured, not inferred: see
//!     `docs/verification/lich-native-frontend-2026-09-06.md`.
//!
//! **`--genie` must stay absent, and that is the one that still matters.** It
//! is one of the two flags `resolve_headless_frontend` does honour, and it
//! would resolve the identity to `genie`, whose registered capabilities are
//! `[xml, mono]` (`front-end.rb:251-252`) - no `streams`. `messaging.rb:21-48`
//! gates every `<pushStream>`/`<popStream>` tag behind
//! `Frontend.supports_streams?`, so the channel tabs would go permanently
//! silent against a real game while the replay fixture, which emits those tags
//! with no capability check, went on looking fine.
//!
//! `--headless=<port>` is also what actually opens the socket
//! `src-tauri/src/game_link.rs` connects to. Its absence was a second,
//! separate gap: without it Lich resolves to the `session` role and expects to
//! spawn a real frontend, so this app's own launch button would start Lich
//! into a state its own TCP client could never attach to.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::credentials::Secret;
use crate::eaccess;
use crate::setup::{detect_ruby, pretty_path, rank_lich_installs};

/// The port Lich is asked to open with `--headless`, and the port the app's
/// own TCP client (`game_link.rs`) and its "Attach" button both default to.
/// One number in one place: the frontend hardcodes this same value in four
/// spots (the Genie config example, the connect guide, and the Attach
/// button), and a mismatch here would launch a Lich nothing could reach.
pub const DETACHABLE_PORT: u16 = 11024;

/// What we know about Lich, in the three answers a status can have.
///
/// Every "is it there" field here has a matching "did we actually look"
/// alongside it, because absent and unknown are different and this project has
/// been bitten by conflating them more than once. A launcher that reports "no
/// saved characters" when it merely failed to read the file sends the player
/// through a first-time setup they already did.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LichStatus {
    /// The Lich folder holding `lich.rbw`.
    pub install_dir: Option<String>,
    /// The script itself.
    pub launcher: Option<String>,
    /// The interpreter that runs it. `rubyw` where available, so launching does
    /// not leave a console window sitting on the desktop.
    pub ruby: Option<String>,
    /// Where Lich keeps saved logins. Present only if the folder exists.
    pub data_dir: Option<String>,
    /// Characters Lich has saved. Meaningful only when `characters_known`.
    pub characters: Vec<String>,
    /// Whether the list above is an answer. False means we could not read the
    /// entry file, which is not the same as it being empty and must never be
    /// rendered as "you have no characters".
    pub characters_known: bool,
    /// A Ruby process is running with `lich` in its command line.
    pub running: bool,
    /// Whether the check above could be performed at all.
    pub running_known: bool,
    /// Whether Lich's *own* login window can actually complete on this
    /// machine - see `gui_login_usable`. When false, "Open Lich to sign in"
    /// is a dead end and the UI must not offer it as the way forward.
    pub gui_login_usable: bool,
    /// Plain English for whatever the fields above cannot say on their own.
    pub note: String,
}

/// Whether Lich's own GUI login window can actually reach the game here.
///
/// It cannot, on a machine where the only frontend installed is Genie, and
/// this is not a misconfiguration anyone can retry past.
///
/// Lich's frontend registry marks which frontends its GUI is allowed to
/// offer. Asked directly rather than inferred - this is Ruby, run against
/// Lich's own source, and fenced as `text` because rustdoc treats an indented
/// block as a Rust doctest and will try to compile it:
///
/// ```text
/// Frontend.definitions(gui_selectable: true)
///   => ["stormfront", "wizard", "avalon", "saga"]
/// ```
///
/// `genie` is registered with capabilities only and no `gui_selectable`
/// metadata (`front-end.rb:251`), so it can never appear in that list. Every
/// GUI login tab requires picking one of them - `manual_login_tab.rb:474`,
/// `saved_login_tab.rb:752`, `account_manager_ui.rb:812`/`:969` all raise
/// "No supported frontend is available." when the selector comes up empty,
/// and no GUI tab has a headless path.
///
/// So Genie-only + GUI login = that modal, deterministically, forever. Two
/// peer sessions and this one independently confirmed it against Lich's
/// source on 27 Aug 2026, after it was first misread here as fallout from an
/// unrelated authentication failure in the same attempt.
///
/// This matters because it creates a deadlock the app was cheerfully walking
/// people into: `launch_lich(Some(name))` needs a saved entry, the normal way
/// to create one is Lich's GUI login, and on this machine that window cannot
/// succeed. The app knows enough to say so; it just was not asking.
fn gui_login_usable() -> bool {
    // The four Lich's GUI will offer, and the executables each ships as.
    // Genie is deliberately absent - that is the whole point of this check.
    const GUI_FRONTEND_EXES: [&str; 5] = [
        "Wrayth.exe",     // stormfront, current name
        "StormFront.exe", // stormfront, older name
        "Wizard.exe",
        "Avalon.exe",
        "Saga.exe",
    ];

    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(v) = std::env::var_os(var) {
            let base = PathBuf::from(v);
            roots.push(base.join("SIMU"));
            roots.push(base.clone());
        }
    }
    for letter in ['C', 'D'] {
        roots.push(PathBuf::from(format!("{letter}:\\SIMU")));
    }

    roots
        .iter()
        .any(|root| GUI_FRONTEND_EXES.iter().any(|exe| root.join(exe).exists()))
}

fn lich_launcher(dir: &Path) -> Option<PathBuf> {
    for leaf in ["lich.rbw", "lich.rb"] {
        let p = dir.join(leaf);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// `rubyw.exe` beside `ruby.exe`, falling back to `ruby.exe`.
///
/// `rubyw` is the windowed interpreter. Launching a GUI script with plain
/// `ruby` leaves a console window open behind Lich for the whole session,
/// which looks like something went wrong and which people close - taking Lich
/// with it.
fn windowed_ruby(ruby_exe: &str) -> String {
    let p = PathBuf::from(ruby_exe);
    if let Some(dir) = p.parent() {
        let w = dir.join("rubyw.exe");
        if w.exists() {
            return w.to_string_lossy().into_owned();
        }
    }
    ruby_exe.to_string()
}

/// The names of saved characters, and nothing else from that file.
///
/// `entry.yaml` holds the account password beside the character names, in
/// plaintext or encrypted depending on how Lich was set up. So this does not
/// deserialize the file into a structure: it scans for `char_name:` lines and
/// takes those, and there is no code path here through which a password can
/// reach a struct, a log line, an error message or the webview.
///
/// That is a deliberate choice of a narrower tool over a better one. A real
/// YAML parse would be more correct about quoting and more robust to layout,
/// and it would also put the password one field access away from anything that
/// later wants to debug-print this. A line scanner cannot leak what it never
/// reads.
///
/// Returns `None` when the file could not be read at all, so the caller can
/// tell "no characters" from "no answer".
fn saved_characters(data_dir: &Path) -> Option<Vec<String>> {
    let text = std::fs::read_to_string(data_dir.join("entry.yaml")).ok()?;
    let mut names = Vec::new();
    for line in text.lines() {
        // The leading "- " matters and its absence was a real bug. Characters
        // are a YAML *list*, so the line is `- char_name: Phemius`, and a
        // prefix check for `char_name:` alone matched nothing. Every install
        // would have reported no saved characters forever, which is the
        // failure this function's own doc comment warns about at length.
        //
        // It was not caught by reading, and it could not be caught by running
        // the test, because linking was broken on this machine at the time. It
        // was found the moment the test could run.
        let t = line.trim().trim_start_matches("- ").trim();
        let Some(rest) = t.strip_prefix("char_name:") else {
            continue;
        };
        let name = rest.trim().trim_matches(['"', '\'']).to_string();
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    Some(names)
}

/// Is a Lich already running?
///
/// Launching a second one is not harmless. Lich binds a local port for the
/// frontend to connect to, and a second instance either fails to bind or takes
/// the connection the first one was holding. The same mistake with Genie
/// disconnected a live session on this machine twice.
///
/// Returns `None` when the check itself could not run, rather than `false`.
/// "We could not ask" and "nothing is running" lead to opposite actions.
fn lich_running() -> Option<bool> {
    let out = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq rubyw.exe", "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let listed = String::from_utf8_lossy(&out.stdout);
    any_image_listed(&listed, &["rubyw.exe"])
}

/// The three states of "is this image in `tasklist`'s output", separated from
/// the process spawn so both callers share one answer and either can be tested
/// without a process to find.
///
/// `None` means the question was not answered. tasklist prints an
/// informational line when a filter matches nothing ("INFO: No tasks are
/// running which match the specified criteria."), so entirely empty stdout is
/// more likely a call that failed than a clean no - and "we could not ask" and
/// "nothing is running" lead to opposite actions.
///
/// Extracted from `lich_running` rather than copied for `genie_running` (E11).
/// Two functions deciding what an empty tasklist means would eventually decide
/// it differently, and the one that got it wrong would be the one that reports
/// a frontend is absent while it holds the port.
fn any_image_listed(listed: &str, images: &[&str]) -> Option<bool> {
    if listed.trim().is_empty() {
        return None;
    }
    let haystack = listed.to_lowercase();
    Some(images.iter().any(|i| haystack.contains(&i.to_lowercase())))
}

/// Is Genie running, and therefore possibly holding the frontend port?
///
/// The same hazard as `lich_running` and the one that has actually bitten on
/// this machine: starting a second frontend took the connection the first was
/// holding, twice, and nothing errored either time - the live window simply
/// went to "Not connected".
///
/// So this reports and never acts. Nothing in this app may close Genie: it may
/// be a session someone is playing, and the wizard's job is to say so and let
/// them decide.
///
/// One unfiltered `tasklist` rather than one call per candidate name. Genie has
/// shipped under four names and `lich_status` is already slow enough to have
/// frozen the window (see `lich_status`'s own note); four extra process spawns
/// to answer one question is not a trade worth making. It also makes the `None`
/// branch mean something: an unfiltered tasklist that returns nothing at all is
/// a broken call, whereas a filtered one returning nothing is ambiguous.
fn genie_running() -> Option<bool> {
    let out = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let listed = String::from_utf8_lossy(&out.stdout);
    any_image_listed(&listed, crate::setup::GENIE_IMAGE_NAMES)
}

/// Off the UI thread, because this takes seconds and used to freeze the app.
///
/// A Tauri command declared `fn` rather than `async fn` runs on the main
/// thread, so its whole duration is time the window cannot paint and no other
/// command can start. This one is not fast: measured against the running app,
/// three times in a row on a settled process,
///
/// ```text
/// bridge_default_url:      2ms
/// lich_status:          5447ms
/// lich_status:          5424ms
/// game_status:             2ms
/// ```
///
/// Consistent, so it is real work rather than startup contention. It is spread
/// across filesystem probing - `detect_ruby`, `rank_lich_installs`,
/// `saved_characters`, `gui_login_usable` - each cheap on its own and slow
/// together on a machine with a large PATH and cloud-synced user folders.
///
/// The UI calls this on mount and again on every "Check again", so those were
/// five-second freezes of the entire window, and any command issued during one
/// queued behind it. That is what "the app is broken" looked like from
/// outside: `bridge_default_url`, a function that returns a constant string,
/// took over thirty seconds and timed out.
///
/// `spawn_blocking` rather than only marking it `async`: the body is
/// genuinely blocking, and an `async fn` whose body blocks just moves the
/// stall onto an async worker instead of the UI thread. This puts it on the
/// pool meant for blocking work, which is the honest description of what it
/// does.
///
/// The cost itself is still worth reducing - this makes it not freeze the
/// app, which is a different thing from making it fast.
/// Whether a Genie frontend is running, in the three answers that has (E11).
///
/// Its own command rather than a field on `LichStatus`, for one measured
/// reason: `lich_status` takes about five seconds (see its note) because it
/// probes the filesystem, and this is one `tasklist` call. Hanging a question
/// worth milliseconds off a command worth seconds would mean the wizard could
/// only ask it as often as it could afford the slow one.
///
/// `known: false` is not `running: false`. The wizard must say "could not
/// tell" in that case, because the action a player takes differs: one is
/// "close it or continue at your own risk", the other is "we do not know
/// whether anything holds the port".
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GenieStatus {
    pub running: bool,
    pub known: bool,
}

#[tauri::command]
pub async fn genie_status() -> GenieStatus {
    tokio::task::spawn_blocking(|| match genie_running() {
        Some(running) => GenieStatus {
            running,
            known: true,
        },
        None => GenieStatus::default(),
    })
    .await
    // A panic in the probe must not take the command with it, and the default
    // is the honest one: not known.
    .unwrap_or_default()
}

#[tauri::command]
pub async fn lich_status() -> LichStatus {
    tokio::task::spawn_blocking(lich_status_blocking)
        .await
        // A panic in the probe must not take the command with it. Default is
        // the honest answer here: every "is it there" field has a matching
        // "did we actually look", and `LichStatus::default()` says no to both
        // rather than claiming an absence it never established.
        .unwrap_or_default()
}

pub(crate) fn lich_status_blocking() -> LichStatus {
    let mut s = LichStatus::default();

    let (_ruby_version, ruby) = detect_ruby();
    s.ruby = ruby.as_deref().map(windowed_ruby);

    let installs = rank_lich_installs(ruby.as_deref());
    if let Some(dir) = installs.first() {
        s.install_dir = Some(pretty_path(dir));
        s.launcher = lich_launcher(dir).map(|p| p.to_string_lossy().into_owned());

        let data = dir.join("data");
        if data.exists() {
            s.data_dir = Some(pretty_path(&data));
            match saved_characters(&data) {
                Some(names) => {
                    s.characters_known = true;
                    s.characters = names;
                }
                None => {
                    // No entry.yaml is the normal state of a fresh install, and
                    // it is a real answer: Lich has not saved anyone yet.
                    s.characters_known = !data.join("entry.yaml").exists();
                }
            }
        } else {
            // Lich makes this on first run. Its absence means the same thing as
            // an absent entry file, and it is equally an answer.
            s.characters_known = true;
        }
    }

    match lich_running() {
        Some(r) => {
            s.running = r;
            s.running_known = true;
        }
        None => s.running_known = false,
    }

    s.gui_login_usable = gui_login_usable();

    s.note = if s.launcher.is_none() {
        "Lich is not installed where the app can find it.".into()
    } else if s.ruby.is_none() {
        "Lich is here but Ruby is not, and Lich is a Ruby program.".into()
    } else if s.running {
        "Lich is already running.".into()
    } else if !s.characters_known {
        "Lich is installed. Whether it has a saved character could not be read, so this is unknown rather than none.".into()
    } else if s.characters.is_empty() && !s.gui_login_usable {
        // The deadlock, said plainly rather than left as a button that
        // cannot work. See `gui_login_usable` for why this is deterministic
        // rather than something to retry.
        "Lich is installed with no saved character, and its own login window cannot \
         complete on this machine: it only offers Wrayth, Wizard, Avalon and Saga, \
         and none of those are installed. Genie is not one it can offer."
            .into()
    } else if s.characters.is_empty() {
        "Lich is installed with no saved character yet. Its own login window handles that, and this app never sees the password.".into()
    } else {
        "Ready to start.".into()
    };

    s
}

/// The arguments `launch_lich` hands to Ruby, separated out so they can be
/// asserted on without spawning a real process.
///
/// This is the function that would have caught both bugs fixed here on
/// 27 Aug 2026 in a test rather than by reading the source after the app
/// failed to work: `--genie` in place of `--stormfront` (silently drops the
/// `streams` capability the channel tabs depend on) and a missing
/// `--headless=<port>` (Lich never opens the socket this app's own TCP client
/// connects to). Neither made `launch_lich` return an error - Lich still
/// started - so nothing short of asserting the argument list itself would
/// have caught either one.
fn launch_args(launcher: &str, sal: Option<&Path>) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec![launcher.to_string()];

    match sal {
        Some(path) => {
            // The launch file, positional and first. Lich matches it by
            // extension - `when /\.sal$|Gse\.~xt$/i`,
            // `lib/main/argv_options.rb:108-110` - so it must keep its `.sal`
            // suffix and must not look like an option.
            let path = path.to_string_lossy().into_owned();
            if path.starts_with('-') {
                return Err(format!("{path:?} would be read as an option, not a file"));
            }
            args.push(path);
            // Opens the socket `game_link.rs` connects to, and stops Lich
            // from expecting to spawn a frontend process it would then find
            // was never installed. Kept as the single `--headless=` token
            // rather than the pair it expands to: `arg_normalization.rb:33-35`
            // refuses to combine `--headless` with an explicit
            // `--detachable-client`, so writing both would be a hard error.
            args.push(format!("--headless={DETACHABLE_PORT}"));
            // The bridge, started by Lich rather than by hand. Without this the
            // app connects to nothing and the player is told the bridge is
            // missing, having just watched the thing that hosts it start up.
            args.push("--start-scripts=companion_bridge".into());
        }
        None => {
            // Deliberately bare. Lich's own launcher asks for the game, the
            // frontend and the account, and the account is the part this app
            // must not be in the middle of.
        }
    }

    Ok(args)
}

/// What a launch reports.
///
/// `docs/LICH_NATIVE_LOGIN.md` §8 publishes `{ pid, port }`; the two extra
/// fields are what `DRC_LICH_DRY_RUN=1` exists to hand back, and they are
/// present on both paths so a caller never has to know which one it got.
/// `pid` is `null` in a dry run, because there is no process and reporting a
/// fabricated number would be worse than saying so.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchOutcome {
    pub pid: Option<u32>,
    pub port: u16,
    /// The exact argument vector, `argv[0]` being the launcher path. Under a
    /// dry run this is the whole answer; on a real launch it is what was
    /// actually passed, so a caller comparing the two is comparing like with
    /// like.
    pub argv: Vec<String>,
    pub dry_run: bool,
}

/// Whether `DRC_LICH_DRY_RUN` asks for a launch that writes and reports but
/// does not spawn.
///
/// A named environment variable rather than a `#[cfg(test)]` branch, because
/// the point is that the sign-in screen can be driven end to end in a running
/// app with no Lich and no account (`docs/LICH_NATIVE_LOGIN.md` §8).
fn dry_run() -> bool {
    std::env::var("DRC_LICH_DRY_RUN").is_ok_and(|v| v == "1")
}

/// Launch files written for a launch that has not yet been attached to.
///
/// One at a time in practice - `launch_lich_with_launch_data` refuses to start
/// a second Lich - but a `Vec` rather than an `Option` so a second entry can
/// never orphan a first.
static PENDING_LAUNCH_FILES: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

/// Shred every launch file this process is still holding, and say how many.
///
/// Called from three places, and any of the three may get there first:
/// `game_link::attach_game` the moment the detachable socket is up, the
/// timeout thread below, and the next launch's sweep. That is why
/// `sal::shred` treats an already-gone file as success.
///
/// The count is returned rather than logged so a test can assert on it. A
/// function that shreds nothing and a function that was never called are
/// otherwise the same observation.
pub fn shred_pending_launch_files() -> usize {
    let taken: Vec<PathBuf> = {
        let mut guard = PENDING_LAUNCH_FILES
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut *guard)
    };
    let mut shredded = 0;
    for path in taken {
        if crate::sal::shred(&path).is_ok() {
            shredded += 1;
        }
    }
    shredded
}

/// How long to wait for the app's own attach before shredding the launch file
/// anyway.
///
/// Generous, because the wait covers a real sign-in to the game server, and
/// harmless to overshoot: the key in the file is one-shot and the file is
/// swept at the next launch regardless. Short enough that a Lich which never
/// started does not leave it there for the session.
const LAUNCH_FILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Start Lich against launch data obtained from `eaccess`.
///
/// **This is the same start path as [`launch_lich`], not a second one.** Both
/// build their argv with [`launch_args`] and spawn with the same `Command`;
/// the only difference between them is whether a `.sal` is passed, which is
/// the difference between "log this player in" and "open Lich's own window".
///
/// The password is not a parameter and never becomes one: what arrives here is
/// the `L` reply's fields, and the only secret among them is the one-shot
/// `KEY`, which goes into the file and never into `argv` - a Windows command
/// line is readable by any process of this user.
///
/// On the deletion of that file, and why it is not simply "after spawn": see
/// the lifetime note in [`crate::sal`]. Lich has finished reading the file by
/// `main.rb:349`, long before the detachable listener opens at
/// `main.rb:842-857`, so the app's own successful attach is a sound and
/// externally observable "safe now" - with [`LAUNCH_FILE_TIMEOUT`] behind it
/// for the case where the attach never happens.
pub fn launch_lich_with_launch_data(fields: &[(String, String)]) -> Result<LaunchOutcome, String> {
    let s = lich_status_blocking();

    let launcher = s.launcher.ok_or("Could not find lich.rbw")?;
    let ruby = s
        .ruby
        .ok_or("Could not find Ruby, which Lich needs to run")?;

    // Refuse rather than race - see `launch_lich` for why, and note that on
    // this path a second Lich would also mean a second launch file.
    if s.running_known && s.running {
        return Err(
            "Lich looks like it is already running. Close it first, or use the one that is up."
                .into(),
        );
    }

    launch_lich_using(&ruby, &launcher, fields)
}

/// [`launch_lich_with_launch_data`] with the interpreter and launcher already
/// resolved.
///
/// Split out for one reason and it is the reason `DRC_LICH_DRY_RUN` exists at
/// all: the dry-run branch below is unreachable from a test otherwise, because
/// the caller above refuses on a machine with no Lich installed and would
/// spawn a real one on a machine that has it. With this seam the dry run can
/// be driven with a launcher path that does not exist, which is exactly the
/// case a test needs and a real launch never wants.
fn launch_lich_using(
    ruby: &str,
    launcher: &str,
    fields: &[(String, String)],
) -> Result<LaunchOutcome, String> {
    // Anything a previous run left behind goes now, before a new one is
    // written. This is the backstop for the case no in-process timer can
    // cover: an app that was killed between writing the file and attaching.
    shred_pending_launch_files();
    let swept = crate::sal::sweep()?;
    if swept > 0 {
        eprintln!("lich: removed {swept} leftover launch file(s) from a previous run");
    }

    let sal = crate::sal::write_temp(fields)?;
    PENDING_LAUNCH_FILES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(sal.clone());

    let args = match launch_args(launcher, Some(&sal)) {
        Ok(args) => args,
        Err(e) => {
            shred_pending_launch_files();
            return Err(e);
        }
    };

    if dry_run() {
        // Write, report, remove. The file is genuinely created and genuinely
        // removed, so the dry run exercises `sal::write_temp` and `sal::shred`
        // rather than skipping past them.
        shred_pending_launch_files();
        return Ok(LaunchOutcome {
            pid: None,
            port: DETACHABLE_PORT,
            argv: args,
            dry_run: true,
        });
    }

    let child = match Command::new(ruby)
        .args(&args)
        .current_dir(
            PathBuf::from(launcher)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from(".")),
        )
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            shred_pending_launch_files();
            return Err(format!("Could not start Lich: {e}"));
        }
    };

    std::thread::spawn(|| {
        std::thread::sleep(LAUNCH_FILE_TIMEOUT);
        shred_pending_launch_files();
    });

    Ok(LaunchOutcome {
        pid: Some(child.id()),
        port: DETACHABLE_PORT,
        argv: args,
        dry_run: false,
    })
}

/// The account's characters, so the player picks from a real list.
///
/// `docs/LICH_NATIVE_LOGIN.md` §8: argument JSON
/// `{ account, password, gameCode }`, result
/// `{ subscription, characters: [{ code, name }] }`.
///
/// Registered here rather than in `eaccess.rs` because this is a launcher
/// command and `eaccess.rs` is the protocol with no I/O of its own beyond its
/// transport - the same split `lich_login_launch` follows. N5 shipped the
/// caller before either existed and left both in the callers test's
/// `AWAITING_BACKEND` list; this and `lich_login_launch` are what remove them.
///
/// The same password rule as [`lich_login_launch`] applies and is not
/// weakened by this being the "read-only" half: the account name and password
/// go to Simutronics and nowhere else, and neither the result, an error nor a
/// log line carries the password back.
#[tauri::command]
pub async fn lich_login_characters(
    account: String,
    password: String,
    game_code: String,
) -> Result<eaccess::Account, String> {
    tokio::task::spawn_blocking(move || {
        let password = Secret::new(password);
        let plaintext = std::str::from_utf8(password.expose_for_obscuring())
            .map_err(|_| "that password is not valid UTF-8".to_string())?;

        let mut transport = eaccess::connect().map_err(|e| e.to_string())?;
        eaccess::list_characters(&mut transport, account.trim(), plaintext, game_code.trim())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("the character lookup did not finish: {e}"))?
}

/// Sign a character in and start Lich for them.
///
/// The one command the sign-in screen needs, and the published shape is
/// `docs/LICH_NATIVE_LOGIN.md` §8: argument JSON
/// `{ account, password, gameCode, character }`, result `{ pid, port }` plus
/// the `argv` and `dryRun` fields a dry run needs.
///
/// **`password` appears here and nowhere else.** It arrives as the `String`
/// serde built, is moved straight into a [`Secret`] that overwrites its own
/// bytes on drop, and is never returned, logged, put in an error, or placed in
/// `argv` or in the launch file. The only thing that reaches disk is the `L`
/// reply's one-shot game `KEY`, which goes into the `.sal` and is shredded on
/// attach - see [`crate::sal`].
///
/// Two environment variables make this reachable without an account, and both
/// exist so an unhappy path can be aimed at on purpose rather than waited for:
/// `DRC_EACCESS_HOST`/`DRC_EACCESS_PORT` point the protocol client at a mock
/// (`eaccess::endpoint`), and `DRC_LICH_DRY_RUN=1` writes and shreds the
/// launch file and reports the argv without spawning Lich.
#[tauri::command]
pub async fn lich_login_launch(
    account: String,
    password: String,
    game_code: String,
    character: String,
) -> Result<LaunchOutcome, String> {
    tokio::task::spawn_blocking(move || {
        // Moved, not copied: from here the plaintext exists in exactly one
        // place that knows how to erase itself.
        let password = Secret::new(password);
        let plaintext = std::str::from_utf8(password.expose_for_obscuring())
            .map_err(|_| "that password is not valid UTF-8".to_string())?;

        let mut transport = eaccess::connect().map_err(|e| e.to_string())?;
        let data = eaccess::login(
            &mut transport,
            account.trim(),
            plaintext,
            game_code.trim(),
            character.trim(),
        )
        .map_err(|e| e.to_string())?;

        // `LaunchData`'s inner `Vec<(String, String)>` is exactly what
        // `sal::write_temp` accepts, so there is one type for this and
        // `eaccess.rs` owns it.
        launch_lich_with_launch_data(&data.0)
    })
    .await
    .map_err(|e| format!("the sign-in task did not finish: {e}"))?
}
/// Open Lich's own launcher window and stop there.
///
/// **The saved-entry route this used to carry is gone.** It passed
/// `--login <Character> --dragonrealms --stormfront`, which asks Lich to
/// resolve an entry out of its own `data/entry.yaml` - and the only way to get
/// an entry into that file on this machine was to sign in through Genie first,
/// because Lich's own window offers Wrayth, Wizard, Avalon and Saga and none
/// of the four is installed. That was the whole reason Genie was in the
/// picture. [`launch_lich_with_launch_data`] replaces it: the app performs the
/// account login itself and hands Lich a `.sal`, so there is nothing left for
/// a saved entry to do. There is deliberately no fallback to the old route -
/// see `CLAUDE.md` §0 and `docs/LICH_NATIVE_LOGIN.md` §6.
///
/// A `character` is therefore refused rather than ignored. The parameter
/// survives only so the existing call site keeps type-checking until the
/// sign-in screen replaces it; passing one is an error naming what to call
/// instead, which is a thing a caller can act on, where silently starting a
/// launcher that asks for a password would not be.
#[tauri::command]
pub fn launch_lich(character: Option<String>) -> Result<String, String> {
    if character
        .as_deref()
        .map(str::trim)
        .is_some_and(|c| !c.is_empty())
    {
        return Err(
            "Signing a character in is `lich_login_launch` now, not `launch_lich`: \
             Lich's saved-entry route needed Genie to create the entry, and the app \
             performs the account login itself."
                .into(),
        );
    }
    launch_lich_bare()
}

fn launch_lich_bare() -> Result<String, String> {
    // The blocking form: this is already off the UI thread (its own command
    // is async) and calling the command wrapper here would need an await for
    // no benefit.
    let s = lich_status_blocking();

    let launcher = s.launcher.ok_or("Could not find lich.rbw")?;
    let ruby = s
        .ruby
        .ok_or("Could not find Ruby, which Lich needs to run")?;

    // Refuse rather than race. A second Lich takes the port the first one is
    // holding, and the failure shows up later as the game disconnecting, which
    // is very hard to trace back to a button press.
    //
    // Only when we actually know. An unreadable process list is not permission
    // to start a second one, but it is not a reason to refuse forever either -
    // the message says which it was.
    if s.running_known && s.running {
        return Err(
            "Lich looks like it is already running. Close it first, or use the one that is up."
                .into(),
        );
    }

    let args = launch_args(&launcher, None)?;

    Command::new(&ruby)
        .args(&args)
        .current_dir(
            PathBuf::from(&launcher)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from(".")),
        )
        .spawn()
        .map_err(|e| format!("Could not start Lich: {e}"))?;

    Ok("Opened Lich's own window.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `.sal` launch, argument for argument.
    ///
    /// Every flag the old character branch carried is gone and the launch file
    /// supplies what each of them used to: `GAMECODE=DR` picks the game
    /// (`main.rb:225`) where `--dragonrealms` did, the file itself replaces
    /// `--login <Character>` and the saved entry it needed, and `--stormfront`
    /// was already inert on this path — `resolve_headless_frontend`
    /// (`login_helpers.rb:578-584`) special-cases only `--saga` and `--genie`
    /// and returns `'profanity'` for everything else.
    #[test]
    fn the_sal_launch_is_the_file_the_port_and_the_bridge_and_nothing_else() {
        let sal = PathBuf::from("C:/Users/x/DR Companion Data/launch/0123456789abcdef.sal");
        let args = launch_args("lich.rbw", Some(&sal)).unwrap();

        assert_eq!(
            args,
            vec![
                "lich.rbw".to_string(),
                sal.to_string_lossy().into_owned(),
                format!("--headless={DETACHABLE_PORT}"),
                "--start-scripts=companion_bridge".to_string(),
            ],
            "{args:?}"
        );

        // Named individually as well as by the equality above, because the
        // equality would go quietly green if somebody rewrote it to match a
        // new argv, and these three are the ones with reasons.
        assert!(!args.iter().any(|a| a == "--login"), "{args:?}");
        assert!(!args.iter().any(|a| a == "--dragonrealms"), "{args:?}");
        assert!(!args.iter().any(|a| a == "--stormfront"), "{args:?}");
        // `--genie` was the original defect this file's tests exist for, and
        // it must stay gone for a different reason now: it is one of the two
        // flags `resolve_headless_frontend` still honours, and it would resolve
        // the identity to `genie`, whose capabilities are `[xml, mono]` — no
        // `streams`, so the channel tabs would go silent again.
        assert!(!args.iter().any(|a| a == "--genie"), "{args:?}");
    }

    /// The socket `game_link.rs` connects to has to actually be opened, or
    /// this app's own launch button starts a Lich its own client cannot
    /// attach to.
    #[test]
    fn opens_the_detachable_client_port() {
        let sal = PathBuf::from("x.sal");
        let args = launch_args("lich.rbw", Some(&sal)).unwrap();
        assert!(
            args.iter()
                .any(|a| a == &format!("--headless={DETACHABLE_PORT}")),
            "{args:?}"
        );
        // And not the older two-token form Lich also accepts - a mismatch
        // here would silently pass Lich's own parser and still be wrong.
        // Worse than wrong, now: `arg_normalization.rb:33-35` raises
        // "--headless cannot be combined with --detachable-client" and exits 1.
        assert!(
            !args.iter().any(|a| a.starts_with("--detachable-client")),
            "{args:?}"
        );
    }

    /// The bare launch (no launch file) must stay bare. Adding a frontend or
    /// port here would have Lich decide those things instead of asking, on
    /// the screen where credentials belong.
    #[test]
    fn a_bare_launch_carries_no_extra_arguments() {
        let args = launch_args("lich.rbw", None).unwrap();
        assert_eq!(args, vec!["lich.rbw".to_string()]);
    }

    /// The launch file's path is positional, so a path that begins with a dash
    /// would become an option instead of a file and Lich would silently launch
    /// with no launch data at all.
    #[test]
    fn a_launch_file_path_that_looks_like_an_option_is_refused() {
        let sal = PathBuf::from("--headless=1.sal");
        assert!(launch_args("lich.rbw", Some(&sal)).is_err());
    }

    /// The saved-entry route is gone, not deprecated. Its replacement is named
    /// in the error, because "that no longer works" without a next step is how
    /// a caller ends up reimplementing it.
    #[test]
    fn a_character_is_refused_and_the_replacement_is_named() {
        let err = launch_lich(Some("Phemius".into())).unwrap_err();
        assert!(err.contains("lich_login_launch"), "{err}");
        // Whitespace is not a character name, so it must not reach this
        // refusal - it falls through to the bare launch. Asserted on the
        // predicate rather than by calling `launch_lich`, which would spawn a
        // real Lich from a unit test.
        let refuses = |c: Option<&str>| c.map(str::trim).is_some_and(|c| !c.is_empty());
        assert!(refuses(Some("Phemius")));
        assert!(!refuses(Some("   ")));
        assert!(!refuses(None));
    }

    /// Serialises tests that read process-global environment variables.
    ///
    /// `std::env` is process-wide and the harness runs tests in parallel, so a
    /// test that sets `DRC_LICH_DRY_RUN` could otherwise decide another test's
    /// launch. There is exactly one such test today; the lock is here so the
    /// second one cannot be written wrong.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// `DRC_LICH_DRY_RUN=1`: the argv is reported, the launch file is really
    /// written and really removed, and no process is started.
    #[test]
    fn a_dry_run_reports_the_argv_writes_the_file_and_spawns_nothing() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());

        let dir = std::env::temp_dir().join(format!("drc-dryrun-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::env::set_var("DRC_LAUNCH_DIR", &dir);
        std::env::set_var("DRC_LICH_DRY_RUN", "1");

        let fields: Vec<(String, String)> = [
            ("GAME", "STORM"),
            ("GAMECODE", "DR"),
            ("GAMEHOST", "dr.simutronics.net"),
            // Not 11024: DR Prime's game port and DETACHABLE_PORT are the
            // same number by coincidence and are unrelated. See the note on
            // `sal::tests::dr_fields`.
            ("GAMEPORT", "11124"),
            ("KEY", "not-a-real-key-0000"),
        ]
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();

        // A launcher path that does not exist. If the dry-run branch were
        // skipped, `Command::spawn` would fail on it and this would be an
        // error rather than a wrong-but-plausible success - so the test cannot
        // pass by accidentally launching something.
        let outcome =
            launch_lich_using("no-such-ruby.exe", "C:/no/such/lich.rbw", &fields).unwrap();

        std::env::remove_var("DRC_LICH_DRY_RUN");
        std::env::remove_var("DRC_LAUNCH_DIR");

        assert!(outcome.dry_run);
        assert_eq!(outcome.pid, None, "a dry run has no process to report");
        assert_eq!(outcome.port, DETACHABLE_PORT);

        // The published argv, in order.
        assert_eq!(outcome.argv[0], "C:/no/such/lich.rbw");
        assert!(
            outcome.argv[1].ends_with(".sal"),
            "the launch file must be argv[1]: {:?}",
            outcome.argv
        );
        assert_eq!(outcome.argv[2], format!("--headless={DETACHABLE_PORT}"));
        assert_eq!(outcome.argv[3], "--start-scripts=companion_bridge");
        assert_eq!(outcome.argv.len(), 4, "{:?}", outcome.argv);

        // The key is in the file, never on a command line. Asserted against
        // the whole argv rather than one element, because "not in argv[1]" is
        // not the claim being made.
        let joined = outcome.argv.join(" ");
        assert!(
            !joined.contains("not-a-real-key-0000"),
            "a secret reached argv: {joined}"
        );
        // ...and the positive control for that assertion: the value really was
        // in the launch data, so a writer that dropped it could not pass the
        // check above by having nothing left to leak.
        assert!(fields.iter().any(|(_, v)| v == "not-a-real-key-0000"));

        // Written and removed, both really.
        assert!(
            std::fs::metadata(&outcome.argv[1]).is_err(),
            "{} survived the dry run",
            outcome.argv[1]
        );
        assert!(
            dir.exists(),
            "the launch directory was never created, so nothing was ever written"
        );
        assert_eq!(
            std::fs::read_dir(&dir).unwrap().count(),
            0,
            "the dry run left something in {}",
            dir.display()
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Shredding is called from three places and any may be first, so it has
    /// to be safe to call when there is nothing pending. Counted rather than
    /// assumed: a function that shredded nothing and one that never ran are
    /// otherwise the same observation.
    #[test]
    fn shredding_nothing_pending_is_zero_and_not_an_error() {
        assert_eq!(shred_pending_launch_files(), 0);
    }

    /// Genie must never count as a frontend Lich's GUI can offer.
    ///
    /// This is the whole point of `gui_login_usable` being a separate question
    /// from "is a frontend installed at all" - `setup.rs`'s `detect_genie`
    /// happily finds Genie and is right to, but Lich's own login window cannot
    /// use it. Conflating the two is what made the app offer a dead-end
    /// button on this machine.
    ///
    /// Asserted against the constant rather than the filesystem, so it holds
    /// on a machine that happens to have Wrayth installed too.
    #[test]
    fn genie_is_not_a_frontend_lichs_gui_can_offer() {
        // Mirrors GUI_FRONTEND_EXES in gui_login_usable. If someone adds
        // Genie to that list, this fails and the comment above explains why
        // that is wrong.
        const GUI_FRONTEND_EXES: [&str; 5] = [
            "Wrayth.exe",
            "StormFront.exe",
            "Wizard.exe",
            "Avalon.exe",
            "Saga.exe",
        ];
        assert!(
            !GUI_FRONTEND_EXES
                .iter()
                .any(|e| e.to_lowercase().contains("genie")),
            "Lich's Frontend.definitions(gui_selectable: true) is \
             [stormfront, wizard, avalon, saga] - genie is registered with \
             capabilities only and no gui_selectable metadata, so it can never \
             appear in the GUI selector"
        );
    }

    /// The deadlock this exists to surface, asserted on the message rather
    /// than described in a comment: no saved character *and* no usable GUI
    /// login has to read differently from no saved character alone, because
    /// the second is a normal first run and the first is a dead end.
    #[test]
    fn no_characters_and_no_usable_gui_reads_differently_from_no_characters() {
        // The note-selection logic, extracted to the shape lich_status uses.
        let note = |characters_empty: bool, gui_usable: bool| -> &'static str {
            if characters_empty && !gui_usable {
                "deadlock"
            } else if characters_empty {
                "ordinary first run"
            } else {
                "ready"
            }
        };

        assert_eq!(note(true, false), "deadlock");
        assert_eq!(note(true, true), "ordinary first run");
        assert_eq!(
            note(false, false),
            "ready",
            "a saved character makes the GUI moot"
        );
    }

    /// The whole point of the narrow parse, asserted rather than described.
    ///
    /// `entry.yaml` holds the account password beside the character names. This
    /// test writes a realistic one and checks two things: that the names come
    /// out, and that nothing resembling the password does. The second assertion
    /// is the one that matters, and it is the reason this reads lines rather
    /// than deserializing the file.
    #[test]
    fn reads_names_and_never_the_password() {
        let dir = std::env::temp_dir().join("drc-lich-entry-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let secret = "hunter2-do-not-leak";
        std::fs::write(
            dir.join("entry.yaml"),
            format!(
                "---\nencryption_mode: plaintext\naccounts:\n  DANCOCKRELL:\n    password: {secret}\n    characters:\n    - char_name: Phemius\n      game_code: DR\n      frontend: genie\n    - char_name: \"Dan the Bold\"\n      game_code: DR\n"
            ),
        )
        .unwrap();

        let names = saved_characters(&dir).expect("file is readable");
        assert_eq!(names, vec!["Phemius", "Dan the Bold"]);

        // Not "the password is not in position 0". Nothing anywhere in the
        // output may contain it, however the file is laid out.
        assert!(
            !names.iter().any(|n| n.contains(secret)),
            "a password reached the character list"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Absent is not empty. A missing file has to be distinguishable from a
    /// file with no characters in it, because the caller renders them
    /// differently and one of the two sends a returning player back through
    /// first-time setup.
    #[test]
    fn missing_file_is_unknown_not_empty() {
        let dir = std::env::temp_dir().join("drc-lich-missing-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(
            saved_characters(&dir).is_none(),
            "no file must not read as no characters"
        );

        std::fs::write(dir.join("entry.yaml"), "---\naccounts: {}\n").unwrap();
        assert_eq!(
            saved_characters(&dir),
            Some(vec![]),
            "an empty file is an answer"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// rubyw over ruby, so no console window is left behind Lich.
    #[test]
    fn prefers_the_windowed_interpreter_when_present() {
        let dir = std::env::temp_dir().join("drc-ruby-pick-test").join("bin");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
        std::fs::create_dir_all(&dir).unwrap();
        let ruby = dir.join("ruby.exe");
        std::fs::write(&ruby, b"").unwrap();

        // Without rubyw beside it, it must hand back what it was given rather
        // than inventing a path that does not exist.
        assert_eq!(
            windowed_ruby(&ruby.to_string_lossy()),
            ruby.to_string_lossy()
        );

        std::fs::write(dir.join("rubyw.exe"), b"").unwrap();
        assert!(windowed_ruby(&ruby.to_string_lossy()).ends_with("rubyw.exe"));

        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }

    /// E11. Three states, not two, and the third is the one worth having.
    ///
    /// A frontend that is running and a check that could not run look identical
    /// to a caller that only has a bool, and they lead to opposite actions:
    /// one says "warn them, they may lose a live session", the other says
    /// "say we could not tell". Folding "could not ask" into `false` is how a
    /// wizard cheerfully reports that nothing holds the port while something
    /// does.
    ///
    /// Parsed rather than spawned, so all three can be produced on demand.
    /// Genie was not running on this machine when this was written, which is
    /// exactly why the running case cannot be left to whatever happens to be
    /// on the developer's desktop.
    #[test]
    fn tasklist_output_has_three_answers_not_two() {
        // tasklist's real CSV, /NH, as it looks with a Genie present.
        let running = "\"Genie5.exe\",\"9312\",\"Console\",\"1\",\"84,120 K\"\r\n\
                       \"explorer.exe\",\"5120\",\"Console\",\"1\",\"180,004 K\"\r\n";
        assert_eq!(
            any_image_listed(running, crate::setup::GENIE_IMAGE_NAMES),
            Some(true)
        );

        // A populated list with no Genie in it is a real no, not an unknown.
        let not_running = "\"explorer.exe\",\"5120\",\"Console\",\"1\",\"180,004 K\"\r\n\
                           \"rubyw.exe\",\"7744\",\"Console\",\"1\",\"52,300 K\"\r\n";
        assert_eq!(
            any_image_listed(not_running, crate::setup::GENIE_IMAGE_NAMES),
            Some(false)
        );

        // Nothing at all on stdout: the call failed. Never `Some(false)`.
        assert_eq!(any_image_listed("", crate::setup::GENIE_IMAGE_NAMES), None);
        assert_eq!(
            any_image_listed("   \r\n  ", crate::setup::GENIE_IMAGE_NAMES),
            None
        );

        // Case is Windows', not ours: tasklist has reported both.
        assert_eq!(
            any_image_listed(
                "\"GENIE.EXE\",\"1\",\"Console\",\"1\",\"1 K\"\r\n",
                crate::setup::GENIE_IMAGE_NAMES
            ),
            Some(true)
        );

        // The same parser answers for Lich, which is the point of sharing it.
        assert_eq!(any_image_listed(not_running, &["rubyw.exe"]), Some(true));
        assert_eq!(any_image_listed(running, &["rubyw.exe"]), Some(false));

        // A chooser tested where the wrong answer is available: every name
        // Genie has shipped under must be found, and a plausible near-miss
        // must not be. Without this the list could shrink to one entry and
        // every assertion above would still pass.
        for name in crate::setup::GENIE_IMAGE_NAMES {
            let line = format!("\"{name}\",\"1\",\"Console\",\"1\",\"1 K\"\r\n");
            assert_eq!(
                any_image_listed(&line, crate::setup::GENIE_IMAGE_NAMES),
                Some(true),
                "{name} is in GENIE_IMAGE_NAMES but was not matched"
            );
        }
        assert_eq!(
            any_image_listed(
                "\"GenieLauncher.exe.bak\",\"1\",\"Console\",\"1\",\"1 K\"\r\n",
                crate::setup::GENIE_IMAGE_NAMES
            ),
            Some(false)
        );
    }
}
