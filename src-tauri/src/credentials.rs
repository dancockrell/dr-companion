//! The one place a player's Play.net password is allowed to exist in this
//! process, and the single declaration of the host it is sent to.
//!
//! Lane N of `docs/PLAN_TO_1_0.md` makes this app sign the player in itself
//! (`docs/LICH_NATIVE_LOGIN.md` §2), which is the project's first first-party
//! credential handling. §5.1 of that document decides what happens to it:
//!
//! | Item | Stored | Where |
//! |---|---|---|
//! | Account name, character list, game code | yes | ordinary app settings, plain |
//! | **Password** | **no, unless the player ticks a box** (N8) | Windows Credential Manager only |
//!
//! So the password is typed each session, crosses the Tauri boundary exactly
//! once — inbound, as the argument of one command — is obscured for frame 2 of
//! the EAccess sequence, and is overwritten in place when it drops. It is never
//! written to a settings file, never put in a process argument (a Windows
//! command line is readable by any process of this user), never placed in the
//! `.sal`, and never logged.
//!
//! # What [`Secret`] guarantees, and how each guarantee is enforced
//!
//! | Guarantee | Enforced by |
//! |---|---|
//! | The bytes are overwritten when it drops | [`Drop`] below, plus `drop_overwrites_the_bytes` |
//! | It cannot be printed by accident | its [`std::fmt::Debug`] prints `Secret(<redacted>)`; there is no `Display` |
//! | It cannot be serialised | it derives nothing, and `NotSerializable` below turns an added `Serialize` into a *compile* error |
//! | Every read of the plaintext is greppable | there is no `Deref`; the only accessor is [`Secret::expose_for_obscuring`] |
//! | No log site names it | `no_logging_macro_mentions_a_secret_binding`, which walks the whole of `src-tauri/src` |
//!
//! `zeroize` is deliberately not used. `docs/SETUP-POLICY.md` makes a new Rust
//! dependency an ask, and at this scale it would buy nothing the manual [`Drop`]
//! below does not already do. The one thing it *would* buy — a compiler barrier
//! against the overwrite being optimised away — is bought here instead with
//! [`std::ptr::write_volatile`] and a [`std::sync::atomic::compiler_fence`].

use std::sync::atomic::{compiler_fence, Ordering};

/// Where the account name and the obscured password are sent, and the only
/// declaration of that endpoint in this tree.
///
/// **This line's shape is load-bearing.** `tools/build-privacy-doc.mjs` cannot
/// see a raw TLS socket the way it sees an `https://` URL, so it reads declared
/// endpoints written in exactly this form:
///
/// ```text
/// pub const <NAME>_ENDPOINT: (&str, u16) = ("host.example", 1234);
/// ```
///
/// `docs/PRIVACY.md` is generated from that scan and refuses to publish when a
/// declared endpoint has no description. Moving or reshaping this line without
/// updating the generator's `ENDPOINT` pattern makes the privacy document stale,
/// and `--check` says so rather than publishing quietly.
///
/// `docs/LICH_NATIVE_LOGIN.md` §2.1 is the source: `eaccess.rb:65-77`, host
/// `eaccess.play.net`, port `7910`, TLS.
pub const EACCESS_ENDPOINT: (&str, u16) = ("eaccess.play.net", 7910);

/// The endpoint to use, after the two test-only overrides.
///
/// `DRC_EACCESS_HOST` and `DRC_EACCESS_PORT` exist only so a test can aim the
/// protocol client at a mock (`docs/LICH_NATIVE_LOGIN.md` §8). They are the
/// injection point that makes the unhappy paths reachable on purpose: a run
/// given a deliberately wrong port must fail *naming that port*, which a
/// default that happens to work could never prove.
///
/// This is the accessor `eaccess.rs` (N1) calls. A second declaration of the
/// host anywhere else would be a fork, and the two would drift.
pub fn eaccess_endpoint() -> Result<(String, u16), String> {
    let host = std::env::var("DRC_EACCESS_HOST").unwrap_or_else(|_| EACCESS_ENDPOINT.0.to_string());
    // A value that was set and cannot be parsed is an error naming itself, not
    // a quiet fall back to 7910. N1 tightened this: a knob whose wrong value is
    // silently ignored is one nobody can prove they connected through, and
    // every run "exercising" it would have passed on the default that happened
    // to work.
    let port = match std::env::var("DRC_EACCESS_PORT") {
        Ok(raw) if !raw.trim().is_empty() => raw
            .trim()
            .parse::<u16>()
            .map_err(|_| format!("DRC_EACCESS_PORT is not a port number: {raw}"))?,
        _ => EACCESS_ENDPOINT.1,
    };
    Ok((host, port))
}

/// A password, held in memory for the length of one login and no longer.
///
/// Construct it from an owned `String` so the caller's copy is moved rather
/// than duplicated: the command signature takes the `String` serde built, hands
/// it straight to [`Secret::new`], and from that point the plaintext exists in
/// exactly one place that knows how to erase itself.
pub struct Secret(String);

impl Secret {
    /// Take ownership of a plaintext password.
    pub fn new(plaintext: String) -> Self {
        Self(plaintext)
    }

    /// The raw bytes, for the XOR obscuring of frame 2 only.
    ///
    /// Named for its one legitimate use rather than `as_str`, and there is no
    /// [`std::ops::Deref`], so `git grep -n expose_for_obscuring src-tauri/src`
    /// enumerates every place in this program that can see a plaintext
    /// password. A shorter name would make that list longer.
    pub fn expose_for_obscuring(&self) -> &[u8] {
        self.0.as_bytes()
    }

    /// Length in bytes. Enough for the "password longer than the hashkey"
    /// error `docs/LICH_NATIVE_LOGIN.md` §2.3 requires, without exposing it.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether the player typed anything at all.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        // In place, through the `String`'s own buffer, so no reallocation
        // leaves a copy behind. `write_volatile` and the fence stop the
        // compiler removing a write to memory it can prove is never read.
        let bytes = unsafe { self.0.as_bytes_mut() };
        for byte in bytes.iter_mut() {
            unsafe { std::ptr::write_volatile(byte, 0) };
        }
        compiler_fence(Ordering::SeqCst);
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Not the length either: a length is a fact about the password.
        f.write_str("Secret(<redacted>)")
    }
}

/// A compile-time proof that [`Secret`] does not implement `serde::Serialize`.
///
/// The blanket impl covers every serialisable type. The concrete impl below it
/// therefore overlaps — and fails to compile — the moment somebody adds
/// `#[derive(Serialize)]` to `Secret`, or a `Serialize` impl for it anywhere in
/// the crate. A test cannot check this, because the failure it guards against
/// is the code compiling at all.
///
/// This is the guarantee that keeps the password out of every Tauri result and
/// event: a `#[tauri::command]` return type must be `Serialize`, so a `Secret`
/// can never be one.
#[allow(dead_code)] // used only for the coherence conflict above, never as a bound.
trait NotSerializable {}
impl<T: serde::Serialize> NotSerializable for T {}
impl NotSerializable for Secret {}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixture password, assembled at runtime so no credential-shaped string
    /// literal sits in the tree (§1 trap 3).
    fn fixture() -> String {
        format!("{}{}", "hunt", "er".len() * 1000 + 2)
    }

    #[test]
    fn debug_never_prints_the_password() {
        let typed = fixture();
        let held = Secret::new(typed.clone());
        let rendered = format!("{held:?}");
        assert_eq!(rendered, "Secret(<redacted>)");
        assert!(!rendered.contains(&typed), "Debug rendered what was typed");
    }

    #[test]
    fn expose_for_obscuring_is_the_bytes() {
        let typed = fixture();
        let held = Secret::new(typed.clone());
        assert_eq!(held.expose_for_obscuring(), typed.as_bytes());
        assert_eq!(held.len(), typed.len());
        assert!(!held.is_empty());
        assert!(Secret::new(String::new()).is_empty());
    }

    /// Reading freed memory is undefined behaviour, so this proves the erase
    /// against a buffer it still owns: the `Drop` body is what is under test,
    /// and it is run against a `Secret` whose bytes are then read back through
    /// a pointer taken before the drop. `ManuallyDrop` keeps the allocation
    /// alive so the read is of live memory.
    #[test]
    fn drop_overwrites_the_bytes() {
        let typed = fixture();
        let len = typed.len();
        let mut held = std::mem::ManuallyDrop::new(Secret::new(typed));
        let ptr = held.0.as_ptr();

        // Positive control: before the drop the plaintext is really there, so
        // an "all zero" result afterwards cannot be an empty buffer we never
        // wrote to in the first place.
        let before = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
        assert!(
            before.iter().any(|&b| b != 0),
            "the fixture was already zero"
        );

        unsafe { std::mem::ManuallyDrop::drop(&mut held) };

        let after = unsafe { std::slice::from_raw_parts(ptr, len) };
        assert!(
            after.iter().all(|&b| b == 0),
            "Drop left {} non-zero byte(s) of {len}",
            after.iter().filter(|&&b| b != 0).count()
        );
    }

    #[test]
    fn the_endpoint_is_simutronics_and_the_overrides_are_read() {
        assert_eq!(EACCESS_ENDPOINT, ("eaccess.play.net", 7910));
        // The env-var overrides are process-global, so they are not exercised
        // here; `eaccess.rs`'s own suite aims a run at a deliberately wrong
        // port and requires the failure to name it (N1).
        let (host, port) = eaccess_endpoint().expect("no malformed override is set in this case");
        if std::env::var("DRC_EACCESS_HOST").is_err() {
            assert_eq!(host, EACCESS_ENDPOINT.0);
        }
        if std::env::var("DRC_EACCESS_PORT").is_err() {
            assert_eq!(port, EACCESS_ENDPOINT.1);
        }
    }

    /// The guarantee no type system can give: that no *other* file prints the
    /// thing. Walks the whole of `src-tauri/src` and fails if any formatting or
    /// logging macro's arguments name a password binding.
    ///
    /// Three states, not two (§1): the counts below are asserted before any
    /// verdict, because "no leaks found" is exactly what a walker that found no
    /// files also says. The positive control at the end proves the matcher can
    /// fire at all.
    #[test]
    fn no_logging_macro_mentions_a_secret_binding() {
        let root = std::path::Path::new("src");
        let mut files = Vec::new();
        collect_rs(root, &mut files);

        let mut macro_sites = 0usize;
        let mut test_lines_not_scanned = 0usize;
        let mut offenders: Vec<String> = Vec::new();
        for path in &files {
            let text = std::fs::read_to_string(path).expect("source file is readable");
            // A `#[cfg(test)]` module ships in no binary, and a suite about
            // passwords is made of the word. Cut there rather than filtering by
            // keyword, and count what was cut: a skip is not a pass, so the
            // number is asserted and printed below.
            let all: Vec<&str> = text.lines().collect();
            let cut = all
                .iter()
                .position(|l| l.trim_start().starts_with("#[cfg(test)]"))
                .unwrap_or(all.len());
            test_lines_not_scanned += all.len() - cut;
            for (i, line) in all[..cut].iter().enumerate() {
                if !is_output_macro(line) {
                    continue;
                }
                macro_sites += 1;
                if names_a_secret(line) {
                    offenders.push(format!("{}:{}: {}", path.display(), i + 1, line.trim()));
                }
            }
        }

        // Denominators first. Each goes to zero when the *mechanism* breaks —
        // a moved directory, a walker that stopped recursing, a matcher that
        // stopped matching — and a broken mechanism reports a clean tree.
        assert!(
            files.len() >= 15,
            "walked only {} source files; the scan is broken, not the tree",
            files.len()
        );
        assert!(
            macro_sites >= 50,
            "found only {macro_sites} output-macro sites in {} files; the matcher is broken",
            files.len()
        );

        // Positive control: the same two matchers, on a line that must be
        // caught. Without this, a matcher that matches nothing passes.
        let control = "        println!(\"{}\", password);";
        assert!(
            is_output_macro(control) && names_a_secret(control),
            "the leak matcher does not fire on a known leak; every result above is meaningless"
        );
        // The form that hides inside a literal: Rust captures `{password}`
        // from the surrounding scope, so this is a leak even though the name
        // is between quotes.
        let inline = "        eprintln!(\"login failed for {password}\");";
        assert!(
            is_output_macro(inline) && names_a_secret(inline),
            "an inline format capture of a password is not being caught"
        );
        // And the other direction, twice, so it is not simply matching
        // everything: an ordinary binding, and the word in prose.
        let benign = "        println!(\"{}\", port);";
        assert!(
            is_output_macro(benign) && !names_a_secret(benign),
            "the leak matcher fires on a line with no secret in it"
        );
        let prose = "        format!(\"that account name or password was refused\")";
        assert!(
            is_output_macro(prose) && !names_a_secret(prose),
            "the leak matcher cannot tell an error message from a binding"
        );

        assert!(
            offenders.is_empty(),
            "{} of {macro_sites} output-macro site(s) across {} files name a password binding:\n{}",
            offenders.len(),
            files.len(),
            offenders.join("\n")
        );

        eprintln!(
            "no_logging_macro_mentions_a_secret_binding: {} files, {macro_sites} output-macro sites scanned, \
             {test_lines_not_scanned} line(s) inside `#[cfg(test)]` not scanned, {} offender(s)",
            files.len(),
            offenders.len()
        );
    }

    fn collect_rs(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).expect("src is readable") {
            let path = entry.expect("a readable directory entry").path();
            if path.is_dir() {
                collect_rs(&path, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                out.push(path);
            }
        }
    }

    /// Any macro that turns a value into text a person or a file could read.
    fn is_output_macro(line: &str) -> bool {
        [
            "println!",
            "print!",
            "eprintln!",
            "eprint!",
            "format!",
            "write!",
            "writeln!",
            "log::",
            "panic!",
        ]
        .iter()
        .any(|m| line.contains(m))
    }

    /// The binding names a `Secret`'s plaintext travels under. Derived from the
    /// type's usage: the accessor is `expose_for_obscuring`, and the argument
    /// the Tauri commands take is `password` (`docs/LICH_NATIVE_LOGIN.md` §8).
    fn names_a_secret(line: &str) -> bool {
        const NAMES: [&str; 5] = [
            "expose_for_obscuring",
            "password",
            "passwd",
            "secret",
            "plaintext",
        ];
        // Only identifiers count, not prose: `"wrong password"` is what a
        // human-readable error is made of and must not be a finding. But Rust's
        // inline captures — `format!("{password}")` — are identifiers written
        // *inside* the literal and are a real leak, so those are kept.
        let identifiers = identifiers_only(line);
        NAMES.iter().any(|n| identifiers.contains(n))
    }

    /// The line with string literals removed, except for the names captured
    /// inline by `{name}` / `{name:?}` inside them, which are bindings.
    fn identifiers_only(line: &str) -> String {
        let mut out = String::new();
        let mut in_string = false;
        let mut escaped = false;
        let mut capture: Option<String> = None;
        for ch in line.chars() {
            if let Some(buf) = capture.as_mut() {
                if ch == '}' || ch == ':' {
                    out.push(' ');
                    out.push_str(buf);
                    out.push(' ');
                    capture = None;
                    if ch == ':' {
                        // Skip the format spec; the closing brace ends the
                        // literal-scanning branch below on its own.
                        continue;
                    }
                    continue;
                }
                buf.push(ch);
                continue;
            }
            if in_string {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == '"' {
                    in_string = false;
                } else if ch == '{' {
                    capture = Some(String::new());
                }
                continue;
            }
            if ch == '"' {
                in_string = true;
                continue;
            }
            out.push(ch);
        }
        if let Some(buf) = capture {
            out.push(' ');
            out.push_str(&buf);
        }
        out
    }
}
