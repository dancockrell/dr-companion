//! Exercises the real download path: fetch, stream, verify, extract.
//!
//!   cargo run --example fetch
//!
//! Uses the small lich-5.zip rather than the 65 MB installer. Also checks that
//! a bad checksum is rejected and the file removed, because "we verify" is
//! only worth saying if the failure path has actually been run.

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");

    rt.block_on(async {
        let url = "https://github.com/elanthia-online/lich-5/releases/download/v5.20.1/lich-5.zip";
        let good = "af5380d0eec569f06e3d073644024472c14022068a0ccac212d92f220a0021a0";
        let dest = std::env::temp_dir().join("drc-test-lich.zip");
        let dest_s = dest.to_string_lossy().to_string();

        println!("-- happy path --");
        let mut last = 0u64;
        match dr_companion_lib::setup::download_verified(url, good, &dest_s, |r, t| {
            if r - last > 400_000 { last = r; println!("   {r}/{t}"); }
        }).await {
            Ok(res) => println!("OK  {} bytes, sha256 {}, verified={}", res.bytes, res.sha256, res.verified),
            Err(e) => { println!("FAIL {e}"); std::process::exit(1); }
        }

        println!("-- bad checksum is rejected --");
        let bad_dest = std::env::temp_dir().join("drc-test-bad.zip");
        let bad_s = bad_dest.to_string_lossy().to_string();
        match dr_companion_lib::setup::download_verified(url, &"0".repeat(64), &bad_s, |_, _| {}).await {
            Ok(_) => { println!("FAIL: accepted a bad checksum"); std::process::exit(1); }
            Err(e) => println!("OK  rejected: {}", e.lines().next().unwrap_or("")),
        }
        println!("    file left behind? {}", bad_dest.exists() || bad_dest.with_extension("part").exists());

        println!("-- unexpected host is refused --");
        match dr_companion_lib::setup::download_verified("https://example.com/evil.exe", "", &bad_s, |_,_| {}).await {
            Ok(_) => { println!("FAIL: fetched from an unexpected host"); std::process::exit(1); }
            Err(e) => println!("OK  {e}"),
        }

        println!("-- extract --");
        match dr_companion_lib::setup::extract_lich(dest_s.clone()) {
            Ok(dir) => {
                let n = std::fs::read_dir(&dir).map(|d| d.count()).unwrap_or(0);
                println!("OK  extracted to {dir} ({n} entries)");
                let lich = std::path::Path::new(&dir).join("lich.rbw");
                println!("    lich.rbw present: {}", lich.exists());
            }
            Err(e) => { println!("FAIL {e}"); std::process::exit(1); }
        }
        let _ = std::fs::remove_file(&dest);
    });
}
