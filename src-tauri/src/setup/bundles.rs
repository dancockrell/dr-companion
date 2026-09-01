//! Installation of file bundles sourced from GitHub repositories.
//!
//! Genie plugins, maps, and DR scripts are committed files rather than release
//! assets. GitHub's contents API supplies a git blob SHA for each file, which
//! lets setup verify the exact bytes before writing them.

use super::{emit_setup_progress, hex};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Deserialize)]
struct GhContent {
    name: String,
    #[serde(default)]
    size: u64,
    sha: String,
    #[serde(rename = "type")]
    kind: String,
    download_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BundleFile {
    pub name: String,
    pub bytes: u64,
    /// Git blob SHA-1 from the contents API.
    pub sha: String,
    pub url: String,
}

pub async fn list_repo_files(repo: &str, path: &str, exts: &[&str]) -> Vec<BundleFile> {
    let client = match reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
    {
        Ok(client) => client,
        Err(_) => return Vec::new(),
    };
    let url = if path.is_empty() {
        format!("https://api.github.com/repos/{repo}/contents")
    } else {
        format!("https://api.github.com/repos/{repo}/contents/{path}")
    };
    let Ok(response) = client.get(&url).send().await else {
        return Vec::new();
    };
    if !response.status().is_success() {
        return Vec::new();
    }
    let Ok(items) = response.json::<Vec<GhContent>>().await else {
        return Vec::new();
    };

    items
        .into_iter()
        .filter(|item| item.kind == "file")
        .filter(|item| {
            exts.is_empty()
                || exts
                    .iter()
                    .any(|ext| item.name.to_lowercase().ends_with(&ext.to_lowercase()))
        })
        .filter_map(|item| {
            item.download_url.map(|url| BundleFile {
                name: item.name,
                bytes: item.size,
                sha: item.sha,
                url,
            })
        })
        .collect()
}

fn git_blob_sha(bytes: &[u8]) -> String {
    use sha1::{Digest as _, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(format!("blob {}\0", bytes.len()).as_bytes());
    hasher.update(bytes);
    hex(hasher.finalize())
}

/// Fetch repository files into `target`, verifying each blob before writing.
pub async fn install_bundle_inner(
    files: &[BundleFile],
    target: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<String, String> {
    let dir = PathBuf::from(target);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .map_err(|error| error.to_string())?;
    let total = files.iter().map(|file| file.bytes).sum();
    let mut done = 0;
    let mut written = 0;

    for file in files {
        if !file
            .url
            .starts_with("https://raw.githubusercontent.com/GenieClient/")
            && !file
                .url
                .starts_with("https://raw.githubusercontent.com/elanthia-online/")
        {
            return Err(format!("refusing an unexpected file host: {}", file.url));
        }
        let response = client
            .get(&file.url)
            .send()
            .await
            .map_err(|error| format!("{}: {error}", file.name))?;
        if !response.status().is_success() {
            return Err(format!("{}: HTTP {}", file.name, response.status()));
        }
        let body = response
            .bytes()
            .await
            .map_err(|error| format!("{}: {error}", file.name))?;
        let actual_sha = git_blob_sha(&body);
        if !actual_sha.eq_ignore_ascii_case(&file.sha) {
            return Err(format!(
                "{} failed verification. Expected git blob {}, got {}. Nothing further was installed.",
                file.name, file.sha, actual_sha
            ));
        }
        std::fs::write(dir.join(&file.name), &body).map_err(|error| error.to_string())?;
        written += 1;
        done += file.bytes;
        on_progress(done, total);
    }

    Ok(format!(
        "{written} files verified and installed to {target}"
    ))
}

#[tauri::command]
pub async fn install_bundle(
    app: AppHandle,
    id: String,
    files: Vec<BundleFile>,
    target: String,
) -> Result<String, String> {
    let progress_id = id.clone();
    let progress_app = app.clone();
    let result = install_bundle_inner(&files, &target, move |received, total| {
        emit_setup_progress(
            &progress_app,
            progress_id.clone(),
            received,
            total,
            "downloading",
        );
    })
    .await?;
    let total = files.iter().map(|file| file.bytes).sum();
    emit_setup_progress(&app, id, total, total, "verified");
    Ok(result)
}
