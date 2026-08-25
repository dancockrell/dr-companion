//! Prints what `plan_setup` sees on this machine.
//!
//!   cargo run --example plan
//!
//! Exists because the setup flow cannot be exercised from the browser, and a
//! detection bug is invisible until someone with a different machine hits it.

fn main() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime");
    let plan = rt.block_on(dr_companion_lib::setup::plan_setup());
    println!("{}", serde_json::to_string_pretty(&plan).unwrap());
}
