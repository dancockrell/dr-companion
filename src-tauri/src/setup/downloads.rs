//! Verified release-asset downloads and setup progress events.

use super::hex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::PathBuf;
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

#[derive(Serialize, Clone)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub verified: bool,
}

/// Fetch one release asset and verify it before moving it into place.
pub async fn download_verified(
    url: &str,
    expected_sha256: &str,
    dest: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<DownloadResult, String> {
    const ALLOWED: [&str; 3] = [
        "https://github.com/elanthia-online/",
        "https://github.com/GenieClient/",
        "https://objects.githubusercontent.com/",
    ];
    if !ALLOWED.iter().any(|prefix| url.starts_with(prefix)) {
        return Err(format!(
            "refusing to download from an unexpected host: {url}"
        ));
    }

    let destination = PathBuf::from(dest);
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("download failed: HTTP {}", response.status()));
    }
    let total = response.content_length().unwrap_or(0);
    let temporary = destination.with_extension("part");
    let mut file = std::fs::File::create(&temporary).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut received = 0;
    let mut stream = response;

    loop {
        let chunk = stream.chunk().await.map_err(|error| error.to_string())?;
        let Some(bytes) = chunk else { break };
        hasher.update(&bytes);
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        received += bytes.len() as u64;
        on_progress(received, total);
    }
    file.flush().map_err(|error| error.to_string())?;
    drop(file);

    let actual_sha = hex(hasher.finalize());
    if !expected_sha256.is_empty() && !actual_sha.eq_ignore_ascii_case(expected_sha256) {
        let _ = std::fs::remove_file(&temporary);
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
