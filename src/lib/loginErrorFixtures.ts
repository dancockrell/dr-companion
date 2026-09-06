/**
 * Every failure the Rust side can send, as it really serialises it.
 *
 * **Generated. Do not edit.** `src-tauri/src/login_error.rs`'s
 * `the_fixture_is_the_real_serialisation` writes this from the Rust types and
 * fails on every `cargo test` if the checked-in copy has drifted. Regenerate
 * with `DRC_WRITE_LOGIN_FIXTURE=1 cargo test login_error` in `src-tauri`.
 *
 * It exists because issue #457 was a contract nobody checked: the webview's
 * classifier was fed strings the test itself had built, so it passed while the
 * backend sent something else entirely. Anything that wants to know what a
 * failure looks like reads this, and this is written by the code that sends
 * them.
 */
export interface LoginErrorFixture {
  code: string
  message: string
}

export const LOGIN_ERROR_FIXTURES: LoginErrorFixture[] = [
  { code: "bad_credentials", message: "the account name or password was not accepted (PASSWORD)" },
  { code: "account_locked_or_expired", message: "the account cannot sign in right now (LOCKED)" },
  { code: "account_refused", message: "the login service refused the account for a reason this version does not recognise (NEW)" },
  { code: "no_such_character", message: "no character named Nobody on this account (3 found)" },
  { code: "protocol_mismatch", message: "the login server's reply to A was not what this version expects: something this version does not know" },
  { code: "password_length", message: "the password is 40 characters and the login server's key is 32; this password cannot be sent" },
  { code: "obscured_byte_out_of_range", message: "the login server's key does not encode this password at position 7" },
  { code: "network", message: "could not reach eaccess.play.net:7910: could not connect: connection refused" },
  { code: "lich_did_not_start", message: "Lich started and then exited with code 1 without opening its detachable port." },
  { code: "lich_already_running", message: "a Lich is already running, so this app did not start a second one" },
  { code: "password_needed", message: "no password was sent and none is saved for demo" },
  { code: "stored_password_rejected", message: "the saved password was refused and has been removed (the account name or password was not accepted (PASSWORD))" },
  { code: "internal", message: "the sign-in task did not finish: task panicked" },
]
