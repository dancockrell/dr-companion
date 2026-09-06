//! The optional half of Lane N's credential handling: remembering the
//! password between sessions, in Windows Credential Manager and nowhere else.
//!
//! [`credentials`](crate::credentials) is the module the password lives in for
//! the length of one sign-in. This one is the only thing in the program that
//! can make it outlive that, and it does so **only** when the player has ticked
//! a box that is off by default (`docs/LICH_NATIVE_LOGIN.md` §5.2).
//!
//! # The shape of the promise
//!
//! | | |
//! |---|---|
//! | Where | Windows Credential Manager, under one service name, one entry per account |
//! | Default | off — nothing is stored until the player asks |
//! | Who can read it | anyone signed in to this Windows account, which is what the UI says in as many words |
//! | What this module returns to the webview | `()`, `bool`, `bool`. **Never the password.** |
//!
//! §5.2 of the design says there is no third option and means it: a password in
//! a settings file, obfuscated or not, is a plaintext password with a decoding
//! step. So there is one store, and the module that talks to it is small enough
//! to read in a sitting.
//!
//! # Why the password never comes back out through a command
//!
//! [`load`] is a plain Rust function, not a `#[tauri::command]`, and it returns
//! a [`Secret`], which cannot be serialised (see `credentials.rs`'s
//! `NotSerializable`). So the stored password can travel from Credential
//! Manager into the EAccess client and no further: there is no route from here
//! to the webview, and the compiler is what enforces that rather than a
//! convention.
//!
//! # The seam that makes the tests real
//!
//! Every function here takes the service name as an argument, and only the
//! `#[tauri::command]` wrappers call [`service_name`]. A test therefore names
//! its own service and *cannot* reach the one a player's credentials live
//! under, however wrong it goes — which is a stronger guarantee than a test
//! that promises to clean up after itself.

use crate::credentials::Secret;

/// The service name a player's entry lives under.
///
/// Windows Credential Manager's target name for an entry is
/// `{account}.{service}` (`windows-native-keyring-store`'s default divider is
/// `.`), so an account `Somebody` lands as `Somebody.dr-companion.play.net` and
/// `cmdkey /list` can be filtered on the constant below. That is the check
/// N8's `verify:` line runs, and it is only meaningful because this string is
/// distinctive.
pub const SERVICE: &str = "dr-companion.play.net";

/// `DRC_CREDENTIAL_SERVICE` moves every entry to another service name.
///
/// It exists so a manual run can be aimed somewhere harmless, in the same
/// spirit as `DRC_EACCESS_HOST`. The automated tests do not use it: they pass
/// a service name directly, because an environment variable is process-global
/// and a test that forgot to set it would silently write to a player's real
/// store.
pub fn service_name() -> String {
    std::env::var("DRC_CREDENTIAL_SERVICE").unwrap_or_else(|_| SERVICE.to_string())
}

/// Store a password for `account`, replacing any entry already there.
///
/// Takes the [`Secret`] rather than a `String`, so the plaintext arrives here
/// already inside the type that erases itself, and the caller cannot have a
/// second copy it forgot about.
///
/// An empty secret is refused. Writing one would leave an entry that
/// [`has`] reports as present and that signs nobody in — a stored credential
/// that is indistinguishable from a working one is worse than none.
pub fn store(service: &str, account: &str, secret: &Secret) -> Result<(), String> {
    if account.trim().is_empty() {
        return Err("no account name to store a password under".into());
    }
    if secret.is_empty() {
        return Err("refusing to store an empty password".into());
    }
    let plaintext = std::str::from_utf8(secret.expose_for_obscuring())
        .map_err(|_| "the password is not valid text".to_string())?;
    backend::set(service, account, plaintext)
}

/// Whether an entry exists for `account`. Never reveals what is in it.
pub fn has(service: &str, account: &str) -> Result<bool, String> {
    if account.trim().is_empty() {
        return Ok(false);
    }
    backend::exists(service, account)
}

/// Remove the entry for `account`. `Ok(false)` means there was none.
pub fn forget(service: &str, account: &str) -> Result<bool, String> {
    if account.trim().is_empty() {
        return Ok(false);
    }
    backend::remove(service, account)
}

/// Read the stored password back, for one sign-in.
///
/// **Not a command, and deliberately.** The caller is
/// `lich::WindowsCredentialManager`, which `lich_login_characters` and
/// `lich_login_launch` hand to `resolve_password`; that reaches this when the
/// webview passed no password, and uses the [`Secret`] once - it is dropped,
/// and overwritten, on the way out of that call. Nothing serialises a
/// `Secret`, so there is no path from this return value to the frontend.
///
/// **This paragraph named those callers for a day before they existed**
/// (issue #459). N8 shipped the store, the checkbox and the notice telling a
/// player their password was now in Credential Manager, and nothing ever read
/// it back: the player typed it again on every sign-in, so the stored secret
/// bought nothing and cost a persisted credential. A claim about somebody's
/// callers is checkable, which is why `tools/credential-store-test.mjs` now
/// greps for a non-test caller of this function rather than taking the
/// sentence above on trust.
pub fn load(service: &str, account: &str) -> Option<Secret> {
    if account.trim().is_empty() {
        return None;
    }
    backend::get(service, account).map(Secret::new)
}

/// Why the store cannot be used, or `None` when it can.
///
/// Three states rather than two: a run that could not reach Credential Manager
/// must be able to say so by name instead of reporting an empty store, which
/// is what "no entry" and "no store" would otherwise look like from here.
pub fn unavailable_reason() -> Option<String> {
    backend::unavailable_reason()
}

/* ------------------------------------------------------------- commands --- */

/// Remember this password. Called only when the player ticked the box.
///
/// The argument is a `String` because that is what crosses the Tauri boundary;
/// it is moved into a [`Secret`] on the first line and never copied, so the
/// plaintext exists in one place that knows how to erase itself.
#[tauri::command]
pub fn credential_store(account: String, password: String) -> Result<(), String> {
    let secret = Secret::new(password);
    store(&service_name(), &account, &secret)
}

/// Whether a password is remembered for this account. A `bool`, never the text.
#[tauri::command]
pub fn credential_has(account: String) -> Result<bool, String> {
    has(&service_name(), &account)
}

/// Forget the remembered password. `false` means there was nothing to forget.
#[tauri::command]
pub fn credential_forget(account: String) -> Result<bool, String> {
    forget(&service_name(), &account)
}

/* -------------------------------------------------------------- backend --- */

#[cfg(windows)]
mod backend {
    use keyring::{Entry, Error};

    fn entry(service: &str, account: &str) -> Result<Entry, String> {
        Entry::new(service, account).map_err(|e| format!("credential store unavailable: {e}"))
    }

    pub fn set(service: &str, account: &str, plaintext: &str) -> Result<(), String> {
        entry(service, account)?
            .set_password(plaintext)
            .map_err(|e| format!("could not write to the credential store: {e}"))
    }

    pub fn exists(service: &str, account: &str) -> Result<bool, String> {
        match entry(service, account)?.get_password() {
            Ok(_) => Ok(true),
            Err(Error::NoEntry) => Ok(false),
            Err(e) => Err(format!("could not read the credential store: {e}")),
        }
    }

    pub fn get(service: &str, account: &str) -> Option<String> {
        entry(service, account).ok()?.get_password().ok()
    }

    pub fn remove(service: &str, account: &str) -> Result<bool, String> {
        match entry(service, account)?.delete_credential() {
            Ok(()) => Ok(true),
            Err(Error::NoEntry) => Ok(false),
            Err(e) => Err(format!("could not remove from the credential store: {e}")),
        }
    }

    pub fn unavailable_reason() -> Option<String> {
        match Entry::store_status() {
            Ok(()) => None,
            Err(e) => Some(e.to_string()),
        }
    }
}

#[cfg(not(windows))]
mod backend {
    //! No store. The app ships for Windows, `keyring` is target-gated in
    //! `Cargo.toml` for the same reason `windows-sys` is, and the honest
    //! answer here is a named refusal rather than a silent success.

    const WHY: &str = "this build has no credential store: Windows Credential Manager is the only one this app uses";

    pub fn set(_service: &str, _account: &str, _plaintext: &str) -> Result<(), String> {
        Err(WHY.into())
    }
    pub fn exists(_service: &str, _account: &str) -> Result<bool, String> {
        Err(WHY.into())
    }
    pub fn get(_service: &str, _account: &str) -> Option<String> {
        None
    }
    pub fn remove(_service: &str, _account: &str) -> Result<bool, String> {
        Err(WHY.into())
    }
    pub fn unavailable_reason() -> Option<String> {
        Some(WHY.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The prefix every test service name carries, so a leftover from a run
    /// that died mid-test can be found and removed.
    ///
    /// These tests write to a real Windows credential store, and a *failing*
    /// run does not reach its own cleanup — that was observed, three entries
    /// deep, while reproducing this increment's sabotage. So the sweep below
    /// runs first rather than the tests promising to tidy up after themselves,
    /// and the manual check is one line:
    ///
    /// ```text
    /// cmdkey /list | findstr dr-companion-test
    /// ```
    const TEST_PREFIX: &str = "dr-companion-test.";

    /// One nonce for the whole test process: nanoseconds since the epoch,
    /// then this process's own id.
    ///
    /// Shared rather than per-service so the sweep can tell *this* run's
    /// entries from a stale one: tests run in parallel threads, and a sweep
    /// that deleted anything carrying `TEST_PREFIX` would happily delete a
    /// sibling test's entry mid-assertion.
    ///
    /// The process id is not decoration. Two `cargo test` runs started
    /// inside one clock tick got the *same* nanosecond reading and therefore
    /// the same service name, and then each one's `has` saw the other's
    /// entry. Issue #502: the Windows credential store is a machine-wide
    /// namespace exactly as `%TEMP%` is, and the same rule applies to it —
    /// every fixture unique to the process that made it.
    static RUN_NONCE: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the clock is after 1970")
            .as_nanos();
        format!("{nanos}-{}", std::process::id())
    });

    /// How old a leftover has to be before the sweep will touch it.
    ///
    /// A concurrent `cargo test` process is minutes old at most, so an hour
    /// is far outside anything live and far inside anything abandoned.
    const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(3600);

    /// A service name no player's credentials can be under.
    ///
    /// Randomised per run so two `cargo test` invocations — or a run that died
    /// before its cleanup — cannot see each other's entries, and so a leftover
    /// from a previous run can never make a check pass.
    fn test_service(what: &str) -> String {
        let nonce = &*RUN_NONCE;
        let service = format!("{TEST_PREFIX}{what}.{nonce}");
        // The seam is only worth having if it cannot collide with the real
        // one. Assert it rather than trusting the name.
        assert_ne!(service, SERVICE, "a test must never use the real service");
        assert!(!service.starts_with(SERVICE));
        service
    }

    fn fixture() -> String {
        format!("{}{}", "hunt", "er".len() * 1000 + 2)
    }

    /// A store that cannot be reached must abort the suite naming the reason,
    /// never let a test pass on an absence.
    ///
    /// `windows-latest` has Credential Manager, so on CI this never fires and
    /// the round-trip below is really run. If it ever does fire, the message
    /// is the diagnosis rather than a green run with nothing behind it.
    fn require_store() {
        if let Some(why) = unavailable_reason() {
            panic!(
                "NOT CHECKED, and therefore failed: the credential-store tests \
                 could not run because {why}. A skip is not a pass; if this \
                 platform genuinely has no store, gate these tests explicitly \
                 rather than letting them report success."
            );
        }
    }

    /// store -> has -> forget -> has false, which is the increment's own
    /// `done-when` (0, 1, 0) run against a service name of this test's own.
    #[test]
    fn store_then_has_then_forget() {
        require_store();
        let service = test_service("roundtrip");
        let account = "n8-roundtrip";

        assert!(
            !has(&service, account).expect("a fresh service can be queried"),
            "a service invented for this test already had an entry"
        );

        store(&service, account, &Secret::new(fixture())).expect("store succeeds");
        assert!(
            has(&service, account).expect("query after store"),
            "stored, but `has` says no"
        );

        assert!(
            forget(&service, account).expect("forget succeeds"),
            "forget found nothing to remove"
        );
        assert!(
            !has(&service, account).expect("query after forget"),
            "the entry survived `forget`"
        );

        // And forgetting again is false rather than an error: the sabotage for
        // this increment turns `forget` into a no-op, and a no-op that still
        // answered `true` would be caught only by the line above.
        assert!(!forget(&service, account).expect("a second forget is not an error"));
    }

    /// What is read back is what was typed. The only test in the tree that
    /// looks at a stored plaintext, and it does so through the one accessor.
    #[test]
    fn what_comes_back_is_what_went_in() {
        require_store();
        let service = test_service("roundtrip-value");
        let account = "n8-value";
        let typed = fixture();

        store(&service, account, &Secret::new(typed.clone())).expect("store succeeds");
        let loaded = load(&service, account).expect("a stored password loads");
        assert_eq!(
            loaded.expose_for_obscuring(),
            typed.as_bytes(),
            "the stored password does not round-trip"
        );

        forget(&service, account).expect("cleanup");
        assert!(
            load(&service, account).is_none(),
            "load still finds a forgotten entry"
        );
    }

    /// The entry really is in Windows Credential Manager, and its target name
    /// is the one N8's `verify:` line filters `cmdkey /list` on.
    ///
    /// Every other test here would pass just as happily against an in-process
    /// map: `store` then `has` is a round-trip through whatever the backend is.
    /// This one asks Windows, through a program this code has nothing to do
    /// with, so it is the check that says *which store* was written to — and it
    /// turns the increment's manual verification into something that runs on
    /// every `cargo test` rather than a claim somebody made once.
    /// Remove anything a previous run left behind.
    ///
    /// Matched on `TEST_PREFIX`, which no shipped service name starts with —
    /// asserted in `test_service` — so this cannot touch a player's entry.
    /// Deliberately not asserted on: there is usually nothing to sweep, and a
    /// sweep that found nothing is the normal case rather than a failure.
    /// Whether a `TEST_PREFIX` target is old enough that no running test
    /// process can still own it.
    ///
    /// Three answers, not two: the `None` arms below mean *I could not tell*
    /// and are treated as "leave it alone", because deleting on a reading
    /// you could not take is how the sweep broke concurrent runs in the
    /// first place.
    #[cfg(windows)]
    fn is_stale(target: &str) -> bool {
        // ...dr-companion-test.<what>.<nanos>-<pid>
        let Some(tail) = target.rsplit('.').next() else {
            return false;
        };
        let Some(nanos) = tail.split('-').next() else {
            return false;
        };
        let Ok(made_at) = nanos.parse::<u128>() else {
            return false;
        };
        let Ok(now) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) else {
            return false;
        };
        now.as_nanos().saturating_sub(made_at) > STALE_AFTER.as_nanos()
    }

    #[cfg(windows)]
    fn sweep_stale_test_entries() {
        let out = match std::process::Command::new("cmdkey").arg("/list").output() {
            Ok(o) => o,
            Err(_) => return,
        };
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let Some((_, rest)) = line.split_once("target=") else {
                continue;
            };
            let target = rest.trim();
            if !target.contains(TEST_PREFIX) {
                continue;
            }
            // Age, not identity. Skipping only *this* run's nonce is what
            // the sweep used to do, and under two concurrent `cargo test`
            // processes that meant each one deleted the other's live
            // fixtures mid-assertion (issue #502). An entry is swept only
            // once it is far too old to belong to any run still going, and
            // one whose age cannot be read is left alone rather than
            // guessed at.
            if !is_stale(target) {
                continue;
            }
            let _ = std::process::Command::new("cmdkey")
                .arg(format!("/delete:{target}"))
                .output();
        }
    }

    #[test]
    #[cfg(windows)]
    fn the_entry_is_in_windows_credential_manager() {
        require_store();
        sweep_stale_test_entries();
        let service = test_service("cmdkey");
        let account = "n8-cmdkey";
        // The target name `windows-native-keyring-store` builds, whose divider
        // is `.` by default. Asserted rather than assumed: if the backend ever
        // changes it, this test says so instead of the doc quietly rotting.
        let target = format!("{account}.{service}");

        let cmdkey_lists = || -> String {
            let out = std::process::Command::new("cmdkey")
                .arg("/list")
                .output()
                .expect("cmdkey is on PATH on every Windows install");
            assert!(
                out.status.success(),
                "cmdkey /list failed: {:?}",
                out.status
            );
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            // Denominator: an empty or unreadable listing would make every
            // `contains` below false, which reads exactly like a store that
            // wrote nothing. `Target:` is cmdkey's own row label.
            assert!(
                text.contains("Target:") || text.contains("Ziel:"),
                "cmdkey printed no credential rows at all ({} bytes); this test cannot \
                 tell absence from a broken instrument",
                text.len()
            );
            text
        };

        assert!(
            !cmdkey_lists().contains(&target),
            "{target} was already in Credential Manager before this test stored anything"
        );

        store(&service, account, &Secret::new(fixture())).expect("store succeeds");
        let listed = cmdkey_lists();
        assert!(
            listed.contains(&target),
            "after storing, Windows does not list {target}; the entry did not reach \
             Credential Manager"
        );

        assert!(forget(&service, account).expect("forget succeeds"));
        assert!(
            !cmdkey_lists().contains(&target),
            "{target} survived `forget` in Credential Manager"
        );
    }

    /// An entry that signs nobody in must not be creatable.
    #[test]
    fn an_empty_password_is_refused() {
        let service = test_service("empty");
        let err = store(&service, "n8-empty", &Secret::new(String::new()))
            .expect_err("an empty password must be refused");
        assert!(err.contains("empty"), "the refusal does not say why: {err}");
        // And nothing was written on the way to refusing it.
        if unavailable_reason().is_none() {
            assert!(!has(&service, "n8-empty").expect("query after a refused store"));
        }
    }

    /// A blank account name is not a wildcard.
    #[test]
    fn a_blank_account_stores_nothing_and_finds_nothing() {
        let service = test_service("blank");
        assert!(store(&service, "   ", &Secret::new(fixture())).is_err());
        assert!(!has(&service, "").expect("blank has"));
        assert!(!forget(&service, "").expect("blank forget"));
        assert!(load(&service, "").is_none());
    }

    /// The real service name is what the commands use, and the override is
    /// read. Without this, every test above could be exercising a seam the
    /// shipped code does not go through.
    #[test]
    fn the_commands_use_the_declared_service() {
        assert_eq!(SERVICE, "dr-companion.play.net");
        match std::env::var("DRC_CREDENTIAL_SERVICE") {
            Err(_) => assert_eq!(service_name(), SERVICE),
            Ok(v) => assert_eq!(service_name(), v),
        }
    }
}
