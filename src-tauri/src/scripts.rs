//! Reading, writing and listing the player's own scripts.
//!
//! Two languages, because the app sits on top of two things. Python is this
//! app's scripting language and runs as a separate process against the script
//! API (`python.rs`). Ruby is Lich's, and a Ruby script is a Lich script: it
//! goes in Lich's own `scripts` folder and is started through the bridge, the
//! same way any other Lich script is.
//!
//! That split is not a design preference, it is where each language can
//! actually run. A Ruby file in this app's task folder would never execute; a
//! Python file in Lich's would never be found. So the destination is decided
//! by the language rather than offered as a choice, and the UI says which is
//! which.
//!
//! # What this module will not do
//!
//! It does not run anything. Python scripts run through `python.rs`, Ruby
//! through the bridge's `start_script` intent, both of which existed already
//! and both of which have their own safety properties - the rate cap, the
//! pause gate, Lich's own script handling. A second execution path here would
//! bypass all of it, which is exactly the kind of shortcut that ends up being
//! the only path that matters.
//!
//! # Names
//!
//! A script name is validated to a bare stem: letters, digits, underscore,
//! hyphen. No extension, no separators, no dots. The name arrives from the
//! webview and becomes a filename, so this is the boundary that has to hold,
//! and an allowlist holds it without needing to anticipate what to reject.

use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

/// Largest script this will read or write.
///
/// Generous for source, small enough that a mistyped path pointing at
/// something enormous fails fast instead of pulling it into the webview.
const MAX_BYTES: usize = 512 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    Python,
    Ruby,
}

impl Lang {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "python" => Some(Self::Python),
            "ruby" => Some(Self::Ruby),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Python => "py",
            // Lich's own extension. A `.rb` in that folder is not offered as a
            // script by Lich, so writing one would produce a file that looks
            // installed and cannot be run.
            Self::Ruby => "lic",
        }
    }
}

/// A script the player can open.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptFile {
    pub name: String,
    /// "python" or "ruby".
    pub lang: String,
    pub path: String,
    pub bytes: u64,
    /// First line of the script's own docstring or comment header, when it has
    /// one. What the author already wrote, rather than a field to fill in.
    pub summary: String,
}

/// Where each language's scripts live, and whether that place is usable.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDirs {
    pub python_dir: Option<String>,
    pub ruby_dir: Option<String>,
    /// Why one of them is missing, when one is. Never silence: a Ruby tab that
    /// simply shows nothing is indistinguishable from a Ruby tab that cannot
    /// find Lich, and only one of those is the player's problem to fix.
    pub note: String,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.starts_with('-')
        && !name.starts_with('_')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn python_dir(app: &AppHandle) -> Option<PathBuf> {
    let base = crate::python::tasks_dir(app)?;
    let dir = base.join("tasks").join("user");
    // Created on demand rather than at install: a folder that exists because
    // somebody opened the panel is harmless, and its absence would otherwise
    // read as "Python scripting is unavailable".
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn ruby_dir(app: &AppHandle) -> Option<PathBuf> {
    let _ = app;
    crate::setup::lich_scripts_dir()
}

fn dir_for(app: &AppHandle, lang: Lang) -> Option<PathBuf> {
    match lang {
        Lang::Python => python_dir(app),
        Lang::Ruby => ruby_dir(app),
    }
}

/// The first substantive line inside a Ruby `=begin`...`=end` header block -
/// dr-scripts' own convention (measured against a real install at
/// `C:\Ruby4Lich5\Lich5\scripts`: 223 of 234 files use it, `#` line comments
/// are the exception in that suite, not the rule the rest of `summarise`
/// assumed). `#trim_start_matches('#')` on a line that starts with `=begin`
/// leaves it unchanged, which `summarise` reads as "this is code, stop" -
/// so every dr-scripts file was getting an empty summary before this, not
/// because it had none but because the reader was looking for the wrong
/// comment style entirely.
///
/// Most of those files' blocks hold nothing but `Documentation: <url>`,
/// which is skipped rather than returned: a link is not a description, and
/// every script with only a link would otherwise show the identical
/// non-answer. `None` when the file has no `=begin` block at all (a
/// hand-written script using ordinary `#` comments), so the caller falls
/// back to that reading instead.
fn summarise_ruby_block(body: &str) -> Option<String> {
    let mut lines = body.lines();
    // The block is sometimes preceded by a magic comment
    // (`# frozen_string_literal: true`), so `=begin` is looked for within
    // the first few lines rather than required to be the very first one.
    let opened = lines.by_ref().take(5).any(|l| l.trim() == "=begin");
    if !opened {
        return None;
    }
    for line in lines.take(20) {
        let text = line.trim();
        if text == "=end" {
            break;
        }
        if text.is_empty() || text.starts_with("Documentation:") {
            continue;
        }
        return Some(text.chars().take(120).collect());
    }
    // The block exists and holds nothing usable (only the doc link, or
    // nothing at all) - that is a real answer, not a missing block, and
    // falling through to the `#`-comment reader below would misread `=end`
    // or `=begin` itself as a line of code and (correctly) still find
    // nothing, just by a slower and less honest route.
    Some(String::new())
}

/// The first line of a script's header comment or docstring.
///
/// Best effort by design: a script with no header gets an empty summary and
/// the UI says nothing rather than inventing something. Guessing a purpose
/// from the code would be a claim the file does not make.
fn summarise(body: &str, lang: Lang) -> String {
    if lang == Lang::Ruby {
        if let Some(text) = summarise_ruby_block(body) {
            return text;
        }
    }
    for raw in body.lines().take(12) {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let text = match lang {
            Lang::Python => line
                .trim_start_matches("\"\"\"")
                .trim_start_matches("'''")
                .trim_start_matches('#'),
            Lang::Ruby => line.trim_start_matches('#'),
        };
        let text = text
            .trim()
            .trim_end_matches("\"\"\"")
            .trim_end_matches("'''");
        if text.is_empty() || text == raw.trim() {
            // Unchanged means this line was code, not a comment. Stop rather
            // than walking into the body and quoting a line of logic as a
            // description.
            if !line.starts_with('#') && !line.starts_with("\"\"\"") && !line.starts_with("'''") {
                return String::new();
            }
            continue;
        }
        return text.chars().take(120).collect();
    }
    String::new()
}

#[tauri::command]
pub fn script_dirs(app: AppHandle) -> ScriptDirs {
    let py = python_dir(&app);
    let rb = ruby_dir(&app);
    let note = match (&py, &rb) {
        (None, None) => "Neither the task folder nor Lich's scripts folder could be found.".into(),
        (None, _) => "The app's Python task folder could not be found in this build.".into(),
        (_, None) => {
            "Lich's scripts folder was not found, so Ruby scripts cannot be saved or run yet. \
             Finish Lich setup first."
                .into()
        }
        _ => String::new(),
    };
    ScriptDirs {
        python_dir: py.map(|p| p.to_string_lossy().into_owned()),
        ruby_dir: rb.map(|p| p.to_string_lossy().into_owned()),
        note,
    }
}

/// Every script the player owns, in both languages.
///
/// Lich's folder holds scripts this app did not write - dr-scripts, whatever
/// the player installed - and they are all listed. Hiding them would make the
/// browser lie about what is installed, and they are exactly the files
/// somebody most wants to read.
#[tauri::command]
pub fn list_scripts(app: AppHandle) -> Vec<ScriptFile> {
    let mut out = Vec::new();
    for (lang, label) in [(Lang::Python, "python"), (Lang::Ruby, "ruby")] {
        let Some(dir) = dir_for(&app, lang) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some(lang.extension()) {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if stem.starts_with('_') {
                continue;
            }
            let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            // Only the head is read for the summary. Listing a folder must not
            // cost the size of everything in it.
            let head = std::fs::read(&path)
                .map(|b| String::from_utf8_lossy(&b[..b.len().min(2048)]).into_owned())
                .unwrap_or_default();
            out.push(ScriptFile {
                name: stem.to_string(),
                lang: label.to_string(),
                path: path.to_string_lossy().into_owned(),
                bytes,
                summary: summarise(&head, lang),
            });
        }
    }
    out.sort_by(|a, b| (&a.lang, &a.name).cmp(&(&b.lang, &b.name)));
    out
}

fn resolve(app: &AppHandle, lang: &str, name: &str) -> Result<(PathBuf, Lang), String> {
    let lang = Lang::parse(lang).ok_or("Unknown language.")?;
    if !valid_name(name) {
        return Err(format!(
            "{name:?} is not a usable script name. Letters, digits, hyphen and \
             underscore, no extension."
        ));
    }
    let dir = dir_for(app, lang).ok_or_else(|| match lang {
        Lang::Python => "The Python task folder could not be found.".to_string(),
        Lang::Ruby => "Lich's scripts folder was not found. Finish Lich setup first.".to_string(),
    })?;
    let path = dir.join(format!("{name}.{}", lang.extension()));

    // Belt and braces. `valid_name` already forecloses traversal, but the file
    // is what actually matters, so the resolved path is checked to still be
    // inside the folder it was built from. Cheap, and it survives somebody
    // later relaxing the name rule without noticing this depended on it.
    if path.parent() != Some(dir.as_path()) {
        return Err("That name does not resolve inside the scripts folder.".into());
    }
    Ok((path, lang))
}

#[tauri::command]
pub fn read_script(app: AppHandle, lang: String, name: String) -> Result<String, String> {
    let (path, _) = resolve(&app, &lang, &name)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if bytes as usize > MAX_BYTES {
        return Err(format!(
            "{name} is {bytes} bytes, larger than this editor will open. Edit it \
             in a text editor instead."
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("Could not read {name}: {e}"))
}

/// Save a script, and answer with where it went.
///
/// The path is returned rather than assumed, because "saved" without a
/// location is the kind of success message that hides having written to
/// somewhere nobody expected.
#[tauri::command]
pub fn write_script(
    app: AppHandle,
    lang: String,
    name: String,
    body: String,
) -> Result<String, String> {
    if body.len() > MAX_BYTES {
        return Err(format!("That script is larger than {MAX_BYTES} bytes."));
    }
    let (path, _) = resolve(&app, &lang, &name)?;

    // Written to a neighbouring temporary file and renamed, so an interrupted
    // save cannot leave a half-written script where a whole one was. A player
    // editing something that already works deserves not to lose it to a crash
    // mid-write.
    let tmp = path.with_extension("tmp-save");
    std::fs::write(&tmp, body.as_bytes()).map_err(|e| format!("Could not write {name}: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {name}: {e}")
    })?;

    Ok(path.to_string_lossy().into_owned())
}

/// Delete a script. Only ever the player's own Python folder.
///
/// Lich's folder is deliberately excluded. It holds dr-scripts and anything
/// else the player installed, this app did not put them there, and a delete
/// button in a browser that lists them is one misclick from removing somebody
/// else's work. Deleting a Lich script is a thing to do in Lich's own folder,
/// where the person doing it can see what it is.
#[tauri::command]
pub fn delete_script(app: AppHandle, lang: String, name: String) -> Result<(), String> {
    let (path, lang) = resolve(&app, &lang, &name)?;
    if lang == Lang::Ruby {
        return Err(
            "Ruby scripts are not deleted from here - that folder holds Lich's own \
             scripts too. Open the folder and delete it there."
                .into(),
        );
    }
    std::fs::remove_file(&path).map_err(|e| format!("Could not delete {name}: {e}"))
}

/// A starting point for a new script, so a blank editor is never the answer.
#[tauri::command]
pub fn script_template(lang: String, name: String) -> String {
    match Lang::parse(&lang) {
        Some(Lang::Ruby) => format!(
            "# {name}\n\
             #\n\
             # A Lich script. Runs inside Lich, in Ruby, with Lich's own API.\n\
             # Start it from the Scripts panel, or in game with: ;{name}\n\
             \n\
             echo \"{name} starting\"\n\
             \n\
             # fput sends a command as though you typed it.\n\
             # fput 'look'\n\
             \n\
             # waitfor blocks until the game says something.\n\
             # waitfor 'You see'\n\
             \n\
             echo \"{name} done\"\n"
        ),
        _ => format!(
            "\"\"\"{name} - say here what it does; this line becomes its description.\"\"\"\n\
             \n\
             from flow import Flow, Step\n\
             \n\
             \n\
             # `main` is called when this script runs. Return a Flow and it is run\n\
             # for you; do the work here and return nothing if you would rather.\n\
             def main():\n\
             \x20   return Flow(\n\
             \x20       title=\"{name}\",\n\
             \x20       steps=[\n\
             \x20           # commands, then how to know the step finished\n\
             \x20           Step(\"Looking around\", [\"look\"], until=r\"you see|obvious\"),\n\
             \x20\n\
             \x20           # `when` is any expression - no condition grammar to learn\n\
             \x20           Step(\"Standing\", [\"stand\"], when=lambda f: \"sitting\" in f.last_line),\n\
             \x20       ],\n\
             \x20   )\n"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_names_that_could_escape_the_folder() {
        for bad in [
            "",
            "..",
            "../x",
            "a/b",
            "a\\b",
            "a.py",
            "a.b",
            "-x",
            "_x",
            "a b",
            "a;b",
            &"a".repeat(65),
        ] {
            assert!(!valid_name(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn accepts_ordinary_script_names() {
        for good in ["hunt", "my_script", "town-run", "a1"] {
            assert!(valid_name(good), "refused {good:?}");
        }
    }

    #[test]
    fn a_summary_comes_from_the_header_and_never_from_the_code() {
        assert_eq!(
            summarise(
                "\"\"\"Tends wounds and rests.\"\"\"\nimport x\n",
                Lang::Python
            ),
            "Tends wounds and rests."
        );
        assert_eq!(
            summarise("# Walks to the bank.\necho 'hi'\n", Lang::Ruby),
            "Walks to the bank."
        );
        // The case that matters: no header means no summary, rather than the
        // first line of logic presented as a description.
        assert_eq!(summarise("import sys\nprint(1)\n", Lang::Python), "");
        assert_eq!(summarise("fput 'look'\n", Lang::Ruby), "");
    }

    /// dr-scripts' own convention, not a hand-written `#` comment - see
    /// `summarise_ruby_block`'s doc comment for where the sample shapes
    /// below actually came from.
    #[test]
    fn ruby_begin_end_blocks_are_read_dr_scripts_style() {
        // The common case: only a documentation link, which is not a
        // description and must not be returned as one.
        assert_eq!(
            summarise(
                "=begin\n  Documentation: https://elanthipedia.play.net/Lich_script_repository#afk\n=end\n\nfput 'afk'\n",
                Lang::Ruby
            ),
            ""
        );
        // Real prose after the doc link - the link is skipped, the prose is not.
        assert_eq!(
            summarise(
                "=begin\n  Documentation: https://elanthipedia.play.net/Lich_script_repository#corn-maze\n  This script runs non-combat tasks for sleeping dragon maze.\n=end\n",
                Lang::Ruby
            ),
            "This script runs non-combat tasks for sleeping dragon maze."
        );
        // Real prose with no doc link at all.
        assert_eq!(
            summarise(
                "=begin\n  Collects insects from a fixed circuit of Crossing-area rooms.\n=end\n",
                Lang::Ruby
            ),
            "Collects insects from a fixed circuit of Crossing-area rooms."
        );
        // A magic comment before the block - astrology.lic's own shape - must
        // not stop the block from being found.
        assert_eq!(
            summarise(
                "# frozen_string_literal: true\n\n=begin\n  A working example.\n=end\n",
                Lang::Ruby
            ),
            "A working example."
        );
        // An empty block: a real answer (no description written), not a
        // reason to fall through to the plain `#`-comment reader and quote
        // `=end` or a line of code instead.
        assert_eq!(summarise("=begin\n=end\n\nfput 'hi'\n", Lang::Ruby), "");
        // No `=begin` block at all - the ordinary `#`-comment path still
        // works exactly as it did before this existed.
        assert_eq!(
            summarise("# A hand-written script.\nfput 'hi'\n", Lang::Ruby),
            "A hand-written script."
        );
    }
}
