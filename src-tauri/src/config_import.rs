//! Read the config a player already has.
//!
//! The fastest way to lose somebody moving off Genie is to ask them to retype
//! years of `#highlight` lines. So the client reads Genie's own files where it
//! finds them, and the corpus this project authored in `dr-genie-settings`
//! installs to exactly that place, which means both cases are one code path.
//!
//! Read-only, on purpose. This never writes into a Genie install: those files
//! belong to a program the player may still be using, and a client that edits
//! another client's config is one bad release away from destroying settings it
//! did not create.

use std::path::PathBuf;

use serde::Serialize;

use crate::setup::genie_install_dir;

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
/// The install directory is asked first because `setup.rs` already does the
/// work of finding it, including the layouts people actually have rather than
/// the one the installer documents.
fn candidates(leaf: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(genie_install_dir().join("Config").join(leaf));
    for root in ["C:\\Genie4", "C:\\Genie", "C:\\Program Files (x86)\\Genie4"] {
        out.push(PathBuf::from(root).join("Config").join(leaf));
    }
    if let Some(home) = std::env::var_os("USERPROFILE") {
        out.push(PathBuf::from(home).join("Genie4").join("Config").join(leaf));
    }
    out
}

/// A Genie config file by name, or an honest account of not finding one.
///
/// The leaf is checked rather than trusted. It arrives from the webview and is
/// joined onto a directory, and nothing legitimate needs a separator or a dot
/// segment in it - the app asks for `highlights.cfg`, not for a path.
#[tauri::command]
pub fn read_genie_config(leaf: String) -> ConfigFile {
    // The charset does the work: no '/', no '\', no ':', nothing non-ASCII,
    // which forecloses separators, absolute paths, drive letters, UNC paths
    // and alternate data streams in one line.
    //
    // Dot-dot is checked as an exact name rather than as a substring. It was a
    // substring, which would have refused a legitimate `my..config.cfg` - a
    // false refusal that reads to somebody as a corrupt file. Only the exact
    // relative-directory names can do anything.
    //
    // Reserved device names are refused too. `CON.cfg` and `NUL.cfg` pass any
    // charset check and Windows resolves them as devices; reading `CON` blocks
    // on console input, which presents as the app hanging rather than failing.
    if leaf.is_empty()
        || leaf.len() > 64
        || leaf == ".."
        || leaf == "."
        || !leaf
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        || crate::sounds::is_reserved_device(&leaf)
    {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(read_genie_config("..".into()).note.contains("not a config file name"));

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
