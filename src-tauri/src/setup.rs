//! Dependency detection and consent-gated installation.
//!
//! Design rules, in priority order:
//!
//! 1. **Install the current version, and leave unrelated things alone.** If a
//!    usable Ruby is already here we use it. If it is too old we offer the
//!    current one, in its own folder rather than over the top of anything. Not
//!    clobbering someone's other software during a game setup is ordinary good
//!    manners; keeping a deprecated runtime alive is not a goal.
//!
//!    Note the limit of that promise. Ruby4Lich5 is the Lich project's
//!    installer, not ours, and a real install showed it putting its own `bin`
//!    at the front of the user PATH. We hand it over verified and it then does
//!    what it does. Claiming otherwise, which this file did, is speaking for
//!    software we do not control.
//! 2. **Nothing downloads without a yes.** `plan_setup` only looks and reports.
//!    Every byte that crosses the network comes from an explicit call the user
//!    triggered, after seeing the URL, the size and the version.
//! 3. **Verify before use.** Release metadata comes from the GitHub API, which
//!    supplies a SHA-256 per asset. We check the file against that digest and
//!    delete it if it does not match.
//! 4. **We do not silently run installers.** Downloading is one consent.
//!    Executing a 65 MB installer is a second, separate one.
//! 5. **Say where things went.** Every result carries a real path.
//!
//! The upstream project already solves Windows bundling with Ruby4Lich5, an
//! official release asset containing Ruby and Lich together. Pointing at their
//! installer is better than inventing our own Ruby layout, because it is the
//! thing the community supports and troubleshoots.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Lich's `.ruby-version`. Anything older is not merely untested, it will fail.
const REQUIRED_RUBY_MAJOR: u32 = 4;
const LICH_REPO: &str = "elanthia-online/lich-5";
pub const GENIE4_REPO: &str = "GenieClient/Genie4";
pub const GENIE5_REPO: &str = "GenieClient/Genie5";
pub const GENIE_PLUGINS_REPO: &str = "GenieClient/Plugins";
pub const GENIE_MAPS_REPO: &str = "GenieClient/Maps";
/// The DragonRealms script suite: 222 scripts and about 2.75 MB of them.
///
/// Not a dependency so much as the product surface. Almost everything a player
/// wants already exists here, written by people who play more than we do, so
/// the app's job is to make them installable and startable rather than to
/// reimplement any of it. See docs/DESIGN.md §2.1.
pub const DR_SCRIPTS_REPO: &str = "elanthia-online/dr-scripts";

/// Scripts worth naming when they are missing, because a great deal of the
/// suite assumes them. Everything else is fetched with the rest.
const DR_SCRIPTS_CORE: &[&str] = &[
    "combat-trainer.lic",
    "crossing-training.lic",
    "coordinator.lic",
    "validate.lic",
    "inventory-manager.lic",
];

// ---------------------------------------------------------------- detection --

fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Where we put anything we install. App-scoped, so nothing we do can collide
/// with a system Ruby or a Lich the user installed themselves.
///
/// **Deliberately not `%LOCALAPPDATA%\DR Companion`.** That is where the NSIS
/// installer puts the program itself, and the first real install proved what
/// happens: a full Lich 5 tree, including the user's own `scripts` folder,
/// ended up sitting beside `uninstall.exe`. Uninstalling this app would have
/// taken their Lich and every personal script in it.
///
/// The name is separate, and `guard_not_install_dir` below makes it structural
/// rather than a convention someone can quietly rename their way back into.
pub fn app_data_dir() -> PathBuf {
    let dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DR Companion Data");

    guard_not_install_dir(dir)
}

/// Never hand back a directory that contains our own executable.
///
/// Cheap insurance against a future rename or a different installer layout
/// putting user data back inside the program directory, where an uninstall
/// would destroy it.
fn guard_not_install_dir(dir: PathBuf) -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    match exe_dir {
        Some(exe) if exe == dir => dir.with_file_name("DR Companion Data (user)"),
        _ => dir,
    }
}

/// Warn if user data is sitting inside the program directory.
///
/// An early build used `%LOCALAPPDATA%\DR Companion` for both the install and
/// for downloads and Lich, so anyone who ran it has a Lich tree next to
/// `uninstall.exe` waiting to be deleted. Say so rather than letting them find
/// out by uninstalling.
fn stranded_data_warning() -> Option<String> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let stranded: Vec<&str> = ["lich", "genie", "downloads"]
        .into_iter()
        .filter(|name| exe_dir.join(name).is_dir())
        .collect();

    if stranded.is_empty() {
        return None;
    }
    Some(format!(
        "An earlier version of this app kept downloads and Lich inside its own \
         program folder. {} still there ({}), and uninstalling would delete \
         them along with any scripts inside. Move them to {} before \
         uninstalling.",
        if stranded.len() == 1 { "One is" } else { "Some are" },
        stranded.join(", "),
        app_data_dir().to_string_lossy()
    ))
}

/// Installers we fetched. These genuinely are ours: temporary files nobody
/// else has a use for, kept only so a checksum can be re-checked.
pub fn downloads_dir() -> PathBuf {
    app_data_dir().join("downloads")
}

/// Where third-party software goes: the place it normally lives.
///
/// The first draft put Lich and Genie inside this app's own data folder, on
/// the reasoning that isolation is tidy. It is tidy and it is wrong. Lich is
/// not ours. Every guide, every help-channel answer and every `#config
/// lichpath` example in the community says `C:\Lich5` or `C:\Ruby4Lich5`, and
/// the project's own installer uses the root. Somewhere private means their
/// other scripts, their `.bat` shortcuts and every troubleshooting answer
/// they will ever be given all point at the wrong path, and the person who
/// suffers is exactly the newcomer this app exists for.
///
/// So: normal locations. `C:\` root is writable without elevation on a
/// default Windows install (Authenticated Users hold create-folder rights
/// there), which is checked rather than assumed — if it fails we fall back to
/// our own folder rather than erroring.
///
/// Answered once per run. Detection asks for this several times per check and
/// the answer costs a create and delete at the drive root; repeating that
/// would be rude for no gain.
pub fn install_root() -> PathBuf {
    static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    ROOT.get_or_init(|| {
        let drive = std::env::var_os("SystemDrive")
            .map(|d| PathBuf::from(format!("{}\\", d.to_string_lossy())))
            .unwrap_or_else(|| PathBuf::from("C:\\"));

        if can_create_dir_in(&drive) {
            drive
        } else {
            app_data_dir()
        }
    })
    .clone()
}

/// Can we make a directory here without asking for administrator rights?
///
/// Answered by making one and removing it. Any guess about ACLs would be a
/// guess, and the cost of getting it wrong is an install that fails halfway.
fn can_create_dir_in(root: &Path) -> bool {
    let probe = root.join(format!("dr-companion-write-test-{}", std::process::id()));
    match std::fs::create_dir(&probe) {
        Ok(()) => {
            let _ = std::fs::remove_dir(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Where we would put Lich, if we install it. `C:\Lich5` is what the guides
/// say, so it is what a search, a friend or a wiki page will tell them too.
pub fn lich_install_dir() -> PathBuf {
    install_root().join("Lich5")
}

/// Genie 4's own installer uses `C:\Genie4`; the portable Genie 5 build has no
/// installer, so we match the convention rather than inventing one.
pub fn genie_install_dir() -> PathBuf {
    install_root().join("Genie5")
}

/// Map an install id to where that software belongs.
fn install_dir_for(target_name: &str) -> PathBuf {
    match target_name {
        "lich" => lich_install_dir(),
        "genie" => genie_install_dir(),
        other => app_data_dir().join(other),
    }
}

fn candidate_dirs(names: &[&str]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(h) = home_dir() {
        for sub in ["", "Documents", "Desktop", "Downloads"] {
            roots.push(if sub.is_empty() { h.clone() } else { h.join(sub) });
        }
        roots.push(h.join("AppData").join("Local"));
        roots.push(h.join("AppData").join("Roaming"));
    }
    roots.push(app_data_dir());
    for env in ["ProgramFiles", "ProgramFiles(x86)", "SystemDrive"] {
        if let Some(v) = std::env::var_os(env) {
            roots.push(PathBuf::from(v));
        }
    }
    roots.push(PathBuf::from("C:\\"));

    let mut out = Vec::new();
    for root in roots {
        for name in names {
            let p = root.join(name);
            if p.exists() && !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

/// A path as it is actually spelled on disk.
///
/// Windows matches paths case-insensitively, so `C:\lich5` opens a folder
/// named `C:\Lich5` and nothing complains. That is fine for opening files and
/// wrong for showing someone, because this string gets pasted into `#config
/// lichpath` and read back later by a person deciding whether the app found
/// the right thing.
///
/// `canonicalize` returns the real casing but prefixes `\\?\`, which is
/// correct and unreadable, so it comes back off.
fn pretty_path(p: &Path) -> String {
    let text = std::fs::canonicalize(p)
        .map(|c| c.to_string_lossy().into_owned())
        .unwrap_or_else(|_| p.to_string_lossy().into_owned());

    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

fn first_existing(dirs: &[PathBuf], leaf: &str) -> Option<PathBuf> {
    dirs.iter().map(|p| p.join(leaf)).find(|p| p.exists())
}

/// Drop paths that are the same folder reached by different spellings.
///
/// Candidates are built by joining a list of names onto a list of roots, so
/// `C:\Lich5` arrives once as "lich5" and again as "Lich5", and once more from
/// `lich_install_dir()`. `PathBuf` equality is textual and keeps all three.
/// The first run against a machine with two real Lich installs reported five,
/// which is worse than saying nothing: it makes a correct warning look like a
/// bug and teaches people to ignore it.
///
/// Order is preserved, because the first entry is the one we use.
fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen: Vec<String> = Vec::new();
    let mut out = Vec::new();

    for p in paths {
        // Compare on the canonical form, which resolves casing and any
        // symlink or junction. Falling back to the lowercased text is enough
        // for the case this exists to catch.
        let key = std::fs::canonicalize(&p)
            .map(|c| c.to_string_lossy().to_lowercase())
            .unwrap_or_else(|_| p.to_string_lossy().to_lowercase());

        if !seen.contains(&key) {
            seen.push(key);
            out.push(p);
        }
    }
    out
}

fn lich_dirs() -> Vec<PathBuf> {
    let mut d = candidate_dirs(&["lich", "Lich", "lich5", "Lich5", "Ruby4Lich5", "ruby4lich5"]);

    // Ruby4Lich5 lays itself out as C:\Ruby4Lich5\Lich5\lich.rbw, with its own
    // Ruby beside it, so the nested folder needs looking at as well as the
    // root. Confirmed from the Genie wiki's default Lich path.
    for root in ["Ruby4Lich5", "ruby4lich5"] {
        let p = PathBuf::from("C:\\").join(root).join("Lich5");
        if p.exists() {
            d.push(p);
        }
    }

    // Both the place we would install to now, and the place the first build
    // used, because someone who ran that build still has a working Lich there.
    d.push(lich_install_dir());
    d.push(app_data_dir().join("lich"));
    d.retain(|p| p.exists());
    dedupe_paths(d)
}

/// Every Lich install on the machine, best first.
///
/// One function because there must be exactly one answer. The setup screen
/// used to rank them one way and `install_bridge_script` another — it took the
/// first directory that happened to contain a `scripts` folder — so the app
/// could tell you it was using one Lich and copy the bridge into a different
/// one. Nothing errors. The screen reads as installed, the script is on disk,
/// and typing the start command does nothing at all, which is unreportable.
///
/// The ranking rule: prefer the Lich sitting beside the Ruby that will run it.
/// Ruby4Lich5 installs a matched pair, `C:\Ruby4Lich5\4.0.5\bin\ruby.exe` and
/// `C:\Ruby4Lich5\Lich5`, versioned and tested together. Anything else is a
/// Lich of unknown vintage that happens to sort earlier in a list, which is no
/// basis for a decision. Seen here: with both present the app picked `C:\Lich5`
/// over the install the bundle had just laid down beside its own Ruby.
fn rank_lich_installs(ruby_path: Option<&str>) -> Vec<PathBuf> {
    let mut installs: Vec<PathBuf> = lich_dirs()
        .into_iter()
        .filter(|d| d.join("lich.rbw").exists() || d.join("lich.rb").exists())
        .collect();

    if let Some(ruby) = ruby_path {
        // ...\Ruby4Lich5\4.0.5\bin\ruby.exe -> ...\Ruby4Lich5
        let home = PathBuf::from(ruby)
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.to_path_buf());

        if let Some(home) = home {
            // Stable, so anything not beside that Ruby keeps its existing order.
            installs.sort_by_key(|p| !p.starts_with(&home));
        }
    }
    installs
}

fn parse_ruby_major(version_text: &str) -> Option<u32> {
    // "ruby 4.0.5 (2026-...) [x64-mingw-ucrt]"
    let after = version_text.split_whitespace().nth(1)?;
    after.split('.').next()?.parse().ok()
}

/// Find a Ruby, on PATH or on disk.
///
/// Returns (version string, path). The disk search exists because a Ruby
/// installed after this process started will not be on our PATH, and telling
/// someone to install Ruby when they just did is the worst possible answer.
fn detect_ruby() -> (Option<String>, Option<String>) {
    if let Some(v) = run_capture("ruby", &["--version"]) {
        let p = run_capture("where", &["ruby"])
            .and_then(|s| s.lines().next().map(|l| l.trim().to_string()));
        return (Some(v), p);
    }

    // Newest first, so a good Ruby beats an old one sitting beside it.
    let names = [
        "Ruby44-x64", "Ruby43-x64", "Ruby42-x64", "Ruby41-x64", "Ruby40-x64",
        "Ruby34-x64", "Ruby33-x64", "Ruby32-x64", "Ruby31-x64",
    ];
    let mut dirs = candidate_dirs(&names);

    // Ruby4Lich5 puts its own Ruby beside Lich, in a folder named after the
    // version: C:\Ruby4Lich5\4.0.5\bin\ruby.exe, with C:\Ruby4Lich5\Lich5 as
    // its sibling. Guessing that name is hopeless, so read the directory.
    //
    // Worth being exact about: this failure was live. After a clean install of
    // Ruby4Lich5 the app still reported Ruby 3.3 as outdated and offered to
    // download the same 65 MB installer again, because the search looked for
    // a subfolder literally named "ruby". Being told to install what you just
    // installed is the worst answer this screen can give.
    for d in lich_dirs() {
        for base in [d.as_path(), d.parent().unwrap_or(&d)] {
            for sub in ["ruby", "Ruby"] {
                let p = base.join(sub);
                if p.exists() {
                    dirs.push(p);
                }
            }
            // Any sibling directory holding a bin\ruby.exe, which covers the
            // version-named layout without hardcoding a version.
            if let Ok(entries) = std::fs::read_dir(base) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.join("bin").join("ruby.exe").exists() {
                        dirs.push(p);
                    }
                }
            }
        }
    }

    // Report the newest, not the first found. With Ruby4Lich5 installed beside
    // an old system Ruby, order of discovery decides whether the app says
    // "ready" or "too old", and it should not.
    let mut best: Option<(u32, String, String)> = None;
    for d in dedupe_paths(dirs) {
        let exe = d.join("bin").join("ruby.exe");
        if !exe.exists() {
            continue;
        }
        let Some(v) = run_capture(&exe.to_string_lossy(), &["--version"]) else {
            continue;
        };
        let major = parse_ruby_major(&v).unwrap_or(0);
        if best.as_ref().is_none_or(|(m, _, _)| major > *m) {
            best = Some((major, v, pretty_path(&exe)));
        }
    }

    match best {
        Some((_, v, path)) => (Some(format!("{v} (installed, not on PATH)")), Some(path)),
        None => (None, None),
    }
}

// -------------------------------------------------------------------- plan --

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Presence {
    Present,
    /// Found, but not a version that will work.
    Outdated,
    Missing,
    /// We looked and could not tell. Never treated as either good or bad.
    Unknown,
}

/// One thing we could fetch, with everything needed to judge it.
#[derive(Serialize, Clone)]
pub struct DownloadOption {
    pub id: String,
    pub label: String,
    pub url: String,
    pub bytes: u64,
    /// Empty when upstream publishes no digest for this asset. The UI says so
    /// rather than implying a verification we cannot perform.
    pub sha256: String,
    pub version: String,
    pub dest: String,
    /// "extract" unpacks it here; "installer" needs a second, separate consent.
    pub after: String,
    /// Set for anything not a stable release, so the label can say beta.
    pub prerelease: bool,
    /// Short reason to pick this one. Shown next to the option.
    pub why: String,
    pub note: String,
    /// True when we suggest this one by default.
    pub recommended: bool,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Remedy {
    /// One or more ways to satisfy this. The user picks; we never auto-select
    /// on their behalf beyond marking one as recommended.
    Choose {
        options: Vec<DownloadOption>,
        note: String,
    },
    /// A set of files from a repo, each verified by its git blob hash.
    Bundle {
        label: String,
        files: Vec<BundleFile>,
        bytes: u64,
        target: String,
        note: String,
    },
    /// We will not do this for you, and here is why plus where to go.
    Manual { instructions: String, link: String },
    /// Already fine, or satisfied by something else in the plan.
    None,
}

#[derive(Serialize, Clone)]
pub struct ComponentPlan {
    pub id: String,
    pub label: String,
    pub presence: Presence,
    pub detail: String,
    pub path: Option<String>,
    pub required: bool,
    pub remedy: Remedy,
}

#[derive(Serialize, Clone)]
pub struct SetupPlan {
    pub components: Vec<ComponentPlan>,
    /// True when nothing needs doing and we can go straight to the dashboard.
    pub ready: bool,
    /// Set when we could not reach GitHub to price the downloads.
    pub offline_note: Option<String>,
    /// Set when data from a pre-0.1.1 build is still sitting in the program
    /// directory, where uninstalling would delete it.
    pub data_warning: Option<String>,
}

#[derive(Deserialize)]
pub struct GhAsset {
    name: String,
    size: u64,
    digest: Option<String>,
    browser_download_url: String,
}

#[derive(Deserialize)]
pub struct GhRelease {
    tag_name: String,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    assets: Vec<GhAsset>,
}

/// Latest stable release of a repo, or None.
pub async fn latest_release(repo: &str) -> Option<GhRelease> {
    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .ok()?;
    let res = client
        .get(format!("https://api.github.com/repos/{repo}/releases/latest"))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let mut rel = res.json::<GhRelease>().await.ok()?;
    rel.prerelease = false;
    Some(rel)
}

/// Newest release including prereleases.
///
/// Genie 5 only publishes betas so far, and `releases/latest` skips those. A
/// project whose current build is a beta should not look like it has no
/// releases at all, so ask for the list and take the first.
pub async fn newest_release(repo: &str) -> Option<GhRelease> {
    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .ok()?;
    let res = client
        .get(format!(
            "https://api.github.com/repos/{repo}/releases?per_page=10"
        ))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let list = res.json::<Vec<GhRelease>>().await.ok()?;
    list.into_iter().find(|r| !r.draft)
}

async fn latest_lich_release() -> Option<GhRelease> {
    latest_release(LICH_REPO).await
}

/// The Genie builds we can offer, newest line first.
///
/// Separate from `plan_setup` so it can be exercised without pretending Genie
/// is absent on a machine that has it.
pub fn genie_options(
    genie5: &Option<GhRelease>,
    genie4: &Option<GhRelease>,
) -> Vec<DownloadOption> {
    let mut options = Vec::new();

    // Genie 5 first: actively developed, cross-platform, and every asset
    // carries a published checksum. Still beta, and labelled as such.
    if let Some(rel) = genie5 {
        if let Some(a) = asset(rel, "01-Windows-Genie5-Portable.zip") {
            options.push(option_from(
                "genie5-portable",
                "Genie 5 portable",
                rel,
                a,
                "extract",
                "The newer line, if you would rather be on it",
                "Their own README says Beta, in active development, expect rough \
                 edges. It is a clean rewrite on .NET 10 and Avalonia that runs on \
                 Windows, macOS and Linux, and it runs Genie 4 .cmd scripts. The \
                 catch for us is that the Lich connection commands the guides \
                 describe are Genie 4 ones and may not exist here yet, which is \
                 where people get stuck. Unpacks into this app's folder and deletes \
                 cleanly.",
                false,
            ));
        }
        if let Some(a) = asset(rel, "01-Windows-Genie5-Setup.exe") {
            options.push(option_from(
                "genie5-setup",
                "Genie 5 installer",
                rel,
                a,
                "installer",
                "Start-menu entry and file associations",
                "Same build as the portable version, installed normally.",
                false,
            ));
        }
    }

    // Genie 4: the long-standing stable client. Worth offering, with the two
    // things a person should know before choosing it.
    if let Some(rel) = genie4 {
        if let Some(a) = asset(rel, "Genie4.zip") {
            let tag = rel.tag_name.clone();
            options.push(option_from(
                "genie4",
                "Genie 4",
                rel,
                a,
                "extract",
                "Stable, free, and what the Lich connection guides describe",
                &format!(
                    "Release {tag}, from December 2023, and what the help channels \
                     steer returning players to: the documented steps for connecting \
                     to Lich are written for it and work. Note the project publishes \
                     no checksum for this file, so we can confirm it came from the \
                     GenieClient releases over HTTPS but cannot check the contents \
                     against a published hash the way we can for the others."
                ),
                true,
            ));
        }
    }

    options
}

/// Find an installed Genie, by executable rather than by folder name alone.
///
/// A bare directory called "Genie" proves nothing; the old code reported one as
/// "Found" and moved on. Look for something runnable, and report the version
/// line from the folder so the user can see which client we picked up.
fn detect_genie() -> (Option<String>, String) {
    // Genie is the common frontend, but not the only one Lich runs under.
    // Wrayth is in active use too, and telling someone with a working setup
    // that they have no frontend is the kind of wrong answer that makes people
    // stop trusting a checker.
    let mut dirs = candidate_dirs(&[
        "Genie",
        "Genie4",
        "Genie5",
        "GenieClient",
        "Genie Client",
        "Wrayth",
        "StormFront",
    ]);
    dirs.push(genie_install_dir());
    dirs.push(app_data_dir().join("genie"));
    dirs.retain(|p| p.exists());

    for exe in [
        "Genie.exe",
        "Genie4.exe",
        "Genie5.exe",
        "GenieClient.exe",
        "Wrayth.exe",
        "StormFront.exe",
    ] {
        if let Some(p) = first_existing(&dirs, exe) {
            return (
                Some(p.to_string_lossy().into_owned()),
                format!("Found {exe}"),
            );
        }
    }
    (
        None,
        "Not found. Lich can run without one, but you need something to read the \
         game in."
            .into(),
    )
}

fn asset<'a>(rel: &'a GhRelease, name: &str) -> Option<&'a GhAsset> {
    rel.assets.iter().find(|a| a.name == name)
}

fn option_from(
    id: &str,
    label: &str,
    rel: &GhRelease,
    a: &GhAsset,
    after: &str,
    why: &str,
    note: &str,
    recommended: bool,
) -> DownloadOption {
    DownloadOption {
        id: id.into(),
        label: label.into(),
        url: a.browser_download_url.clone(),
        bytes: a.size,
        sha256: digest_hex(a),
        version: rel.tag_name.clone(),
        dest: downloads_dir().join(&a.name).to_string_lossy().into_owned(),
        after: after.into(),
        prerelease: rel.prerelease,
        why: why.into(),
        note: note.into(),
        recommended,
    }
}

fn digest_hex(a: &GhAsset) -> String {
    a.digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .unwrap_or("")
        .to_string()
}

/// Look at the machine and report. Downloads nothing, changes nothing.
#[tauri::command]
pub async fn plan_setup() -> SetupPlan {
    // Three lookups, one round trip each, run together.
    let (release, genie5, genie4) = tokio::join!(
        latest_lich_release(),
        newest_release(GENIE5_REPO),
        latest_release(GENIE4_REPO),
    );
    // Kept in its own field rather than folded into `offline_note`. One says a
    // version lookup failed; the other says your scripts are in the folder an
    // uninstall deletes. Sharing a slot lets the trivial one hide the serious
    // one.
    let data_warning = stranded_data_warning();

    let offline_note = if release.is_none() {
        Some(
            "Could not reach GitHub to check the current Lich release. \
             Detection below is still accurate; download sizes and versions are unavailable."
                .into(),
        )
    } else {
        None
    };

    let mut components = Vec::new();

    // ---- Ruby ----
    // Nobody here wants Ruby. Lich is written in it, so it comes along; that
    // is the whole reason it appears in this app at all.
    //
    // Which means: install the current one and move on. An earlier draft made
    // a virtue of leaving an old Ruby in place — "we never touch your Ruby" —
    // which is the wrong instinct. Not clobbering unrelated software during a
    // game setup is ordinary good manners, not a feature, and preserving a
    // deprecated runtime is not something to design around. If a usable Ruby
    // is already here we use it. If it is too old we offer the current one.
    //
    // PATH alone is not enough for detection. A Ruby installed while this app
    // was running will not be on our inherited PATH, and neither will the one
    // Ruby4Lich5 installs, so a "missing" verdict there would push someone
    // into a second copy of what they just installed. Look on disk too.
    let (ruby_version, ruby_path) = detect_ruby();

    let (ruby_presence, ruby_detail) = match ruby_version.as_deref() {
        Some(v) => match parse_ruby_major(v) {
            Some(major) if major >= REQUIRED_RUBY_MAJOR => {
                (Presence::Present, format!("{v} — meets Lich's requirement"))
            }
            Some(major) => (
                Presence::Outdated,
                format!("{v} — Lich needs Ruby {REQUIRED_RUBY_MAJOR}.x, you have {major}.x"),
            ),
            None => (Presence::Unknown, format!("{v} — could not read the version")),
        },
        None => (
            Presence::Missing,
            "Not on your PATH, and not in any of the usual folders".into(),
        ),
    };

    // The offer has to live on this row, not on Lich's.
    //
    // It used to be built inside the Lich block and only when Lich was
    // missing, which produced a screen with no way forward: Lich present,
    // Ruby 3.3, every row either fine or advisory, and nothing to press. The
    // one thing that fixes it was gated behind a condition that had nothing
    // to do with it. Ruby is the dependency; Ruby's row makes the offer.
    //
    // Lich 5 checks `RUBY_VERSION` against `REQUIRED_RUBY` in lib/version.rb
    // and quits with a dialog if it loses, so an old Ruby is a hard stop, not
    // a warning, and "here is a link, good luck" is the exact failure this app
    // exists to remove.
    //
    // Offering it plainly is safe: Ruby4Lich5 installs its own Ruby into its
    // own folder. Nothing on PATH changes and the Ruby already here keeps
    // working for whatever else uses it. Someone who would rather do it
    // themselves still has the link.
    let ruby_needed = ruby_presence != Presence::Present;
    let ruby4lich5 = release
        .as_ref()
        .filter(|_| ruby_needed)
        .and_then(|rel| asset(rel, "Ruby4Lich5.exe").map(|a| (rel, a)))
        .map(|(rel, a)| {
            option_from(
                "ruby4lich5",
                "Ruby4Lich5 — Ruby and Lich together",
                rel,
                a,
                "installer",
                if ruby_presence == Presence::Outdated {
                    "Installs the current Ruby, and Lich with it"
                } else {
                    "Everything in one step"
                },
                "The Lich project's own Windows installer, so it is the setup their \
                 community supports and troubleshoots. We fetch it, check it against \
                 the checksum GitHub publishes, and hand it to you. It does not run \
                 until you ask separately, and it asks its own questions.",
                true,
            )
        });

    let ruby_offers_bundle = ruby4lich5.is_some();

    let ruby_remedy = match (&ruby_presence, ruby4lich5) {
        (Presence::Present, _) => Remedy::None,
        (_, Some(option)) => Remedy::Choose {
            options: vec![option],
            note: if ruby_presence == Presence::Outdated {
                "Lich 5 needs Ruby 4.0 or newer and refuses to start on anything older, so \
                 the Ruby on this machine will not run it. This installs the current one \
                 in its own folder, leaving your old one in place. It does put itself \
                 first on your PATH, so `ruby` at a prompt will mean the new one \
                 afterwards. Prefer to install Ruby 4 yourself? Do that and press Check \
                 again."
                    .into()
            } else {
                "Lich is written in Ruby, so Ruby comes along. This is the Lich project's \
                 own bundle of the two, installed into its own folder."
                    .into()
            },
        },
        // No release info, so we cannot price or verify a download. Say what
        // to do rather than showing a button that cannot work.
        _ => Remedy::Manual {
            instructions:
                "Lich 5 needs Ruby 4.0 or newer. Could not reach GitHub to offer the \
                 download, so either check your connection and press Check again, or \
                 install Ruby yourself and do the same."
                    .into(),
            link: "https://rubyinstaller.org/downloads/".into(),
        },
    };

    components.push(ComponentPlan {
        id: "ruby".into(),
        label: "Ruby runtime".into(),
        presence: ruby_presence.clone(),
        detail: ruby_detail,
        // Cloned because the Lich row needs it too: which Lich we pick depends
        // on which Ruby will run it.
        path: ruby_path.clone(),
        required: true,
        remedy: ruby_remedy,
    });

    // ---- Lich ----
    let dirs = lich_dirs();

    // Every Lich on the machine, not just the first one found.
    //
    // Two is a normal outcome, not an edge case: install Lich by hand, later
    // run Ruby4Lich5, and now there are two — `C:\Lich5` and
    // `C:\Ruby4Lich5\Lich5`. Picking one silently is how someone ends up
    // dropping scripts into the copy that is not running and concluding the
    // app is broken. Say which one we mean and that there is another.
    let lich_installs = rank_lich_installs(ruby_path.as_deref());

    let lich_found = lich_installs
        .first()
        .map(|d| d.join("lich.rbw"))
        .filter(|p| p.exists())
        .or_else(|| lich_installs.first().map(|d| d.join("lich.rb")))
        .filter(|p| p.exists());

    let lich_remedy = match &release {
        Some(rel) => {
            let has_ruby = ruby_presence == Presence::Present;
            let mut options = Vec::new();

            // With a usable Ruby the small archive is the right answer: it
            // adds Lich and nothing else.
            if let Some(a) = asset(rel, "lich-5.zip") {
                options.push(option_from(
                    "lich-zip",
                    "Lich 5 only",
                    rel,
                    a,
                    "extract",
                    if has_ruby {
                        "Uses the Ruby you already have"
                    } else {
                        "Needs a Ruby 4.x you install yourself"
                    },
                    &format!(
                        "Unpacked into {}. Nothing else on your machine is touched.",
                        lich_install_dir().to_string_lossy()
                    ),
                    has_ruby,
                ));
            }
            // Without one, the project's own bundle is the supported path —
            // but only offer it here when Ruby's own row has not already. Two
            // rows showing the same 65 MB installer reads as two downloads.
            if !has_ruby && ruby_offers_bundle {
                // The Ruby row is already offering it, and satisfying that row
                // satisfies this one too. Say so rather than repeating it.
            } else if let Some(a) = asset(rel, "Ruby4Lich5.exe") {
                options.push(option_from(
                    "ruby4lich5",
                    "Ruby4Lich5 — Ruby and Lich together",
                    rel,
                    a,
                    "installer",
                    if has_ruby {
                        "Installs a second Ruby beside yours, leaving yours alone"
                    } else {
                        "Everything in one step"
                    },
                    "The Lich project's own Windows installer. We fetch it, check it \
                     against the checksum GitHub publishes, and hand it to you. It will \
                     not run until you ask separately, and it asks its own questions.",
                    !has_ruby,
                ));
            }

            if options.is_empty() {
                Remedy::None
            } else {
                Remedy::Choose {
                    options,
                    note: if has_ruby {
                        "You already have a Ruby that works, so the small one is enough."
                            .into()
                    } else if ruby_offers_bundle {
                        "Ruby4Lich5, offered on the Ruby row above, already includes Lich. \
                         Take that one and this row takes care of itself. The zip here is \
                         only worth it if you would rather install Ruby 4 yourself."
                            .into()
                    } else {
                        "Either route works. The bundle is simpler; the zip is smaller \
                         if you would rather manage Ruby yourself."
                            .into()
                    },
                }
            }
        }
        None => Remedy::Manual {
            instructions: "Could not reach GitHub. Download Lich 5 manually.".into(),
            link: format!("https://github.com/{LICH_REPO}/releases/latest"),
        },
    };

    components.push(ComponentPlan {
        id: "lich".into(),
        // "Lich 5" alone reads to a Genie user as "switch to Lich", which is
        // the objection to answer rather than accept. Lich is a proxy: the
        // frontend still runs and every .cmd script keeps working. It is this
        // app's plumbing, not a toolchain anyone has to adopt.
        label: "Lich 5 (this app's engine)".into(),
        presence: if lich_found.is_some() {
            Presence::Present
        } else {
            Presence::Missing
        },
        detail: match &lich_found {
            // Naming the extras matters more than it looks. The bridge script
            // gets copied into one `scripts\` folder, and if that is not the
            // one the frontend launches, everything looks installed and
            // nothing happens.
            Some(_) if lich_installs.len() > 1 => format!(
                "Found {} on this machine. Using the one above, because it sits \
                 with the Ruby that will run it. Also here: {}. Point your \
                 frontend at the one above — the bridge script goes there, and \
                 launching a different Lich just means nothing happens.",
                if lich_installs.len() == 2 {
                    "two".into()
                } else {
                    format!("{}", lich_installs.len())
                },
                lich_installs
                    .iter()
                    .skip(1)
                    .map(|p| pretty_path(p))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Some(_) => "Found".into(),
            None => "Not installed. It runs alongside your frontend, and your \
                     existing scripts keep working exactly as they do now."
                .into(),
        },
        // Shown in the connect guide and pasted into `#config lichpath`, so
        // it should read the way it reads in Explorer. We build candidate
        // paths from a list of spellings ("lich5", "Lich5"), and the one that
        // matched is not necessarily the one on disk.
        path: lich_found
            .as_ref()
            .and_then(|p| p.parent().map(pretty_path)),
        required: true,
        remedy: if lich_found.is_some() {
            Remedy::None
        } else {
            lich_remedy
        },
    });

    // ---- The bridge script ----
    // Ours, small, and going to a known folder, so this is the one thing we
    // install directly once Lich exists.
    let mut script_dirs: Vec<PathBuf> = dirs.iter().map(|d| d.join("scripts")).collect();
    script_dirs.extend(dirs.iter().cloned());
    let bridge = first_existing(&script_dirs, "companion_bridge.lic");

    components.push(ComponentPlan {
        id: "bridge".into(),
        label: "Companion bridge script".into(),
        presence: if bridge.is_some() {
            Presence::Present
        } else {
            Presence::Missing
        },
        detail: match &bridge {
            Some(_) => "Installed in Lich's scripts folder".into(),
            None if lich_found.is_some() => "Ready to install".into(),
            None => "Waiting on Lich".into(),
        },
        path: bridge.as_ref().map(|p| p.to_string_lossy().into_owned()),
        required: true,
        remedy: Remedy::None,
    });

    // ---- The dr-scripts suite ----
    //
    // 222 scripts. This is the reason to install Lich at all, and until now
    // nothing checked whether the player had any of it. Almost every feature
    // anyone wants is already in here.
    if let Some(lich_dir) = lich_found.as_ref().and_then(|p| p.parent()) {
        let scripts_dir = lich_dir.join("scripts");
        let have: Vec<String> = std::fs::read_dir(&scripts_dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().to_lowercase())
                    .collect()
            })
            .unwrap_or_default();

        let missing_core: Vec<&str> = DR_SCRIPTS_CORE
            .iter()
            .copied()
            .filter(|s| !have.iter().any(|h| h == s))
            .collect();

        // Only ask GitHub for the listing when we might act on it. Enumerating
        // 222 files on every check would be rude for no benefit.
        let files = if missing_core.is_empty() {
            Vec::new()
        } else {
            list_repo_files(DR_SCRIPTS_REPO, "", &[".lic"]).await
        };
        let bytes: u64 = files.iter().map(|f| f.bytes).sum();

        components.push(ComponentPlan {
            id: "dr_scripts".into(),
            label: "DragonRealms script suite".into(),
            presence: if missing_core.is_empty() {
                Presence::Present
            } else {
                Presence::Missing
            },
            detail: if missing_core.is_empty() {
                format!("{} scripts in Lich's scripts folder", have.len())
            } else {
                format!(
                    "Missing {}. This is the community's script suite — most of what \
                     people use Lich for lives here.",
                    missing_core.join(", ")
                )
            },
            path: Some(pretty_path(&scripts_dir)),
            required: false,
            remedy: if files.is_empty() {
                Remedy::None
            } else {
                Remedy::Bundle {
                    label: format!("{} scripts", files.len()),
                    files,
                    bytes,
                    target: scripts_dir.to_string_lossy().into_owned(),
                    note: "Maintained by elanthia-online. Each file is checked \
                           against the git blob hash GitHub publishes before \
                           anything is written, and one mismatch aborts the whole \
                           install."
                        .into(),
                }
            },
        });

        // ---- The map database ----
        //
        // Not something we can fetch. It comes from repo.lichproject.org over
        // TLS on port 7157, with a pinned certificate and their own protocol,
        // and reimplementing that would be fragile and presumptuous. Their
        // script already does it correctly.
        //
        // So: detect it here, and let the bridge run their script. Which is the
        // rule from docs/DESIGN.md §7 — if a script already does it, start it.
        let data_dir = lich_dir.join("data");
        let map_db = ["DR", "DRF", "DRX", "DRT"].iter().find_map(|game| {
            let d = data_dir.join(game);
            std::fs::read_dir(&d).ok().and_then(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .find(|n| n.starts_with("map-") && n.ends_with(".json"))
                    .map(|n| d.join(n))
            })
        });

        components.push(ComponentPlan {
            id: "mapdb".into(),
            label: "Map database".into(),
            presence: if map_db.is_some() {
                Presence::Present
            } else {
                Presence::Missing
            },
            detail: match &map_db {
                Some(_) => "Lich has room data, so the map and travel work".into(),
                None => "Not downloaded. Without it Lich cannot route, so the map \
                         has nothing to draw and #goto does not work."
                    .into(),
            },
            path: map_db.as_ref().map(|p| pretty_path(p)),
            required: false,
            remedy: if map_db.is_some() {
                Remedy::None
            } else {
                Remedy::Manual {
                    instructions:
                        "This one comes from the Lich project's own server, not from \
                         GitHub, so their script fetches it. Connect a character and \
                         run ;repository download-mapdb — the panel offers a button \
                         for it once the bridge is up."
                            .into(),
                    link: "https://github.com/elanthia-online/lich-5/wiki".into(),
                }
            },
        });
    }

    // ---- Frontend ----
    // Genie is the window you actually read the game in. It is optional in the
    // sense that other frontends exist, but a new player with none of them has
    // nothing to look at, so this offers to fetch one.
    let (genie_path, genie_detail) = detect_genie();

    let genie_remedy = if genie_path.is_some() {
        Remedy::None
    } else {
        let options = genie_options(&genie5, &genie4);

        if options.is_empty() {
            Remedy::Manual {
                instructions: "Could not reach GitHub to look up a Genie release."
                    .into(),
                link: format!("https://github.com/{GENIE5_REPO}/releases"),
            }
        } else {
            Remedy::Choose {
                options,
                note: "Genie is the window you read the game in. Lich can run without \
                       one, and other frontends work too, so this is optional."
                    .into(),
            }
        }
    };

    components.push(ComponentPlan {
        id: "genie".into(),
        label: "Game frontend (Genie)".into(),
        presence: if genie_path.is_some() {
            Presence::Present
        } else {
            Presence::Missing
        },
        detail: genie_detail,
        path: genie_path.clone(),
        required: false,
        remedy: genie_remedy,
    });

    // ---- Genie plugins and maps ----
    //
    // A fresh Genie has an empty Maps folder and none of the plugins the
    // community scripts assume. travel.cmd opens with "REQUIRES EXPTRACKER
    // PLUGIN! MANDATORY!", so this is not a nicety.
    if let Some(gp) = genie_path.clone() {
        let genie_root = Path::new(&gp).parent().map(|p| p.to_path_buf());

        if let Some(root) = genie_root {
            // Plugins
            let plugins_dir = root.join("Plugins");
            let have: Vec<String> = std::fs::read_dir(&plugins_dir)
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().to_lowercase())
                        .collect()
                })
                .unwrap_or_default();

            let key_plugins = ["exptracker.dll", "spelltimer.dll", "circlecalc.dll"];
            let missing: Vec<&str> = key_plugins
                .iter()
                .copied()
                .filter(|p| !have.iter().any(|h| h == p))
                .collect();

            let plugin_files = if missing.is_empty() {
                Vec::new()
            } else {
                list_repo_files(GENIE_PLUGINS_REPO, "", &[".dll", ".xml"]).await
            };
            let plugin_bytes: u64 = plugin_files.iter().map(|f| f.bytes).sum();

            components.push(ComponentPlan {
                id: "plugins".into(),
                label: "Genie plugins".into(),
                presence: if missing.is_empty() {
                    Presence::Present
                } else {
                    Presence::Missing
                },
                detail: if missing.is_empty() {
                    "EXPTracker, SpellTimer and CircleCalc are installed".into()
                } else {
                    format!(
                        "Missing {}. Community scripts assume these: the travel script \
                         will not run without EXPTracker.",
                        missing.join(", ")
                    )
                },
                path: Some(plugins_dir.to_string_lossy().into_owned()),
                required: false,
                remedy: if missing.is_empty() || plugin_files.is_empty() {
                    Remedy::None
                } else {
                    Remedy::Bundle {
                        label: format!("{} plugin files", plugin_files.len()),
                        files: plugin_files,
                        bytes: plugin_bytes,
                        target: plugins_dir.to_string_lossy().into_owned(),
                        note: "These ship as files in the GenieClient/Plugins repo \
                               rather than as a release, so there is no release \
                               checksum. Each one is verified against the git blob \
                               hash GitHub publishes for it, which pins exact \
                               content. Anything that does not match is not written."
                            .into(),
                    }
                },
            });

            // Maps
            let maps_dir = root.join("Maps");
            let map_count = std::fs::read_dir(&maps_dir)
                .map(|rd| {
                    rd.filter_map(|e| e.ok())
                        .filter(|e| {
                            e.file_name().to_string_lossy().to_lowercase().ends_with(".xml")
                        })
                        .count()
                })
                .unwrap_or(0);

            let map_files = if map_count > 0 {
                Vec::new()
            } else {
                list_repo_files(GENIE_MAPS_REPO, "", &[".xml"]).await
            };
            let map_bytes: u64 = map_files.iter().map(|f| f.bytes).sum();

            components.push(ComponentPlan {
                id: "maps".into(),
                label: "Genie maps".into(),
                presence: if map_count > 0 {
                    Presence::Present
                } else {
                    Presence::Missing
                },
                detail: if map_count > 0 {
                    format!("{map_count} map files")
                } else {
                    "Empty. Without maps the automapper cannot route, so travel and \
                     hunting-ground scripts have nothing to walk."
                        .into()
                },
                path: Some(maps_dir.to_string_lossy().into_owned()),
                required: false,
                remedy: if map_count > 0 || map_files.is_empty() {
                    Remedy::None
                } else {
                    Remedy::Bundle {
                        label: format!("{} map files", map_files.len()),
                        files: map_files,
                        bytes: map_bytes,
                        target: maps_dir.to_string_lossy().into_owned(),
                        note: "The community map set, verified file by file against \
                               the git blob hashes GitHub publishes. Genie 4 ships \
                               Lamp.exe to do this itself, but the Lamp build it \
                               fetches is currently broken and reports \"Maps \
                               Updated\" either way, which is why people keep \
                               finding an empty Maps folder after a clean install."
                            .into(),
                    }
                },
            });
        }
    }


    let ready = components
        .iter()
        .filter(|c| c.required)
        .all(|c| c.presence == Presence::Present);

    SetupPlan {
        components,
        ready,
        offline_note,
        data_warning,
    }
}

// ---------------------------------------------------------------- download --

#[derive(Serialize, Clone)]
pub struct Progress {
    pub id: String,
    pub received: u64,
    pub total: u64,
    pub phase: String,
}

#[derive(Serialize, Clone)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
    pub verified: bool,
}

/// Fetch one file and verify it against the digest the GitHub API gave us.
/// A file that fails verification is deleted, not kept.
///
/// Split from the Tauri command so it can be exercised without a running app;
/// see `examples/fetch.rs`. `on_progress` is called as bytes arrive.
pub async fn download_verified(
    url: &str,
    expected_sha256: &str,
    dest: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<DownloadResult, String> {
    // Only ever fetch from the project's own release host.
    // Only the two projects this app integrates with, over HTTPS.
    const ALLOWED: [&str; 3] = [
        "https://github.com/elanthia-online/",
        "https://github.com/GenieClient/",
        "https://objects.githubusercontent.com/",
    ];
    if !ALLOWED.iter().any(|p| url.starts_with(p)) {
        return Err(format!("refusing to download from an unexpected host: {url}"));
    }

    let dest_path = PathBuf::from(dest);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("download failed: HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);

    let tmp = dest_path.with_extension("part");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut stream = res;

    loop {
        let chunk = stream.chunk().await.map_err(|e| e.to_string())?;
        let Some(bytes) = chunk else { break };
        hasher.update(&bytes);
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        received += bytes.len() as u64;
        on_progress(received, total);
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    let got = format!("{:x}", hasher.finalize());
    let verified = expected_sha256.is_empty() || got.eq_ignore_ascii_case(expected_sha256);

    if !verified {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "checksum mismatch. Expected {expected_sha256}, got {got}. \
             The file was deleted and nothing was installed."
        ));
    }

    std::fs::rename(&tmp, &dest_path).map_err(|e| e.to_string())?;

    Ok(DownloadResult {
        path: dest_path.to_string_lossy().into_owned(),
        bytes: received,
        sha256: got,
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
    let emit_id = id.clone();
    let app2 = app.clone();
    let res = download_verified(&url, &expected_sha256, &dest, move |received, total| {
        let _ = app2.emit(
            "setup://progress",
            Progress {
                id: emit_id.clone(),
                received,
                total,
                phase: "downloading".into(),
            },
        );
    })
    .await?;

    let _ = app.emit(
        "setup://progress",
        Progress {
            id,
            received: res.bytes,
            total: res.bytes,
            phase: "verified".into(),
        },
    );
    Ok(res)
}

/// Unpack a verified Lich zip into our own app folder.
///
/// The release archive wraps everything in a single `Lich5/` directory. Left
/// alone that puts `lich.rbw` one level deeper than detection looks, so the
/// install would appear to succeed and then not be found. Strip a single
/// common top-level directory when there is exactly one.
#[tauri::command]
pub fn extract_lich(archive: String) -> Result<String, String> {
    extract_archive(archive, "lich".into(), Some("lich.rbw".into()))
}

/// Unpack a verified archive into a named folder under the app directory.
///
/// `expect` is a file that must exist afterwards. Release archives often wrap
/// everything in one directory, and silently installing one level too deep
/// looks like success until nothing can find it.
#[tauri::command]
pub fn extract_archive(
    archive: String,
    target_name: String,
    expect: Option<String>,
) -> Result<String, String> {
    let target = install_dir_for(&target_name);
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    // Find a single shared root, if there is one.
    let mut roots: Vec<String> = Vec::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("archive contains an unsafe path: {}", entry.name()));
        };
        if let Some(first) = rel.components().next() {
            let s = first.as_os_str().to_string_lossy().into_owned();
            if !roots.contains(&s) {
                roots.push(s);
            }
        }
    }
    let strip = if roots.len() == 1 { Some(roots[0].clone()) } else { None };

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("archive contains an unsafe path: {}", entry.name()));
        };
        let rel = match &strip {
            Some(root) => rel.strip_prefix(root).unwrap_or(&rel).to_path_buf(),
            None => rel.to_path_buf(),
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let out = target.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut w).map_err(|e| e.to_string())?;
    }

    if let Some(expected) = expect {
        if !target.join(&expected).exists() {
            return Err(format!(
                "extracted to {} but {expected} is not there. The archive layout may have changed.",
                target.to_string_lossy()
            ));
        }
    }
    Ok(target.to_string_lossy().into_owned())
}

/// Show a downloaded file in Explorer. Deliberately not "run it".
#[tauri::command]
pub fn reveal_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("file not found".into());
    }
    #[cfg(windows)]
    {
        let mut cmd = Command::new("explorer.exe");
        cmd.arg("/select,").arg(p);
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Launch a verified installer, as a separate and explicit action.
///
/// Downloading is one decision; running something is another, so this is its
/// own command rather than the tail of the download. It refuses anything we
/// did not just download and verify into our own folder.
#[tauri::command]
pub fn run_installer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("installer not found".into());
    }
    if !p.starts_with(downloads_dir()) {
        return Err("refusing to run anything outside the app's own download folder".into());
    }
    if p.extension().and_then(|e| e.to_str()) != Some("exe") {
        return Err("not an installer".into());
    }
    Command::new(&p).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Copy our bridge script into Lich's scripts folder.
///
/// The script ships as a bundled resource, so the source path is resolved here
/// rather than passed in from the webview. The frontend cannot ask us to copy
/// an arbitrary file somewhere.
#[tauri::command]
pub fn install_bridge_script(app: AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let src = app
        .path()
        .resolve(
            "lich-scripts/companion_bridge.lic",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("could not locate the bundled bridge script: {e}"))?;

    if !src.exists() {
        return Err(format!(
            "the bundled bridge script is missing from this build ({})",
            src.to_string_lossy()
        ));
    }

    copy_bridge_to_lich(&src)
}

/// The `scripts` folder of the Lich the setup screen says it is using.
///
/// Public so a test can ask the same question the app asks. The bug this
/// guards against is not a crash: if the screen names one Lich and the copy
/// lands in another, everything reads as installed and the start command does
/// nothing, with no error anywhere.
pub fn bridge_target_dir() -> Option<PathBuf> {
    let (_, ruby_path) = detect_ruby();
    rank_lich_installs(ruby_path.as_deref())
        .iter()
        .map(|d| d.join("scripts"))
        .find(|d| d.exists())
}

/// Copy the bridge script into that folder.
///
/// Split from the Tauri command so it can be run outside a Tauri app, where
/// the bundled-resource lookup is unavailable. The source path stays the
/// caller's problem; in the app it is resolved in Rust rather than passed from
/// the web view, so the UI cannot ask us to copy an arbitrary file somewhere.
pub fn copy_bridge_to_lich(src: &Path) -> Result<String, String> {
    let target_dir = bridge_target_dir()
        .ok_or_else(|| "Could not find Lich's scripts folder. Install Lich first.".to_string())?;

    let dest = target_dir.join("companion_bridge.lic");
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    Ok(pretty_path(&dest))
}

// ------------------------------------------------------------- repo bundles --
//
// Genie's plugins and maps ship as files committed to a repo, not as release
// assets, so there is no release checksum to check them against. GitHub's
// contents API does give the git blob SHA for every file, and that is
// verifiable: sha1("blob <len>\0" + content). Same authenticated source as the
// download URL, and it pins exact content.
//
// This matters more than it sounds. The travel script every DragonRealms
// player uses opens with "REQUIRES EXPTRACKER PLUGIN! MANDATORY!", and a fresh
// Genie has neither that plugin nor any maps.

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
    /// git blob SHA-1, from the contents API.
    pub sha: String,
    pub url: String,
}

/// List the files we would install for a bundle, with their blob hashes.
pub async fn list_repo_files(repo: &str, path: &str, exts: &[&str]) -> Vec<BundleFile> {
    let client = match reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
    {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let url = if path.is_empty() {
        format!("https://api.github.com/repos/{repo}/contents")
    } else {
        format!("https://api.github.com/repos/{repo}/contents/{path}")
    };
    let Ok(res) = client.get(&url).send().await else {
        return Vec::new();
    };
    if !res.status().is_success() {
        return Vec::new();
    }
    let Ok(items) = res.json::<Vec<GhContent>>().await else {
        return Vec::new();
    };

    items
        .into_iter()
        .filter(|i| i.kind == "file")
        .filter(|i| {
            exts.is_empty()
                || exts
                    .iter()
                    .any(|e| i.name.to_lowercase().ends_with(&e.to_lowercase()))
        })
        .filter_map(|i| {
            i.download_url.map(|u| BundleFile {
                name: i.name,
                bytes: i.size,
                sha: i.sha,
                url: u,
            })
        })
        .collect()
}

fn git_blob_sha(bytes: &[u8]) -> String {
    use sha1::{Digest as _, Sha1};
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    format!("{:x}", h.finalize())
}

/// Fetch a set of repo files into `target`, verifying each against its blob SHA.
///
/// A file that does not match is not written. The whole install fails rather
/// than leaving a half-verified plugin folder behind.
/// Core of the bundle install, split out so it can be tested without an app.
pub async fn install_bundle_inner(
    files: &[BundleFile],
    target: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<String, String> {
    let dir = PathBuf::from(target);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .user_agent("dr-companion-setup")
        .build()
        .map_err(|e| e.to_string())?;

    let total: u64 = files.iter().map(|f| f.bytes).sum();
    let mut done: u64 = 0;
    let mut written = 0usize;

    for f in files {
        if !f.url.starts_with("https://raw.githubusercontent.com/GenieClient/")
            && !f
                .url
                .starts_with("https://raw.githubusercontent.com/elanthia-online/")
        {
            return Err(format!("refusing an unexpected file host: {}", f.url));
        }

        let res = client
            .get(&f.url)
            .send()
            .await
            .map_err(|e| format!("{}: {e}", f.name))?;
        if !res.status().is_success() {
            return Err(format!("{}: HTTP {}", f.name, res.status()));
        }
        let body = res
            .bytes()
            .await
            .map_err(|e| format!("{}: {e}", f.name))?;

        let got = git_blob_sha(&body);
        if !got.eq_ignore_ascii_case(&f.sha) {
            return Err(format!(
                "{} failed verification. Expected git blob {}, got {}. \
                 Nothing further was installed.",
                f.name, f.sha, got
            ));
        }

        // Only touch the disk once the bytes are known-good.
        std::fs::write(dir.join(&f.name), &body).map_err(|e| e.to_string())?;
        written += 1;
        done += f.bytes;

        on_progress(done, total);
    }

    Ok(format!("{written} files verified and installed to {target}"))
}

#[tauri::command]
pub async fn install_bundle(
    app: AppHandle,
    id: String,
    files: Vec<BundleFile>,
    target: String,
) -> Result<String, String> {
    let emit_id = id.clone();
    let app2 = app.clone();
    let res = install_bundle_inner(&files, &target, move |received, total| {
        let _ = app2.emit(
            "setup://progress",
            Progress {
                id: emit_id.clone(),
                received,
                total,
                phase: "downloading".into(),
            },
        );
    })
    .await?;

    let total: u64 = files.iter().map(|f| f.bytes).sum();
    let _ = app.emit(
        "setup://progress",
        Progress {
            id,
            received: total,
            total,
            phase: "verified".into(),
        },
    );
    Ok(res)
}
