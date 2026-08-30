//! One page of Elanthipedia (the DragonRealms player wiki), fetched live -
//! Dan's ask, 30 Aug 2026: "live fetch on hover... and then only for rooms
//! that the player chooses to WATCH CAREFULLY... This is for rooms that
//! need frequent updating for whatever reason, likely a festival."
//!
//! Two things make this a defensible thing to build against someone else's
//! wiki rather than a bulk scrape: it goes through MediaWiki's own `api.php`
//! (the sanctioned way to ask a MediaWiki site a question, not screen-
//! scraping its rendered HTML), and the frontend only ever calls it for a
//! room a player explicitly marked to watch, rate-limited to once a minute
//! per title - see `useWatchedRoom.ts`'s cache. This module does not enforce
//! that limit itself; it is a thin, honest fetch, and the frontend is where
//! "only for watched rooms, no more than once a minute" actually lives,
//! since that is a product decision about how the feature is used, not a
//! property of the wiki call itself.
//!
//! Runs through Rust rather than the webview because a browser fetch from
//! this app's own origin to elanthipedia.play.net would be blocked by CORS
//! long before it got an answer - MediaWiki does not send the headers that
//! would allow it, and it has no reason to.

use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "dr-companion (https://github.com/dancockrell/dr-companion)";

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ElanthipediaPage {
    pub found: bool,
    /// The page actually resolved to, after redirects - may differ from the
    /// title asked for, so the caller can show which page answered.
    pub title: String,
    /// Plain text, not wikitext or rendered HTML - `explaintext` on the API
    /// call does that conversion server-side, so this app never has to
    /// parse MediaWiki markup itself.
    pub extract: String,
    /// The page's own thumbnail/lead image, if it has one. Absent (not a
    /// broken string) when there isn't one - most room pages don't.
    pub image_url: Option<String>,
    pub page_url: String,
    pub note: String,
}

#[derive(Deserialize)]
struct QueryResponse {
    query: Option<QueryResult>,
}

#[derive(Deserialize)]
struct QueryResult {
    pages: std::collections::HashMap<String, PageResult>,
}

#[derive(Deserialize)]
struct PageResult {
    title: String,
    #[serde(default)]
    missing: Option<String>,
    #[serde(default)]
    extract: Option<String>,
    #[serde(default)]
    original: Option<ImageSource>,
}

#[derive(Deserialize)]
struct ImageSource {
    source: String,
}

/// A page by title, or an honest account of not finding one - never an
/// error the caller has to unpack, since "no such page" is an expected,
/// common answer (a room's title is a guess at the wiki's own page name,
/// and guesses miss).
#[tauri::command]
pub async fn fetch_elanthipedia(title: String) -> ElanthipediaPage {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return ElanthipediaPage {
            note: "No title given.".into(),
            ..Default::default()
        };
    }

    let client = match reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return ElanthipediaPage {
                note: format!("Could not build a request: {e}"),
                ..Default::default()
            }
        }
    };

    let res = client
        .get("https://elanthipedia.play.net/api.php")
        .query(&[
            ("action", "query"),
            ("titles", trimmed),
            ("prop", "extracts|pageimages"),
            ("exintro", "1"),
            ("explaintext", "1"),
            ("piprop", "original"),
            ("redirects", "1"),
            ("format", "json"),
        ])
        .send()
        .await;

    let res = match res {
        Ok(r) => r,
        Err(e) => {
            return ElanthipediaPage {
                note: format!("Elanthipedia did not answer: {e}"),
                ..Default::default()
            }
        }
    };

    if !res.status().is_success() {
        return ElanthipediaPage {
            note: format!("Elanthipedia returned HTTP {}", res.status()),
            ..Default::default()
        };
    }

    let parsed = match res.json::<QueryResponse>().await {
        Ok(p) => p,
        Err(e) => {
            return ElanthipediaPage {
                note: format!("Could not read Elanthipedia's answer: {e}"),
                ..Default::default()
            }
        }
    };

    let Some(query) = parsed.query else {
        return ElanthipediaPage {
            note: "Elanthipedia's answer had no page data.".into(),
            ..Default::default()
        };
    };

    // A single-page query still comes back as a map keyed by page id -
    // MediaWiki's own shape, not this app's choice.
    let Some(page) = query.pages.into_values().next() else {
        return ElanthipediaPage {
            note: "Elanthipedia's answer named no page at all.".into(),
            ..Default::default()
        };
    };

    if page.missing.is_some() {
        return ElanthipediaPage {
            title: page.title.clone(),
            note: format!("No Elanthipedia page named \"{}\".", page.title),
            ..Default::default()
        };
    }

    let page_url = format!(
        "https://elanthipedia.play.net/{}",
        page.title.replace(' ', "_")
    );

    ElanthipediaPage {
        found: true,
        title: page.title,
        extract: page.extract.unwrap_or_default(),
        image_url: page.original.map(|i| i.source),
        page_url,
        note: String::new(),
    }
}
