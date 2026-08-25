//! What we would offer someone with no Genie installed.
//!
//!   cargo run --example genie
//!
//! Exists because this machine has Genie, so the offer path never runs in a
//! normal plan and a broken asset name would go unnoticed.

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
    rt.block_on(async {
        use dr_companion_lib::setup::*;
        let g5 = newest_release(GENIE5_REPO).await;
        let g4 = latest_release(GENIE4_REPO).await;
        let opts = genie_options(&g5, &g4);
        if opts.is_empty() {
            println!("NO OPTIONS — asset names may have changed upstream");
            std::process::exit(1);
        }
        for o in &opts {
            println!(
                "{}{}  {}  {:.1} MB\n   why: {}\n   checksum: {}\n   {}\n",
                if o.recommended { "* " } else { "  " },
                o.label,
                if o.prerelease { format!("{} (beta)", o.version) } else { o.version.clone() },
                o.bytes as f64 / 1_048_576.0,
                o.why,
                if o.sha256.is_empty() { "NOT PUBLISHED by upstream".into() } else { format!("{}…", &o.sha256[..16]) },
                o.url,
            );
        }
    });
}
