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

use crate::setup::genie_install_dir;

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

fn sound_dirs() -> Vec<PathBuf> {
    let mut out = vec![genie_install_dir().join("Sounds")];
    for root in ["C:\\Genie4", "C:\\Genie"] {
        out.push(PathBuf::from(root).join("Sounds"));
    }
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
    // The charset is what actually forecloses traversal: no '/', no '\', no
    // ':', nothing non-ASCII, so a path separator, an absolute path, a drive
    // letter, a UNC path and an alternate data stream are all impossible in
    // one line.
    //
    // The dot-dot rule is therefore belt to those braces, and it used to be
    // `!name.contains("..")` - which refused a legitimate `my..song.wav`. A
    // false refusal here reads to a player as a corrupt file. Only the exact
    // relative-directory names can do anything, and they are rejected by name.
    let relative_dir = name == ".." || name == ".";

    let looks_like_a_name = !name.is_empty()
        && name.len() <= 64
        && !relative_dir
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        && !is_reserved_device(&name);

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
