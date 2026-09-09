//! Whether this build can update itself, answered by the build rather than by
//! a guess in the frontend.
//!
//! # What this exists to prevent
//!
//! `tauri-plugin-updater` needs two things in `tauri.conf.json`: at least one
//! `endpoints` URL, and a `pubkey` — the minisign public key whose private
//! half signed the installer. It verifies the downloaded bytes against that
//! key before running anything (`verify_signature`, `updater.rs:1524` of
//! `tauri-plugin-updater-2.11.0`), which is the whole reason the feature is
//! safe to have at all: without it, an updater is a program that downloads an
//! executable from the internet and runs it.
//!
//! The key is a credential and is not in this repository (see
//! `docs/RELEASE.md` §2.4), so the committed config carries an **empty**
//! `pubkey` until a release build supplies one. That is deliberate, and it
//! creates a state the app has to be honest about: a build in which the
//! updater exists, the endpoint is reachable, a new version genuinely is
//! announced — and nothing downloaded could ever be verified.
//!
//! Left unstated, that build would offer an update, download 217 MB, and fail
//! at the last step with a signature error, which reads to a player as "the
//! download is corrupt" and sends them to check their network. So the frontend
//! asks this first and refuses to start at all, saying plainly that this build
//! has no update channel and pointing at the releases page.
//!
//! Three states, not two: can update, cannot update, and failed while trying —
//! the same discipline `tools/verify-release-bundle.mjs` applies to the world
//! viewer, for the same reason.
//!
//! # Why it reads the config rather than a compile-time constant
//!
//! `tauri.conf.json` is baked into the binary at build time, so
//! `app.config()` is a property of the artefact a player is holding. A
//! constant in Rust would be a second copy of the same fact and would drift
//! from the config the plugin actually uses — which is the defect the version
//! work in this same change is about.

use std::collections::HashMap;

/// `true` when this binary was built with a non-empty updater public key.
///
/// Reads the config the plugin itself reads. An absent `plugins.updater`
/// section, an absent `pubkey`, or a `pubkey` of whitespace all answer
/// `false`: those are the same situation to a player, and distinguishing them
/// in the UI would be a distinction only a developer could act on.
#[tauri::command]
pub fn updater_configured(app: tauri::AppHandle) -> bool {
    pubkey_is_set(&app.config().plugins.0)
}

/// Split out so the test can reach it without an `AppHandle`, which needs a
/// running Tauri context.
fn pubkey_is_set(plugins: &HashMap<String, serde_json::Value>) -> bool {
    plugins
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|k| k.as_str())
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::pubkey_is_set;
    use serde_json::{json, Value};
    use std::collections::HashMap;

    /// `PluginConfig` is a `HashMap`, not serde_json's ordered `Map`, so the
    /// fixtures are built as one. Read off the compiler rather than guessed:
    /// the first version of this file took `&serde_json::Map` and did not
    /// compile against `app.config().plugins.0`.
    fn plugins(v: Value) -> HashMap<String, Value> {
        v.as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    #[test]
    fn a_real_key_is_configured() {
        assert!(pubkey_is_set(&plugins(json!({
            "updater": { "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6..." }
        }))));
    }

    #[test]
    fn an_empty_key_is_not() {
        assert!(!pubkey_is_set(&plugins(
            json!({ "updater": { "pubkey": "" } })
        )));
    }

    /// The one that matters. A key of spaces is what a half-finished edit
    /// leaves behind, and it would satisfy any check written as "the field is
    /// present".
    #[test]
    fn whitespace_is_not_a_key() {
        assert!(!pubkey_is_set(&plugins(
            json!({ "updater": { "pubkey": "   \n" } })
        )));
    }

    #[test]
    fn a_missing_section_is_not_configured() {
        assert!(!pubkey_is_set(&plugins(json!({ "somethingelse": {} }))));
        assert!(!pubkey_is_set(&plugins(json!({ "updater": {} }))));
    }
}
