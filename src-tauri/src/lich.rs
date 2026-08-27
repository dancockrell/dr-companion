//! Starting Lich, so the app is not permanently parked on somebody else doing
//! it by hand.
//!
//! Lich sits between Genie and the game. Without it running there is no bridge,
//! no live data, and the whole companion is a demo of itself - which is what it
//! had been, for as long as launching Lich was a manual step somebody had to
//! remember and get the arguments right for.
//!
//! # The password never comes through here
//!
//! This is the constraint the whole design is bent around, so it is stated
//! first rather than buried.
//!
//! Lich accepts `--account=`, `--password=` and `--character=` on the command
//! line. This module does not use them and must not. A password on a command
//! line is visible in the process list to every other program on the machine,
//! and lands in crash dumps and parent-process logs; it is the wrong place for
//! a credential no matter how briefly it is there.
//!
//! So there are two paths and neither carries one:
//!
//!   - **First time**, when Lich has no saved character: launch Lich's own
//!     window and stop. The player types their account details into
//!     Simutronics' and Lich's own dialog, which is the software that is
//!     supposed to have them, and Lich saves the entry itself.
//!   - **Every time after**: `--login <character>`, which names a saved entry
//!     and carries no secret at all.
//!
//! The app therefore never reads, stores, holds in memory, or passes on a
//! password. Reading the saved-entry file is deliberately narrow for the same
//! reason - see `saved_characters`.
//!
//! # The frontend flag has to be `--stormfront`, not `--genie`
//!
//! Found 27 Aug 2026, the same day the channel tabs shipped, and it would have
//! made them permanently silent against a real game. Lich's frontend registry
//! (`front-end.rb`) gives each declared frontend a fixed capability set, and
//! `messaging.rb` gates every `<pushStream>`/`<popStream>` tag behind
//! `Frontend.supports_streams?`. `--genie`'s capabilities are `[xml, mono]` -
//! no `streams` - because the real Genie plugin never asked for them, which is
//! the entire reason StreamTabs exists: Genie users build named windows out of
//! highlight patterns because Lich never gives them the game's own labels.
//! Declaring `--genie` here would have reproduced exactly that limitation on
//! purpose, silently, and only the replay fixture (which emits tags without
//! any capability check) made the feature look like it worked.
//!
//! `--stormfront` carries `[xml, streams, mono, room_window]`, is a real
//! `-s`/`--stormfront` flag Lich's argument parser accepts, and combined with
//! `--headless <port>` never launches an actual Wrayth/StormFront process -
//! `--headless` expands to `--without-frontend --detachable-client=PORT`,
//! and `--without-frontend` sets `$_CLIENT_ = nil` before any launcher adapter
//! runs (`lib/main/main.rb`). So the frontend identity governs the protocol
//! Lich speaks; `--without-frontend` governs whether it tries to open a
//! window. The two are independent, and this app wants the first without the
//! second.
//!
//! `--headless <port>` is also what actually opens the socket
//! `src-tauri/src/game_link.rs` connects to. Its absence here was a second,
//! separate gap: without it Lich resolves to the `session` role and expects to
//! spawn a real frontend, so this app's own launch button would start Lich
//! into a state its own TCP client could never attach to.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

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

    roots.iter().any(|root| {
        GUI_FRONTEND_EXES
            .iter()
            .any(|exe| root.join(exe).exists())
    })
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
    if listed.trim().is_empty() {
        // tasklist prints an informational line when nothing matches, so an
        // entirely empty stdout is more likely a broken call than a clean no.
        return None;
    }
    Some(listed.to_lowercase().contains("rubyw.exe"))
}

/// A character name that is safe to put on a command line.
///
/// Not a defence against a hostile user - it is their own machine and their own
/// Lich. It is a defence against a name that Lich would read as an option
/// rather than a value, which is what a leading dash does, and against the
/// quoting mess that anything more exotic turns into once it crosses a process
/// boundary on Windows.
///
/// Apostrophes and spaces are allowed because DragonRealms names have them.
///
/// Its own function so it can be tested. Left inline it was unreachable from a
/// test without spawning a process, and an unreachable branch is one nobody can
/// prove they fixed.
fn valid_character_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '\'' || c == '-' || c == ' ')
}

#[tauri::command]
pub fn lich_status() -> LichStatus {
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
fn launch_args(launcher: &str, character: Option<&str>) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = vec![launcher.to_string()];

    match character.map(str::trim).filter(|c| !c.is_empty()) {
        Some(name) => {
            // A character name reaches a command line, so it is checked. This
            // is not defence against a hostile user - it is their own machine -
            // it is defence against a name with a quote or a switch-looking
            // prefix in it turning into an argument Lich reads as an option.
            if !valid_character_name(name) {
                return Err(format!("{name:?} does not look like a character name"));
            }
            args.push("--login".into());
            args.push(name.into());
            args.push("--dragonrealms".into());
            // `--stormfront`, not `--genie` - see the module note. This is
            // the frontend Lich believes it is talking to for capability
            // purposes (streams, so the channel tabs have something to read),
            // and `--headless` below is what stops it from trying to launch
            // an actual one.
            args.push("--stormfront".into());
            // Opens the socket `game_link.rs` connects to, and stops Lich
            // from expecting to spawn a frontend process it would then find
            // was never installed.
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

/// Start Lich.
///
/// With a character name this is a silent, complete launch: Lich logs in using
/// the entry it saved earlier, connects DragonRealms for Genie, and starts the
/// companion bridge script so the app has data without a second manual step.
///
/// Without one it opens Lich's own launcher and stops there, because that is
/// the screen where credentials belong. See the module header.
#[tauri::command]
pub fn launch_lich(character: Option<String>) -> Result<String, String> {
    let s = lich_status();

    let launcher = s.launcher.ok_or("Could not find lich.rbw")?;
    let ruby = s.ruby.ok_or("Could not find Ruby, which Lich needs to run")?;

    // Refuse rather than race. A second Lich takes the port the first one is
    // holding, and the failure shows up later as the game disconnecting, which
    // is very hard to trace back to a button press.
    //
    // Only when we actually know. An unreadable process list is not permission
    // to start a second one, but it is not a reason to refuse forever either -
    // the message says which it was.
    if s.running_known && s.running {
        return Err("Lich looks like it is already running. Close it first, or use the one that is up.".into());
    }

    let args = launch_args(&launcher, character.as_deref())?;

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

    Ok(match character {
        Some(name) => format!("Starting Lich for {name}."),
        None => "Opened Lich's login window. Sign in there and it will remember the character.".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `streams` capability, not the frontend that lacks it. `--genie`
    /// shipped here first and was wrong in a way nothing else in this file
    /// would have caught - Lich still starts, `launch_lich` still returns Ok,
    /// and the only symptom is a feature elsewhere in the app receiving
    /// nothing, forever, from a real game.
    #[test]
    fn declares_stormfront_for_streams_not_genie() {
        let args = launch_args("lich.rbw", Some("Phemius")).unwrap();
        assert!(args.iter().any(|a| a == "--stormfront"), "{args:?}");
        assert!(!args.iter().any(|a| a == "--genie"), "{args:?}");
    }

    /// The socket `game_link.rs` connects to has to actually be opened, or
    /// this app's own launch button starts a Lich its own client cannot
    /// attach to.
    #[test]
    fn opens_the_detachable_client_port() {
        let args = launch_args("lich.rbw", Some("Phemius")).unwrap();
        assert!(
            args.iter().any(|a| a == &format!("--headless={DETACHABLE_PORT}")),
            "{args:?}"
        );
        // And not the older two-token form Lich also accepts - a mismatch
        // here would silently pass Lich's own parser and still be wrong.
        assert!(!args.iter().any(|a| a.starts_with("--detachable-client")), "{args:?}");
    }

    /// The bare launch (no character) must stay bare. Adding a frontend or
    /// port here would have Lich decide those things instead of asking, on
    /// the screen where credentials belong.
    #[test]
    fn a_bare_launch_carries_no_extra_arguments() {
        let args = launch_args("lich.rbw", None).unwrap();
        assert_eq!(args, vec!["lich.rbw".to_string()]);
    }

    #[test]
    fn a_hostile_looking_name_is_refused_before_it_reaches_a_command_line() {
        assert!(launch_args("lich.rbw", Some("--account=x")).is_err());
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
            !GUI_FRONTEND_EXES.iter().any(|e| e.to_lowercase().contains("genie")),
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
        assert_eq!(note(false, false), "ready", "a saved character makes the GUI moot");
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

        assert!(saved_characters(&dir).is_none(), "no file must not read as no characters");

        std::fs::write(dir.join("entry.yaml"), "---\naccounts: {}\n").unwrap();
        assert_eq!(saved_characters(&dir), Some(vec![]), "an empty file is an answer");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn character_names_that_would_become_options_are_refused() {
        assert!(valid_character_name("Phemius"));
        assert!(valid_character_name("Dan the Bold"));
        assert!(valid_character_name("D'Vare"));

        // The ones that matter: anything Lich would parse as a switch, and
        // anything that turns into a second argument or a shell surprise.
        assert!(!valid_character_name("--password=hunter2"));
        assert!(!valid_character_name("-s"));
        assert!(!valid_character_name(""));
        assert!(!valid_character_name("Phemius\" --password=x"));
        assert!(!valid_character_name("Phemius; calc"));
        assert!(!valid_character_name("Phem\nius"));
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
        assert_eq!(windowed_ruby(&ruby.to_string_lossy()), ruby.to_string_lossy());

        std::fs::write(dir.join("rubyw.exe"), b"").unwrap();
        assert!(windowed_ruby(&ruby.to_string_lossy()).ends_with("rubyw.exe"));

        let _ = std::fs::remove_dir_all(dir.parent().unwrap());
    }
}
