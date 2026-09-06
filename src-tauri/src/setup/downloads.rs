//! Verified release-asset downloads and setup progress events.
//!
//! # A failed attempt leaves a resumable prefix or nothing
//!
//! #402 found that an interrupted download orphaned its `.part` forever: the
//! temporary was removed on a checksum mismatch and on no other path, so a
//! dropped connection left bytes on disk that `present()` could not see, that
//! no retry read, and that nothing ever deleted. Re-verified against a
//! loopback server that announces 1,000,000 bytes and sends 4,096 before
//! hanging up - `error decoding response body`, no final file, `.part` left
//! at 4,096 bytes.
//!
//! Deleting it was the smaller fix and the wrong one. The music library is
//! 4.36 GB across 182 files, the largest single file about 90 MB, and every
//! URL is sha256-pinned, so the bytes already on disk are worth keeping: a
//! restart throws away up to 90 MB per interruption and a flaky connection
//! can make no progress at all. So the temporary is a *resume point*:
//!
//! - the next attempt sends `Range: bytes=<what is on disk>-`, and continues
//!   only on a `206` the server did not disclaim with `Accept-Ranges: none`;
//! - a server that answers `200` instead is one that ignored the range, so
//!   the prefix is dropped and the file restarts from zero;
//! - `416` means the prefix is at or past the end of the resource and is not
//!   a prefix of it at all, so that too restarts;
//! - the resumed bytes are **read back off disk and hashed**, never carried
//!   over from the attempt that wrote them, so the sha256 covers the whole
//!   file exactly as it is about to be renamed into place;
//! - a mismatch deletes the `.part` *and* any final file, because a resume
//!   that produced the wrong bytes must not leave either half behind;
//! - and any other failure keeps the `.part` only when it is a resumable
//!   prefix - some bytes, strictly fewer than a length the server actually
//!   announced. Anything else is removed. So a failed attempt leaves either
//!   something the next one continues from or nothing, never an orphan, and
//!   the kept prefix is always shorter than the file so `present()` (which
//!   matches the final name at its pinned size) cannot mistake it for an
//!   installed track.

use super::hex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct Progress {
    pub id: String,
    pub received: u64,
    pub total: u64,
    pub phase: String,
}

pub(crate) fn emit_setup_progress<R: tauri::Runtime>(
    app: &AppHandle<R>,
    id: impl Into<String>,
    received: u64,
    total: u64,
    phase: &str,
) {
    let _ = app.emit(
        "setup://progress",
        Progress {
            id: id.into(),
            received,
            total,
            phase: phase.into(),
        },
    );
}

#[derive(Serialize, Clone, Debug)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub verified: bool,
}

/// Every place this app is allowed to fetch bytes from.
///
/// One list rather than a per-caller check, so a new download path cannot
/// quietly widen it: the first three are the setup wizard's (Lich, Genie, and
/// the object host GitHub redirects release assets to), the last two are the
/// optional music library's sources - the only two hosts
/// `data/audio/manifest.json` names across all 182 entries.
///
/// These are URL *prefixes*, matched with `starts_with`, so the path is part
/// of the check and the host cannot be reached through a path segment of some
/// other URL.
pub(crate) const ALLOWED_DOWNLOAD_PREFIXES: [&str; 5] = [
    "https://github.com/elanthia-online/",
    "https://github.com/GenieClient/",
    "https://objects.githubusercontent.com/",
    "https://upload.wikimedia.org/wikipedia/commons/",
    "https://opengameart.org/sites/default/files/",
];

/// The one host rule, with the list as a parameter.
///
/// One predicate rather than a copy of `starts_with` at each call site: the
/// verifier, the music installer's per-track check and the tests all ask this
/// function, so there is no second reading of the allowlist to drift from it.
pub(crate) fn allowed_by(url: &str, allowed: &[&str]) -> bool {
    allowed.iter().any(|prefix| url.starts_with(prefix))
}

/// Fetch one release asset and verify it before moving it into place.
pub async fn download_verified(
    url: &str,
    expected_sha256: &str,
    dest: &str,
    on_progress: impl FnMut(u64, u64),
) -> Result<DownloadResult, String> {
    download_verified_from(
        url,
        expected_sha256,
        dest,
        &ALLOWED_DOWNLOAD_PREFIXES,
        on_progress,
    )
    .await
}

/// The body of `download_verified`, with the allowlist as a parameter.
///
/// The parameter exists so the verifier can be run deliberately in a test
/// against a local server, rather than only against hosts nobody can make
/// answer wrongly on demand - CLAUDE.md's "a branch nobody can execute on
/// purpose is a branch nobody can prove they fixed". Every shipping caller
/// goes through `download_verified` and gets `ALLOWED_DOWNLOAD_PREFIXES`;
/// nothing here reads an environment variable, so the seam cannot be opened
/// at run time.
pub(crate) async fn download_verified_from(
    url: &str,
    expected_sha256: &str,
    dest: &str,
    allowed: &[&str],
    mut on_progress: impl FnMut(u64, u64),
) -> Result<DownloadResult, String> {
    if !allowed_by(url, allowed) {
        return Err(format!(
            "refusing to download from an unexpected host: {url}"
        ));
    }

    let destination = PathBuf::from(dest);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temporary = destination.with_extension("part");
    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .map_err(|error| error.to_string())?;

    // What a previous attempt left. Anything that is not a plain file of
    // non-zero length is not a resume point.
    let mut have = std::fs::metadata(&temporary)
        .ok()
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .unwrap_or(0);

    let mut response = request(&client, url, have).await?;
    if have > 0 && response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        // The prefix is at or past the end of what the server is serving, so
        // it is not a prefix of this resource. Start again rather than argue.
        let _ = std::fs::remove_file(&temporary);
        have = 0;
        response = request(&client, url, 0).await?;
    }
    if !response.status().is_success() {
        // Nothing was written this time; whatever is on disk is still the
        // previous attempt's resume point and is left alone.
        return Err(format!("download failed: HTTP {}", response.status()));
    }

    // A resume needs the server to have actually honoured the range. A `200`
    // here is a server that ignored it and is about to send the whole file
    // from byte zero; `Accept-Ranges: none` is one saying so outright.
    let resuming = have > 0
        && response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        && !response
            .headers()
            .get(reqwest::header::ACCEPT_RANGES)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.eq_ignore_ascii_case("none"));

    let body_length = response.content_length().unwrap_or(0);
    // What the whole file is supposed to weigh, which is the number a kept
    // `.part` has to stay under. Zero means the server never said, and a
    // length nobody announced cannot be used to judge a prefix.
    let announced = if resuming {
        body_length.saturating_add(have)
    } else {
        body_length
    };

    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut file = if resuming {
        // Nothing has been written this attempt, so the prefix on disk is
        // exactly as the last one left it: judged by the same rule as any
        // other failure rather than deleted for being unreadable once.
        let (handle, hashed) =
            reopen_for_resume(&temporary, have, &mut hasher).inspect_err(|_| {
                settle_partial(&temporary, have, announced);
            })?;
        received = hashed;
        on_progress(received, announced);
        handle
    } else {
        std::fs::File::create(&temporary).map_err(|error| error.to_string())?
    };

    let mut stream = response;
    loop {
        let chunk = match stream.chunk().await {
            Ok(chunk) => chunk,
            Err(error) => {
                let _ = file.flush();
                drop(file);
                settle_partial(&temporary, received, announced);
                return Err(error.to_string());
            }
        };
        let Some(bytes) = chunk else { break };
        hasher.update(&bytes);
        if let Err(error) = file.write_all(&bytes) {
            drop(file);
            settle_partial(&temporary, received, announced);
            return Err(error.to_string());
        }
        received += bytes.len() as u64;
        on_progress(received, announced);
    }
    if let Err(error) = file.flush() {
        drop(file);
        settle_partial(&temporary, received, announced);
        return Err(error.to_string());
    }
    drop(file);

    if announced > 0 && received < announced {
        // The body ended short of what the server announced. Hashing this
        // would only produce a mismatch and delete a prefix that is exactly
        // what the next attempt would ask to continue from.
        settle_partial(&temporary, received, announced);
        return Err(format!(
            "download ended early: {received} of {announced} bytes. What arrived was kept and the next attempt continues from it."
        ));
    }

    let actual_sha = hex(hasher.finalize());
    if !expected_sha256.is_empty() && !actual_sha.eq_ignore_ascii_case(expected_sha256) {
        // Both, not just the temporary. A resume that produced the wrong
        // bytes must not leave a prefix the next attempt would build on, and
        // must not leave a final file either.
        let _ = std::fs::remove_file(&temporary);
        let _ = std::fs::remove_file(&destination);
        return Err(format!(
            "checksum mismatch. Expected {expected_sha256}, got {actual_sha}. The file was deleted and nothing was installed."
        ));
    }
    std::fs::rename(&temporary, &destination).map_err(|error| error.to_string())?;

    Ok(DownloadResult {
        path: destination.to_string_lossy().into_owned(),
        bytes: received,
        sha256: actual_sha,
        verified: true,
    })
}

/// One GET, asking to continue from `have` when there is anything to continue.
async fn request(
    client: &reqwest::Client,
    url: &str,
    have: u64,
) -> Result<reqwest::Response, String> {
    let mut builder = client.get(url);
    if have > 0 {
        builder = builder.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    builder.send().await.map_err(|error| error.to_string())
}

/// Hash the `have` bytes already on disk and hand back a handle positioned to
/// append after them.
///
/// The hash is taken from the file rather than remembered from the attempt
/// that wrote it, so the sha256 at the end covers the bytes that are actually
/// about to be renamed into place. `set_len` first, so a `.part` that somehow
/// grew past what the range asked to continue from cannot leave a hole.
fn reopen_for_resume(
    temporary: &Path,
    have: u64,
    hasher: &mut Sha256,
) -> Result<(std::fs::File, u64), String> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(temporary)
        .map_err(|error| error.to_string())?;
    file.set_len(have).map_err(|error| error.to_string())?;
    let mut hashed = 0u64;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        hashed += read as u64;
    }
    if hashed != have {
        return Err(format!(
            "could not re-read the partial download: expected {have} bytes, read {hashed}"
        ));
    }
    file.seek(SeekFrom::End(0))
        .map_err(|error| error.to_string())?;
    Ok((file, hashed))
}

/// What becomes of the `.part` when an attempt fails.
///
/// Kept only when it is a resumable prefix: bytes on disk, strictly fewer than
/// a length the server actually announced. Everything else is removed, which
/// is the whole of #402's item 1 - a failure leaves either something the next
/// attempt continues from, or nothing.
fn settle_partial(temporary: &Path, received: u64, announced: u64) {
    let resumable = received > 0 && announced > 0 && received < announced;
    if !resumable {
        let _ = std::fs::remove_file(temporary);
    }
}

#[tauri::command]
pub async fn download_component(
    app: AppHandle,
    id: String,
    url: String,
    expected_sha256: String,
    dest: String,
) -> Result<DownloadResult, String> {
    let progress_id = id.clone();
    let progress_app = app.clone();
    let result = download_verified(&url, &expected_sha256, &dest, move |received, total| {
        emit_setup_progress(
            &progress_app,
            progress_id.clone(),
            received,
            total,
            "downloading",
        );
    })
    .await?;
    emit_setup_progress(&app, id, result.bytes, result.bytes, "verified");
    Ok(result)
}
