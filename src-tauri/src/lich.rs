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
use crate::login_error::{LoginCode, LoginFailure};
use crate::setup::{detect_ruby, pretty_path, rank_lich_installs};

/// The port Lich is asked to open with `--headless`, and the port the app's
/// own TCP client (`game_link.rs`) and its "Attach" button both default to.
/// One number in one place: the frontend hardcodes this same value in four
/// spots (the sign-in screen, the connect guide, and the Attach
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
/// It cannot, on a machine whose only installed frontend is one it does not
/// list, and
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
/// That client is registered with capabilities only and no `gui_selectable`
/// metadata (`front-end.rb:251`), so it can never appear in that list. Every
/// GUI login tab requires picking one of them - `manual_login_tab.rb:474`,
/// `saved_login_tab.rb:752`, `account_manager_ui.rb:812`/`:969` all raise
/// "No supported frontend is available." when the selector comes up empty,
/// and no GUI tab has a headless path.
///
/// So such a machine plus the GUI login = that modal, deterministically,
/// forever. Two
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
    // It is deliberately absent - that is the whole point of this check.
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
/// the connection the first one was holding. The same mistake with another client
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
/// Extracted from `lich_running` rather than copied for
/// `other_frontend_running` (E11).
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

/// Is another game client running, and therefore possibly holding the port?
///
/// The same hazard as `lich_running` and the one that has actually bitten on
/// this machine: starting a second frontend took the connection the first was
/// holding, twice, and nothing errored either time - the live window simply
/// went to "Not connected".
///
/// So this reports and never acts. Nothing in this app may close it: it may
/// be a session someone is playing, and the wizard's job is to say so and let
/// them decide.
///
/// One unfiltered `tasklist` rather than one call per candidate name. The client
/// it looks for has
/// shipped under four names and `lich_status` is already slow enough to have
/// frozen the window (see `lich_status`'s own note); four extra process spawns
/// to answer one question is not a trade worth making. It also makes the `None`
/// branch mean something: an unfiltered tasklist that returns nothing at all is
/// a broken call, whereas a filtered one returning nothing is ambiguous.
fn other_frontend_running() -> Option<bool> {
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
/// Whether another game client is running, in the three answers that has (E11).
///
/// **Kept through N6 on purpose, renamed rather than deleted.** N6's `do:` line
/// says to remove this with the rest of the retired route, and doing so would
/// have been a deletion dressed as a sweep. This was never about the route:
/// two processes cannot both hold the detachable port, and starting a second
/// client has taken the connection out from under a live session on this
/// machine twice, with no error either time. The hazard outlives the client
/// that named it, so the warning does too - under a name that says what it is
/// for rather than what it happens to match on.
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
pub struct FrontendConflictStatus {
    pub running: bool,
    pub known: bool,
}

#[tauri::command]
pub async fn frontend_conflict_status() -> FrontendConflictStatus {
    tokio::task::spawn_blocking(|| match other_frontend_running() {
        Some(running) => FrontendConflictStatus {
            running,
            known: true,
        },
        None => FrontendConflictStatus::default(),
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
         and none of those are installed. Sign in from this app instead: it \
         performs the account login itself and starts Lich with the result."
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
///
/// **That argument is about a developer's running app and does not extend to
/// the shipped one** (issue #464). A release binary started with
/// `DRC_LICH_DRY_RUN=1` in its environment used to report a successful sign-in
/// and spawn nothing, which is an environment variable that decides whether a
/// player is playing. So the read is gated on [`crate::credentials::
/// overrides_are_honoured`] - the same gate as the endpoint overrides, one
/// definition, no second rule to drift.
fn dry_run() -> bool {
    crate::credentials::overrides_are_honoured()
        && std::env::var("DRC_LICH_DRY_RUN").is_ok_and(|v| v == "1")
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

/// The Lich this app started, kept so the attach can ask whether it is still
/// alive.
///
/// Issue #458: the attach used to be a single dial in the same tick as the
/// spawn, which cannot succeed - Lich does not open the detachable listener
/// until `main.rb:842-857`, after Ruby boots and the game connection is made.
/// The fix is a bounded retry, and a retry needs a way to stop early: if the
/// process this app started has *exited*, no amount of further dialling will
/// help, and "connection refused" would be a worse thing to tell a player than
/// "Lich exited with code 1".
///
/// The [`std::process::Child`] is held rather than only the pid because a pid
/// can be recycled: asking the handle is the only answer that cannot name
/// somebody else's process.
static SPAWNED_LICH: LichProcess = LichProcess(std::sync::Mutex::new(None));

/// The one owner of the [`std::process::Child`] this app spawned.
///
/// A named type rather than a bare `Mutex<Option<Child>>` because #488 §3 was
/// less a bug than an *unowned* handle: nothing could say what happened to it
/// on exit, because nothing was responsible for it. Every read and every
/// decision about that child now goes through one of the four methods below,
/// so "what happens to Lich when the app closes" has a place to be answered
/// and a place to be tested.
///
/// A `static` rather than Tauri managed state, on purpose.
/// `game_link::dial_once` passes [`spawned_lich_status`] as a plain `&dyn Fn`
/// with no `AppHandle` anywhere near it, so a managed copy would be a *second*
/// owner beside this one, and two owners of one process eventually disagree
/// (`CLAUDE.md` §0). One owner, reachable from both.
///
/// # The lifetime, stated
///
/// A static is never dropped, and dropping a `Child` does not kill the process
/// in any case. So with nothing else done, Lich outlives the app - which is
/// what this codebase wants and says in three other places ([`launch_lich_using`]
/// below, `docs/PLAN_TO_1_0.md`, and the whole point of `--detachable-client`),
/// and never said about this handle. `docs/LICH_NATIVE_LOGIN.md` §9 is the
/// sentence; [`LichProcess::stop`] and [`LichProcess::release`] are the two
/// answers to the question the app asks on close.
pub struct LichProcess(std::sync::Mutex<Option<std::process::Child>>);

/// What [`LichProcess::stop`] did, so a caller can say which rather than guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopOutcome {
    /// Nothing to stop: this app did not start a Lich, or a previous stop or
    /// release already gave the handle up.
    NotOurs,
    /// It had already exited by itself. Nothing was killed.
    AlreadyGone,
    /// It was running and this app ended it.
    Killed,
}

impl LichProcess {
    /// Take ownership of a newly spawned child.
    ///
    /// A previous child is *released*, never killed - see
    /// [`LichProcess::release`]. In practice there is never one, because both
    /// launch paths refuse while a Lich is running.
    fn hold(&self, child: std::process::Child) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    }

    /// Non-blocking: what the held child is doing. See [`spawned_lich_status`].
    fn status(&self) -> SpawnedLich {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let Some(child) = guard.as_mut() else {
            return SpawnedLich::NotOurs;
        };
        match child.try_wait() {
            Ok(Some(status)) => SpawnedLich::Exited(status.code()),
            Ok(None) => SpawnedLich::Running,
            // The handle itself failed. Reporting `Exited` here would tell a
            // player Lich died on the strength of a broken instrument, so this
            // says only what is certain: nothing useful is known about it.
            Err(_) => SpawnedLich::NotOurs,
        }
    }

    /// End the Lich this app started, and forget it.
    ///
    /// Killed **by the handle**, never by image name: more than one Lich can
    /// be running on this machine and a name-based kill would take somebody
    /// else's character offline. Same rule as `viewer::close_viewer`, for the
    /// same reason.
    ///
    /// Any pending launch file goes with it: a Lich that is being ended has no
    /// further use for a one-shot game key, and leaving it to the 120-second
    /// backstop would mean a key on disk after the thing it was written for is
    /// gone. Shredded after the lock is dropped, because
    /// `shred_pending_launch_files` takes a different lock and holding two is
    /// how an ordering bug gets in.
    fn stop(&self) -> StopOutcome {
        let mut guard = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let outcome = match guard.as_mut() {
            None => StopOutcome::NotOurs,
            Some(child) => match child.try_wait() {
                // Already gone is the ordinary case when the player closed
                // Lich themselves; `kill` errors on it and there is nothing to
                // be done about that.
                Ok(Some(_)) => StopOutcome::AlreadyGone,
                _ => {
                    let killed = child.kill().is_ok();
                    let _ = child.wait();
                    if killed {
                        StopOutcome::Killed
                    } else {
                        StopOutcome::AlreadyGone
                    }
                }
            },
        };
        *guard = None;
        drop(guard);
        shred_pending_launch_files();
        outcome
    }

    /// Give up the handle without touching the process.
    ///
    /// The other half of the choice, and the default one: the player is in the
    /// middle of a session, and closing this app is not a reason to log their
    /// character out. Returns whether there was anything to release, so
    /// "released one" and "there was none" are different observations.
    ///
    /// The launch file is deliberately *not* shredded here. Releasing ends
    /// nothing; `dial_with_retry` and the 120-second backstop own that file and
    /// both still apply to a Lich that is still running.
    fn release(&self) -> bool {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
            .is_some()
    }
}

/// What the Lich this app started is doing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpawnedLich {
    /// This app did not start a Lich, so there is nothing to say about one.
    /// **Not** "it is dead": a player who started Lich themselves is here too,
    /// which is why the attach treats this as "keep waiting" rather than as a
    /// reason to give up.
    NotOurs,
    /// Started by this app and still running.
    Running,
    /// Started by this app and gone. `Some(code)` where the platform gave one.
    Exited(Option<i32>),
}

/// Whether the Lich this app spawned is still up.
///
/// Non-blocking: `try_wait` reaps an exited child and returns immediately for
/// a live one, so this is safe to call from a dial loop several times a
/// second.
pub fn spawned_lich_status() -> SpawnedLich {
    SPAWNED_LICH.status()
}

/// What the app tells the webview about the Lich it started.
///
/// Two booleans rather than the enum, because the webview asks one question -
/// *is there a running Lich that closing this app would abandon* - and a
/// serialised three-way enum would make every caller re-derive it. `ours` is
/// false for a Lich the player started themselves, which this app never had a
/// handle on and must never presume to end.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, Default)]
pub struct OwnedLich {
    /// This app started a Lich and still holds its handle.
    pub ours: bool,
    /// That Lich is still running.
    pub running: bool,
    /// It has exited, with this code where the platform gave one.
    pub exit_code: Option<i32>,
}

/// Whether closing the app right now would leave a Lich this app started.
///
/// The one thing the close prompt is allowed to key on. A prompt shown for a
/// Lich the player started themselves would be offering to end a session this
/// app has no business ending, and a prompt shown for an exited one would be
/// asking about a process that is not there.
///
/// Deliberately **not** a `#[tauri::command]`. `lib.rs` calls it from the
/// `CloseRequested` handler and sends the answer with the event, so the webview
/// is told rather than asked - and a command nothing invokes is a noodle to
/// nowhere (`CLAUDE.md` §0), which `tools/tauri-command-callers-test.mjs`
/// catches.
pub fn lich_owned_status() -> OwnedLich {
    match SPAWNED_LICH.status() {
        SpawnedLich::NotOurs => OwnedLich::default(),
        SpawnedLich::Running => OwnedLich {
            ours: true,
            running: true,
            exit_code: None,
        },
        SpawnedLich::Exited(code) => OwnedLich {
            ours: true,
            running: false,
            exit_code: code,
        },
    }
}

/// "Stop Lich": end the one this app started, and say what that did.
///
/// One of the two answers to the close prompt (#488 §3). The player chose
/// this, which is the only thing that ever ends a Lich from this app: nothing
/// on the exit path kills one by itself, and a crash or a kill leaves it
/// running on purpose.
#[tauri::command]
pub fn lich_stop() -> StopOutcome {
    SPAWNED_LICH.stop()
}

/// "Leave it running": give up the handle and touch nothing.
///
/// The other answer, and the default. Returns whether there was a handle to
/// give up so that a caller can tell "let a running Lich go" from "there was
/// nothing there", which are the same silence otherwise.
#[tauri::command]
pub fn lich_release() -> bool {
    SPAWNED_LICH.release()
}

/// Serialises every test that touches the pending-launch-file list.
///
/// That list is process-global and cargo runs tests in threads, so without
/// this a case asserting "the file is still there" can be looking at a list
/// another case has just emptied. Found the hard way: the single-dial case
/// went red for exactly that reason, which is a check reporting on the
/// harness rather than on the code under test.
#[cfg(test)]
pub(crate) static LAUNCH_FILE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serialises every test that puts a child into [`SPAWNED_LICH`].
///
/// Same reason as the lock above: the handle is process-global and cargo runs
/// tests in threads, so without this a case asserting "the handle is gone" can
/// be looking at one another case has just taken.
#[cfg(test)]
pub(crate) static LICH_PROCESS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Put a path on the pending-launch-file list, for tests in other modules.
///
/// `game_link.rs` owns the dial that now shreds the launch file on all three
/// of its outcomes (#458), so its tests need a file to watch disappear. The
/// alternative was a second pending list over there, which is the fork this
/// exists to avoid.
#[cfg(test)]
pub(crate) fn remember_launch_file_for_test(path: PathBuf) {
    PENDING_LAUNCH_FILES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(path);
}

/// Shred the pending launch file after `after`, on a thread.
///
/// A parameter rather than a read of [`LAUNCH_FILE_TIMEOUT`] inside the body,
/// so the backstop can be *executed* in a test instead of waited for. A branch
/// nobody can trigger on purpose is a branch nobody can prove they fixed, and
/// two minutes is long enough that the alternative is no test at all.
fn spawn_shred_timer(after: std::time::Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(after);
        shred_pending_launch_files();
    });
}

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
///
/// # Why this returns a `LoginFailure` rather than a `String`
///
/// Issue #488 §3. Every failure here used to be flattened by the one caller
/// into [`crate::login_error::LoginCode::LichDidNotStart`], whose player
/// sentence sends them to a diagnostic - which is right for a Lich that
/// crashed and wrong for the commonest case on this path, a Lich that is
/// already up because the app was closed and reopened while the character
/// stayed logged in. That is not a fault to diagnose, it is a Lich to attach
/// to, and it now has its own code so the screen can offer that.
pub fn launch_lich_with_launch_data(
    fields: &[(String, String)],
) -> Result<LaunchOutcome, LoginFailure> {
    let s = lich_status_blocking();

    let launcher = s
        .launcher
        .ok_or_else(|| LoginFailure::lich_did_not_start("Could not find lich.rbw"))?;
    let ruby = s.ruby.ok_or_else(|| {
        LoginFailure::lich_did_not_start("Could not find Ruby, which Lich needs to run")
    })?;

    // Refuse rather than race - see `launch_lich` for why, and note that on
    // this path a second Lich would also mean a second launch file.
    if let Some(refusal) = already_running_refusal(s.running_known, s.running) {
        return Err(refusal);
    }

    launch_lich_using(&ruby, &launcher, fields).map_err(LoginFailure::lich_did_not_start)
}

/// Whether a Lich is already up, and therefore what to tell the player.
///
/// Its own function so all three states can be driven in a test. The whole
/// point of #488 §3's second half is *which* of them refuses, and on a machine
/// with a real Lich installed the caller above cannot be aimed at any of them
/// on purpose.
///
/// Only when we actually know. `running_known` false is "the process list could
/// not be read", which is neither permission to start a second Lich nor a
/// reason to claim one is up - so it does not refuse, exactly as before.
fn already_running_refusal(running_known: bool, running: bool) -> Option<LoginFailure> {
    (running_known && running).then(|| {
        LoginFailure::lich_already_running(
            "a Lich is already running, so this app did not start a second one",
        )
    })
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

    spawn_shred_timer(LAUNCH_FILE_TIMEOUT);

    let pid = child.id();
    // Held so the attach retry can tell "Lich is still booting" from "Lich
    // exited" - see [`LichProcess`] and issue #458. A previous child is
    // dropped here, which on every platform this ships to detaches rather
    // than kills: this app does not end a Lich it did not start ending.
    SPAWNED_LICH.hold(child);

    Ok(LaunchOutcome {
        pid: Some(pid),
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
/// `password` is optional from N9 (issue #459): `null` means "use the one you
/// have saved for this account", which is what makes N8's stored password
/// worth storing. See [`resolve_password`].
#[tauri::command]
pub async fn lich_login_characters(
    account: String,
    password: Option<String>,
    game_code: String,
) -> Result<eaccess::Account, LoginFailure> {
    tokio::task::spawn_blocking(move || {
        let creds = WindowsCredentialManager;
        let mut transport = eaccess::connect()?;
        characters_with(
            &mut transport,
            account.trim(),
            password,
            game_code.trim(),
            &creds,
        )
    })
    .await
    .map_err(|e| LoginFailure::internal(format!("the character lookup did not finish: {e}")))?
}

/// [`lich_login_characters`] with the transport and the credential store
/// injected.
///
/// The seam exists so the stored-password paths can be *executed* in a test
/// rather than reasoned about: a mock `EAccess` records the frames, so "the
/// stored password is the one that went on the wire" is a check on the bytes
/// and not on a call count.
pub(crate) fn characters_with<T: eaccess::Transport>(
    transport: &mut T,
    account: &str,
    typed: Option<String>,
    game_code: &str,
    creds: &dyn CredentialAccess,
) -> Result<eaccess::Account, LoginFailure> {
    let (secret, source) = resolve_password(typed, account, creds)?;
    let plaintext = plaintext_of(&secret)?;
    eaccess::list_characters(transport, account, plaintext, game_code)
        .map_err(|e| protocol_failure(e, source, account, creds))
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
/// launch file and reports the argv without spawning Lich. **Neither survives
/// into a release build** (issue #464): both are gated on
/// [`crate::credentials::overrides_are_honoured`], because a variable that can
/// redirect where a password is sent is not a thing a shipped binary should
/// read from its environment.
///
/// `password` is optional from N9 (issue #459): `null` asks for the one saved
/// in Windows Credential Manager, which until then nothing read back.
#[tauri::command]
pub async fn lich_login_launch(
    account: String,
    password: Option<String>,
    game_code: String,
    character: String,
) -> Result<LaunchOutcome, LoginFailure> {
    tokio::task::spawn_blocking(move || {
        let creds = WindowsCredentialManager;
        let mut transport = eaccess::connect()?;
        launch_with(
            &mut transport,
            account.trim(),
            password,
            game_code.trim(),
            character.trim(),
            &creds,
        )
    })
    .await
    .map_err(|e| LoginFailure::internal(format!("the sign-in task did not finish: {e}")))?
}

/// [`lich_login_launch`] with the transport and the credential store injected.
///
/// The launcher half's failures become [`crate::login_error::LoginCode::
/// LichDidNotStart`], which is the code the webview's "the sign-in worked but
/// Lich did not start" sentence hangs off - a sentence that was written for
/// this and had no way to be reached before #457.
pub(crate) fn launch_with<T: eaccess::Transport>(
    transport: &mut T,
    account: &str,
    typed: Option<String>,
    game_code: &str,
    character: &str,
    creds: &dyn CredentialAccess,
) -> Result<LaunchOutcome, LoginFailure> {
    let (secret, source) = resolve_password(typed, account, creds)?;
    let plaintext = plaintext_of(&secret)?;
    let data = eaccess::login(transport, account, plaintext, game_code, character)
        .map_err(|e| protocol_failure(e, source, account, creds))?;

    // `LaunchData`'s inner `Vec<(String, String)>` is exactly what
    // `sal::write_temp` accepts, so there is one type for this and
    // `eaccess.rs` owns it.
    // Already a `LoginFailure`, and deliberately not re-wrapped: #488 §3 was
    // an "already running" refusal arriving as `lich_did_not_start`, which
    // pointed the player at a diagnostic when the answer was Attach.
    launch_lich_with_launch_data(&data.0)
}

/// Where the password for a sign-in came from.
///
/// Load-bearing rather than informational: a refusal of a password the *player
/// typed* is "check it and try again", and a refusal of one loaded from the
/// store is "the saved one is no longer any good, and it has been removed".
/// Telling a player to re-check something they did not type is how a
/// credential feature becomes an infinite retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasswordSource {
    Typed,
    Stored,
}

/// The stored-password half of the sign-in, behind a trait.
///
/// A seam, so the three cases N8 shipped and nothing read - stored password
/// used, stored password refused, typed password winning over a stored one -
/// can be driven in a test without Windows Credential Manager.
pub trait CredentialAccess {
    fn load(&self, account: &str) -> Option<Secret>;
    /// Remove the stored entry. The return says whether there was one.
    fn forget(&self, account: &str) -> bool;
}

/// The real one: Windows Credential Manager, through `credential_store`.
///
/// This is the non-test caller `credential_store::load`'s doc comment has
/// named since N8 and did not have (issue #459).
pub struct WindowsCredentialManager;

impl CredentialAccess for WindowsCredentialManager {
    fn load(&self, account: &str) -> Option<Secret> {
        crate::credential_store::load(&crate::credential_store::service_name(), account)
    }

    fn forget(&self, account: &str) -> bool {
        crate::credential_store::forget(&crate::credential_store::service_name(), account)
            .unwrap_or(false)
    }
}

/// The password to sign in with, and where it came from.
///
/// A typed password always wins. Only when the webview sent nothing at all is
/// the store consulted, and a store with nothing in it is an error naming
/// that, rather than a sign-in attempt with an empty password: the account
/// server would refuse that as bad credentials, and a player would be told a
/// password they never typed was wrong.
fn resolve_password(
    typed: Option<String>,
    account: &str,
    creds: &dyn CredentialAccess,
) -> Result<(Secret, PasswordSource), LoginFailure> {
    if let Some(typed) = typed {
        if !typed.is_empty() {
            // Moved, not copied: from here the plaintext exists in exactly one
            // place that knows how to erase itself.
            return Ok((Secret::new(typed), PasswordSource::Typed));
        }
    }
    match creds.load(account) {
        Some(stored) if !stored.is_empty() => Ok((stored, PasswordSource::Stored)),
        _ => Err(LoginFailure::password_needed(account)),
    }
}

/// The bytes for frame 2, as `&str`.
///
/// A `Secret` is built from a `String`, so this cannot fail today; it is kept
/// rather than unwrapped because `Secret` guards its plaintext behind one
/// accessor by design and a panic is not an answer to give a sign-in screen.
/// The code is `password_length` because the player-facing kind it maps to -
/// "this password cannot be sent to the login service" - is exactly true of a
/// password that cannot be put into the frame.
fn plaintext_of(secret: &Secret) -> Result<&str, LoginFailure> {
    std::str::from_utf8(secret.expose_for_obscuring()).map_err(|_| {
        LoginFailure::new(
            LoginCode::PasswordLength,
            "that password cannot be encoded for the login frame",
        )
    })
}

/// Whether a failure is grounds for deleting the stored password.
///
/// A `match` over the whole enum with no wildcard, so the compiler refuses a
/// variant added later rather than sweeping it into one answer or the other
/// (issue #488). The old code was `matches!(e, BadCredentials { .. })`, which is
/// the same rule and asks nothing of the next person to add a variant — and the
/// defect was never in this line anyway. It was in the classifier that fed it:
/// `BadCredentials` used to be the fallback for *any* token that was not one of
/// five lock words, so an unrecognised refusal — `NEW`, `NORECORD`, `REJECT`, an
/// empty third field from a truncated reply — destroyed a credential.
///
/// The rule now: forget only when the login service named the password itself
/// ([`eaccess::EAccessError::BadCredentials`], and
/// `EAccessError::from_refusal_code` reaches that from the single token Lich
/// documents as "wrong password"). Everything else keeps the entry. Deleting a
/// credential is not the safe default for a code nobody can read.
fn is_grounds_for_forgetting(e: &eaccess::EAccessError) -> bool {
    use eaccess::EAccessError as E;
    match e {
        E::BadCredentials { .. } => true,
        E::AccountLockedOrExpired { .. }
        | E::AccountRefused { .. }
        | E::NoSuchCharacter { .. }
        | E::ProtocolMismatch { .. }
        | E::PasswordLength { .. }
        | E::ObscuredByteOutOfRange { .. }
        | E::Network { .. } => false,
    }
}

/// A protocol failure, plus the one decision the store forces.
///
/// A stored password the account server refuses is forgotten *here*, before
/// the error is returned, so the next sign-in asks for a typed one rather than
/// retrying the same dead secret for ever. Which refusals count is
/// [`is_grounds_for_forgetting`].
fn protocol_failure(
    e: eaccess::EAccessError,
    source: PasswordSource,
    account: &str,
    creds: &dyn CredentialAccess,
) -> LoginFailure {
    if source == PasswordSource::Stored && is_grounds_for_forgetting(&e) {
        creds.forget(account);
        return LoginFailure::stored_password_rejected(&e.to_string());
    }
    e.into()
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
    #[cfg_attr(
        not(debug_assertions),
        ignore = "DRC_LICH_DRY_RUN is debug-only from #464; the_dry_run_knob_is_debug_only is what runs there"
    )]
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
        // The lock, because the list this reads is process-global and N9 added
        // cases that put files on it. Without it this asserts "nothing was
        // pending" against a list another thread had just filled, and it went
        // red under `cargo test --release` for exactly that reason - a check
        // reporting on the harness rather than on the code.
        let _pending = LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Emptied first, so this is "shredding nothing is zero" rather than
        // "nothing else in this process has ever run".
        shred_pending_launch_files();
        assert_eq!(shred_pending_launch_files(), 0);
    }

    /// The retired client must never count as a frontend Lich's GUI can offer.
    ///
    /// This is the whole point of `gui_login_usable` being a separate question
    /// from "is a frontend installed at all" - `setup.rs`'s detection still
    /// finds it and is right to, because the config importer reads its files -
    /// but Lich's own login window cannot
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
        let dir = crate::test_support::scratch_dir("lich-entry");

        let secret = "hunter2-do-not-leak";
        std::fs::write(
            dir.join("entry.yaml"),
            format!(
                "---\nencryption_mode: plaintext\naccounts:\n  DANCOCKRELL:\n    password: {secret}\n    characters:\n    - char_name: Phemius\n      game_code: DR\n      frontend: genie\n    - char_name: \"Dan the Bold\"\n      game_code: DR\n"
            ),
        )
        .unwrap();

        let names = saved_characters(dir.path()).expect("file is readable");
        assert_eq!(names, vec!["Phemius", "Dan the Bold"]);

        // Not "the password is not in position 0". Nothing anywhere in the
        // output may contain it, however the file is laid out.
        assert!(
            !names.iter().any(|n| n.contains(secret)),
            "a password reached the character list"
        );
    }

    /// Absent is not empty. A missing file has to be distinguishable from a
    /// file with no characters in it, because the caller renders them
    /// differently and one of the two sends a returning player back through
    /// first-time setup.
    #[test]
    fn missing_file_is_unknown_not_empty() {
        let dir = crate::test_support::scratch_dir("lich-missing");

        assert!(
            saved_characters(dir.path()).is_none(),
            "no file must not read as no characters"
        );

        std::fs::write(dir.join("entry.yaml"), "---\naccounts: {}\n").unwrap();
        assert_eq!(
            saved_characters(dir.path()),
            Some(vec![]),
            "an empty file is an answer"
        );
    }

    /// rubyw over ruby, so no console window is left behind Lich.
    #[test]
    fn prefers_the_windowed_interpreter_when_present() {
        let root = crate::test_support::scratch_dir("ruby-pick");
        let dir = root.join("bin");
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
    // -- N9: the stored password, and the three states it has (#459) --------

    /// A credential store a test can see into.
    ///
    /// Records what was asked for and what was forgotten, so "the stored entry
    /// was removed" is a check on an effect rather than on a comment.
    struct FakeStore {
        stored: std::sync::Mutex<Option<String>>,
        forgotten: std::sync::Mutex<Vec<String>>,
    }

    impl FakeStore {
        fn with(password: Option<&str>) -> Self {
            Self {
                stored: std::sync::Mutex::new(password.map(str::to_string)),
                forgotten: std::sync::Mutex::new(Vec::new()),
            }
        }
        fn forgotten(&self) -> Vec<String> {
            self.forgotten.lock().unwrap().clone()
        }
    }

    impl CredentialAccess for FakeStore {
        fn load(&self, _account: &str) -> Option<Secret> {
            self.stored.lock().unwrap().clone().map(Secret::new)
        }
        fn forget(&self, account: &str) -> bool {
            self.forgotten.lock().unwrap().push(account.to_string());
            self.stored.lock().unwrap().take().is_some()
        }
    }

    /// The obscured bytes of frame 2, computed longhand from the formula in
    /// `eaccess.rb:111` rather than by calling `obscure` - which would assert
    /// that a function equals itself.
    fn frame_two(account: &str, password: &str) -> Vec<u8> {
        let mut expected: Vec<u8> = vec![b'A', b'\t'];
        expected.extend_from_slice(account.as_bytes());
        expected.push(b'\t');
        for (p, k) in password.bytes().zip(eaccess::test_support::HASHKEY.iter()) {
            let (p, k) = (i32::from(p), i32::from(*k));
            expected.push((((p - 32) ^ k) + 32) as u8);
        }
        expected
    }

    /// #459: the stored password is the one that goes on the wire.
    ///
    /// The check is on the **bytes frame 2 carried**, not on whether `load`
    /// was called: a command that asked the store and then signed in with
    /// something else would pass a call-count check and fail this one.
    #[test]
    fn a_stored_password_is_the_one_that_reaches_the_wire() {
        let stored = String::from("stored-") + "example";
        let store = FakeStore::with(Some(&stored));
        let mut server = eaccess::test_support::happy_server();
        let account = eaccess::test_support::account();

        let result = characters_with(&mut server, &account, None, "DR", &store)
            .expect("a stored password signs in");
        assert_eq!(result.characters.len(), 2, "the mock's character list");
        assert_eq!(
            &server.received[1],
            &frame_two(&account, &stored),
            "frame 2 did not carry the stored password"
        );
        assert!(
            store.forgotten().is_empty(),
            "a working stored password was forgotten"
        );
    }

    /// #459: a typed password wins over a stored one.
    #[test]
    fn a_typed_password_wins_over_a_stored_one() {
        let stored = String::from("stored-") + "example";
        let typed = String::from("typed-") + "example";
        let store = FakeStore::with(Some(&stored));
        let mut server = eaccess::test_support::happy_server();
        let account = eaccess::test_support::account();

        characters_with(&mut server, &account, Some(typed.clone()), "DR", &store)
            .expect("a typed password signs in");
        assert_eq!(
            &server.received[1],
            &frame_two(&account, &typed),
            "frame 2 carried the stored password over a typed one"
        );
        // The control that makes the line above mean something: the two
        // passwords really do produce different frames, so an assertion that
        // passed on either would be no assertion at all.
        assert_ne!(frame_two(&account, &typed), frame_two(&account, &stored));
    }

    /// #459: a stored password the server refuses is forgotten, and said so
    /// once - not retried for ever against an entry that cannot work.
    #[test]
    fn a_refused_stored_password_is_forgotten_and_reported_once() {
        let store = FakeStore::with(Some("stale-example"));
        let mut server =
            eaccess::test_support::server_with(b'A', eaccess::test_support::REFUSED_A_REPLY);
        let account = eaccess::test_support::account();

        let failure = characters_with(&mut server, &account, None, "DR", &store)
            .expect_err("a refused password is an error");
        assert_eq!(failure.code, "stored_password_rejected");
        assert_eq!(store.forgotten(), vec![account.clone()]);

        // And the second attempt is a different state: there is nothing left
        // to load, so it asks for one rather than refusing the same secret
        // again.
        let mut second = eaccess::test_support::happy_server();
        let again = characters_with(&mut second, &account, None, "DR", &store)
            .expect_err("nothing is stored any more");
        assert_eq!(again.code, "password_needed");
    }

    /// A *typed* password the server refuses stays `bad_credentials`, and
    /// forgets nothing. The direction that finds things: without it, a change
    /// that classified every refusal as the stored one would pass above.
    #[test]
    fn a_refused_typed_password_is_not_the_stored_state() {
        let store = FakeStore::with(Some("stored-example"));
        let mut server =
            eaccess::test_support::server_with(b'A', eaccess::test_support::REFUSED_A_REPLY);
        let typed = String::from("typed-") + "example";

        let failure = characters_with(
            &mut server,
            &eaccess::test_support::account(),
            Some(typed),
            "DR",
            &store,
        )
        .expect_err("a refused password is an error");
        assert_eq!(failure.code, "bad_credentials");
        assert!(
            store.forgotten().is_empty(),
            "a typed refusal threw away the saved password"
        );
    }

    /// #488: every `A`-reply refusal token, through the composed path, with the
    /// store checked afterwards.
    ///
    /// The path is the real one — `characters_with` -> the mock EAccess server
    /// -> `handshake` -> `EAccessError::from_refusal_code` -> `protocol_failure`
    /// -> the store — so the (token, forgotten?) pair asserted here is the pair
    /// a server sending that token really produces. Building the variant
    /// directly and asserting on it would test the assertion, which is how the
    /// `NEW` fixture came to record a state the pipeline could not reach.
    ///
    /// Three denominators, because "nothing was forgotten" is what an inert
    /// harness says too:
    ///
    /// - the store is asserted to hold the secret **before** each case, so a
    ///   `FakeStore` that lost it earlier cannot pass by being empty;
    /// - `PASSWORD` is the positive control and must be forgotten, so a run in
    ///   which forgetting is broken outright goes red;
    /// - `NEW` is the negative control and must be kept, which is the bug.
    ///
    /// Both outcomes are therefore reachable and both are asserted to occur.
    #[test]
    fn every_refusal_token_but_the_password_one_keeps_the_stored_password() {
        let account = eaccess::test_support::account();
        let stored = String::from("stored-") + "example";
        let mut forgotten: Vec<&str> = Vec::new();
        let mut kept: Vec<&str> = Vec::new();

        for token in eaccess::test_support::REFUSAL_TOKENS {
            // A fresh store per case, and the control that it really has
            // something to lose.
            let store = FakeStore::with(Some(&stored));
            assert!(
                store.load(&account).is_some(),
                "token {token:?}: the store was empty before the case ran"
            );
            let mut server = eaccess::test_support::server_refusing(token);
            let failure = characters_with(&mut server, &account, None, "DR", &store)
                .expect_err("a refusal is an error");

            let was_forgotten = !store.forgotten().is_empty();
            assert_eq!(
                was_forgotten,
                store.load(&account).is_none(),
                "token {token:?}: `forget` was recorded without emptying the store,                  or the other way round"
            );
            assert_eq!(
                was_forgotten,
                failure.code == "stored_password_rejected",
                "token {token:?}: the code the webview gets ({}) and what happened to                  the stored password disagree",
                failure.code
            );
            if was_forgotten {
                forgotten.push(token);
            } else {
                kept.push(token);
            }
        }

        // Named individually as well as counted: `NEW` is the exemplar in
        // `login_error.rs`, `REJECT`/`NORECORD` are Lich's own vocabulary, and
        // `""` is what a truncated third field leaves behind.
        for token in ["NEW", "REJECT", "NORECORD", "INVALID", ""] {
            assert!(
                kept.contains(&token),
                "token {token:?} deleted the stored password"
            );
        }
        // The one token Lich documents as "wrong password"
        // (`authenticator.rb:21`), case-insensitively, and nothing else.
        assert_eq!(
            forgotten,
            vec!["PASSWORD", "password"],
            "the set of tokens that delete a saved password has changed"
        );
        // Both outcomes occurred, so neither list is the answer an inert
        // harness would give.
        assert!(!forgotten.is_empty() && !kept.is_empty());
        assert_eq!(
            forgotten.len() + kept.len(),
            eaccess::test_support::REFUSAL_TOKENS.len(),
            "a token was driven and neither counted"
        );
    }

    /// #507: every `A`-reply token, through the composed path, to the sentence
    /// the player is shown.
    ///
    /// The same drive as the case above and a different question. That one asks
    /// what happens to the stored password; this asks what the player is *told*,
    /// which before #507 was one sentence for fifteen tokens - including the
    /// four Lich writes meanings down for and this app has a table of.
    ///
    /// The path is the real one, so the (token, sentence) pair asserted here is
    /// the pair a server sending that token really produces: the mock EAccess
    /// server -> `handshake` -> `from_refusal_code` -> `protocol_failure` ->
    /// the `LoginFailure` the webview receives -> `login_error::refusal_sentence`
    /// on the `token` field it carries. The webview reads the same table out of
    /// the generated fixture, so there is one table and this end of it is
    /// driven.
    ///
    /// Three denominators, because "they all differ" is also what a run over an
    /// empty list says:
    ///
    /// - every token is accounted for, named or unnamed, and the two counts sum
    ///   to the driven length;
    /// - the named rows are asserted to be *reached*, by token, and their
    ///   sentences to be distinct from each other, so collapsing two rows to one
    ///   sentence goes red naming both tokens;
    /// - `NEW` is the negative control and must reach no row at all, which is
    ///   the case the "a reason this app does not recognise" wording is true of.
    #[test]
    fn every_refusal_token_reaches_the_sentence_written_for_its_cause() {
        use crate::login_error::refusal_sentence;
        let account = eaccess::test_support::account();
        let stored = String::from("stored-") + "example";
        // token -> the sentence the player would see, for the refusals that
        // have one. Ordered so a failure prints something a person can read.
        let mut named: std::collections::BTreeMap<&str, &'static str> =
            std::collections::BTreeMap::new();
        let mut unnamed: Vec<&str> = Vec::new();

        for token in eaccess::test_support::REFUSAL_TOKENS {
            let store = FakeStore::with(Some(stored.as_str()));
            let mut server = eaccess::test_support::server_refusing(token);
            let failure = characters_with(&mut server, &account, None, "DR", &store)
                .expect_err("a refusal is an error");

            // Only `account_refused` reads this table: the other codes have
            // their own sentence one level up, and a row for one of their
            // tokens is unreachable (asserted in `login_error.rs`).
            if failure.code != "account_refused" {
                continue;
            }
            match failure.token.as_deref().and_then(refusal_sentence) {
                Some(row) => {
                    named.insert(row.token, row.sentence);
                }
                None => unnamed.push(token),
            }
        }

        // The four Lich glosses, by name. This is the list from the issue, and
        // a token that stopped reaching its row is named individually rather
        // than counted.
        for token in [
            "REJECT",
            "NORECORD",
            "INVALID",
            "CHARACTER_NOT_FOUND",
            "GENERATOR_NOT_AVAILABLE",
        ] {
            assert!(
                named.contains_key(token),
                "token {token:?} did not reach a sentence of its own; \
                 it would fall back to the unrecognised-token wording"
            );
        }
        // N tokens, N distinct sentences. Collapsing two rows to one sentence
        // fails here naming both tokens, which is what the sabotage does.
        let mut by_sentence: std::collections::BTreeMap<&str, Vec<&str>> =
            std::collections::BTreeMap::new();
        for (token, sentence) in &named {
            by_sentence.entry(sentence).or_default().push(token);
        }
        let shared: Vec<String> = by_sentence
            .iter()
            .filter(|(_, tokens)| tokens.len() > 1)
            .map(|(_, tokens)| tokens.join(" and "))
            .collect();
        assert!(
            shared.is_empty(),
            "these tokens share one sentence, so a cause lost its remedy: {}",
            shared.join("; ")
        );
        assert_eq!(
            by_sentence.len(),
            named.len(),
            "{} tokens produced {} sentences",
            named.len(),
            by_sentence.len()
        );

        // The negative control, and the reason the generic wording still
        // exists: a token nobody has written down must reach no row, so the
        // webview shows "a reason this app does not recognise" for the case
        // that is actually true of.
        assert!(
            unnamed.contains(&"NEW"),
            "NEW reached a sentence written for a named cause"
        );
        // Both outcomes occurred, so neither list is what an inert drive gives.
        assert!(!named.is_empty() && !unnamed.is_empty());
        assert_eq!(
            named.len(),
            crate::login_error::REFUSAL_SENTENCES.len(),
            "the table has rows no driven token reaches, or the drive missed one"
        );
    }

    /// #488: a refused *stored* password still reaches the forgotten state.
    ///
    /// The direction the case above cannot cover on its own: it asserts which
    /// tokens do not forget, and a `protocol_failure` that never forgot anything
    /// would satisfy all but the `PASSWORD` row. This is that row on its own,
    /// spelled out.
    #[test]
    fn the_password_token_still_forgets_a_stored_password() {
        let account = eaccess::test_support::account();
        let store = FakeStore::with(Some("stale-example"));
        let mut server = eaccess::test_support::server_refusing("PASSWORD");
        let failure = characters_with(&mut server, &account, None, "DR", &store)
            .expect_err("a refused password is an error");
        assert_eq!(failure.code, "stored_password_rejected");
        assert_eq!(store.forgotten(), vec![account]);
    }

    /// #464: a release build ignores `DRC_LICH_DRY_RUN`.
    ///
    /// Meaningful in both configurations: under `cargo test` it proves the
    /// knob is read at all, and under `cargo test --release` it proves a
    /// shipped binary cannot be told to fake a sign-in from its environment.
    #[test]
    fn the_dry_run_knob_is_debug_only() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::set_var("DRC_LICH_DRY_RUN", "1");
        let honoured = dry_run();
        std::env::remove_var("DRC_LICH_DRY_RUN");
        assert_eq!(
            honoured,
            cfg!(debug_assertions),
            "DRC_LICH_DRY_RUN was honoured in a release build; a shipped app can be told \
             to report a sign-in it never performed"
        );
    }

    /// #458: the 120-second backstop really removes the launch file.
    ///
    /// Driven through the seam rather than by waiting two minutes, because a
    /// branch nobody can execute on purpose is a branch nobody can prove they
    /// fixed. The positive control is the assertion that the file exists
    /// before the timer runs: without it, "gone" is equally true of a file
    /// that was never written.
    #[test]
    fn the_launch_file_backstop_shreds_the_file() {
        let _pending = LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let path = std::env::temp_dir().join(format!(
            "drc-backstop-{}-{:?}.sal",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::write(&path, "KEY=not-a-real-key\n").expect("the fixture writes");
        assert!(path.exists(), "control: the fixture is on disk");
        remember_launch_file_for_test(path.clone());

        spawn_shred_timer(std::time::Duration::from_millis(50));
        for _ in 0..100 {
            if !path.exists() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        panic!("the backstop left {} on disk", path.display());
    }

    // -----------------------------------------------------------------------
    // What happens to Lich when the app closes. Issue #488 §3.
    //
    // A loopback stand-in throughout: `ping -n 60 127.0.0.1` is a real child
    // process, on every Windows, that lives long enough to be found alive and
    // dies when it is killed. No Ruby, no Lich, and nothing that could touch a
    // session somebody is playing.
    //
    // Every one of these asserts the **outcome** - whether the operating
    // system still lists the pid - rather than what `stop` or `release`
    // returned about itself. A `StopOutcome::Killed` from a function that
    // killed nothing reads identically to one that worked.
    // -----------------------------------------------------------------------

    /// A child that will still be there in a moment. Returns it with its pid.
    #[cfg(windows)]
    fn loopback_stand_in() -> std::process::Child {
        Command::new("ping")
            .args(["-n", "60", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("the loopback stand-in starts")
    }

    /// Does the operating system still list this pid?
    ///
    /// Asked of the OS rather than of the handle we just used, because the
    /// handle is the thing under test. `None` where the question could not be
    /// asked at all, which is not the same answer as "gone" - a test that read
    /// a broken tasklist as a successful kill would be certifying nothing.
    #[cfg(windows)]
    fn pid_listed(pid: u32) -> Option<bool> {
        let out = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .ok()?;
        let listed = String::from_utf8_lossy(&out.stdout);
        if listed.trim().is_empty() {
            return None;
        }
        Some(listed.contains(&format!("\"{pid}\"")))
    }

    /// Wait for a pid to disappear, so a kill is not raced against a check.
    #[cfg(windows)]
    fn wait_for_exit(pid: u32) -> bool {
        for _ in 0..100 {
            if pid_listed(pid) == Some(false) {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        false
    }

    /// "Stop Lich" ends the process this app started, and takes the launch
    /// file with it.
    ///
    /// The controls are the whole test. The stand-in is asserted alive and the
    /// launch file asserted on disk *before* the stop, because "gone" is
    /// equally true of a process that never started and a file that was never
    /// written - and a `stop` that did nothing would pass without them.
    #[test]
    #[cfg(windows)]
    fn stopping_lich_ends_the_process_and_shreds_the_launch_file() {
        let _held = LICH_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _pending = LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        let child = loopback_stand_in();
        let pid = child.id();
        SPAWNED_LICH.hold(child);

        let path = std::env::temp_dir().join(format!(
            // The child's pid, plus this process's own, so two
            // concurrent `cargo test` runs cannot name one file
            // (issue #502).
            "drc-stop-{pid}-{}.sal",
            std::process::id()
        ));
        std::fs::write(&path, "KEY=not-a-real-key\n").expect("the fixture writes");
        remember_launch_file_for_test(path.clone());

        // Controls, before anything is stopped.
        assert_eq!(
            pid_listed(pid),
            Some(true),
            "control: the stand-in is running before the stop"
        );
        assert_eq!(
            SPAWNED_LICH.status(),
            SpawnedLich::Running,
            "control: the handle agrees it is running"
        );
        assert!(path.exists(), "control: the launch file is on disk");

        assert_eq!(SPAWNED_LICH.stop(), StopOutcome::Killed);

        assert!(wait_for_exit(pid), "the stand-in survived a stop");
        assert!(
            !path.exists(),
            "the launch file outlived the Lich it was for"
        );
        assert_eq!(
            SPAWNED_LICH.status(),
            SpawnedLich::NotOurs,
            "the handle is given up as well as the process"
        );
    }

    /// "Leave it running" gives up the handle and touches nothing.
    ///
    /// The negative control for the case above, and the behaviour the app has
    /// on every path that is not the close prompt: a crash, a kill, or a
    /// webview that never answers all end here. The stand-in is killed at the
    /// end by the pid this test started - never by image name, which on this
    /// machine would reach other sessions' processes.
    #[test]
    #[cfg(windows)]
    fn leaving_lich_running_releases_the_handle_and_the_process_survives() {
        let _held = LICH_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let _pending = LAUNCH_FILE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        let child = loopback_stand_in();
        let pid = child.id();
        SPAWNED_LICH.hold(child);

        let path = std::env::temp_dir().join(format!(
            // The child's pid, plus this process's own, so two
            // concurrent `cargo test` runs cannot name one file
            // (issue #502).
            "drc-release-{pid}-{}.sal",
            std::process::id()
        ));
        std::fs::write(&path, "KEY=not-a-real-key\n").expect("the fixture writes");
        remember_launch_file_for_test(path.clone());

        assert_eq!(
            pid_listed(pid),
            Some(true),
            "control: the stand-in is running before the release"
        );

        assert!(SPAWNED_LICH.release(), "there was a handle to release");

        assert_eq!(
            pid_listed(pid),
            Some(true),
            "releasing the handle ended the process; it must not"
        );
        assert!(
            path.exists(),
            "releasing shredded the launch file; the Lich that needs it is \
             still running and the attach and the backstop still own it"
        );
        assert_eq!(
            SPAWNED_LICH.status(),
            SpawnedLich::NotOurs,
            "the handle is gone even though the process is not"
        );

        // Clean up by the pid this test launched, never by image name.
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
        assert!(wait_for_exit(pid), "the stand-in outlived its own test");
        assert_eq!(shred_pending_launch_files(), 1);
    }

    /// Releasing twice, and releasing nothing, are different answers.
    ///
    /// A `release` that always said `true` would make the test above pass
    /// while reporting a handle it never had.
    #[test]
    #[cfg(windows)]
    fn releasing_nothing_says_there_was_nothing() {
        let _held = LICH_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        // Whatever a previous case left, so this starts from empty.
        SPAWNED_LICH.release();
        assert!(!SPAWNED_LICH.release());
        assert_eq!(SPAWNED_LICH.stop(), StopOutcome::NotOurs);
    }

    /// A Lich that has already exited is not something this app killed.
    ///
    /// Three states, not two: `stop` has to be able to say "there was nothing
    /// to stop", "it was already gone" and "I ended it", or a caller reporting
    /// what happened is guessing at two thirds of it.
    #[test]
    #[cfg(windows)]
    fn stopping_a_lich_that_already_exited_says_so_rather_than_killed() {
        let _held = LICH_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        SPAWNED_LICH.release();

        let child = Command::new("cmd")
            .args(["/C", "exit", "0"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .expect("the stand-in starts");
        let pid = child.id();
        SPAWNED_LICH.hold(child);
        assert!(wait_for_exit(pid), "control: the stand-in exits by itself");

        assert!(
            matches!(SPAWNED_LICH.status(), SpawnedLich::Exited(_)),
            "control: the handle sees the exit"
        );
        assert_eq!(SPAWNED_LICH.stop(), StopOutcome::AlreadyGone);
        assert_eq!(SPAWNED_LICH.status(), SpawnedLich::NotOurs);
    }

    /// The webview is told about a running Lich only when there is one to be
    /// told about.
    #[test]
    #[cfg(windows)]
    fn the_close_prompt_is_only_offered_for_a_running_lich_this_app_started() {
        let _held = LICH_PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        SPAWNED_LICH.release();

        assert_eq!(
            lich_owned_status(),
            OwnedLich::default(),
            "a Lich the player started themselves is not ours to end"
        );

        let child = loopback_stand_in();
        let pid = child.id();
        SPAWNED_LICH.hold(child);
        let asked = lich_owned_status();
        assert!(asked.ours && asked.running, "{asked:?}");

        assert_eq!(SPAWNED_LICH.stop(), StopOutcome::Killed);
        assert!(wait_for_exit(pid));
        assert_eq!(
            lich_owned_status(),
            OwnedLich::default(),
            "nothing left to ask about once it has been stopped"
        );
    }

    /// The refusal a running Lich produces is the one that offers Attach.
    ///
    /// #488 §3: this arrived as `lich_did_not_start`, whose player sentence
    /// sends them to "Why won't it start?" - a diagnostic for a Lich that is
    /// running perfectly well. The three states are driven here because the
    /// caller cannot be aimed at them on a machine that has Lich installed.
    #[test]
    fn a_lich_that_is_already_up_is_an_attach_offer_and_not_a_diagnostic() {
        let refusal =
            already_running_refusal(true, true).expect("a known-running Lich refuses the launch");
        assert_eq!(refusal.code, "lich_already_running");
        assert_ne!(
            refusal.code, "lich_did_not_start",
            "the diagnostic sentence is the wrong thing to show for a Lich that is up"
        );

        // The two states that must not refuse, and the second is the reason
        // this is a three-way question: an unreadable process list is not
        // evidence that a Lich is running.
        assert!(already_running_refusal(true, false).is_none());
        assert!(
            already_running_refusal(false, true).is_none(),
            "an unknown process list must not be reported as a running Lich"
        );
    }
}
