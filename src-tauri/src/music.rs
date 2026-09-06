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
use crate::setup::downloads::{
    allowed_by, download_verified_from, emit_setup_progress, DownloadOutcome,
    ALLOWED_DOWNLOAD_PREFIXES,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

/// Set by `cancel_music_install`, cleared when an install starts. A whole
/// library is a long download and a player who changes their mind should not
/// have to kill the app.
///
/// This one flag is now read in two places rather than one: between tracks
/// here, and after every chunk inside `download_verified_from`, which takes
/// it as a parameter. Not a second flag - the same one, passed down - so
/// there is nothing for a Cancel to hit one of and miss the other.
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
    /// Manifest-relative paths whose `.part` is on disk: a download that was
    /// interrupted and that the next install continues from.
    ///
    /// This is the same walk that finds the installed files, so it *is* the
    /// sweep #402 asked for rather than a second timer nobody would run. A
    /// path can be in one list or the other and never in both - the final
    /// name only appears after a verified rename - so a partial download
    /// reports as partial and can never be counted as installed.
    pub partial_files: Vec<String>,
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
///
/// The allowlist is a parameter rather than a call to
/// `ALLOWED_DOWNLOAD_PREFIXES`, and for the reason `download_verified_from`
/// gives about its own: one function, driven by a test against a loopback
/// server, rather than a second copy of these checks that could drift from
/// the one the app runs. Every shipping caller passes the real list.
pub(crate) fn check_track(
    dir: &Path,
    track: &MusicTrack,
    allowed: &[&str],
) -> Result<PathBuf, String> {
    if track.sha256.len() != 64 || !track.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "{}: refusing to install a track with no sha256 pin",
            track.file
        ));
    }
    if !allowed_by(&track.download, allowed) {
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
    let mut partial_files = Vec::new();
    for track in tracks {
        let Ok(path) = track_path(dir, &track.file) else {
            continue;
        };
        if present(&path, track.bytes) {
            installed_files.push(track.file.clone());
        } else if std::fs::metadata(path.with_extension("part")).is_ok_and(|m| m.is_file()) {
            // `else`, deliberately: installed wins, so a `.part` left beside a
            // finished file cannot demote a track that is actually there.
            partial_files.push(track.file.clone());
        }
    }
    MusicLibraryStatus {
        dir: dir.to_string_lossy().into_owned(),
        installed_files,
        partial_files,
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

/// How much room to leave on the volume after an install.
///
/// A download that exactly fits leaves a machine with nothing, and Windows
/// starts failing in ways nothing here can explain long before zero. Half a
/// gigabyte is small against the 1.65 GB largest group and large enough that
/// the disk is still usable afterwards.
pub(crate) const FREE_SPACE_MARGIN: u64 = 500 * 1024 * 1024;

/// Bytes free on the volume `dir` lives on, or `None` when that cannot be
/// asked here.
///
/// `None` is a third answer and not a large number: it means the question was
/// not answered, and `space_refusal` refuses nothing on it. Folding "could not
/// check" into "there is plenty" would be the same lie in the safer-looking
/// direction, and folding it into "there is none" would block every install on
/// a platform this happens not to implement.
///
/// The directory may not exist yet on a first install, so the walk climbs to
/// the nearest ancestor that does - a volume's free space is the same wherever
/// on it you ask.
pub(crate) fn free_space(dir: &Path) -> Option<u64> {
    let mut probe = dir;
    loop {
        if probe.exists() {
            return free_space_of_existing(probe);
        }
        probe = probe.parent()?;
    }
}

#[cfg(windows)]
fn free_space_of_existing(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let mut wide: Vec<u16> = dir.as_os_str().encode_wide().collect();
    wide.push(0);
    let mut available: u64 = 0;
    // SAFETY: `wide` is a null-terminated UTF-16 path that outlives the call,
    // and the out-parameter is a live `u64` this frame owns. The two totals
    // this function does not need are passed as null, which the API documents
    // as permitted.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return None;
    }
    Some(available)
}

#[cfg(not(windows))]
fn free_space_of_existing(_dir: &Path) -> Option<u64> {
    // The app ships for Windows. Rather than pull a crate to answer this on a
    // platform nothing installs on, say plainly that it was not answered.
    None
}

/// Bytes as a person reads them, for a message about a disk.
fn human_bytes(bytes: u64) -> String {
    const GB: u64 = 1024 * 1024 * 1024;
    const MB: u64 = 1024 * 1024;
    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else {
        format!("{} MB", bytes / MB)
    }
}

/// Whether this install should be refused for want of room, and what to say.
///
/// Split out from the install so both the numbers and the sentence can be
/// asserted without a disk that happens to be nearly full - `free` is a
/// parameter rather than a call, and rather than an environment variable,
/// so the refusal can be reached deliberately and the shipping path cannot
/// have it switched on at run time.
pub(crate) fn space_refusal(needed: u64, free: Option<u64>) -> Option<String> {
    let free = free?;
    let usable = free.saturating_sub(FREE_SPACE_MARGIN);
    if needed <= usable {
        return None;
    }
    Some(format!(
        "not enough free space: this needs {} and the disk has {} free, of which {} is usable after leaving a {} margin. Nothing was downloaded.",
        human_bytes(needed),
        human_bytes(free),
        human_bytes(usable),
        human_bytes(FREE_SPACE_MARGIN)
    ))
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
    let dir = music_dir();
    let free = free_space(&dir);
    let progress_app = app.clone();
    install_into(
        &dir,
        &tracks,
        free,
        &ALLOWED_DOWNLOAD_PREFIXES,
        &CANCELLED,
        move |received, total, phase| {
            emit_setup_progress(&progress_app, "music", received, total, phase);
        },
    )
    .await
}

/// The body of `install_music_library`, with the disk, the allowlist, the
/// free-space answer and the cancel flag as parameters.
///
/// Same reasoning as `download_verified_from`'s allowlist seam: the refusal
/// and the resume are the two things #402 is about, and neither can be reached
/// on demand against a real disk and a real host. Everything shipping goes
/// through `install_music_library`, which supplies the real music directory,
/// the real allowlist and a real `GetDiskFreeSpaceExW`; nothing here reads an
/// environment variable, so the seam cannot be opened at run time.
///
/// `cancel` is the same flag `cancel_music_install` sets: shipping goes
/// through `install_music_library`, which passes `&CANCELLED`. It is a
/// parameter rather than a read of the static so a test can cancel one
/// install without reaching into a process-wide flag two other tests in the
/// same binary are also using.
pub(crate) async fn install_into(
    dir: &Path,
    tracks: &[MusicTrack],
    free: Option<u64>,
    allowed: &[&str],
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, u64, &str),
) -> Result<MusicInstallResult, String> {
    if tracks.is_empty() {
        return Err("nothing to install: the track list was empty".into());
    }
    cancel.store(false, Ordering::SeqCst);

    // Every check first, so a bad entry stops the run before any bytes move
    // rather than 140 tracks in.
    let mut planned = Vec::with_capacity(tracks.len());
    for track in tracks {
        planned.push((track.clone(), check_track(dir, track, allowed)?));
    }

    let total_bytes: u64 = tracks.iter().map(|t| t.bytes).sum();
    let mut done_bytes: u64 = planned
        .iter()
        .filter(|(t, p)| present(p, t.bytes))
        .map(|(t, _)| t.bytes)
        .sum();

    // What this run would still have to fetch, not what the group weighs: a
    // resumed install has most of it already and refusing on the full size
    // would block the very case that needs the least room. Before any request,
    // so a refusal costs the disk nothing and the network nothing.
    if let Some(message) = space_refusal(total_bytes.saturating_sub(done_bytes), free) {
        return Err(message);
    }

    let mut installed = 0;
    for (track, path) in &planned {
        if present(path, track.bytes) {
            installed += 1;
            continue;
        }
        if cancel.load(Ordering::SeqCst) {
            on_progress(done_bytes, total_bytes, "cancelled");
            return Ok(MusicInstallResult {
                installed,
                total: tracks.len(),
                bytes: done_bytes,
                cancelled: true,
            });
        }
        let base = done_bytes;
        let outcome = download_verified_from(
            &track.download,
            &track.sha256,
            &path.to_string_lossy(),
            allowed,
            cancel,
            |received, _| {
                on_progress(base + received, total_bytes, "downloading");
            },
        )
        .await
        .map_err(|error| format!("{}: {error}", track.file))?;
        if let DownloadOutcome::Cancelled { bytes } = outcome {
            // Stopped part-way through this file. What it wrote is a
            // resumable prefix, so the group reports partial with a Resume
            // rather than failed - and the count is what is really on disk,
            // not the whole track's weight.
            on_progress(base + bytes, total_bytes, "cancelled");
            return Ok(MusicInstallResult {
                installed,
                total: tracks.len(),
                bytes: base + bytes,
                cancelled: true,
            });
        }
        done_bytes = base + track.bytes;
        installed += 1;
    }

    // Read the flag once more rather than reporting `cancelled: false` from
    // the fact that the loop ended. #402 (review pass over #396) found that a
    // Cancel pressed during the *last* track was never seen: the loop checks
    // before each download and there is no iteration after the final one, so
    // the person pressed Cancel and the app said it had completed normally.
    // Cancel now also takes effect *inside* a file - `download_verified_from`
    // takes this same flag and checks it per chunk - so the loop above can
    // return part-way through a track. This last read still matters for the
    // case that has no iteration left to catch it: a Cancel pressed after the
    // final chunk was written and before the rename finished.
    let cancelled = cancel.load(Ordering::SeqCst);
    on_progress(
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
    use crate::setup::download_verified;
    use crate::setup::downloads::{download_verified_from, NEVER_CANCELLED};
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// The shipping host rule, asked the way the app asks it.
    fn allowed(url: &str) -> bool {
        allowed_by(url, &ALLOWED_DOWNLOAD_PREFIXES)
    }

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
        assert!(allowed(WIKI));
        assert!(allowed(
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
        assert!(!allowed(&smuggled));
        let lookalike = format!(
            "https://{}/wikipedia/commons/x.ogg",
            "upload.wikimedia.org.evil.example"
        );
        assert!(!allowed(&lookalike));
        assert!(!allowed("http://127.0.0.1:9/x.ogg"));
        // Positive control on the same function: the setup wizard's own hosts
        // still pass, so a false on the lines above means the URL and not a
        // broken allowlist.
        assert!(allowed(
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
        let e = check_track(
            dir,
            &track("radio/a.ogg", WIKI, "", 10),
            &ALLOWED_DOWNLOAD_PREFIXES,
        )
        .unwrap_err();
        assert!(e.contains("radio/a.ogg"), "{e}");
        assert!(e.contains("sha256"), "{e}");
        let e = check_track(
            dir,
            &track("radio/b.ogg", WIKI, "not-hex-and-short", 10),
            &ALLOWED_DOWNLOAD_PREFIXES,
        )
        .unwrap_err();
        assert!(e.contains("radio/b.ogg"), "{e}");
        // Positive control: a well-formed pin on an allowed host is accepted,
        // so the failures above are the pin and not the whole function.
        assert!(check_track(
            dir,
            &track("radio/c.ogg", WIKI, OK_SHA, 10),
            &ALLOWED_DOWNLOAD_PREFIXES
        )
        .is_ok());
    }

    #[test]
    fn an_unexpected_host_is_refused_naming_the_file() {
        let dir = Path::new("C:\\base");
        // Assembled, not a literal - see the comment in the allowlist test.
        let elsewhere = format!("https://{}/a.ogg", "evil.example");
        let e = check_track(
            dir,
            &track("radio/a.ogg", &elsewhere, OK_SHA, 1),
            &ALLOWED_DOWNLOAD_PREFIXES,
        )
        .unwrap_err();
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
            &NEVER_CANCELLED,
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
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect("a matching body installs")
        .finished()
        .expect("a matching body was not cancelled");
        assert_eq!(ok.bytes, body.len() as u64);
        assert!(dest.exists());

        // And the seam is not a hole: the shipping allowlist refuses the very
        // URL the test just used.
        let refused = download_verified(
            &url,
            &right,
            &dest.to_string_lossy(),
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect_err("loopback must not be reachable through the real allowlist");
        assert!(refused.contains("unexpected host"), "{refused}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---------------------------------------------------------------- #402
    //
    // A loopback server that can be asked to behave the four ways a real one
    // does, and that records every request it saw. The log is the denominator
    // for most of what follows: "the file resumed" is only worth anything if
    // the server can show it was asked to continue from the right byte, and
    // "nothing was downloaded" is only worth anything against a server that
    // could have answered.

    #[derive(Clone, Copy)]
    enum Mode {
        /// Honours `Range`, answering 206 with `Accept-Ranges: bytes`.
        Ranged,
        /// Ignores `Range` and always sends the whole body with a 200.
        NoRange,
        /// Announces `announce` bytes and sends `send` of them, then hangs up.
        Truncated { announce: usize, send: usize },
        /// Honours `Range` like `Ranged`, but hands the body over in
        /// `chunk`-sized pieces with a pause between them.
        ///
        /// A cancel that is meant to land *inside* a file needs a file that
        /// arrives in more than one piece: against a server that writes 20 kB
        /// in one go the client sees a single chunk and there is no mid-file
        /// to stop in, so a test would pass whether or not the flag were ever
        /// read. This is the only mode that can be stopped part-way, which is
        /// exactly what makes it the one worth cancelling.
        Slow { chunk: usize },
    }

    /// The first byte a request asked to continue from, if it asked at all.
    fn range_start(head: &str) -> Option<u64> {
        for line in head.lines() {
            let lower = line.to_ascii_lowercase();
            if let Some(rest) = lower.strip_prefix("range:") {
                let rest = rest.trim();
                let digits = rest.strip_prefix("bytes=")?.trim_end_matches('-');
                return digits.parse().ok();
            }
        }
        None
    }

    /// Hand `bytes` to the socket in `chunk`-sized pieces, pausing between
    /// them, and count what got through.
    ///
    /// The count stops the moment a write fails, which is how a client that
    /// walked away is visible from the server's side: with 1 MB still to send
    /// and a socket buffer far smaller, a client that hung up cannot leave
    /// this at the full length. That is the denominator for "the request
    /// stopped" - without it, a cancelled download and a completed one that
    /// merely wrote a short `.part` would look the same from here.
    fn send_body(
        stream: &mut std::net::TcpStream,
        bytes: &[u8],
        chunk: usize,
        pause: std::time::Duration,
        served: &Arc<std::sync::atomic::AtomicU64>,
    ) {
        for piece in bytes.chunks(chunk.max(1)) {
            if stream.write_all(piece).is_err() {
                return;
            }
            served.fetch_add(piece.len() as u64, Ordering::SeqCst);
            if !pause.is_zero() {
                if stream.flush().is_err() {
                    return;
                }
                std::thread::sleep(pause);
            }
        }
    }

    /// Serve `body` `connections` times, and hand back the URL, the log of
    /// request heads the server actually received, and how many body bytes it
    /// got through.
    fn serve_mode(
        mode: Mode,
        body: Vec<u8>,
        connections: usize,
    ) -> (
        String,
        Arc<Mutex<Vec<String>>>,
        Arc<std::sync::atomic::AtomicU64>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        let log: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = log.clone();
        let served: Arc<std::sync::atomic::AtomicU64> =
            Arc::new(std::sync::atomic::AtomicU64::new(0));
        let counter = served.clone();
        let whole = body.len().max(1);
        let none = std::time::Duration::ZERO;
        std::thread::spawn(move || {
            for _ in 0..connections {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut buffer = [0u8; 4096];
                let read = stream.read(&mut buffer).unwrap_or(0);
                let head = String::from_utf8_lossy(&buffer[..read]).into_owned();
                let asked = range_start(&head);
                sink.lock().unwrap().push(head);
                match mode {
                    Mode::Truncated { announce, send } => {
                        let start = asked.unwrap_or(0) as usize;
                        let _ = stream.write_all(
                            format!("HTTP/1.1 200 OK\r\nContent-Length: {announce}\r\n\r\n")
                                .as_bytes(),
                        );
                        let end = (start + send).min(body.len());
                        send_body(
                            &mut stream,
                            &body[start.min(body.len())..end],
                            whole,
                            none,
                            &counter,
                        );
                    }
                    Mode::NoRange => {
                        let _ = stream.write_all(
                            format!(
                                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: none\r\n\r\n",
                                body.len()
                            )
                            .as_bytes(),
                        );
                        send_body(&mut stream, &body, whole, none, &counter);
                    }
                    // `Slow` *is* `Ranged` with a pace, rather than a second
                    // copy of the range handling that could drift from it.
                    Mode::Ranged | Mode::Slow { .. } => {
                        let (chunk, pause) = match mode {
                            Mode::Slow { chunk } => (chunk, std::time::Duration::from_millis(2)),
                            _ => (whole, none),
                        };
                        match asked {
                            Some(start) if (start as usize) < body.len() => {
                                let start = start as usize;
                                let rest = &body[start..];
                                let _ = stream.write_all(
                                format!(
                                    "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nContent-Range: bytes {}-{}/{}\r\n\r\n",
                                    rest.len(),
                                    start,
                                    body.len() - 1,
                                    body.len()
                                )
                                .as_bytes(),
                            );
                                send_body(&mut stream, rest, chunk, pause, &counter);
                            }
                            Some(_) => {
                                let _ = stream.write_all(
                                b"HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\n\r\n",
                            );
                            }
                            None => {
                                let _ = stream.write_all(
                                format!(
                                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n\r\n",
                                    body.len()
                                )
                                .as_bytes(),
                            );
                                send_body(&mut stream, &body, chunk, pause, &counter);
                            }
                        }
                    }
                }
                let _ = stream.flush();
            }
        });
        (format!("http://127.0.0.1:{port}/track.ogg"), log, served)
    }

    const LOOPBACK: [&str; 1] = ["http://127.0.0.1:"];

    /// A body big enough that 4,096 bytes is a real prefix of it rather than
    /// the whole thing.
    fn body_of(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    fn ranges_asked(log: &Arc<Mutex<Vec<String>>>) -> Vec<Option<u64>> {
        log.lock().unwrap().iter().map(|h| range_start(h)).collect()
    }

    #[tokio::test]
    async fn an_interrupted_download_leaves_a_resumable_part_that_reads_as_partial() {
        let dir = scratch("interrupted");
        let body = body_of(20_000);
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), 20_000);
        let dest = track_path(&dir, &t.file).unwrap();

        let (url, log, _served) = serve_mode(
            Mode::Truncated {
                announce: body.len(),
                send: 4_096,
            },
            body.clone(),
            1,
        );
        let error = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect_err("a body that stops short must not install");

        let part = dest.with_extension("part");
        assert_eq!(log.lock().unwrap().len(), 1, "the server saw one request");
        assert!(
            !dest.exists(),
            "a truncated download was renamed into place"
        );
        let size = std::fs::metadata(&part)
            .expect("the prefix was thrown away instead of kept")
            .len();
        assert_eq!(size, 4_096, "{error}");
        // The property the whole design rests on: what is kept is strictly
        // shorter than the file, so `present()` - which matches the final name
        // at its pinned size - cannot ever mistake it for an installed track.
        assert!(size < t.bytes);

        // And the status walk says so in the two lists rather than in one.
        let status = status_of(&dir, std::slice::from_ref(&t));
        assert!(
            status.installed_files.is_empty(),
            "a partial read as installed"
        );
        assert_eq!(status.partial_files, vec![t.file.clone()]);

        // Positive control on the same walk: the same track, whole, is
        // installed and is not reported as partial. Without this an empty
        // `installed_files` above would also be what a broken walk returns.
        std::fs::write(&dest, &body).unwrap();
        let status = status_of(&dir, std::slice::from_ref(&t));
        assert_eq!(status.installed_files, vec![t.file.clone()]);
        assert!(
            status.partial_files.is_empty(),
            "a finished file was demoted by the .part beside it"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_second_attempt_resumes_from_the_bytes_already_on_disk() {
        let dir = scratch("resume");
        let body = body_of(20_000);
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), 20_000);
        let dest = track_path(&dir, &t.file).unwrap();
        let part = dest.with_extension("part");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&part, &body[..4_096]).unwrap();

        let (url, log, _served) = serve_mode(Mode::Ranged, body.clone(), 1);
        let mut first_progress = None;
        let result = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |received, total| {
                if first_progress.is_none() {
                    first_progress = Some((received, total));
                }
            },
        )
        .await
        .expect("a resumed download verifies")
        .finished()
        .expect("a resumed download was not cancelled");

        // The server saw the continuation, and saw it at the right byte. This
        // is the assertion that separates a resume from a restart that
        // happened to end with the same file.
        assert_eq!(
            ranges_asked(&log),
            vec![Some(4_096)],
            "the second attempt did not ask to continue"
        );
        assert_eq!(result.bytes, 20_000);
        assert!(result.sha256.eq_ignore_ascii_case(&t.sha256));
        assert_eq!(
            std::fs::read(&dest).unwrap(),
            body,
            "the file is not the body"
        );
        assert!(!part.exists(), "the .part outlived a successful resume");
        // Progress starts from what was already there rather than from zero,
        // so a resumed install does not appear to lose its place.
        assert_eq!(first_progress, Some((4_096, 20_000)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_server_that_ignores_range_restarts_and_still_verifies() {
        let dir = scratch("norange");
        let body = body_of(20_000);
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), 20_000);
        let dest = track_path(&dir, &t.file).unwrap();
        let part = dest.with_extension("part");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        // Deliberately *not* a prefix of the body. If the restart failed to
        // discard it the hash would be wrong and this test would go red, which
        // is the only way to tell a restart from an append.
        std::fs::write(&part, vec![0xEEu8; 4_096]).unwrap();

        let (url, log, _served) = serve_mode(Mode::NoRange, body.clone(), 1);
        let result = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect("a restart verifies")
        .finished()
        .expect("a restart was not cancelled");

        // It did ask - the seam is not simply never sending a Range header -
        // and the server declined, and the file is still right.
        assert_eq!(ranges_asked(&log), vec![Some(4_096)]);
        assert_eq!(result.bytes, 20_000);
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(!part.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_resume_whose_sha_does_not_match_deletes_the_part_and_any_final() {
        let dir = scratch("resume-mismatch");
        let body = body_of(20_000);
        let mut corrupted = body.clone();
        corrupted[10_000] ^= 0xFF;
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), 20_000);
        let dest = track_path(&dir, &t.file).unwrap();
        let part = dest.with_extension("part");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&part, &body[..4_096]).unwrap();
        // A stale final from some earlier life, which a mismatch must also
        // take: leaving it would be a wrong file sitting under the right name.
        std::fs::write(&dest, b"stale").unwrap();

        let (url, log, _served) = serve_mode(Mode::Ranged, corrupted, 1);
        let error = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect_err("a resumed body with the wrong hash must not install");

        assert!(error.contains("checksum mismatch"), "{error}");
        assert_eq!(
            ranges_asked(&log),
            vec![Some(4_096)],
            "it did not resume at all"
        );
        assert!(!part.exists(), "a mismatched resume left its .part");
        assert!(!dest.exists(), "a mismatched resume left a final file");
        // And nothing is reported: neither installed nor partial, because
        // there is nothing on disk to continue from.
        let status = status_of(&dir, std::slice::from_ref(&t));
        assert!(status.installed_files.is_empty());
        assert!(status.partial_files.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_space_refusal_names_what_is_needed_and_what_is_there() {
        let gb = 1024u64 * 1024 * 1024;
        // Could not ask is not a refusal, and is not "there is plenty" either -
        // it is simply not a reason to stop.
        assert!(space_refusal(4 * gb, None).is_none());
        // Room to spare.
        assert!(space_refusal(gb, Some(10 * gb)).is_none());
        // Exactly the margin is the boundary, and it is not a refusal.
        assert!(space_refusal(gb, Some(gb + FREE_SPACE_MARGIN)).is_none());
        // One byte past it is.
        let message = space_refusal(gb + 1, Some(gb + FREE_SPACE_MARGIN))
            .expect("a request one byte past the margin must be refused");
        assert!(message.contains("1.0 GB"), "{message}");
        assert!(message.contains("1.5 GB"), "{message}");
        assert!(message.contains("500 MB"), "{message}");
        assert!(message.contains("Nothing was downloaded"), "{message}");
    }

    #[tokio::test]
    async fn an_install_with_too_little_room_refuses_before_a_single_request() {
        let dir = scratch("space");
        let body = body_of(20_000);
        let (url, log, _served) = serve_mode(Mode::Ranged, body.clone(), 2);
        let t = track(
            "radio/a.ogg",
            &url,
            &hex(Sha256::digest(&body)),
            body.len() as u64,
        );

        // Needed is 20,000 bytes; free is the margin exactly, so nothing at
        // all is usable.
        let error = install_into(
            &dir,
            std::slice::from_ref(&t),
            Some(FREE_SPACE_MARGIN),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _, _| {},
        )
        .await
        .expect_err("an install with no room must refuse");
        assert!(error.contains("not enough free space"), "{error}");
        assert!(error.contains("500 MB"), "{error}");
        assert!(error.contains("0 MB"), "{error}");
        // The point of refusing before the request rather than after the first
        // failed write. A server that could have answered saw nothing.
        assert_eq!(log.lock().unwrap().len(), 0, "the refusal still downloaded");
        assert!(status_of(&dir, std::slice::from_ref(&t))
            .installed_files
            .is_empty());
        assert!(status_of(&dir, std::slice::from_ref(&t))
            .partial_files
            .is_empty());

        // Positive control on the same call: with room, the identical install
        // runs and the file lands. Without this the zero above would also be
        // what a broken rig produces.
        let result = install_into(
            &dir,
            std::slice::from_ref(&t),
            Some(FREE_SPACE_MARGIN + 10 * 1024 * 1024),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _, _| {},
        )
        .await
        .expect("an install with room installs");
        assert_eq!(result.installed, 1);
        assert_eq!(log.lock().unwrap().len(), 1);
        assert_eq!(
            status_of(&dir, std::slice::from_ref(&t)).installed_files,
            vec![t.file.clone()]
        );

        // And "could not ask" does not refuse: a platform that cannot answer
        // must not block every install.
        let again = install_into(
            &dir,
            std::slice::from_ref(&t),
            None,
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _, _| {},
        )
        .await
        .expect("an unanswerable free-space question does not refuse");
        assert_eq!(again.installed, 1, "the already-present track was skipped");
        assert_eq!(
            log.lock().unwrap().len(),
            1,
            "a present track was refetched"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ------------------------------------------------- #402, the last item
    //
    // Cancel inside a file. The flag is raised from the progress callback
    // rather than from a timer, so these are decided by bytes and not by how
    // busy the machine is: the cancel lands at a known point every run.

    /// A body far larger than any socket buffer, so a client that hangs up
    /// leaves the server unable to finish writing it. That is what makes
    /// "the request stopped" checkable from the server's side.
    const BIG: usize = 1_000_000;
    /// Where the cancel is raised: four 16 kB pieces in, so what is asserted
    /// is a stop *part-way* and not a stop before the first byte.
    const CANCEL_AFTER: u64 = 65_536;

    #[tokio::test]
    async fn a_cancel_mid_file_stops_the_request_and_leaves_a_prefix_that_resumes() {
        let dir = scratch("cancel-midfile");
        let body = body_of(BIG);
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), BIG as u64);
        let dest = track_path(&dir, &t.file).unwrap();
        let part = dest.with_extension("part");

        let (url, log, served) = serve_mode(Mode::Slow { chunk: 16_384 }, body.clone(), 1);
        let flag = AtomicBool::new(false);
        let outcome = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &flag,
            |received, _| {
                if received >= CANCEL_AFTER {
                    flag.store(true, Ordering::SeqCst);
                }
            },
        )
        .await
        .expect("a cancel is not a failure and must not arrive as one");

        let DownloadOutcome::Cancelled { bytes } = outcome else {
            panic!("a cancelled download reported {outcome:?}");
        };
        assert!(
            bytes >= CANCEL_AFTER,
            "it stopped before the cancel: {bytes}"
        );
        assert!(
            (bytes as usize) < BIG,
            "it ran to the end anyway: {bytes} of {BIG}"
        );
        // What was reported is what is on disk, to the byte.
        assert_eq!(
            std::fs::metadata(&part)
                .expect("the cancelled prefix was thrown away")
                .len(),
            bytes
        );
        assert!(
            !dest.exists(),
            "a cancelled download was renamed into place"
        );
        // The request really stopped rather than being read to the end and
        // thrown away: nobody was reading, so the server could not get a body
        // this size through.
        let sent = served.load(Ordering::SeqCst);
        assert!(
            sent < BIG as u64,
            "the server served the whole body: {sent} of {BIG}"
        );
        assert_eq!(log.lock().unwrap().len(), 1, "it asked more than once");

        // The panel's two lists say partial: not installed, and not absent.
        let status = status_of(&dir, std::slice::from_ref(&t));
        assert!(
            status.installed_files.is_empty(),
            "a cancelled track read as installed"
        );
        assert_eq!(status.partial_files, vec![t.file.clone()]);

        // And Resume continues from exactly what the cancel left, rather than
        // starting the 1 MB again.
        let (resume_url, resume_log, _) = serve_mode(Mode::Ranged, body.clone(), 1);
        let result = download_verified_from(
            &resume_url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect("the resume verifies")
        .finished()
        .expect("the resume was not cancelled");
        assert_eq!(
            ranges_asked(&resume_log),
            vec![Some(bytes)],
            "it did not continue from what the cancel left"
        );
        assert_eq!(result.bytes, BIG as u64);
        assert!(result.sha256.eq_ignore_ascii_case(&t.sha256));
        assert_eq!(
            std::fs::read(&dest).unwrap(),
            body,
            "the file is not the body"
        );
        assert!(!part.exists(), "the .part outlived a successful resume");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn the_same_slow_server_runs_to_completion_when_nothing_cancels() {
        // The positive control for the test above. Without it, a `.part`
        // shorter than the file and a server that did not finish would also
        // be what a broken rig - a stalled server, a dropped connection -
        // produces, and the cancel would be proving nothing.
        let dir = scratch("cancel-control");
        let body = body_of(BIG);
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), BIG as u64);
        let dest = track_path(&dir, &t.file).unwrap();

        let (url, _log, served) = serve_mode(Mode::Slow { chunk: 16_384 }, body.clone(), 1);
        let result = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect("the same server, uncancelled, installs")
        .finished()
        .expect("nothing cancelled this one");
        assert_eq!(result.bytes, BIG as u64);
        assert_eq!(served.load(Ordering::SeqCst), BIG as u64);
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(!dest.with_extension("part").exists());
        assert_eq!(
            status_of(&dir, std::slice::from_ref(&t)).installed_files,
            vec![t.file.clone()]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_cancel_before_the_first_request_downloads_nothing() {
        let dir = scratch("cancel-before");
        let body = body_of(20_000);
        let t = track("radio/a.ogg", WIKI, &hex(Sha256::digest(&body)), 20_000);
        let dest = track_path(&dir, &t.file).unwrap();

        // Two connections, so the control below is answered by the same
        // server that the cancelled call was free to reach and did not.
        let (url, log, served) = serve_mode(Mode::Ranged, body.clone(), 2);
        let flag = AtomicBool::new(true);
        let outcome = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &flag,
            |_, _| {},
        )
        .await
        .expect("a cancel is not a failure");
        assert!(
            matches!(outcome, DownloadOutcome::Cancelled { bytes: 0 }),
            "{outcome:?}"
        );
        assert_eq!(
            log.lock().unwrap().len(),
            0,
            "a cancel before the first request still asked"
        );
        assert_eq!(served.load(Ordering::SeqCst), 0);
        assert!(!dest.exists());
        assert!(!dest.with_extension("part").exists());

        // Positive control on the same call and the same server: with the
        // flag clear it asks, and installs. Without this the zero above is
        // also what an unreachable server would produce.
        let result = download_verified_from(
            &url,
            &t.sha256,
            &dest.to_string_lossy(),
            &LOOPBACK,
            &NEVER_CANCELLED,
            |_, _| {},
        )
        .await
        .expect("an uncancelled download installs")
        .finished()
        .expect("nothing cancelled this one");
        assert_eq!(result.bytes, 20_000);
        assert_eq!(log.lock().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn an_install_cancelled_mid_file_reports_partial_and_the_next_one_resumes() {
        let dir = scratch("cancel-install");
        let body = body_of(BIG);
        let (url, _log, _served) = serve_mode(Mode::Slow { chunk: 16_384 }, body.clone(), 1);
        let t = track("radio/a.ogg", &url, &hex(Sha256::digest(&body)), BIG as u64);
        let dest = track_path(&dir, &t.file).unwrap();

        let flag = AtomicBool::new(false);
        let mut phases: Vec<String> = Vec::new();
        let result = install_into(
            &dir,
            std::slice::from_ref(&t),
            None,
            &LOOPBACK,
            &flag,
            |received, _, phase| {
                phases.push(phase.to_string());
                if phase == "downloading" && received >= CANCEL_AFTER {
                    flag.store(true, Ordering::SeqCst);
                }
            },
        )
        .await
        .expect("a cancelled install is not a failure");

        assert!(result.cancelled, "the install did not report the cancel");
        assert_eq!(
            result.installed, 0,
            "a track stopped part-way was counted as installed"
        );
        assert_eq!(result.total, 1);
        assert!(
            result.bytes >= CANCEL_AFTER && (result.bytes as usize) < BIG,
            "reported {} bytes",
            result.bytes
        );
        assert_eq!(
            phases.last().map(String::as_str),
            Some("cancelled"),
            "the last thing the panel heard was {:?}",
            phases.last()
        );
        assert_eq!(
            std::fs::metadata(dest.with_extension("part"))
                .expect("the cancelled install kept nothing to resume from")
                .len(),
            result.bytes
        );
        let status = status_of(&dir, std::slice::from_ref(&t));
        assert!(status.installed_files.is_empty());
        assert_eq!(status.partial_files, vec![t.file.clone()]);

        // Install again, against a server that honours the range. The flag is
        // still set from before, which the run must clear rather than trip
        // over: a cancel does not disable the next install.
        assert!(flag.load(Ordering::SeqCst));
        let (resume_url, resume_log, _) = serve_mode(Mode::Ranged, body.clone(), 1);
        let resumed = track("radio/a.ogg", &resume_url, &t.sha256, BIG as u64);
        let again = install_into(
            &dir,
            std::slice::from_ref(&resumed),
            None,
            &LOOPBACK,
            &flag,
            |_, _, _| {},
        )
        .await
        .expect("the resumed install runs");
        assert!(!again.cancelled, "a stale cancel blocked the next install");
        assert_eq!(again.installed, 1);
        assert_eq!(
            ranges_asked(&resume_log),
            vec![Some(result.bytes)],
            "the install restarted instead of resuming"
        );
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert_eq!(
            status_of(&dir, std::slice::from_ref(&resumed)).installed_files,
            vec![resumed.file.clone()]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
