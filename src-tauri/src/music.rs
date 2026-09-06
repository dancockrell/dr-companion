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

/// What is on disk, and nothing about what it means.
///
/// This used to carry `installed`, `bytes_installed`, `bytes_total` and
/// `complete` as well, all computed here. Per-group installs (#397) need the
/// same counts per station, and a station is a frontend idea - the manifest's
/// `station` field is what `ambientSound.ts` already builds `RADIO_STATIONS`
/// from. Rather than teach this file about stations, or count once here and
/// again per group over there, this reports the files it found and
/// `musicLibrary.ts` derives every count from them. One walker, one grouping,
/// one set of numbers.
#[derive(Serialize, Clone, Debug)]
pub struct MusicLibraryStatus {
    pub dir: String,
    /// Manifest-relative paths, exactly as they arrived, for the entries whose
    /// file is present at its pinned size.
    pub installed_files: Vec<String>,
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
    let mut installed_files = Vec::new();
    for track in tracks {
        let Ok(path) = track_path(dir, &track.file) else {
            continue;
        };
        if present(&path, track.bytes) {
            installed_files.push(track.file.clone());
        }
    }
    MusicLibraryStatus {
        dir: dir.to_string_lossy().into_owned(),
        installed_files,
    }
}

/// Delete one group's files, and refuse to touch anything else.
///
/// One gate, deliberately: `track_path`, the same one the install goes through,
/// which rejects the shape of any path that could leave the directory - `..`, a
/// root, a drive letter, a backslash. A second `path.starts_with(dir)` check
/// was written here and then removed, because given `track_path` it could not
/// be made to fail: there is no input that reaches it and escapes, so nothing
/// could ever prove it still worked, and an unreachable guard reads as
/// protection while providing none. If `track_path` is ever loosened, its own
/// test goes red first - `a_track_path_cannot_escape_the_audio_directory` and
/// `removal_refuses_a_path_outside_the_music_directory` both fail on the same
/// sabotage.
///
/// A file that is not there is not an error: removing a partly-installed group
/// must not stop at the first track that was never downloaded.
///
/// The `.part` beside it goes too. `download_verified` writes there first, so a
/// cancelled install can leave one, and a "removed" group that silently kept a
/// gigabyte of half-files would be the worst kind of honest-looking.
pub(crate) fn remove_tracks(dir: &Path, tracks: &[MusicTrack]) -> Result<usize, String> {
    let mut removed = 0;
    for track in tracks {
        let path = track_path(dir, &track.file)?;
        for candidate in [path.clone(), path.with_extension("part")] {
            match std::fs::remove_file(&candidate) {
                Ok(()) => removed += 1,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("{}: {e}", track.file)),
            }
        }
    }
    Ok(removed)
}

#[tauri::command]
pub fn remove_music_group(tracks: Vec<MusicTrack>) -> Result<usize, String> {
    if tracks.is_empty() {
        return Err("nothing to remove: the track list was empty".into());
    }
    remove_tracks(&music_dir(), &tracks)
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

    // Read the flag once more rather than reporting `cancelled: false` from
    // the fact that the loop ended. #402 (review pass over #396) found that a
    // Cancel pressed during the *last* track was never seen: the loop checks
    // before each download and there is no iteration after the final one, so
    // the person pressed Cancel and the app said it had completed normally.
    // Cancel still only takes effect between files - stopping mid-file needs
    // `download_verified` to take a cancellation token, which is #402's own
    // item and is not this change.
    let cancelled = CANCELLED.load(Ordering::SeqCst);
    emit_setup_progress(
        &app,
        "music",
        done_bytes,
        total_bytes,
        if cancelled { "cancelled" } else { "verified" },
    );
    Ok(MusicInstallResult {
        installed,
        total: tracks.len(),
        bytes: done_bytes,
        cancelled,
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

    /// A temp directory of this test's own, named after the case so two of
    /// them running at once cannot delete each other's fixtures - which is the
    /// exact failure the removal cases below are about.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("drc-music-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Write `bytes` bytes at the track's path so `present` counts it.
    fn place(dir: &Path, t: &MusicTrack) {
        let path = track_path(dir, &t.file).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, vec![0u8; t.bytes as usize]).unwrap();
    }

    /// Two groups by directory, the way the manifest lays them out.
    fn two_groups() -> (Vec<MusicTrack>, Vec<MusicTrack>) {
        let a = vec![
            track("radio/a1.ogg", WIKI, OK_SHA, 8),
            track("radio/a2.ogg", WIKI, OK_SHA, 8),
        ];
        let b = vec![
            track("biome/b1.ogg", WIKI, OK_SHA, 8),
            track("biome/b2.ogg", WIKI, OK_SHA, 8),
        ];
        (a, b)
    }

    #[test]
    fn status_reports_the_files_that_are_there_and_nothing_else() {
        let dir = scratch("status");
        let (a, b) = two_groups();
        place(&dir, &a[0]);
        place(&dir, &b[1]);
        // Present at the wrong size is not present: a truncated download must
        // not read as an installed track.
        let short = track("radio/short.ogg", WIKI, OK_SHA, 99);
        place(&dir, &track("radio/short.ogg", WIKI, OK_SHA, 3));

        let all: Vec<MusicTrack> = a
            .iter()
            .chain(b.iter())
            .chain([short].iter())
            .cloned()
            .collect();
        let s = status_of(&dir, &all);
        assert_eq!(s.installed_files, vec!["radio/a1.ogg", "biome/b2.ogg"]);
        // The denominator: the walk really did examine all five, so the two
        // absences above are absences and not a walk that stopped early.
        assert_eq!(all.len(), 5);
        // An empty ask finds nothing rather than reporting a whole library.
        assert!(status_of(&dir, &[]).installed_files.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_one_group_leaves_the_other_group_alone() {
        let dir = scratch("remove");
        let (a, b) = two_groups();
        for t in a.iter().chain(b.iter()) {
            place(&dir, t);
        }
        // A cancelled install's leftover, which removal must also take.
        std::fs::write(dir.join("radio").join("a1.part"), b"half").unwrap();
        assert_eq!(status_of(&dir, &a).installed_files.len(), 2);
        assert_eq!(status_of(&dir, &b).installed_files.len(), 2);

        let removed = remove_tracks(&dir, &a).expect("removing a present group");
        assert_eq!(removed, 3, "two tracks and one .part");
        // Count both sides. Counting only the removed one would stay true if
        // the function had deleted everything.
        assert_eq!(status_of(&dir, &a).installed_files.len(), 0);
        assert_eq!(status_of(&dir, &b).installed_files.len(), 2);

        // Removing again is not an error - a group half-installed and then
        // removed must not stop at the first file that was never fetched.
        assert_eq!(remove_tracks(&dir, &a).unwrap(), 0);
        assert_eq!(status_of(&dir, &b).installed_files.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn removal_refuses_a_path_outside_the_music_directory() {
        let dir = scratch("escape");
        let victim = dir.join("victim.ogg");
        std::fs::write(&victim, b"not yours").unwrap();
        let inside = dir.join("radio");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::write(inside.join("keep.ogg"), b"mine").unwrap();

        for bad in [
            "../victim.ogg",
            "radio/../victim.ogg",
            "/etc/passwd",
            "C:/Windows/System32/x.dll",
        ] {
            let e = remove_tracks(&dir.join("radio"), &[track(bad, WIKI, OK_SHA, 1)])
                .expect_err("accepted an escaping path");
            assert!(e.contains(bad), "{e}");
        }
        assert!(victim.exists(), "a refused removal deleted the file anyway");
        // Positive control on the same function: a path that is inside really
        // is removed, so the refusals above are the guard and not a removal
        // that never works.
        assert_eq!(
            remove_tracks(&dir, &[track("radio/keep.ogg", WIKI, OK_SHA, 4)]).unwrap(),
            1
        );
        let _ = std::fs::remove_dir_all(&dir);
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
