//! Fixtures shared by more than one module's tests.
//!
//! Today this is one thing: a scratch directory that two `cargo test`
//! processes cannot collide in.
//!
//! ## Why this exists (issue #502)
//!
//! Several sessions work this repository at once and each runs `npm run gate`,
//! which runs `cargo test`. The Rust suite used to be unsafe to run as two
//! processes, because `setup.rs` and `bridge_token.rs` each built a scratch
//! directory like this:
//!
//! ```text
//! let d = std::env::temp_dir().join("drc-vendor-good");   // a constant name
//! let _ = std::fs::remove_dir_all(&d);                    // wipes the other run
//! std::fs::create_dir_all(&d).unwrap();
//! ```
//!
//! Two processes therefore shared one directory, and each one's setup deleted
//! the other's fixture mid-test. Measured on this branch's parent, running the
//! built lib test binary from `src-tauri/`:
//!
//! ```text
//! control, 1 process x 5 runs of vendor_tests      0 of   5 failed
//! 6 concurrent processes x 25 runs                54 of 150 failed  (36%)
//! 6 concurrent processes x 25 runs, bridge_token  54 of 150 failed  (36%)
//! 4 concurrent processes x 4 full-suite runs       2 of  16 failed
//! ```
//!
//! The fix is not "schedule the lanes apart". It is to remove the shared name:
//! every directory this helper hands out is unique per process **and** per
//! call, so there is nothing to collide over and nothing to wipe on entry.
//!
//! ## The rule this module enforces
//!
//! A test that needs a directory calls [`scratch_dir`]. It never builds a path
//! from `std::env::temp_dir().join("some-literal")`, and it never deletes a
//! directory on the way *in* — deletion happens on the way out, from
//! [`ScratchDir`]'s `Drop`, so an aborted run cleans up after itself and a
//! concurrent run is never touched.
//!
//! `tools/rust-test-isolation-test.mjs` is the check that keeps this true: it
//! reads every `.rs` file under `src-tauri/src` and fails on a fixed-name temp
//! directory or a fixed test port. Run it with a fixed name reintroduced and
//! it names the file and line.
//!
//! ## Not the only `test_support` in the crate
//!
//! `eaccess::test_support` (issue #475) is the scripted EAccess server, and it
//! lives beside the protocol it mocks because `lich.rs` needs that same
//! instrument. This module is the crate-level home for fixtures that belong to
//! no single module. Neither duplicates the other; if the EAccess mock ever
//! needs a third consumer outside `eaccess`/`lich`, move it here rather than
//! copying it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Distinguishes two calls inside one process. `std::process::id()` alone is
/// not enough: the test binary runs its cases on several threads at once, so
/// two tests in the *same* process would otherwise share a name too.
static NEXT: AtomicU64 = AtomicU64::new(0);

/// A scratch directory that exists for as long as the value does.
///
/// Deliberately not `Clone` and not `Copy`: two owners would mean two `Drop`s,
/// and the second would be deleting a directory it does not own any more.
pub(crate) struct ScratchDir(PathBuf);

impl ScratchDir {
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }

    /// `dir.join("x")` reads better than `dir.path().join("x")` at the call
    /// sites, which are mostly one line long.
    pub(crate) fn join<P: AsRef<Path>>(&self, p: P) -> PathBuf {
        self.0.join(p)
    }
}

impl AsRef<Path> for ScratchDir {
    fn as_ref(&self) -> &Path {
        &self.0
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        // Best effort. A file still open on Windows can refuse to go, and a
        // test failing because its own cleanup could not run would be a worse
        // signal than a stray directory under `%TEMP%/dr-companion-tests`.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A directory no other test, and no other `cargo test` process, can be in.
///
/// The name carries the process id and a per-call counter, so it is unique
/// across processes and across the threads inside one process. `label` is for
/// a human reading `%TEMP%` after a crash; it is not what makes the path
/// unique, and it may repeat.
///
/// Nothing is deleted on entry. That is the whole point: the old helpers wiped
/// the directory before creating it, which is what let one run destroy
/// another's fixture.
pub(crate) fn scratch_dir(label: &str) -> ScratchDir {
    let dir = std::env::temp_dir()
        .join("dr-companion-tests")
        .join(format!(
            "{}-{}-{label}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| panic!("scratch dir {}: {e}", dir.display()));
    ScratchDir(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The property the whole module exists for: two calls are two
    /// directories. Asserted rather than read off the `format!`, because the
    /// counter is the part that would silently stop incrementing.
    #[test]
    fn two_calls_never_share_a_directory() {
        let a = scratch_dir("same-label");
        let b = scratch_dir("same-label");
        assert_ne!(a.path(), b.path(), "two scratch dirs must not share a path");
        assert!(a.path().is_dir());
        assert!(b.path().is_dir());
    }

    /// A new scratch directory must not disturb an existing one. This is the
    /// cross-process failure in miniature: with the old `remove_dir_all` on
    /// entry and a shared name, `b`'s creation destroyed `a`'s fixture.
    #[test]
    fn creating_one_does_not_wipe_another() {
        let a = scratch_dir("victim");
        std::fs::write(a.join("fixture.txt"), b"still here").unwrap();
        let _b = scratch_dir("victim");
        assert_eq!(
            std::fs::read(a.join("fixture.txt")).unwrap(),
            b"still here",
            "a second scratch dir must not touch the first"
        );
    }

    /// Cleanup is on the way out, so an ordinary run leaves nothing behind.
    #[test]
    fn the_directory_goes_away_when_the_guard_does() {
        let path = {
            let d = scratch_dir("dropped");
            std::fs::write(d.join("f"), b"x").unwrap();
            d.path().to_path_buf()
        };
        assert!(!path.exists(), "the scratch dir should be gone after drop");
    }
}
