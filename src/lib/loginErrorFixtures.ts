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
  /** The raw `A`-reply refusal token, on the failures that have one (#507). */
  token?: string
}

export const LOGIN_ERROR_FIXTURES: LoginErrorFixture[] = [
  { code: "bad_credentials", message: "the account name or password was not accepted (PASSWORD)", token: "PASSWORD" },
  { code: "account_locked_or_expired", message: "the account cannot sign in right now (LOCKED)", token: "LOCKED" },
  { code: "account_refused", message: "the login service refused the account for a reason this version does not recognise (NEW)", token: "NEW" },
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

/**
 * One `A`-reply refusal token, and the sentence the player is shown for it.
 *
 * Generated from `login_error.rs`'s `REFUSAL_SENTENCES`, which is where the
 * wording lives and where it is argued for. Issue #507: every token below used
 * to reach one sentence saying Play.net "gave a reason this app does not
 * recognise" and offering one remedy, for causes with different remedies and
 * meanings this app had written down in its own source.
 *
 * `gloss` is Lich's own words for the token (`authenticator.rb:20-22`). It is
 * not shown to anybody; it is here so a reader can check the sentence against
 * the thing it claims to be about.
 */
export interface RefusalSentence {
  token: string
  gloss: string
  sentence: string
}

export const REFUSAL_SENTENCES: RefusalSentence[] = [
  { token: "REJECT", gloss: "bad credentials", sentence: "Play.net refused the account name and password together. Check both. Your saved password has been kept." },
  { token: "NORECORD", gloss: "account not found", sentence: "No account with that name. Check the account name (not the character name)." },
  { token: "INVALID", gloss: "invalid request", sentence: "Play.net called the request invalid. Try again; if it repeats, the login service may have changed." },
  { token: "CHARACTER_NOT_FOUND", gloss: "character not in account", sentence: "Play.net says that character is not on this account. Start the sign-in again to get a fresh character list." },
  { token: "GENERATOR_NOT_AVAILABLE", gloss: "not entitled to the generator", sentence: "Play.net answered as though this app had asked to make a new character. It never does, so this is worth reporting as a bug." },
]
