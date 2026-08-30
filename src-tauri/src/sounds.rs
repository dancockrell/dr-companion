//! The sound files a highlight names.
//!
//! Genie's config says `{Help.wav}` and means a file in the directory
//! `#config {sounddir}` points at. The webview cannot open a file off the disk,
//! so the bytes come through here and are played in the page.
//!
//! # Why bytes rather than a file URL
//!
//! Tauri can serve local files through an asset protocol, which would be less
//! code and would mean granting the webview a path into the filesystem that is
//! open for the life of the process. These are six small WAVs read once and
//! cached in the page. Handing over a directory to avoid reading six files is
//! a poor trade.
//!
//! # Read-only, and only sounds
//!
//! Same rule as `config_import`: the player's Genie install is another
//! program's data. This reads, never writes, and refuses anything that is not
//! a plain audio filename - the name arrives from the webview and is joined
//! onto a directory, so it does not get to be a path.

use std::path::PathBuf;

use serde::Serialize;

/// Base64, by hand.
///
/// The crate is in the lock file transitively but is not a direct dependency,
/// and adding one to encode six small files is a poor trade - especially on a
/// machine where the linker is already fragile. Twenty lines with a test
/// against the RFC 4648 vectors is cheaper than a supply chain.
fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);

        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        // The tail is padded rather than truncated. A decoder given an
        // unpadded stream is entitled to reject it, and a data: URL that some
        // browsers accept and others do not is the worst kind of bug.
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Windows device names, which are files everywhere except Windows.
///
/// `NUL.wav`, `CON.wav`, `COM1.wav` and `AUX.mp3` all pass an
/// `[A-Za-z0-9._-]` charset, and Windows resolves a device name with an
/// extension appended - so these are not caught by any of the checks that
/// stop traversal. Opening `CON` for reading blocks on console input, which
/// would be a hang rather than a crash: the worst shape, because it looks
/// like the app is thinking.
///
/// A red-team pass established that `p.is_file()` already stops all of them,
/// and that the guard is real rather than vacuous - `win.ini` returns true
/// against the same check, so the falses mean something.
///
/// This is here anyway, because "it happens to be safe" and "it cannot happen"
/// are different, and the thing standing between them is a refactor nobody has
/// written yet. Rejecting by name survives someone dropping the `is_file`
/// call; relying on `is_file` does not.
pub(crate) fn is_reserved_device(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();

    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
}

/// Whether `name` is safe to join onto a directory and read: a bare filename,
/// not a path.
///
/// Used by both `read_sound` and `read_genie_config`, which used to each
/// carry their own copy of this exact check - length bound, exact `".."`/`"."`
/// rejection (not a substring match, which would refuse a legitimate
/// `my..config.cfg`), an ASCII-alphanumeric-plus-`.-_` charset (the charset is
/// what actually forecloses traversal: no `/`, `\`, `:`, or non-ASCII, so a
/// separator, an absolute path, a drive letter, a UNC path or an alternate
/// data stream are all impossible in one line), and a reserved-device check
/// (`CON.cfg`/`NUL.cfg` pass the charset check and Windows resolves them as
/// devices - reading `CON` blocks on console input, which presents as the app
/// hanging rather than failing). Two copies meant a future fix to one - this
/// exact logic has already needed one, the dot-dot substring bug above - was
/// one keystroke from not reaching the other.
pub(crate) fn valid_plain_filename(name: &str, max_len: usize) -> bool {
    !name.is_empty()
        && name.len() <= max_len
        && name != ".."
        && name != "."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !is_reserved_device(name)
}

/// Big enough for any alert anybody would want, small enough that a mistake
/// cannot pull a film into memory. The stock Genie sounds are a few kilobytes.
const MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SoundFile {
    pub found: bool,
    /// A `data:` URL ready for an `Audio`. Empty when not found.
    pub data_url: String,
    pub path: String,
    pub note: String,
}

/// Built from `setup::genie_roots()`, the same root list `config_import.rs`
/// builds `Config` paths from. See that function's own comment for why this
/// used to be a separate, narrower list.
fn sound_dirs() -> Vec<PathBuf> {
    crate::setup::genie_roots()
        .into_iter()
        .map(|root| root.join("Sounds"))
        .collect()
}

/// Every sound file a highlight could actually name, across every directory
/// `read_sound` would search - so an editor can offer a picker instead of
/// asking a player to type a filename they can only get right by already
/// knowing it.
///
/// Same resolution order as `read_sound`: a name present in more than one
/// directory is listed once, from the first directory that has it. Sorted
/// case-insensitively so the picker doesn't put every capitalised name before
/// every lowercase one, which is what a plain string sort would do.
fn is_audio_filename(name: &str) -> bool {
    // A leading dot is a backup/hidden-file convention on this machine (see
    // this file's own test below for a real example: the `.originals-backup`
    // pass that gain-reduced the alert WAVs left `.Chatter-backup-....wav`
    // siblings next to the real `Chatter.wav`). `read_sound` would still
    // serve one of these if a highlights.cfg named it by exact filename -
    // this only keeps it out of the *picker*, which is offering choices, not
    // resolving a name someone already committed to.
    if name.starts_with('.') {
        return false;
    }
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".wav") || lower.ends_with(".mp3") || lower.ends_with(".ogg")
}

#[tauri::command]
pub fn list_sounds() -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();

    for dir in sound_dirs() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if !is_audio_filename(&name) || !entry.path().is_file() {
                continue;
            }
            if seen.insert(name.to_ascii_lowercase()) {
                out.push(name);
            }
        }
    }

    out.sort_by_key(|n| n.to_ascii_lowercase());
    out
}

/// A named sound, as a data URL, or an honest account of not finding it.
///
/// A missing sound is not an error worth interrupting anybody over. A config
/// naming a file the player never installed is common, and the right answer is
/// a quiet note rather than a dialog - the highlight still colours the line,
/// which is most of the value.
#[tauri::command]
pub fn read_sound(name: String) -> SoundFile {
    let looks_like_a_name = valid_plain_filename(&name, 64);

    let is_audio = {
        let lower = name.to_ascii_lowercase();
        lower.ends_with(".wav") || lower.ends_with(".mp3") || lower.ends_with(".ogg")
    };

    if !looks_like_a_name || !is_audio {
        return SoundFile {
            note: format!("{name:?} is not a sound file name"),
            ..Default::default()
        };
    }

    for dir in sound_dirs() {
        let p = dir.join(&name);
        if !p.is_file() {
            continue;
        }

        // Checked before reading, not after. Reading first and then deciding
        // it was too big means the memory is already gone.
        match std::fs::metadata(&p) {
            Ok(m) if m.len() > MAX_BYTES => {
                return SoundFile {
                    path: p.to_string_lossy().into_owned(),
                    note: format!(
                        "{name} is {} bytes, larger than an alert should be",
                        m.len()
                    ),
                    ..Default::default()
                }
            }
            Ok(_) => {}
            Err(e) => {
                return SoundFile {
                    path: p.to_string_lossy().into_owned(),
                    note: format!("{name} could not be read: {e}"),
                    ..Default::default()
                }
            }
        }

        let Ok(bytes) = std::fs::read(&p) else {
            continue;
        };

        let mime = if name.to_ascii_lowercase().ends_with(".mp3") {
            "audio/mpeg"
        } else if name.to_ascii_lowercase().ends_with(".ogg") {
            "audio/ogg"
        } else {
            "audio/wav"
        };

        return SoundFile {
            found: true,
            data_url: format!("data:{mime};base64,{}", base64(&bytes)),
            path: p.to_string_lossy().into_owned(),
            note: String::new(),
        };
    }

    SoundFile {
        note: format!("{name} is named by a highlight but is not in any Sounds folder"),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_audio_filename_matches_the_three_extensions_case_insensitively() {
        for good in ["Thunder.wav", "growl.mp3", "Bird.OGG", "x.Wav"] {
            assert!(is_audio_filename(good), "{good:?} should be audio");
        }
        for bad in [
            "highlights.cfg",
            "readme.txt",
            "wav",
            "Thunder.wav.bak",
            "",
            // Real filenames this machine had sitting in Sounds/ at the time
            // this exclusion was added - a backup convention from an earlier
            // gain-reduction pass, not something a picker should offer.
            ".Chatter-backup-20260828195704.wav",
            ".Help-backup-20260828195704.wav",
        ] {
            assert!(!is_audio_filename(bad), "{bad:?} should not be audio");
        }
    }

    /// A live smoke test against this machine's real Sounds folders rather
    /// than a mock - `sound_dirs()` is not injectable, and a test asserting
    /// only "does not panic" would be exactly the check-that-cannot-fail this
    /// codebase's own working agreements warn about. This machine's
    /// `C:\Genie4\Sounds` is known to be populated (dr-genie-settings' own
    /// sound corpus is deployed there), so the list must come back non-empty,
    /// every name must end in a real audio extension, and it must contain no
    /// duplicate names case-insensitively - the actual property `list_sounds`
    /// exists to guarantee. Skips honestly (rather than passing vacuously) if
    /// that directory is not present on whatever machine runs this suite.
    #[test]
    fn list_sounds_finds_the_real_corpus_with_no_duplicates() {
        if !PathBuf::from("C:\\Genie4\\Sounds").is_dir() {
            eprintln!("SKIPPED: C:\\Genie4\\Sounds not present on this machine");
            return;
        }
        let names = list_sounds();
        assert!(!names.is_empty(), "expected real sound files, found none");
        for n in &names {
            assert!(is_audio_filename(n), "{n:?} is not an audio filename");
        }
        let mut lower: Vec<String> = names.iter().map(|n| n.to_ascii_lowercase()).collect();
        let before = lower.len();
        lower.sort();
        lower.dedup();
        assert_eq!(lower.len(), before, "list_sounds returned a duplicate name");
    }

    /// The name is joined onto a directory, so it does not get to be a path,
    /// and it does not get to be an executable either.
    #[test]
    fn refuses_anything_that_is_not_a_plain_audio_name() {
        for bad in [
            "../../../Windows/System32/calc.exe",
            "..\\Config\\entry.yaml",
            "sub/Help.wav",
            "sub\\Help.wav",
            "Help.exe",
            "entry.yaml",
            "",
        ] {
            let got = read_sound(bad.into());
            assert!(!got.found, "{bad:?} must not be read");
            assert!(
                got.note.contains("not a sound file name"),
                "{bad:?} should be refused by name, got {:?}",
                got.note
            );
        }
    }

    /// Against the RFC 4648 vectors, including every padding case.
    ///
    /// Worth testing rather than eyeballing: an encoder that gets the tail
    /// wrong produces a data URL that plays in one browser and is silently
    /// rejected in another, which presents as "sounds do not work on my
    /// machine" and is close to undebuggable from a bug report.
    #[test]
    fn base64_matches_the_standard_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");

        // Bytes above 127, which is most of a WAV and the place a sloppy
        // implementation using char arithmetic goes wrong.
        assert_eq!(base64(&[0xFF, 0xFE, 0xFD]), "//79");
        assert_eq!(base64(&[0x00, 0x00, 0x00]), "AAAA");
    }

    /// Windows device names, which pass every charset check ever written.
    ///
    /// `CON.wav` and `NUL.mp3` are not files on Windows, they are devices, and
    /// the OS resolves them with an extension appended. Opening `CON` for read
    /// blocks on console input - a hang rather than a crash, which is the worse
    /// shape because it looks like the app is thinking.
    #[test]
    fn refuses_windows_device_names() {
        for device in [
            "CON.wav", "con.wav", "NUL.wav", "PRN.mp3", "AUX.ogg", "COM1.wav", "LPT9.wav",
            "Con.Wav",
        ] {
            assert!(is_reserved_device(device), "{device:?} is a device name");
            let got = read_sound(device.into());
            assert!(!got.found, "{device:?} must not be opened");
        }

        // The control. Without it, "everything returned true" and "the
        // function returns true for everything" are the same reading - and a
        // classifier that refuses all input would pass the block above.
        for ordinary in [
            "Help.wav",
            "Chatter.wav",
            "console.wav",
            "communicator.mp3",
            "auxiliary.ogg",
        ] {
            assert!(
                !is_reserved_device(ordinary),
                "{ordinary:?} is an ordinary name and must be allowed"
            );
        }
    }

    /// A dot-dot inside a name is not a traversal, and refusing it reads to
    /// somebody as a corrupt file.
    ///
    /// The check was `contains("..")`, which refused `my..song.wav`. The
    /// charset already forecloses traversal - there is no separator available -
    /// so only the exact relative-directory names can do anything.
    #[test]
    fn a_dot_dot_inside_a_name_is_not_a_traversal() {
        // Refused because it is a directory, not because of the dots.
        assert!(!read_sound("..".into()).found);
        assert!(!read_sound(".".into()).found);

        // Allowed through validation. It will not be found, because no such
        // file exists - but the note must be "not in any Sounds folder", not
        // "is not a sound file name".
        let got = read_sound("my..song.wav".into());
        assert!(
            got.note.contains("not in any Sounds folder"),
            "a legitimate name was refused by shape: {:?}",
            got.note
        );
    }

    /// A config naming a sound the player never installed is common and is not
    /// an error. It has to say which file, though, or the note is useless.
    #[test]
    fn a_missing_sound_names_itself() {
        let got = read_sound("NotInstalled9f3a.wav".into());
        assert!(!got.found);
        assert!(got.data_url.is_empty());
        assert!(
            got.note.contains("NotInstalled9f3a.wav"),
            "the note must name the file: {:?}",
            got.note
        );
    }
}
