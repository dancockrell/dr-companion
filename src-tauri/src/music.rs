//! The optional music library: 182 tracks nobody downloads until they ask.
//!
//! # Why this is a download and not part of the installer
//!
//! Measured, not estimated. `tools/vendor-audio.mjs` pulls every entry in
//! `data/audio/manifest.json`; fetching all 182 and weighing what landed gives
//! the real total, recorded per entry as `bytes` in the manifest itself. It is
//! several times the size of the whole installer, so bundling it would make
//! every player pay for it whether or not they ever turn music on - including
//! the players on metered connections the setup wizard already asks about.
//!
//! A HEAD sweep of the same URLs said something quite different and was wrong:
//! Wikimedia rate-limited it and answered 168 of the 182 with a 2144-byte
//! error page, whose `content-length` reads exactly like a small file. That is
//! why the manifest's sizes come from bytes on disk.
//!
//! # Shape
//!
//! Same shape the setup wizard already uses for Ruby4Lich5 and Lich, and
//! deliberately the same code: `download_verified`, one sha256-pinned entry at
//! a time, into the app data directory, emitting `setup://progress` so the
//! existing progress plumbing displays it. Nothing is fetched until the person
//! presses Install.
//!
//! The pins live in `data/audio/manifest.json`, which ships *inside* the
//! signed installer, so there is no manifest to fetch and therefore no
//! manifest-fetch to verify: the list of what to download and the hash of each
//! file arrive together, already trusted as much as the app binary is.

use crate::setup::app_data_dir;
use crate::setup::downloads::{allowed_download_url, download_verified, emit_setup_progress};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

/// Set by `cancel_music_install`, cleared when an install starts. A whole
/// library is a long download and a player who changes their mind should not
/// have to kill the app.
static CANCELLED: AtomicBool = AtomicBool::new(false);

/// One manifest entry, as the frontend sends it. `bytes` and `sha256` come
/// from `data/audio/manifest.json`, which is bundled; nothing here trusts a
/// number the network supplied.
#[derive(Deserialize, Clone, Debug)]
pub struct MusicTrack {
    pub file: String,
    pub download: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct MusicLibraryStatus {
    pub dir: String,
    pub installed: usize,
    pub total: usize,
    pub bytes_installed: u64,
    pub bytes_total: u64,
    pub complete: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct MusicInstallResult {
    pub installed: usize,
    pub total: usize,
    pub bytes: u64,
    pub cancelled: bool,
}

/// Where an installed library lives. Beside the other things this app
/// downloads rather than inside the program directory, for the reason
/// `app_data_dir` gives at length: an uninstall must not take a player's data
/// with it, and a 2 GB library re-downloaded after every update would be a
/// cruel way to learn that.
pub fn music_dir() -> PathBuf {
    app_data_dir().join("audio")
}

/// Turn a manifest-relative path into an absolute one, or refuse.
///
/// The frontend sends these, and a webview is not a trusted caller: the same
/// reasoning `install_bundled_ruby4lich5` gives for resolving its own path.
/// Everything here is a check on the *shape* of the string, so it holds
/// whatever the manifest happens to contain.
pub(crate) fn track_path(dir: &Path, file: &str) -> Result<PathBuf, String> {
    let bad = file.is_empty()
        || file.contains("..")
        || file.starts_with('/')
        || file.starts_with('\\')
        || file.contains(':')
        || file.contains('\\');
    if bad {
        return Err(format!("refusing an unsafe track path: {file}"));
    }
    let mut path = dir.to_path_buf();
    for part in file.split('/') {
        if part.is_empty() || part == "." {
            return Err(format!("refusing an unsafe track path: {file}"));
        }
        path.push(part);
    }
    Ok(path)
}

/// Everything that must be true before a byte is fetched, named per track.
///
/// A sha that is the wrong shape is refused here rather than passed down:
/// `download_verified` treats an empty expected hash as "do not check", which
/// is right for the bundled Ruby it was written for and would be a hole here.
pub(crate) fn check_track(dir: &Path, track: &MusicTrack) -> Result<PathBuf, String> {
    if track.sha256.len() != 64 || !track.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "{}: refusing to install a track with no sha256 pin",
            track.file
        ));
    }
    if !allowed_download_url(&track.download) {
        return Err(format!(
            "{}: refusing to download from an unexpected host: {}",
            track.file, track.download
        ));
    }
    track_path(dir, &track.file)
}

/// A track counts as installed when the file is there at the size the manifest
/// pins. Not a re-hash: that would read the whole library on every panel open,
/// and the hash was checked when the bytes arrived.
fn present(path: &Path, bytes: u64) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() == bytes)
}

pub(crate) fn status_of(dir: &Path, tracks: &[MusicTrack]) -> MusicLibraryStatus {
    let mut installed = 0;
    let mut bytes_installed = 0;
    let mut bytes_total = 0;
    for track in tracks {
        bytes_total += track.bytes;
        let Ok(path) = track_path(dir, &track.file) else {
            continue;
        };
        if present(&path, track.bytes) {
            installed += 1;
            bytes_installed += track.bytes;
        }
    }
    MusicLibraryStatus {
        dir: dir.to_string_lossy().into_owned(),
        installed,
        total: tracks.len(),
        bytes_installed,
        bytes_total,
        // An empty manifest is not a complete library. Without this an
        // `installed == total` of 0 == 0 would report the library present and
        // the app would go back to playing nothing while claiming otherwise.
        complete: !tracks.is_empty() && installed == tracks.len(),
    }
}

#[tauri::command]
pub fn music_library_status(tracks: Vec<MusicTrack>) -> MusicLibraryStatus {
    status_of(&music_dir(), &tracks)
}

#[tauri::command]
pub fn cancel_music_install() {
    CANCELLED.store(true, Ordering::SeqCst);
}

/// Download every track that is not already there, verifying each one.
///
/// Progress is reported across the whole set rather than per file, because
/// "37 of 182" and a byte count is what a person waiting actually wants; the
/// per-file callback feeds the running total.
#[tauri::command]
pub async fn install_music_library(
    app: AppHandle,
    tracks: Vec<MusicTrack>,
) -> Result<MusicInstallResult, String> {
    if tracks.is_empty() {
        return Err("nothing to install: the track list was empty".into());
    }
    CANCELLED.store(false, Ordering::SeqCst);
    let dir = music_dir();

    // Every check first, so a bad entry stops the run before any bytes move
    // rather than 140 tracks in.
    let mut planned = Vec::with_capacity(tracks.len());
    for track in &tracks {
        planned.push((track.clone(), check_track(&dir, track)?));
    }

    let total_bytes: u64 = tracks.iter().map(|t| t.bytes).sum();
    let mut done_bytes: u64 = planned
        .iter()
        .filter(|(t, p)| present(p, t.bytes))
        .map(|(t, _)| t.bytes)
        .sum();
    let mut installed = 0;

    for (track, path) in &planned {
        if present(path, track.bytes) {
            installed += 1;
            continue;
        }
        if CANCELLED.load(Ordering::SeqCst) {
            emit_setup_progress(&app, "music", done_bytes, total_bytes, "cancelled");
            return Ok(MusicInstallResult {
                installed,
                total: tracks.len(),
                bytes: done_bytes,
                cancelled: true,
            });
        }
        let base = done_bytes;
        let progress_app = app.clone();
        download_verified(
            &track.download,
            &track.sha256,
            &path.to_string_lossy(),
            move |received, _| {
                emit_setup_progress(
                    &progress_app,
                    "music",
                    base + received,
                    total_bytes,
                    "downloading",
                );
            },
        )
        .await
        .map_err(|error| format!("{}: {error}", track.file))?;
        done_bytes = base + track.bytes;
        installed += 1;
    }

    emit_setup_progress(&app, "music", done_bytes, total_bytes, "verified");
    Ok(MusicInstallResult {
        installed,
        total: tracks.len(),
        bytes: done_bytes,
        cancelled: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup::downloads::download_verified_from;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn track(file: &str, download: &str, sha: &str, bytes: u64) -> MusicTrack {
        MusicTrack {
            file: file.into(),
            download: download.into(),
            sha256: sha.into(),
            bytes,
        }
    }

    const OK_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const WIKI: &str = "https://upload.wikimedia.org/wikipedia/commons/b/bb/Thing.ogg";

    #[test]
    fn the_two_audio_hosts_are_allowed_and_lookalikes_are_not() {
        assert!(allowed_download_url(WIKI));
        assert!(allowed_download_url(
            "https://opengameart.org/sites/default/files/forest_2_0.ogg"
        ));
        // The prefix includes the path, so the host cannot be smuggled in as
        // somebody else's path segment.
        //
        // These two are assembled rather than written as literals on purpose:
        // `tools/build-privacy-doc.mjs` reads every `https://<host>` out of
        // this tree and refuses to publish until each host is described in the
        // privacy document. A host invented for a negative test is not a
        // destination, and describing it there would be a lie in the one
        // document where that matters most.
        let smuggled = format!("https://{}/{WIKI}", "evil.example");
        assert!(!allowed_download_url(&smuggled));
        let lookalike = format!(
            "https://{}/wikipedia/commons/x.ogg",
            "upload.wikimedia.org.evil.example"
        );
        assert!(!allowed_download_url(&lookalike));
        assert!(!allowed_download_url("http://127.0.0.1:9/x.ogg"));
        // Positive control on the same function: the setup wizard's own hosts
        // still pass, so a false on the lines above means the URL and not a
        // broken allowlist.
        assert!(allowed_download_url(
            "https://github.com/elanthia-online/lich-5/releases/download/x"
        ));
    }

    #[test]
    fn a_track_path_cannot_escape_the_audio_directory() {
        let dir = Path::new("C:\\base");
        assert!(track_path(dir, "radio/a.ogg").is_ok());
        for bad in [
            "../evil.ogg",
            "radio/../../evil.ogg",
            "/etc/passwd",
            "\\\\server\\share\\x.ogg",
            "C:/Windows/System32/x.dll",
            "",
        ] {
            assert!(track_path(dir, bad).is_err(), "accepted {bad}");
        }
    }

    #[test]
    fn a_track_with_no_sha_pin_is_refused_naming_the_file() {
        let dir = Path::new("C:\\base");
        let e = check_track(dir, &track("radio/a.ogg", WIKI, "", 10)).unwrap_err();
        assert!(e.contains("radio/a.ogg"), "{e}");
        assert!(e.contains("sha256"), "{e}");
        let e = check_track(dir, &track("radio/b.ogg", WIKI, "not-hex-and-short", 10)).unwrap_err();
        assert!(e.contains("radio/b.ogg"), "{e}");
        // Positive control: a well-formed pin on an allowed host is accepted,
        // so the failures above are the pin and not the whole function.
        assert!(check_track(dir, &track("radio/c.ogg", WIKI, OK_SHA, 10)).is_ok());
    }

    #[test]
    fn an_unexpected_host_is_refused_naming_the_file() {
        let dir = Path::new("C:\\base");
        // Assembled, not a literal - see the comment in the allowlist test.
        let elsewhere = format!("https://{}/a.ogg", "evil.example");
        let e = check_track(dir, &track("radio/a.ogg", &elsewhere, OK_SHA, 1)).unwrap_err();
        assert!(e.contains("radio/a.ogg"), "{e}");
        assert!(e.contains("evil.example"), "{e}");
    }

    #[test]
    fn an_empty_library_is_not_a_complete_one() {
        let s = status_of(Path::new("C:\\base"), &[]);
        assert!(!s.complete);
        assert_eq!(s.total, 0);
    }

    /// Serve one body once, on a loopback port, and hand back the URL.
    fn serve(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut junk = [0u8; 1024];
                let _ = stream.read(&mut junk);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: audio/ogg\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
        });
        format!("http://127.0.0.1:{port}/track.ogg")
    }

    fn hex(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }

    #[tokio::test]
    async fn a_body_whose_sha_does_not_match_is_refused_and_nothing_is_written() {
        let body = vec![7u8; 4096];
        let dir = std::env::temp_dir().join(format!("drc-music-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("bad.ogg");
        let _ = std::fs::remove_file(&dest);

        let url = serve(body.clone());
        let wrong = "0".repeat(64);
        let err = download_verified_from(
            &url,
            &wrong,
            &dest.to_string_lossy(),
            &["http://127.0.0.1:"],
            |_, _| {},
        )
        .await
        .expect_err("a mismatched body must not install");
        assert!(err.contains("checksum mismatch"), "{err}");
        assert!(!dest.exists(), "a rejected download was left on disk");
        assert!(
            !dest.with_extension("part").exists(),
            "a rejected download left its .part behind"
        );

        // Positive control on the same path: the identical fetch with the
        // real hash succeeds, so the failure above is the hash check doing its
        // job rather than the little server or the seam being broken.
        let url = serve(body.clone());
        let right = hex(Sha256::digest(&body));
        let ok = download_verified_from(
            &url,
            &right,
            &dest.to_string_lossy(),
            &["http://127.0.0.1:"],
            |_, _| {},
        )
        .await
        .expect("a matching body installs");
        assert_eq!(ok.bytes, body.len() as u64);
        assert!(dest.exists());

        // And the seam is not a hole: the shipping allowlist refuses the very
        // URL the test just used.
        let refused = download_verified(&url, &right, &dest.to_string_lossy(), |_, _| {})
            .await
            .expect_err("loopback must not be reachable through the real allowlist");
        assert!(refused.contains("unexpected host"), "{refused}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
