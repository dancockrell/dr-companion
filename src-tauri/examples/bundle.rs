//! Installs the Genie plugin set into a temp folder and checks verification.
//!
//!   cargo run --example bundle
//!
//! Uses a scratch directory, not a real Genie install. Also corrupts an
//! expected hash to confirm a bad file is refused and not written.

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
    rt.block_on(async {
        use dr_companion_lib::setup::*;

        let files = list_repo_files(GENIE_PLUGINS_REPO, "", &[".dll", ".xml"]).await;
        println!("listed {} files from {GENIE_PLUGINS_REPO}", files.len());
        if files.is_empty() { println!("FAIL: no files listed"); std::process::exit(1); }
        for f in files.iter().take(3) {
            println!("   {}  {}B  blob {}", f.name, f.bytes, &f.sha[..12]);
        }

        let dir = std::env::temp_dir().join("drc-bundle-test");
        let _ = std::fs::remove_dir_all(&dir);
        let dir_s = dir.to_string_lossy().to_string();

        println!("-- happy path --");
        let mut last = 0u64;
        match install_bundle_inner(&files, &dir_s, |r, t| {
            if r - last > 100_000 { last = r; println!("   {r}/{t}"); }
        }).await {
            Ok(msg) => println!("OK  {msg}"),
            Err(e) => { println!("FAIL {e}"); std::process::exit(1); }
        }
        let got = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
        println!("    files on disk: {got}");
        println!("    EXPTracker.dll present: {}", dir.join("EXPTracker.dll").exists());

        println!("-- a tampered hash is refused --");
        let bad_dir = std::env::temp_dir().join("drc-bundle-bad");
        let _ = std::fs::remove_dir_all(&bad_dir);
        let mut tampered = files.clone();
        tampered[0].sha = "0".repeat(40);
        match install_bundle_inner(&tampered, &bad_dir.to_string_lossy(), |_, _| {}).await {
            Ok(_) => { println!("FAIL: accepted a bad hash"); std::process::exit(1); }
            Err(e) => println!("OK  {}", e.lines().next().unwrap_or("")),
        }
        let leaked = std::fs::read_dir(&bad_dir).map(|d| d.count()).unwrap_or(0);
        println!("    files written despite failure: {leaked}");
        if leaked > 0 { println!("FAIL: wrote a file that did not verify"); std::process::exit(1); }

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&bad_dir);
    });
}
