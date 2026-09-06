//! The player's own files, in the app's own data directory.
//!
//! Everything this app writes on the player's behalf - the pin export, and
//! from Q6 the whole-store JSON document - lands in
//! `setup::app_data_dir()/config`, and nowhere else. That is question N-c of
//! `docs/PLAN_TO_1_0.md`, answered in `docs/PLAYER_CONFIG.md` §8: pins are app
//! data.
//!
//! # Why this module exists at all
//!
//! It used to be `config_import.rs`'s `write_genie_config`, which wrote into a
//! *Genie* install's `Config` directory. Two things were wrong with that by
//! 6 Sep 2026. The app no longer routes through Genie, so a player may have no
//! such directory at all and the export button then fails with "No Genie
//! Config folder found" - a button that cannot work on a clean install. And a
//! client that writes into another client's config directory is one bad
//! release away from destroying settings it did not create, which is the
//! policy `config_import.rs`'s header held until 29 Aug 2026 and lost.
//!
//! So the write path moved here and the Genie one was deleted rather than
//! left beside it. **The app now writes nothing into a Genie install**, and
//! `tools/doc-claims-test.mjs` asserts it rather than this paragraph merely
//! claiming it.
//!
//! # What moved, and what is new
//!
//! `sibling`, `backup_once`, `save_atomically` and `matches_on_disk` are
//! `config_import.rs`'s, moved here with their tests - not copied. The
//! guarantees they carry are unchanged and still the reason to read them:
//!
//! - **A permanent backup, made once.** The first time a given leaf is ever
//!   written through this module, whatever was on disk before is copied to
//!   `<leaf>.bak`, and only if `.bak` does not already exist - so it always
//!   holds the file as it stood before this app touched it, never a more
//!   recent "oops" that itself needs undoing.
//! - **Atomic write.** Temp file then rename, the same shape as
//!   `scripts.rs::write_script`: an interrupted save cannot leave a
//!   half-written file where a whole one was.
//! - **Compare-and-swap.** `expected_previous` is the text the caller's write
//!   was built from. If the file no longer matches it, something else touched
//!   it since - another window of this app, a text editor - and writing anyway
//!   would silently discard that. This refuses instead. `config_import.rs`
//!   recorded having no caller for it as a downgrade; the pin export passes it
//!   now, so two windows cannot clobber each other.
//!
//! New here: the root is ours rather than somebody else's, so
//! `writable_target`'s "do not fabricate a Genie install" dance is gone -
//! `player_config_dir()` is created if it does not exist, because it is our
//! own directory to create.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Where the player's own files live: `app_data_dir()/config`.
///
/// Under `app_data_dir()` rather than beside the executable for the reason
/// `setup::app_data_dir` gives at length - an uninstall must not take a
/// player's data with it.
pub fn player_config_dir() -> PathBuf {
    crate::setup::app_data_dir().join("config")
}

/// Big enough for any pin file or whole-store export anybody would produce -
/// the largest real Genie `aliases.cfg` on this machine is a fraction of it.
/// Small enough that a mistake cannot write a film into the player's data.
const MAX_PLAYER_FILE_BYTES: usize = 8 * 1024 * 1024;

/// A leaf resolved against `player_config_dir()`, or a refusal by name.
///
/// The leaf arrives from the webview and is joined onto a directory, so it is
/// checked rather than trusted - the same `sounds::valid_plain_filename` check
/// `read_genie_config` uses, which refuses separators, dot segments and
/// Windows device names. Nothing legitimate needs any of them: the app asks
/// for `dr-companion-pins.yaml`, not for a path.
fn resolve(leaf: &str) -> Result<PathBuf, String> {
    if !crate::sounds::valid_plain_filename(leaf, 64) {
        return Err(format!("{leaf:?} is not a player file name"));
    }
    Ok(player_config_dir().join(leaf))
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlayerFile {
    /// Where it was looked for - filled in whether or not it was found, so
    /// "where would it be" always has an answer to show.
    pub path: String,
    pub text: String,
    /// Whether a file was actually read. False means "not there", which is not
    /// the same as "there and empty" - one is a player who has never exported,
    /// the other is an export that just lost its contents.
    pub found: bool,
    pub note: String,
}

/// Read one of the player's own files, or an honest account of not finding it.
#[tauri::command]
pub fn read_player_file(leaf: String) -> PlayerFile {
    let path = match resolve(&leaf) {
        Ok(p) => p,
        Err(note) => {
            return PlayerFile {
                note,
                ..Default::default()
            }
        }
    };
    let shown = path.to_string_lossy().into_owned();
    if !path.is_file() {
        return PlayerFile {
            path: shown,
            note: format!("No {leaf} saved yet."),
            ..Default::default()
        };
    }
    match std::fs::read_to_string(&path) {
        Ok(text) => PlayerFile {
            path: shown,
            text,
            found: true,
            note: String::new(),
        },
        // Present but unreadable is its own answer. Reporting it as "not
        // there" would send somebody looking for a file that is sitting right
        // where the path says.
        Err(e) => PlayerFile {
            note: format!("{shown} exists but could not be read: {e}"),
            path: shown,
            ..Default::default()
        },
    }
}

/// `path` with a suffix appended to the whole file name, not substituted for
/// its extension - `with_extension` treats everything after the first dot in a
/// name like `dr-companion-pins.yaml` as replaceable, which for a suffix like
/// `.bak` means reasoning about what the "real" extension was first. Appending
/// to the raw `OsString` has no such edge case.
fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Copy `path` to a sibling `<name>.bak`, but only the first time - a `.bak`
/// that already exists is left alone, because it holds the file as it stood
/// before this app ever touched it, which is the one copy worth never
/// overwriting. Not an error if `path` itself does not exist yet (a brand new
/// file has nothing to back up) or if the backup already exists.
fn backup_once(path: &Path) -> std::io::Result<()> {
    if !path.is_file() {
        return Ok(());
    }
    let backup = sibling(path, ".bak");
    if backup.is_file() {
        return Ok(());
    }
    std::fs::copy(path, &backup)?;
    Ok(())
}

/// Back up (once) and atomically overwrite `path` with `text`. Returns whether
/// a `.bak` exists afterward. Pure and path-injectable on purpose, separate
/// from `write_player_file`, so a test can exercise the exact
/// backup/atomic-write sequence a save actually runs against a throwaway
/// temp-dir file rather than the real data directory.
fn save_atomically(path: &Path, text: &[u8]) -> std::io::Result<bool> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    backup_once(path)?;
    let tmp = sibling(path, ".tmp-save");
    std::fs::write(&tmp, text)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(sibling(path, ".bak").is_file())
}

/// Whether `expected` still matches what a fresh read of `path` finds - the
/// property `write_player_file` refuses to write past. A missing file and an
/// empty `expected` agree with each other (both read as `""`), which is
/// correct: a file the caller never found and a file that still does not exist
/// have nothing to conflict about.
fn matches_on_disk(path: &Path, expected: &str) -> bool {
    std::fs::read_to_string(path).unwrap_or_default() == expected
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    /// Whether a `.bak` of the pre-write file now exists (whether made just
    /// now or already there from an earlier save) - so the UI can tell a
    /// player "your previous version is saved" honestly rather than always
    /// claiming it, since a brand-new file has no "before" to back up.
    pub backed_up: bool,
}

/// Write one of the player's own files, atomically, backing up whatever was
/// there the first time this leaf is ever written.
///
/// `expected_previous`, when given, is the text this write was built from -
/// the last thing the caller either read or wrote. If the file on disk no
/// longer matches it, another window of this app or a text editor has changed
/// it since, and writing anyway would silently discard that change with
/// nothing to show for it afterward. So this refuses, and the message names
/// what happened rather than an error code: a caller that only checks for an
/// error being absent needs the failure to actually surface as one.
#[tauri::command]
pub fn write_player_file(
    leaf: String,
    text: String,
    expected_previous: Option<String>,
) -> Result<WriteResult, String> {
    let path = resolve(&leaf)?;
    if text.len() > MAX_PLAYER_FILE_BYTES {
        return Err(format!(
            "That file is larger than {MAX_PLAYER_FILE_BYTES} bytes - too big to be this file."
        ));
    }

    if let Some(expected) = &expected_previous {
        if !matches_on_disk(&path, expected) {
            return Err(format!(
                "{leaf} changed since this window last read it - another window of this app, or \
                 a text editor, has written to it since. Reload to see the current version \
                 before saving here, or your change would silently overwrite it."
            ));
        }
    }

    let backed_up = save_atomically(&path, text.as_bytes())
        .map_err(|e| format!("Could not save {leaf}: {e}"))?;

    Ok(WriteResult {
        path: path.to_string_lossy().into_owned(),
        backed_up,
    })
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdoptResult {
    pub adopted: bool,
    /// Where the file was copied from, when one was. Empty otherwise.
    pub from: String,
    /// Where it now lives, or would.
    pub path: String,
    pub note: String,
}

/// One-way migration for a player who already has a file of this name in a
/// Genie `Config` folder from before the move.
///
/// It runs only when the app-data copy does **not** exist: an existing copy is
/// the player's current file and adopting over it would destroy work done
/// since the move. And the Genie copy is **left where it is** - deleting
/// somebody's file to tidy up is not a migration.
///
/// This is the only remaining route by which a Genie file reaches app data,
/// and it reads. Nothing here writes into a Genie install.
#[tauri::command]
pub fn adopt_genie_file(leaf: String) -> Result<AdoptResult, String> {
    let path = resolve(&leaf)?;
    let shown = path.to_string_lossy().into_owned();
    if path.is_file() {
        return Ok(AdoptResult {
            path: shown,
            note: format!("{leaf} is already in your DR Companion data folder."),
            ..Default::default()
        });
    }
    let found = crate::config_import::read_genie_config(leaf.clone());
    if !found.found {
        return Ok(AdoptResult {
            path: shown,
            note: found.note,
            ..Default::default()
        });
    }
    save_atomically(&path, found.text.as_bytes())
        .map_err(|e| format!("Could not copy {leaf} into your data folder: {e}"))?;
    Ok(AdoptResult {
        adopted: true,
        note: format!(
            "Copied {leaf} from {} into your DR Companion data folder. The Genie copy is still there.",
            found.path
        ),
        from: found.path,
        path: shown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, uniquely-named file inside the OS temp directory - never the
    /// real data directory. `resolve`/`player_config_dir` (the part of this
    /// module that decides *where*) are exercised by their own cases below;
    /// `save_atomically` takes a path directly, and that is what these test.
    fn temp_path(unique: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "drc-player-file-test-{unique}-{}",
            std::process::id()
        ))
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(sibling(path, ".bak"));
        let _ = std::fs::remove_file(sibling(path, ".tmp-save"));
    }

    #[test]
    fn matches_on_disk_catches_a_change_made_outside_this_window() {
        let path = temp_path("conflict-detection");
        cleanup(&path);
        std::fs::write(&path, b"loaded by this window").unwrap();

        assert!(
            matches_on_disk(&path, "loaded by this window"),
            "nothing has touched the file yet, so it must still match"
        );

        // The exact scenario this exists for: something other than this window
        // - a second window of this app, a text editor - writes to the file in
        // between the read and the save.
        std::fs::write(&path, b"edited by something else in the meantime").unwrap();

        assert!(
            !matches_on_disk(&path, "loaded by this window"),
            "an external edit must be detected, not silently overwritten"
        );

        cleanup(&path);
    }

    #[test]
    fn matches_on_disk_treats_a_missing_file_as_the_empty_string() {
        let path = temp_path("conflict-detection-missing");
        cleanup(&path);
        assert!(!path.exists());

        // A first-ever export: the caller read nothing (read_player_file
        // reports found:false, text:""), so its own "expected previous" is "".
        assert!(
            matches_on_disk(&path, ""),
            "no file and an empty expectation must agree - both mean nothing existed yet"
        );

        // But if something created the file in the meantime, that is exactly
        // as much a conflict as an edit to an existing one.
        std::fs::write(&path, b"created by something else").unwrap();
        assert!(!matches_on_disk(&path, ""));

        cleanup(&path);
    }

    #[test]
    fn sibling_appends_rather_than_replacing_the_extension() {
        let p = PathBuf::from("C:\\data\\config\\dr-companion-pins.yaml");
        assert_eq!(
            sibling(&p, ".bak"),
            PathBuf::from("C:\\data\\config\\dr-companion-pins.yaml.bak")
        );
    }

    #[test]
    fn first_save_backs_up_the_original_second_save_does_not_overwrite_it() {
        let path = temp_path("first-save-backs-up");
        cleanup(&path);
        std::fs::write(&path, b"original content").unwrap();

        let backed_up_1 = save_atomically(&path, b"edit one").unwrap();
        assert!(backed_up_1, "the first save must produce a backup");
        let backup = sibling(&path, ".bak");
        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "original content"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edit one");

        // A second save must NOT touch the backup - it still has to read
        // "original content", not "edit one". This is the property the whole
        // design exists for: the backup is the file as it stood before this
        // app ever touched it, not a rolling "one save ago" copy.
        let backed_up_2 = save_atomically(&path, b"edit two").unwrap();
        assert!(backed_up_2);
        assert_eq!(
            std::fs::read_to_string(&backup).unwrap(),
            "original content",
            "the second save overwrote the backup - it must stay the pre-edit original"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edit two");

        cleanup(&path);
    }

    #[test]
    fn saving_a_brand_new_file_reports_no_backup() {
        let path = temp_path("brand-new-file");
        cleanup(&path);
        assert!(!path.exists());

        let backed_up = save_atomically(&path, b"first ever content").unwrap();
        assert!(
            !backed_up,
            "a file that did not exist before has nothing to back up"
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "first ever content"
        );

        cleanup(&path);
    }

    #[test]
    fn save_leaves_no_leftover_temp_file() {
        let path = temp_path("no-leftover-tmp");
        cleanup(&path);
        std::fs::write(&path, b"before").unwrap();

        save_atomically(&path, b"after").unwrap();

        assert!(
            !sibling(&path, ".tmp-save").exists(),
            "the atomic rename should leave no .tmp-save behind"
        );
        cleanup(&path);
    }

    /// The leaf is joined onto a directory, so it does not get to be a path.
    /// This is the case that keeps a write inside `app_data_dir()/config`:
    /// anything that would escape it is refused by name, before any path is
    /// built, and the refusal says which name.
    #[test]
    fn a_leaf_that_would_escape_the_config_directory_is_refused_by_name() {
        for bad in [
            "../evil.yaml",
            "..\\evil.yaml",
            "sub/x.yaml",
            "sub\\x.yaml",
            "../../../Windows/System32/drivers/etc/hosts",
            "..",
            ".",
            "CON.yaml",
            "nul.yaml",
            "COM1.yaml",
            "",
        ] {
            let err = resolve(bad).expect_err("this leaf must be refused");
            assert!(
                err.contains("is not a player file name"),
                "{bad:?} gave {err:?}"
            );

            // And through the two commands, not only the private helper -
            // a refusal that only the helper makes is a refusal the webview
            // never meets.
            let err = write_player_file(bad.into(), "text".into(), None)
                .expect_err("a write to this leaf must be refused");
            assert!(err.contains("is not a player file name"), "{bad:?} {err:?}");
            let got = read_player_file(bad.into());
            assert!(!got.found, "{bad:?} must not be read");
            assert!(
                got.note.contains("is not a player file name"),
                "{bad:?} gave {:?}",
                got.note
            );
        }

        // Control: a legitimate leaf resolves, and lands inside the config
        // directory rather than anywhere else. Without this the loop above
        // would pass just as well against a `resolve` that refused everything.
        let good = resolve("dr-companion-pins.yaml").expect("a plain leaf must resolve");
        assert_eq!(good.parent(), Some(player_config_dir().as_path()));
        assert!(
            resolve("my..pins.yaml").is_ok(),
            "inner dots are legitimate"
        );
    }

    #[test]
    fn write_player_file_refuses_a_file_larger_than_the_cap() {
        let huge = "x".repeat(MAX_PLAYER_FILE_BYTES + 1);
        let err = write_player_file("oversize-test.yaml".into(), huge, None)
            .expect_err("an oversized file must be refused");
        assert!(err.contains("larger than"), "got {err:?}");
    }

    /// The compare-and-swap, end to end through the command, in the real data
    /// directory - two windows racing on one file is what it exists for, so
    /// the test is two writers against one leaf.
    #[test]
    fn a_stale_expected_previous_is_refused_and_the_other_windows_write_survives() {
        let leaf = format!("drc-cas-test-{}.yaml", std::process::id());
        let path = player_config_dir().join(&leaf);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(sibling(&path, ".bak"));

        // Both windows read the same starting state: nothing there.
        let before = read_player_file(leaf.clone());
        assert!(!before.found);

        // Window A writes first, and succeeds.
        write_player_file(
            leaf.clone(),
            "window A's pins".into(),
            Some(before.text.clone()),
        )
        .expect("the first writer must succeed");

        // Window B still holds the state it read before A wrote.
        let err = write_player_file(leaf.clone(), "window B's pins".into(), Some(before.text))
            .expect_err("a stale expectation must be refused, not silently written");
        assert!(
            err.contains("changed since this window last read it"),
            "got {err:?}"
        );

        // And the refusal is real: A's write is still on disk.
        assert_eq!(read_player_file(leaf.clone()).text, "window A's pins");

        // B reloads and its write then goes through - a refusal must be
        // recoverable, not a dead end.
        let fresh = read_player_file(leaf.clone());
        let result = write_player_file(leaf.clone(), "window B's pins".into(), Some(fresh.text))
            .expect("after reloading, B's write must succeed");
        assert!(
            result.backed_up,
            "overwriting an existing file must leave a backup of it"
        );
        assert_eq!(
            std::fs::read_to_string(sibling(&path, ".bak")).unwrap(),
            "window A's pins"
        );
        assert_eq!(read_player_file(leaf).text, "window B's pins");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(sibling(&path, ".bak"));
    }

    /// The migration refuses to touch an app-data copy that already exists.
    /// Overwriting it would destroy whatever the player has done since the
    /// move, which is the one thing a migration must not do.
    #[test]
    fn adopting_never_overwrites_a_file_that_is_already_here() {
        let leaf = format!("drc-adopt-test-{}.yaml", std::process::id());
        let path = player_config_dir().join(&leaf);
        std::fs::create_dir_all(player_config_dir()).unwrap();
        std::fs::write(&path, b"the player's current pins").unwrap();

        let got = adopt_genie_file(leaf.clone()).expect("an existing copy is not an error");
        assert!(
            !got.adopted,
            "an existing app-data copy must not be adopted over"
        );
        assert!(
            got.note
                .contains("already in your DR Companion data folder"),
            "{:?}",
            got.note
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "the player's current pins",
            "the migration overwrote a file it was supposed to leave alone"
        );

        // Control: with the file gone, the same call gets past that guard and
        // reports on the Genie side instead - so the check above is measuring
        // the guard rather than a call that never does anything.
        let _ = std::fs::remove_file(&path);
        let got = adopt_genie_file(leaf).expect("a missing Genie file is not an error either");
        assert!(!got.adopted);
        assert!(
            !got.note
                .contains("already in your DR Companion data folder"),
            "the existing-copy guard fired with no file present: {:?}",
            got.note
        );
        let _ = std::fs::remove_file(&path);
    }
}
