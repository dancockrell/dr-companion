//! The `.sal` launch file — the one thing DR Companion hands Lich so Lich does
//! not have to ask anybody for a password.
//!
//! # What a `.sal` is, to Lich
//!
//! It is not a parsed document. Lich reads it as **lines**
//! (`C:\Ruby4Lich5\Lich5\lib\main\main.rb:213`, Lich 5.20.1 per
//! `lib/version.rb:3`):
//!
//! ```ruby
//! @launch_data = File.open(@argv_options[:sal]) { |sal_file| sal_file.readlines }
//!                    .collect { |line| line.chomp }
//! ```
//!
//! and then looks every field up with `Array#find` and an **unanchored**
//! regex. There are five that matter, four unconditional and one that
//! `--without-frontend` — which `--headless=<port>` expands to
//! (`lib/main/arg_normalization.rb:52-53`) — turns on:
//!
//! | Lich's test | Cite | On absence |
//! |---|---|---|
//! | `line =~ /GAMECODE=/` | `main.rb:232` | `error: launch_data contains no GAMECODE info`, `exit(1)` |
//! | `line =~ /GAMEPORT=/` | `main.rb:237` | `error: launch_data contains no GAMEPORT info`, `exit(1)` |
//! | `opt  =~ /GAMEHOST=/` | `main.rb:242` | `error: launch_data contains no GAMEHOST info`, `exit(1)` |
//! | `opt  =~ /GAME=/`     | `main.rb:247` | `error: launch_data contains no GAME info`, `exit(1)` |
//! | `opt  =~ /KEY=/`      | `main.rb:308` | `error: launch_data contains no KEY info`, `exit(1)` |
//!
//! `KEY=` is required because `--without-frontend` sets `requires_game_key =
//! true` (`main.rb:319-323`) and `game_key = extract_game_key.call` runs at
//! `main.rb:345`. `GAMECODE=DR` is separately what selects DragonRealms
//! (`main.rb:225`); the game is **not** chosen by a `--dragonrealms` flag on
//! this path.
//!
//! Every one of those is a plain substring test on a whole line, which is why
//! [`REQUIRED_FIELDS`] below is a list of substrings and
//! [`missing_required_fields`] is `contains`, not a parser. Re-deriving Lich's
//! question in a different shape would be answering a different question.
//!
//! # Why the fields are validated here rather than trusted
//!
//! The values come off the wire from `eaccess.play.net` (the `L` reply,
//! `docs/LICH_NATIVE_LOGIN.md` §2.5) and go onto disk one per line. A value
//! carrying a newline would write a second line Lich would then `find` — so a
//! server that answered `KEY=x\nGAMEHOST=elsewhere` could redirect the launch.
//! [`write_temp`] refuses those bytes rather than escaping them, because there
//! is no escape: `readlines` has no quoting.
//!
//! # Lifetime
//!
//! The file holds `KEY=`, the one-shot game key from the `L` reply. It is not
//! a password and cannot be replayed once the game server consumes it, but it
//! is a secret on disk, so it lives for exactly as long as Lich needs to read
//! it and no longer. **When that is, measured rather than assumed:** on the
//! `--without-frontend` path Lich has finished with `@launch_data` by
//! `main.rb:345-349` (`extract_game_key.call`, then `gamecode/gameport/
//! gamehost/game` are each reduced to `.split('=').last`). The branch at
//! `main.rb:430` that rewrites the launch data and writes a *second* `.sal`
//! for a spawned frontend is in the `else` of `if
//! ARGV.include?('--without-frontend')` at `main.rb:359`, so it is not taken
//! here and Lich never re-reads our file. The detachable listener opens much
//! later, at `main.rb:842-857`. **So the first externally observable event
//! that is provably after the last read is the detachable port accepting a
//! connection**, and that is what [`crate::lich::lich_login_launch`] waits for
//! before shredding — with a fixed timeout that shreds anyway, because a Lich
//! that never opened the port is a Lich that will never read the file either.

use std::io::Write;
use std::path::{Path, PathBuf};

/// The substrings Lich's five `Array#find` regexes look for, verbatim from the
/// cites in this module's header.
///
/// These are the regexes' literal source with no metacharacters in them, so
/// `str::contains` is the same test Ruby performs and not an approximation of
/// it. If Lich ever anchors one of these, this list stops being equivalent and
/// the module header is where to notice.
pub const REQUIRED_FIELDS: [&str; 5] = ["GAMECODE=", "GAMEPORT=", "GAMEHOST=", "GAME=", "KEY="];

/// The subdirectory of the app's data directory launch files live in.
///
/// Deliberately not Lich's `TEMP_DIR` (which Lich shreds on its own schedule
/// and other Lich sessions share) and deliberately not the repo.
const LAUNCH_SUBDIR: &str = "launch";

/// Which of Lich's five required fields the given lines do not satisfy, in
/// Lich's own order, using Lich's own test.
///
/// Returns an empty vector when Lich would accept the file.
pub fn missing_required_fields(lines: &[String]) -> Vec<&'static str> {
    REQUIRED_FIELDS
        .iter()
        .copied()
        .filter(|needle| !lines.iter().any(|line| line.contains(needle)))
        .collect()
}

/// Render `fields` as the lines Lich will read, or say why they cannot be.
///
/// `fields` is the `L` reply in order, keys already uppercased — that is
/// `LaunchData`'s inner `Vec<(String, String)>` from `eaccess.rs`, taken as a
/// slice so this module does not need a second copy of that type.
pub fn render(fields: &[(String, String)]) -> Result<String, String> {
    for (key, value) in fields {
        if key.is_empty() {
            return Err("launch data contains a field with an empty name".into());
        }
        if let Some(bad) = key.chars().find(|c| *c == '\n' || *c == '\r' || *c == '=') {
            return Err(format!(
                "launch data field name {key:?} contains {bad:?}, which would not survive a line-per-field file"
            ));
        }
        if let Some(bad) = value.chars().find(|c| *c == '\n' || *c == '\r') {
            return Err(format!(
                "launch data value for {key} contains {bad:?}, which would write a second line Lich would then read as a field"
            ));
        }
    }

    let lines: Vec<String> = fields.iter().map(|(k, v)| format!("{k}={v}")).collect();

    let missing = missing_required_fields(&lines);
    if !missing.is_empty() {
        return Err(format!(
            "launch data is missing {}, which Lich exits(1) on (main.rb:232-251, :308)",
            missing.join(", ")
        ));
    }

    // Trailing newline: `readlines` chomps, so a final line without one is
    // read correctly either way, but a file whose last line has no terminator
    // is the sort of thing that breaks the day something appends to it.
    Ok(format!("{}\n", lines.join("\n")))
}

/// Write a launch file and return its path.
///
/// The basename is 16 hex characters of OS randomness, and the file is created
/// with `create_new`, so an existing file at that path is an error rather than
/// something to overwrite — that is what stops a predictable name being
/// pre-created by anything else.
///
/// **On permissions, precisely.** On unix the file is created mode `0o600`. On
/// Windows there is no mode; what this does instead is create it inside
/// `%LOCALAPPDATA%\DR Companion Data\launch`, whose default ACL grants this
/// user and administrators and nobody else, and hold it with
/// `share_mode(0)` while writing so nothing can open it mid-write. That is
/// *not* the same guarantee as `0600` — an administrator can read it — and
/// saying so is cheaper than implying an ACL edit this does not perform.
pub fn write_temp(fields: &[(String, String)]) -> Result<PathBuf, String> {
    write_temp_in(&launch_dir(), fields)
}

/// Where launch files go.
///
/// `DRC_LAUNCH_DIR` overrides it, and exists for one reason: without it, a
/// test of the launch path writes into - and [`sweep`]s - the directory the
/// *running* app uses, which on this machine means a test could delete a live
/// launch file out from under a real sign-in. It is also the seam that lets
/// the unhappy paths be aimed somewhere on purpose rather than waited for.
pub fn launch_dir() -> PathBuf {
    match std::env::var_os("DRC_LAUNCH_DIR") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => crate::setup::app_data_dir().join(LAUNCH_SUBDIR),
    }
}

/// [`write_temp`] with the directory named, so a test can write somewhere it
/// owns rather than into the running user's real app data.
pub fn write_temp_in(dir: &Path, fields: &[(String, String)]) -> Result<PathBuf, String> {
    let body = render(fields)?;

    std::fs::create_dir_all(dir)
        .map_err(|e| format!("could not make the launch directory {}: {e}", dir.display()))?;

    let path = dir.join(format!("{}.sal", random_hex16()?));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // No sharing at all while we hold it open.
        options.share_mode(0);
    }

    let mut file = options
        .open(&path)
        .map_err(|e| format!("could not create the launch file {}: {e}", path.display()))?;
    file.write_all(body.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("could not write the launch file {}: {e}", path.display()))?;

    Ok(path)
}

/// Overwrite the file's bytes and remove it.
///
/// Overwriting first because a plain `remove_file` leaves the key in whatever
/// blocks the file occupied; this is the same courtesy Lich pays its own copy
/// (`Lich::Common::CredentialScrub.shred_file`, `main.rb:439`, `:487`).
/// Neither is a guarantee against a journalling or copy-on-write filesystem,
/// and neither pretends to be — the real protection is that the key is
/// one-shot.
///
/// A file that is already gone is success: this runs on the happy path, on a
/// timeout and at exit, and any of the three may be second.
pub fn shred(path: &Path) -> Result<(), String> {
    let len = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("could not stat {}: {e}", path.display())),
    };

    if let Ok(mut file) = std::fs::OpenOptions::new().write(true).open(path) {
        let zeros = vec![0u8; len as usize];
        let _ = file.write_all(&zeros);
        let _ = file.sync_all();
    }

    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!(
            "could not remove the launch file {}: {e}",
            path.display()
        )),
    }
}

/// Shred every `.sal` left in the launch directory, and say how many.
///
/// The backstop for the one case no in-process timer can cover: an app killed
/// between writing a launch file and attaching to Lich. There is no `at_exit`
/// in Rust that survives a kill, so instead of promising to clean up on the
/// way out, the next launch cleans up on the way in — which is a check that
/// runs rather than a claim that it will.
///
/// Safe because only one launch is ever in flight (`lich.rs` refuses to start
/// a second Lich) and because the key in any leftover file is one-shot and
/// long since consumed or expired.
pub fn sweep() -> Result<usize, String> {
    sweep_in(&launch_dir())
}

/// [`sweep`] with the directory named, so a test can sweep a directory it owns.
pub fn sweep_in(dir: &Path) -> Result<usize, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        // Nothing has ever launched. That is not a failure, and it is not a
        // count of files it could not read either.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(format!("could not read {}: {e}", dir.display())),
    };

    let mut removed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "sal") {
            shred(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// 16 hex characters from the OS.
///
/// `getrandom` is already a direct dependency for the script API's connection
/// token; this is the second call site, not a new crate.
fn random_hex16() -> Result<String, String> {
    let mut bytes = [0u8; 8];
    getrandom::fill(&mut bytes).map_err(|e| format!("could not read OS randomness: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A scratch directory that removes itself, so these tests never write
    /// into the running user's real app data directory.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "drc-sal-test-{tag}-{}-{}",
                std::process::id(),
                random_hex16().unwrap()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The launch data a DragonRealms `L` reply produces, in the order
    /// `docs/LICH_NATIVE_LOGIN.md` §3.1 lists it. Assembled at runtime rather
    /// than written as one literal so nothing in this file is shaped like a
    /// credential.
    ///
    /// **`GAMEPORT` is deliberately not `11024`.** DR Prime's game port and
    /// this app's detachable-client port are the same number by coincidence,
    /// and they are unrelated: one is `dr.simutronics.net`'s, the other is
    /// `lich.rs`'s `DETACHABLE_PORT`. A fixture using 11024 here would make a
    /// writer that confused the two look correct, and it would give
    /// `tools/detachable-port-test.mjs` a hit it cannot tell from a retyped
    /// constant. `11124` is DR Platinum's real port, so the value is still a
    /// true one — and using it makes the point `docs/LICH_NATIVE_LOGIN.md` §7
    /// item 3 asks for: `GAMEPORT` is whatever the server sent, never a
    /// constant of ours.
    fn dr_fields() -> Vec<(String, String)> {
        [
            ("GAME", "STORM"),
            ("GAMECODE", "DR"),
            ("GAMEFILE", "STORMFRONT.EXE"),
            ("GAMEHOST", "dr.simutronics.net"),
            ("GAMEPORT", "11124"),
            ("KEY", "not-a-real-key-0000"),
            ("FULLGAMENAME", "DragonRealms"),
            ("UPPORT", "5535"),
        ]
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
    }

    /// Lich's five `Array#find` regexes, re-implemented from the cites in this
    /// module's header rather than from memory, and applied to the bytes we
    /// actually write.
    ///
    /// This is the test the increment exists for. There is no Ruby on this
    /// machine's PATH to run `main.rb`'s own parser against (`ruby` resolves
    /// to nothing in Git Bash; Lich's own interpreter lives under
    /// `C:\Ruby4Lich5` and is not a build dependency of this crate), so the
    /// regexes are transcribed verbatim — `/GAMECODE=/`, `/GAMEPORT=/`,
    /// `/GAMEHOST=/`, `/GAME=/`, `/KEY=/`, all unanchored, all plain
    /// substrings — and the transcription is what the module header cites.
    #[test]
    fn the_written_bytes_satisfy_every_regex_lich_exits_on() {
        let scratch = Scratch::new("regexes");
        let path = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();

        // `readlines` + `chomp`, in Rust.
        let lines: Vec<String> = text.lines().map(str::to_string).collect();

        assert_eq!(
            missing_required_fields(&lines),
            Vec::<&str>::new(),
            "wrote {lines:?}"
        );
        // Assert the denominator, and assert it by name rather than by count.
        // `missing_required_fields` iterates `REQUIRED_FIELDS`, so a field
        // quietly dropped from that list stops being checked and the empty
        // "missing" list above then means nothing. This is the line that
        // notices, and it says which field went.
        assert_eq!(
            REQUIRED_FIELDS.to_vec(),
            vec!["GAMECODE=", "GAMEPORT=", "GAMEHOST=", "GAME=", "KEY="],
            "REQUIRED_FIELDS no longer transcribes Lich's five regexes \
             (main.rb:232, :237, :242, :247, :308)"
        );
        for needle in REQUIRED_FIELDS {
            assert!(
                lines.iter().any(|l| l.contains(needle)),
                "no line contains {needle:?} in {lines:?}"
            );
        }
        // And the one the loop above cannot vouch for on its own: the game key
        // has to be in the file, because it is the only thing in it the player
        // could not retype. Named explicitly so it survives the loop shrinking.
        assert!(
            lines.iter().any(|l| l.starts_with("KEY=")),
            "the launch file carries no KEY= line: {lines:?}"
        );

        // `main.rb:225` — this and not a `--dragonrealms` flag is what picks
        // the game.
        assert!(lines.iter().any(|l| l.contains("GAMECODE=DR")), "{lines:?}");

        // `main.rb:345-349` reduces each found line with `.split('=').last`.
        // Model that, so a value containing an `=` would be caught here rather
        // than at runtime.
        let found = |needle: &str| -> String {
            let line = lines.iter().find(|l| l.contains(needle)).unwrap();
            line.split('=').next_back().unwrap().to_string()
        };
        assert_eq!(found("GAMEHOST="), "dr.simutronics.net");
        assert_eq!(found("GAMEPORT="), "11124");
        assert_eq!(found("GAME="), "STORM");
    }

    /// The negative direction of the same check. Lich's five `find`s cannot
    /// tell a missing field from a mistyped one, so the writer has to.
    #[test]
    fn every_required_field_is_named_when_it_is_absent() {
        for required in REQUIRED_FIELDS {
            let short: Vec<(String, String)> = dr_fields()
                .into_iter()
                .filter(|(k, _)| format!("{k}=") != required)
                .collect();
            // Each removal takes out exactly its own field: no other line we
            // write contains another's needle as a substring ("GAMECODE=DR"
            // does not contain "GAME="; "FULLGAMENAME=" does not either).
            let err = render(&short).unwrap_err();
            assert!(
                err.contains(required),
                "removing {required} produced {err:?}, which does not name it"
            );
            for other in REQUIRED_FIELDS {
                if other != required {
                    assert!(
                        !err.contains(&format!(" {other}")) && !err.contains(&format!("{other},")),
                        "removing {required} also complained about {other}: {err:?}"
                    );
                }
            }
        }
    }

    /// The four required regexes are unanchored substring tests, so the
    /// obvious worry is that `/GAME=/` also matches `GAMECODE=DR` — in which
    /// case `Array#find` would return whichever line came first and
    /// `main.rb:349`'s `game.split('=').last` would yield `"DR"` instead of
    /// `"STORM"`, and the order the server happens to send its fields in would
    /// decide it.
    ///
    /// It does not: `"GAMECODE="` has a `C` where `/GAME=/` needs an `=`, and
    /// the same goes for `GAMEPORT=`, `GAMEHOST=`, `GAMEFILE=` and
    /// `FULLGAMENAME=`. This test asserts that against a deliberately hostile
    /// ordering — every other `GAME`-prefixed field placed *before* `GAME=` —
    /// so if a future field ever does collide, this goes red here rather than
    /// showing up as Lich connecting to the wrong game.
    #[test]
    fn no_other_field_collides_with_lichs_unanchored_needles() {
        let hostile: Vec<(String, String)> = [
            ("GAMECODE", "DR"),
            ("GAMEPORT", "11124"),
            ("GAMEHOST", "dr.simutronics.net"),
            ("GAMEFILE", "STORMFRONT.EXE"),
            ("FULLGAMENAME", "DragonRealms"),
            ("GAME", "STORM"),
            ("KEY", "not-a-real-key-0000"),
        ]
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect();

        let text = render(&hostile).unwrap();
        let lines: Vec<String> = text.lines().map(str::to_string).collect();

        // `Array#find` — the first line matching, which is what makes the
        // ordering matter at all.
        let first = |needle: &str| -> String {
            lines
                .iter()
                .find(|l| l.contains(needle))
                .unwrap_or_else(|| panic!("nothing matched {needle:?} in {lines:?}"))
                .split('=')
                .next_back()
                .unwrap()
                .to_string()
        };
        assert_eq!(first("GAME="), "STORM", "{lines:?}");
        assert_eq!(first("GAMECODE="), "DR", "{lines:?}");
        assert_eq!(first("GAMEPORT="), "11124", "{lines:?}");
        assert_eq!(first("GAMEHOST="), "dr.simutronics.net", "{lines:?}");

        // And the positive control the assertion above needs: prove the
        // ordering could have mattered, i.e. that these lines really are ahead
        // of `GAME=STORM` in the file. Without this the test would pass just
        // as happily against a renderer that sorted them.
        let index = |needle: &str| lines.iter().position(|l| l.starts_with(needle)).unwrap();
        assert!(index("GAMECODE=") < index("GAME="), "{lines:?}");
        assert!(index("FULLGAMENAME=") < index("GAME="), "{lines:?}");
    }

    /// A value off the wire cannot smuggle a second field in.
    #[test]
    fn a_newline_in_a_value_is_refused_rather_than_written() {
        let mut fields = dr_fields();
        for (k, v) in fields.iter_mut() {
            if k == "KEY" {
                *v = "abc\nGAMEHOST=attacker.example".to_string();
            }
        }
        let err = render(&fields).unwrap_err();
        assert!(err.contains("KEY"), "{err}");
        assert!(err.contains("second line"), "{err}");
    }

    #[test]
    fn shred_removes_the_file_and_is_happy_to_run_twice() {
        let scratch = Scratch::new("shred");
        let path = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        assert!(std::fs::metadata(&path).is_ok());
        shred(&path).unwrap();
        assert!(
            std::fs::metadata(&path).is_err(),
            "{} survived shred",
            path.display()
        );
        // Timeout, happy path and at-exit all call this; any of the three may
        // be second.
        shred(&path).unwrap();
    }

    /// Two launches must not collide, and the name must not be guessable.
    #[test]
    fn each_launch_file_gets_its_own_random_name() {
        let scratch = Scratch::new("names");
        let a = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        let b = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        assert_ne!(a, b);
        for p in [&a, &b] {
            let stem = p.file_stem().unwrap().to_string_lossy().into_owned();
            assert_eq!(stem.len(), 16, "{stem}");
            assert!(stem.chars().all(|c| c.is_ascii_hexdigit()), "{stem}");
        }
        shred(&a).unwrap();
        shred(&b).unwrap();
    }

    /// The at-exit backstop, and the reason it is a sweep on the way in rather
    /// than a promise on the way out.
    #[test]
    fn a_sweep_removes_launch_files_a_killed_run_left_behind() {
        let scratch = Scratch::new("sweep");
        let a = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        let b = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        // Something that is not ours, in the same directory, must survive.
        let bystander = scratch.0.join("notes.txt");
        std::fs::write(&bystander, b"keep me").unwrap();

        assert_eq!(sweep_in(&scratch.0).unwrap(), 2);
        assert!(std::fs::metadata(&a).is_err());
        assert!(std::fs::metadata(&b).is_err());
        assert!(std::fs::metadata(&bystander).is_ok(), "swept a bystander");

        // A second sweep finds nothing and says zero, rather than erroring.
        assert_eq!(sweep_in(&scratch.0).unwrap(), 0);

        // A directory that never existed is zero, not an error - a fresh
        // install has never launched.
        assert_eq!(sweep_in(&scratch.0.join("never")).unwrap(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_created_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let scratch = Scratch::new("mode");
        let path = write_temp_in(&scratch.0, &dr_fields()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{mode:o}");
    }
}
