//! Read and, as of 29 Aug 2026, write the config a player already has.
//!
//! The fastest way to lose somebody moving off Genie is to ask them to retype
//! years of `#highlight` lines. So the client reads Genie's own files where it
//! finds them, and the corpus this project authored in `dr-genie-settings`
//! installs to exactly that place, which means both cases are one code path.
//!
//! # Read-only no longer, on purpose, and the risk that reverses
//!
//! This module used to say, flatly, that it never writes into a Genie
//! install: those files belong to a program the player may still be using,
//! and a client that edits another client's config is one bad release away
//! from destroying settings it did not create. That risk has not gone away -
//! `write_genie_config` below reverses the policy because Dan asked for
//! in-app editing of highlights and aliases (29 Aug 2026: "add their own,
//! delete or change yours"), not because the risk stopped being real.
//!
//! So the write path carries what the read-only version didn't need:
//!
//! - **A permanent backup, made once.** The first time a given leaf is ever
//!   written through this module, whatever was on disk before that write is
//!   copied to `<leaf>.bak` - and only if `.bak` does not already exist, so
//!   it always holds the file as it stood before this app touched it, never
//!   a more recent "oops" that itself needs undoing. `restore_genie_config`
//!   is the other half.
//! - **Atomic write.** Same temp-file-then-rename shape as
//!   `scripts.rs::write_script` - an interrupted save cannot leave a
//!   half-written config where a whole one was.
//! - **No creating a Genie install that is not there.** A `leaf` that does
//!   not exist yet is only ever created inside a `Config` directory that
//!   already exists - see `writable_target`'s own comment.

use std::path::{Path, PathBuf};

use serde::Serialize;


#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    /// Where it was found. Empty when nothing was.
    pub path: String,
    pub text: String,
    /// Whether a file was actually read. False means "not found", which is not
    /// the same as "found and empty" - one is a player with no config yet and
    /// the other is a player whose config just got truncated.
    pub found: bool,
    pub note: String,
}

/// Everywhere a Genie config plausibly lives.
///
/// Built from `setup::genie_roots()` - the same root list `sounds.rs` builds
/// `Sounds` paths from - so the two can never independently drift about
/// where "Genie" means again. See that function's own comment for the gap
/// this closed.
fn candidates(leaf: &str) -> Vec<PathBuf> {
    crate::setup::genie_roots()
        .into_iter()
        .map(|root| root.join("Config").join(leaf))
        .collect()
}

/// A Genie config file by name, or an honest account of not finding one.
///
/// The leaf is checked rather than trusted. It arrives from the webview and is
/// joined onto a directory, and nothing legitimate needs a separator or a dot
/// segment in it - the app asks for `highlights.cfg`, not for a path.
#[tauri::command]
pub fn read_genie_config(leaf: String) -> ConfigFile {
    if !crate::sounds::valid_plain_filename(&leaf, 64) {
        return ConfigFile {
            note: format!("{leaf:?} is not a config file name"),
            ..Default::default()
        };
    }

    let tried = candidates(&leaf);
    for p in &tried {
        if !p.is_file() {
            continue;
        }
        match std::fs::read_to_string(p) {
            Ok(text) => {
                return ConfigFile {
                    path: p.to_string_lossy().into_owned(),
                    text,
                    found: true,
                    note: String::new(),
                }
            }
            Err(e) => {
                // Present but unreadable is its own answer. Reporting it as
                // "not found" would send somebody looking for a file that is
                // sitting right there.
                return ConfigFile {
                    path: p.to_string_lossy().into_owned(),
                    found: false,
                    note: format!("{} exists but could not be read: {e}", p.display()),
                    ..Default::default()
                };
            }
        }
    }

    ConfigFile {
        found: false,
        note: format!("No {leaf} found. Looked in {} places.", tried.len()),
        ..Default::default()
    }
}

/// Big enough for any highlights or aliases config anybody would hand-write or
/// this editor would grow to - Dan's real `aliases.cfg` (356 stock aliases
/// plus whatever he added) is a fraction of this. Small enough that a mistake
/// cannot write a film into somebody's Genie folder.
const MAX_WRITE_BYTES: usize = 2 * 1024 * 1024;

/// Where a write should land: the existing file if one was found by the same
/// search `read_genie_config` uses, or - only if nothing exists yet - a new
/// file inside the *first* candidate directory that already exists as a
/// `Config` folder.
///
/// The second branch is what keeps this from fabricating a Genie install for
/// somebody who does not have one: it will start a fresh `highlights.cfg`
/// next to a real `aliases.cfg` it just read, but it will not create the
/// `Config` directory itself. `genie_install_dir()` on a machine with no
/// Genie resolves to a path that simply does not exist, so this correctly
/// finds nothing and the caller reports that rather than writing anywhere.
fn writable_target(leaf: &str) -> Result<PathBuf, String> {
    let tried = candidates(leaf);

    for p in &tried {
        if p.is_file() {
            return Ok(p.clone());
        }
    }
    for p in &tried {
        if let Some(dir) = p.parent() {
            if dir.is_dir() {
                return Ok(p.clone());
            }
        }
    }

    Err(format!(
        "No Genie Config folder found to write {leaf} into. Looked in {} places.",
        tried.len()
    ))
}

/// `path` with a suffix appended to the whole file name, not substituted for
/// its extension - `with_extension` treats everything after the first dot in
/// a name like `highlights.cfg` as replaceable, which for a suffix like
/// `.bak` means reasoning about what the "real" extension was first. Appending
/// to the raw `OsString` has no such edge case: `highlights.cfg` plus `.bak`
/// is unambiguously `highlights.cfg.bak`.
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

/// Back up (once) and atomically overwrite `path` with `text`. Returns
/// whether a `.bak` exists afterward. Pure and path-injectable on purpose,
/// separate from `write_genie_config`, so a test can exercise the exact
/// backup/atomic-write sequence a save actually runs against a throwaway
/// temp-dir file - never against a real Genie install, which is the one
/// thing this whole module exists to protect.
fn save_atomically(path: &Path, text: &[u8]) -> std::io::Result<bool> {
    backup_once(path)?;
    let tmp = sibling(path, ".tmp-save");
    std::fs::write(&tmp, text)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(sibling(path, ".bak").is_file())
}

/// Restore `path` from its `.bak`, atomically. Same reasoning as
/// `save_atomically` for being pure and separately testable.
fn restore_atomically(path: &Path) -> std::io::Result<()> {
    let backup = sibling(path, ".bak");
    let tmp = sibling(path, ".tmp-restore");
    std::fs::copy(&backup, &tmp)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    /// Whether a `.bak` of the pre-edit file now exists (whether made just
    /// now or already there from an earlier save) - so the UI can tell a
    /// player "your original is saved" honestly rather than always claiming
    /// it, since a brand-new file has no "before" to back up.
    pub backed_up: bool,
}

/// Write a Genie config file back, atomically, backing up the pre-edit
/// version the first time this leaf is ever saved.
///
/// The leaf is validated exactly as `read_genie_config` validates it - same
/// charset, same device-name refusal - because the same string is about to be
/// joined onto a directory and this time the result gets written to, not just
/// read, which is the more dangerous direction to get wrong.
#[tauri::command]
pub fn write_genie_config(leaf: String, text: String) -> Result<WriteResult, String> {
    if !crate::sounds::valid_plain_filename(&leaf, 64) {
        return Err(format!("{leaf:?} is not a config file name"));
    }
    if text.len() > MAX_WRITE_BYTES {
        return Err(format!(
            "That config is larger than {MAX_WRITE_BYTES} bytes - too big to be this file."
        ));
    }

    let path = writable_target(&leaf)?;
    let backed_up = save_atomically(&path, text.as_bytes())
        .map_err(|e| format!("Could not save {leaf}: {e}"))?;

    Ok(WriteResult {
        path: path.to_string_lossy().into_owned(),
        backed_up,
    })
}

/// Undo every change this app has made to a leaf, by restoring its `.bak`.
///
/// Refuses when there is no backup rather than silently doing nothing - a
/// player pressing "restore original" needs to know whether it happened, and
/// "nothing to restore" and "restored" read identically to a caller that only
/// checks for an error being absent.
#[tauri::command]
pub fn restore_genie_config(leaf: String) -> Result<WriteResult, String> {
    if !crate::sounds::valid_plain_filename(&leaf, 64) {
        return Err(format!("{leaf:?} is not a config file name"));
    }

    let path = writable_target(&leaf)?;
    if !sibling(&path, ".bak").is_file() {
        return Err(format!(
            "No backup of {leaf} exists - nothing has been saved through this editor yet."
        ));
    }
    restore_atomically(&path).map_err(|e| format!("Could not restore {leaf}: {e}"))?;

    Ok(WriteResult {
        path: path.to_string_lossy().into_owned(),
        backed_up: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, uniquely-named file inside the OS temp directory - never
    /// anywhere near a real Genie install. `writable_target`/`candidates`
    /// (the part of this module that resolves *where* Genie lives) are
    /// deliberately not exercised by these tests at all; `save_atomically`
    /// and `restore_atomically` take a path directly; that's what's tested.
    fn temp_path(unique: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "drc-config-write-test-{unique}-{}",
            std::process::id()
        ))
    }

    fn cleanup(path: &Path) {
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(sibling(path, ".bak"));
        let _ = std::fs::remove_file(sibling(path, ".tmp-save"));
        let _ = std::fs::remove_file(sibling(path, ".tmp-restore"));
    }

    #[test]
    fn sibling_appends_rather_than_replacing_the_extension() {
        let p = PathBuf::from("C:\\Genie4\\Config\\highlights.cfg");
        assert_eq!(
            sibling(&p, ".bak"),
            PathBuf::from("C:\\Genie4\\Config\\highlights.cfg.bak")
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
        // "original content", not "edit one". This is the property the
        // whole design exists for: the backup is the file as it stood before
        // this app ever touched it, not a rolling "one save ago" copy.
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

    #[test]
    fn restore_puts_the_backup_content_back_and_leaves_no_leftover_temp_file() {
        let path = temp_path("restore-roundtrip");
        cleanup(&path);
        std::fs::write(&path, b"original").unwrap();
        save_atomically(&path, b"edited").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "edited");

        restore_atomically(&path).unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "original",
            "restore must put the pre-edit content back"
        );
        assert!(!sibling(&path, ".tmp-restore").exists());
        // The backup itself survives a restore - restoring twice, or editing
        // again after restoring, must still have something to roll back to.
        assert!(sibling(&path, ".bak").is_file());

        cleanup(&path);
    }

    #[test]
    fn write_genie_config_refuses_bad_names_the_same_way_read_does() {
        for bad in ["../evil.cfg", "sub/x.cfg", "CON.cfg", ""] {
            let err = write_genie_config(bad.into(), "text".into())
                .expect_err(&format!("{bad:?} must be refused"));
            assert!(
                err.contains("not a config file name"),
                "{bad:?} gave {err:?}"
            );
        }
    }

    #[test]
    fn write_genie_config_refuses_a_config_larger_than_the_cap() {
        let huge = "x".repeat(MAX_WRITE_BYTES + 1);
        let err = write_genie_config("highlights.cfg".into(), huge)
            .expect_err("an oversized config must be refused");
        assert!(err.contains("larger than"), "got {err:?}");
    }

    /// The name is joined onto a directory, so it does not get to be a path.
    #[test]
    fn refuses_anything_that_is_not_a_plain_file_name() {
        for bad in [
            "../../../Windows/System32/drivers/etc/hosts",
            "..\\secrets.txt",
            "sub/dir.cfg",
            "sub\\dir.cfg",
            "",
        ] {
            let got = read_genie_config(bad.into());
            assert!(!got.found, "{bad:?} must not be read");
            assert!(
                got.note.contains("not a config file name") || got.note.contains("No "),
                "{bad:?} gave {:?}",
                got.note
            );
        }
    }

    /// Device names and dot-dot, the same two edges as `sounds.rs`.
    ///
    /// `CON.cfg` passes any charset check and Windows resolves it as a device;
    /// reading `CON` blocks on console input, which presents as the app
    /// hanging. And `my..config.cfg` is a legitimate filename that a substring
    /// check for ".." refused - a false refusal reads as a corrupt file.
    #[test]
    fn device_names_are_refused_and_inner_dots_are_not() {
        for device in ["CON.cfg", "nul.cfg", "COM1.cfg", "AUX.cfg"] {
            let got = read_genie_config(device.into());
            assert!(!got.found, "{device:?} must not be opened");
            assert!(
                got.note.contains("not a config file name"),
                "{device:?} should be refused by name, got {:?}",
                got.note
            );
        }

        // Refused as directories, not because of the dots.
        assert!(read_genie_config("..".into())
            .note
            .contains("not a config file name"));

        // And a legitimate name with dots in it passes validation. It will not
        // be found, but the reason must be "no such file", not "bad name".
        let ok = read_genie_config("my..config.cfg".into());
        assert!(
            ok.note.starts_with("No my..config.cfg found"),
            "a legitimate name was refused by shape: {:?}",
            ok.note
        );
    }

    /// Not found and found-but-empty are different, and the caller renders
    /// them differently: one is a player who has no config yet, the other is a
    /// config that just lost its contents.
    #[test]
    fn missing_is_not_the_same_as_empty() {
        let got = read_genie_config("definitely-not-there-9f3a.cfg".into());
        assert!(!got.found);
        assert!(got.text.is_empty());
        assert!(
            got.note.contains("No definitely-not-there"),
            "the note has to say what was looked for: {:?}",
            got.note
        );
    }
}
