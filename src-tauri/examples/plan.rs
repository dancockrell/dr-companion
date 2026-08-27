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
    // `plan_setup_inner`, not `plan_setup` - the public command needs a real
    // AppHandle only to resolve where a bundled Ruby4Lich5 would be, and this
    // dev checkout (run from a bare `cargo run`, no window) has nothing
    // bundled anyway. `None` here is exactly what an unbundled checkout
    // answers for real.
    let plan = rt.block_on(dr_companion_lib::setup::plan_setup_inner(None));
    println!("{}", serde_json::to_string_pretty(&plan).unwrap());
}
