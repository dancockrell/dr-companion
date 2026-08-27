//! Runs a real setup against this machine, using the app's own code.
//!
//!   cargo run --example install -- ruby4lich5   download and verify
//!   cargo run --example install -- plugins      Genie plugin bundle
//!   cargo run --example install -- maps         Genie map bundle
//!   cargo run --example install -- run          execute what was downloaded
//!   cargo run --example install -- guards       just the run_installer checks
//!   cargo run --example install -- bridge       our script into Lich
//!
//! Everything here goes through `plan_setup`, `download_verified` and
//! `install_bundle_inner`, so a bug in the setup flow shows up here rather
//! than in a hand-written curl that proves nothing about the app.
//!
//! Downloading and running are separate subcommands on purpose, because they
//! are separate decisions in the app: fetching a 65 MB installer is one, and
//! executing it is another. `ruby4lich5` prints the verified path and stops.

use dr_companion_lib::setup::*;
use std::path::PathBuf;

fn main() {
    let which = std::env::args().nth(1).unwrap_or_else(|| {
        eprintln!(
            "usage: cargo run --example install -- <ruby4lich5|plugins|maps|run|guards|bridge>"
        );
        std::process::exit(2);
    });

    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");

    rt.block_on(async move {
        match which.as_str() {
            "ruby4lich5" => download_from_plan("ruby", "ruby4lich5").await,
            "plugins" => bundle("plugins").await,
            "maps" => bundle("maps").await,
            "dr_scripts" => bundle("dr_scripts").await,
            "run" => {
                run_downloaded_installer();
                check_guards()
            }
            "guards" => check_guards(),
            "bridge" => install_bridge(),
            other => {
                eprintln!("unknown target: {other}");
                std::process::exit(2);
            }
        }
    });
}

/// Take the URL, size and checksum from the plan rather than from me.
///
/// The point is to prove the plan is usable, not to prove a download works. A
/// hardcoded URL here would pass while the plan handed the UI something wrong.
async fn download_from_plan(component_id: &str, option_id: &str) {
    // plan_setup_inner, not plan_setup - see its doc comment. This dev
    // checkout has nothing bundled either way, so `None` is the true answer.
    let plan = plan_setup_inner(None, None).await;
    let Some(c) = plan.components.iter().find(|c| c.id == component_id) else {
        die(&format!("no component {component_id} in the plan"));
    };

    let Remedy::Choose { options, .. } = &c.remedy else {
        die(&format!(
            "component {component_id} offers no download (remedy is {:?})",
            std::mem::discriminant(&c.remedy)
        ));
    };
    let Some(o) = options.iter().find(|o| o.id == option_id) else {
        die(&format!("no option {option_id} on {component_id}"));
    };

    println!("{}  {}", o.label, o.version);
    println!("  from {}", o.url);
    println!("  {} bytes, sha256 {}", o.bytes, o.sha256);
    println!("  to   {}", o.dest);
    println!();

    let mut last = 0u64;
    match download_verified(&o.url, &o.sha256, &o.dest, |got, total| {
        if got - last > 8_000_000 || got == total {
            last = got;
            let pct = (got * 100).checked_div(total).unwrap_or(0);
            println!("  {pct:>3}%  {got}/{total}");
        }
    })
    .await
    {
        Ok(r) => {
            println!();
            println!("verified: {}", r.verified);
            println!("bytes:    {}", r.bytes);
            println!("sha256:   {}", r.sha256);
            println!("path:     {}", r.path);
            println!();
            println!("Not run. Running it is a separate decision.");
        }
        Err(e) => die(&e),
    }
}

/// Install a file bundle into the folder the plan names.
///
/// Every file is checked against the git blob hash GitHub publishes before
/// anything is written, and one mismatch aborts the whole thing.
async fn bundle(component_id: &str) {
    let plan = plan_setup_inner(None, None).await;
    let Some(c) = plan.components.iter().find(|c| c.id == component_id) else {
        die(&format!("no component {component_id} in the plan"));
    };

    let Remedy::Bundle {
        label,
        files,
        bytes,
        target,
        ..
    } = &c.remedy
    else {
        die(&format!("{component_id} offers no bundle"));
    };

    println!("{label}  ({bytes} bytes)");
    println!("  into {target}");
    println!();

    let mut last = 0u64;
    match install_bundle_inner(files, target, |got, total| {
        if got - last > 2_000_000 || got == total {
            last = got;
            let pct = (got * 100).checked_div(total).unwrap_or(0);
            println!("  {pct:>3}%  {got}/{total}");
        }
    })
    .await
    {
        Ok(msg) => println!("\n{msg}"),
        Err(e) => die(&e),
    }
}

/// The second decision: actually execute what was downloaded.
///
/// Goes through `run_installer` rather than spawning it directly, so the real
/// entry point is what gets exercised.
///
/// Launched interactively on purpose. NSIS takes `/S`, and using it would mean
/// installing something on someone's machine without them seeing a single one
/// of its own questions, which is the behaviour this app is supposed to be the
/// opposite of.
fn run_downloaded_installer() {
    let path = downloads_dir().join("Ruby4Lich5.exe");
    let path_s = path.to_string_lossy().to_string();

    println!("running {path_s}");
    match run_installer(path_s) {
        Ok(()) => println!("launched — it asks its own questions from here"),
        Err(e) => die(&e),
    }
    println!();
}

/// `run_installer` refuses anything outside the app's own download folder and
/// anything that is not an `.exe`. Guards are only worth having if they have
/// been run, and this is separate from `run` so re-checking them does not mean
/// launching a 65 MB installer again.
fn check_guards() {
    println!("-- run_installer guards --");

    // The extension guard needs a file *inside* the download folder, or the
    // path guard catches it first and the check never runs. The first version
    // of this test used C:\Lich5\lich.rbw and reported the wrong refusal
    // reason while looking like it passed.
    let decoy = downloads_dir().join("not-an-installer.txt");
    let _ = std::fs::write(&decoy, b"not an installer");

    for (label, bad, want) in [
        (
            "outside the download folder",
            PathBuf::from("C:\\Windows\\System32\\cmd.exe"),
            "outside the app's own download folder",
        ),
        ("not an .exe", decoy.clone(), "not an installer"),
    ] {
        match run_installer(bad.to_string_lossy().into_owned()) {
            Ok(()) => {
                eprintln!("FAILED: ran {label}");
                std::process::exit(1);
            }
            Err(e) if e.contains(want) => println!("  refused {label}: {e}"),
            Err(e) => {
                eprintln!("FAILED: refused {label} for the wrong reason: {e}");
                std::process::exit(1);
            }
        }
    }
    let _ = std::fs::remove_file(&decoy);
}

/// Put the bridge script into Lich, and check it landed where the plan said.
///
/// The check is the point. A copy that succeeds into the wrong Lich looks
/// identical to one that succeeds into the right one, right up until someone
/// types the start command and nothing at all happens.
fn install_bridge() {
    // Outside the app there is no bundled resource, so use the repo copy.
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .join("lich-scripts")
        .join("companion_bridge.lic");

    if !src.exists() {
        die(&format!("no bridge script at {}", src.to_string_lossy()));
    }

    let Some(target) = bridge_target_dir() else {
        die("no Lich scripts folder found");
    };
    println!("target: {}", target.to_string_lossy());

    match copy_bridge_to_lich(&src) {
        Ok(dest) => {
            println!("copied: {dest}");
            if !PathBuf::from(&dest).exists() {
                die("reported success but the file is not there");
            }
            let want = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
            let got = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
            if want != got {
                die(&format!("size mismatch: source {want}, copy {got}"));
            }
            println!("verified: {got} bytes on disk");
        }
        Err(e) => die(&e),
    }
}

fn die(msg: &str) -> ! {
    eprintln!("FAILED: {msg}");
    std::process::exit(1);
}
