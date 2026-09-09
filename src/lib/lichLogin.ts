/**
 * Signing in to DragonRealms from this app, and starting Lich with the result.
 *
 * # Why this exists
 *
 * Until now the app could not sign anybody in. It could only *attach* to a Lich
 * that somebody else had already logged in - which in practice meant Genie, and
 * the instructions to arrange that were printed in two components. Dan's
 * instruction on 6 September 2026 was "we aren't using genie anymore… you have
 * to implement correctly using lich", so those instructions are gone and this
 * is what replaced them.
 *
 * The protocol, the launch mechanism and the credential decision are all in
 * `docs/LICH_NATIVE_LOGIN.md`, read out of Lich 5.20.1's own source with
 * `file:line` cites. This module is only the webview half: it calls the two
 * commands that document publishes in §8 and turns their failures into
 * sentences a player can act on.
 *
 * # What is stored
 *
 * The account name, the game code and the last character are ordinary
 * preferences, saved in plain text like every other preference. The password is
 * held in one component's `useState` for the length of a call and cleared
 * afterwards; it is passed as a command argument and never comes back in a
 * result, an error or a log line.
 *
 * **It is stored unless the player unticks the box, which is ticked by
 * default.** This paragraph has said three different things in four days: that
 * remembering was "not built" (it was, the next day, #452), that it happened
 * "if and only if the player ticks the box" (true while the box was opt-in),
 * and now this. Dan reversed the default on 9 September 2026 for a desktop app
 * on his own machine. The storing itself is unchanged: Windows Credential
 * Manager through `credential_store`, never a file this app writes.
 * `src/lib/rememberSignIn.ts` is the whole of that surface and
 * `docs/PRIVACY.md` is what the player is told.
 *
 * # The error contract, and why it is a token
 *
 * Matching English prose to decide which sentence to show would break the
 * first time somebody reworded a message on the Rust side, and would break
 * silently - every error would quietly become the generic one. So the contract
 * is that every failure from `lich_login_characters` and `lich_login_launch`
 * carries a **machine code**: a Tauri command's `Err` is serialised by serde
 * like any other value, and these two send
 * `{ code: "account_locked_or_expired", message: "…" }`.
 * `classifyLoginError` reads `code`, and the message is detail shown under the
 * sentence rather than instead of it.
 *
 * **This section used to describe a contract nothing implemented** - issue
 * #457. `impl Display for EAccessError` wrote prose with no prefix and both
 * commands did `.map_err(|e| e.to_string())`, so every real failure landed on
 * `unknown` and all seven sentences below were unreachable in the shipped app.
 * A locked account read as *"Signing in failed. the account cannot sign in
 * right now (NEW)"*. `src-tauri/src/login_error.rs` is the Rust half, and
 * `LoginCode` there is the one definition of the code set.
 *
 * The check that would have caught it, and now exists: `cargo test` generates
 * `tools/fixtures/login-errors.json` **from the Rust types**, one real
 * serialisation per code, and fails if the checked-in file has drifted;
 * `tools/sign-in-test.mjs` classifies that file rather than a string it built
 * itself. Its end-to-end loop used to manufacture the token it then read back,
 * which is why #457 survived fifty-five green checks. `lichLoginFake.ts` throws
 * the same generated objects, so the browser stand-in cannot produce a shape
 * the backend never sends.
 */
import { invokeTauri, isTauri } from './tauri.ts'
import { fakeListCharacters, fakeLaunch, dryRunRequested } from './lichLoginFake.ts'
import { notifyLichStarted } from './lichStarted.ts'
// Generated from `login_error.rs`'s `REFUSAL_SENTENCES` by `cargo test`, and
// read here rather than retyped: the sentences below are this module's, the
// per-token ones are Rust's, and one hand-kept copy of a table is one table
// that drifts (#507).
import { REFUSAL_SENTENCES } from './loginErrorFixtures.ts'

/**
 * The games this picker offers, and the codes Lich's own table gives them
 * (`lib/common/authentication/login_helpers.rb:88-97`). Prime is `DR`; the
 * other three exist and a player on one of them would otherwise have no route
 * in at all.
 */
export const GAME_CODES = [
  { code: 'DR', label: 'DragonRealms' },
  { code: 'DRX', label: 'DragonRealms Platinum' },
  { code: 'DRF', label: 'DragonRealms Fallen' },
  { code: 'DRT', label: 'DragonRealms Test' },
] as const

export const DEFAULT_GAME_CODE = 'DR'

export interface CharacterEntry {
  /** The code the `L` frame needs. Not the name - see LICH_NATIVE_LOGIN §2.4. */
  code: string
  name: string
}

export interface AccountCharacters {
  subscription: string
  characters: CharacterEntry[]
}

export interface LaunchResult {
  pid: number
  /** The detachable-client port Lich was started with. The caller attaches to
   * this rather than retyping 11024, which is the point of returning it. */
  port: number
}

/**
 * Every way signing in can fail, as a closed set.
 *
 * Closed on purpose: a player facing a failure needs to be told what to do
 * next, and "Error: 3" or a Ruby exception class is not that. Anything the
 * Rust side sends that does not carry one of these tokens falls to `unknown`,
 * which prints the raw text rather than pretending to understand it.
 */
export const LOGIN_ERROR_KINDS = [
  'bad_password',
  'account_locked',
  // #488: the login service said no with a token this version cannot read.
  // Not folded into `bad_password` — that sentence tells a player to re-check
  // a password, and the whole point of this state is that nobody knows whether
  // the password is the problem. It is also the state in which the saved
  // password is deliberately NOT thrown away.
  'account_refused',
  'character_not_found',
  'service_unreachable',
  'login_service_changed',
  'password_unsendable',
  'lich_did_not_start',
  // #488: the sign-in worked and this app started no Lich, because one was
  // already up. Deliberately not `lich_did_not_start`: that sentence sends a
  // player to a diagnostic, and there is nothing wrong here. It is the
  // ordinary state after the app was closed with "Leave it running", and the
  // thing to do about it is attach.
  'lich_already_running',
  // The two states N9 (#459) made reachable by wiring the stored password up.
  // Neither is a rename of `bad_password`: one is "you did not type one and
  // there is none saved", the other is "the saved one has just been thrown
  // away because the account server refused it". Telling a player to re-check
  // a password they did not type is how a credential feature becomes a loop.
  'password_needed',
  'stored_password_rejected',
] as const

/**
 * Every `code` the Rust side can send, as a closed set.
 *
 * The second half of the contract, and it is written down here so the two
 * sides can be *compared* rather than assumed equal: `tools/sign-in-test.mjs`
 * derives the same set from `tools/fixtures/login-errors.json` - which
 * `cargo test` generates from `LoginCode::ALL` - and fails naming any code
 * that is in one list and not the other.
 *
 * `internal` is deliberately not in {@link CODE_KINDS} below: there is no
 * advice to give about a worker thread that did not finish, so it classifies
 * to `unknown` and the raw message is printed, which is the honest answer.
 */
export const RUST_ERROR_CODES = [
  'bad_credentials',
  'account_locked_or_expired',
  'account_refused',
  'no_such_character',
  'protocol_mismatch',
  'password_length',
  'obscured_byte_out_of_range',
  'network',
  'certificate_changed',
  'lich_did_not_start',
  'lich_already_running',
  'password_needed',
  'stored_password_rejected',
  'internal',
] as const

/**
 * Every variant of `EAccessError` in `src-tauri/src/eaccess.rs`, mapped to the
 * sentence a player gets. **Not** a rename of the Rust names: the protocol has
 * seven ways to fail and a person has fewer things they can do about it, so two
 * pairs of variants deliberately land on one sentence each.
 *
 * The mapping is written down rather than inferred from the names, because the
 * two vocabularies genuinely differ - `AccountLockedOrExpired` is not called
 * `account_locked`, and pretending a name match would work is how a variant
 * added later becomes a silent `unknown`. `tools/sign-in-test.mjs` parses the
 * Rust enum and fails, naming the variant, if this table does not cover it.
 *
 * `lich_did_not_start` has no entry here on purpose: it is the launch half,
 * which is `sal.rs`/`lich.rs`, not the protocol.
 */
export const EACCESS_VARIANT_KINDS: Record<string, LoginErrorKind> = {
  // The two refusals `classify_account_refusal` splits an unknown server
  // vocabulary into. One a retry can fix, one it cannot.
  bad_credentials: 'bad_password',
  account_locked_or_expired: 'account_locked',
  // The third refusal (#488). `classify_account_refusal`'s old two-way split
  // made this one `bad_credentials`, which on the Rust side meant deleting the
  // saved password for a token nobody had ever seen.
  account_refused: 'account_refused',
  no_such_character: 'character_not_found',
  // A reply that did not have the shape the step requires. The player has done
  // nothing wrong and retrying will not help, so it must not read as either a
  // bad password or an outage.
  protocol_mismatch: 'login_service_changed',
  // The socket, the TLS handshake, or an endpoint override pointed somewhere
  // there is nothing.
  network: 'service_unreachable',
  // The service answered and its certificate is not the one this app pins.
  // `login_service_changed`, not `service_unreachable`: nothing is down, and
  // retrying will meet the same certificate. What has to change is the app.
  certificate_changed: 'login_service_changed',
  // Both of these are "this exact password cannot go down this wire", for
  // arithmetic reasons in the obscuring loop that a player cannot see and can
  // only route around by changing the password.
  password_length: 'password_unsendable',
  obscured_byte_out_of_range: 'password_unsendable',
}

/**
 * Every Rust code that has a player sentence, which is all of them but
 * `internal`.
 *
 * Built from {@link EACCESS_VARIANT_KINDS} rather than restating it: the seven
 * protocol codes have one table, and this adds the three that happen outside
 * the protocol. Those three are named the same on both sides because there is
 * nothing to translate - one Rust failure, one thing the player does.
 */
export const CODE_KINDS: Record<string, LoginErrorKind> = {
  ...EACCESS_VARIANT_KINDS,
  lich_did_not_start: 'lich_did_not_start',
  lich_already_running: 'lich_already_running',
  password_needed: 'password_needed',
  stored_password_rejected: 'stored_password_rejected',
}

export type LoginErrorKind = (typeof LOGIN_ERROR_KINDS)[number] | 'unknown'

/**
 * One sentence per kind, in the second person, saying what happened and what
 * the player can do. No error codes, no protocol vocabulary: none of `EAccess`,
 * `L\tOK`, `sal` or `argv` means anything to somebody who wants to play.
 */
export const LOGIN_ERROR_SENTENCES: Record<LoginErrorKind, string> = {
  bad_password: 'That account name or password was not accepted. Check both and try again.',
  account_locked:
    'Play.net has locked this account. Sign in on the Play.net website to unlock it, then come back.',
  // The fallback, and from #507 it is only the fallback. A token this app has
  // a meaning for gets that meaning, from the generated `REFUSAL_SENTENCES`
  // table; this wording is for the case it is actually true of, which is a
  // token that fell off the end of Lich's own list. `refusalSentence` appends
  // the raw token to it, so a bug report carries the word the server sent.
  account_refused:
    'Play.net refused this sign-in and gave a reason this app does not recognise. Your saved password has been kept. Check the account on the Play.net website, then try again.',
  character_not_found:
    'That character is not on this account any more. Sign in again to get a fresh list.',
  service_unreachable:
    'The Play.net login service did not answer. Check your connection and try again in a moment.',
  login_service_changed:
    'The login service answered in a way this version of the app does not understand. Retrying will not help; this is worth reporting as a bug.',
  password_unsendable:
    'This password cannot be sent to the login service. Changing it on the Play.net website is the only way round it.',
  lich_did_not_start:
    'The sign-in worked but Lich did not start. Use "Why won\'t it start?" below to find out why.',
  lich_already_running:
    // #504: this used to end "Attach to the one that is up", which promises
    // something the app may then withdraw - a Lich with no detachable port
    // cannot be attached to, and the offer below says so. A sentence that
    // contradicts the control under it is worse than a vaguer one.
    'Lich is already running, so this app did not start a second one. Below is which Lich that is, and whether this app can attach to it.',
  password_needed:
    'No password was sent and none is saved for this account. Type your password and try again.',
  stored_password_rejected:
    'The saved password no longer works, so it has been forgotten. Type your password again.',
  unknown: 'Signing in failed.',
}

/**
 * The sentence for one `A`-reply refusal token (#507).
 *
 * Four of Lich's tokens mean four different things - `authenticator.rb:20-22`
 * glosses them, `eaccess.rs` writes the glosses down, and `from_refusal_code`
 * matched on them to reach `account_refused` in the first place. Telling all
 * four players "a reason this app does not recognise" was false, and sending
 * all four to the Play.net account page was one remedy for four causes: it is
 * the wrong lever for `INVALID`, which is about the request rather than the
 * account, and for `NORECORD`, which means the **account name** on the screen
 * in front of them is wrong.
 *
 * The table is generated from Rust, so this function only chooses; it does not
 * hold any wording of its own. A token with no row keeps the generic sentence,
 * plus the token itself, because a player reporting a bug should not have to
 * transcribe the detail line for the one word that matters.
 */
function refusalSentence(token: string): string {
  const row = REFUSAL_SENTENCES.find((r) => r.token === token.trim().toUpperCase())
  if (row) return row.sentence
  const generic = LOGIN_ERROR_SENTENCES.account_refused
  return token.trim() ? `${generic} Play.net said: ${token.trim()}.` : generic
}

/**
 * The kind and the sentence for a raw failure from either command.
 *
 * Kept separate from the invoking code so it can be run over every kind in a
 * test without a browser, a backend or an account.
 */
export function classifyLoginError(raw: unknown): {
  kind: LoginErrorKind
  sentence: string
  /** Whatever the backend said, for the line under the sentence. */
  detail: string
} {
  // The shape a Tauri command's `Err` arrives in: the serialised value itself,
  // not an `Error`. Read structurally rather than by parsing text, because a
  // message that happens to begin `something:` is not a code and a code is not
  // a prefix of prose.
  const structured =
    typeof raw === 'object' && raw !== null && typeof (raw as { code?: unknown }).code === 'string'
      ? (raw as { code: string; message?: unknown; token?: unknown })
      : null

  const text = structured
    ? String(structured.message ?? '')
    : raw instanceof Error
      ? raw.message
      : String(raw ?? '')

  // A string failure still classifies, and that is not a second contract: it is
  // for the callers that are not these two commands - `game_attach`, whose
  // errors are strings for the Attach button's sake, and anything a browser
  // stand-in throws. Those carry a `code:` prefix or nothing at all.
  const prefix = /^([a-z_]+)\s*:/.exec(text.trim())?.[1] ?? ''
  const code = structured ? structured.code : prefix

  // Either vocabulary is accepted: the webview's own kind, or the Rust code.
  // A code that is in neither stays `unknown` rather than being guessed at.
  const kind: LoginErrorKind = (LOGIN_ERROR_KINDS as readonly string[]).includes(code)
    ? (code as LoginErrorKind)
    : (CODE_KINDS[code] ?? 'unknown')

  // The prefix is dropped from the detail only when it was actually read as a
  // code. A string whose leading word means nothing to us keeps it, because
  // the whole text is then the only information there is.
  const detail =
    !structured && kind !== 'unknown'
      ? text.trim().slice(text.trim().indexOf(':') + 1).trim()
      : text.trim()

  if (kind === 'unknown') {
    // The raw text is more use than a shrug, so it is appended rather than
    // swallowed - but only once, and only when there is something to append.
    return {
      kind,
      sentence: detail
        ? `${LOGIN_ERROR_SENTENCES.unknown} ${detail}`
        : LOGIN_ERROR_SENTENCES.unknown,
      detail,
    }
  }
  // #507. The one kind whose sentence depends on more than the kind: the
  // refusal token is a *field* on the failure, never read back out of the
  // message, because parsing prose for a code is the defect #457 was.
  // A string-form failure carries no token and keeps the generic sentence,
  // which is honest - nothing knows what the server said.
  if (kind === 'account_refused') {
    const token = typeof structured?.token === 'string' ? structured.token : ''
    return { kind, sentence: refusalSentence(token), detail }
  }
  return { kind, sentence: LOGIN_ERROR_SENTENCES[kind], detail }
}

/**
 * Whether this webview is talking to the TS-side stand-in rather than Rust.
 *
 * True only outside the desktop app and only when asked for with
 * `?lichDryRun=1`. Inside the app the real commands are always called, and
 * `DRC_LICH_DRY_RUN=1` on the Rust side is what makes those safe to run
 * without spawning Lich. See `lichLoginFake.ts` for when this goes.
 */
export function usingFakeBackend(): boolean {
  return !isTauri() && dryRunRequested()
}

/**
 * `password` is optional from N9 (issue #459).
 *
 * An empty string is sent as `null`, which is what asks Rust to use the
 * password saved in Windows Credential Manager for this account - the read
 * half N8 shipped and nothing called. An empty string sent as an empty string
 * would instead be a sign-in attempt with no password, which the account
 * server refuses as bad credentials and which reads to a player as though
 * their password were wrong.
 */
export async function listCharacters(args: {
  account: string
  password: string
  gameCode: string
}): Promise<AccountCharacters> {
  if (usingFakeBackend()) return await fakeListCharacters(args)
  return (await invokeTauri('lich_login_characters', {
    account: args.account,
    password: args.password || null,
    gameCode: args.gameCode,
  })) as AccountCharacters
}

export async function launchCharacter(args: {
  account: string
  password: string
  gameCode: string
  character: string
}): Promise<LaunchResult> {
  const result = usingFakeBackend()
    ? await fakeLaunch(args)
    : ((await invokeTauri('lich_login_launch', {
        account: args.account,
        password: args.password || null,
        gameCode: args.gameCode,
        character: args.character,
      })) as LaunchResult)
  /*
   * A Lich exists now, so the bridge has something to dial - issue #532.
   *
   * Here rather than in the sign-in screen because this is the one function
   * every route to a launched Lich passes through, including the fake backend
   * the tests drive, so the announcement cannot be forgotten by a screen that
   * is rewritten or by a second route added later. See `lichStarted.ts`.
   *
   * After the await and only on success: a launch that threw started nothing,
   * and telling the bridge to expect a Lich that does not exist would put back
   * the exact ladder-at-an-empty-port this issue is about.
   */
  notifyLichStarted({ port: result.port ?? null, via: 'sign-in' })
  return result
}

/**
 * Where the remembering went.
 *
 * `rememberSignIn` and `rememberedSignIn` used to live here, beside the two
 * commands, and `rememberPassword.ts` owned the password half separately. That
 * was two owners for one question - *what do we remember about a sign-in* - and
 * on 9 September 2026 the answer grew to cover everything a sign-in produces,
 * so the two were merged rather than kept in step.
 *
 * `src/lib/rememberSignIn.ts` is the single owner now: the default, the
 * preference, the credential surface and the one resolver every sign-in screen
 * asks. This module is the protocol half again, which is all it was ever meant
 * to be. Nothing is re-exported from here, deliberately - a re-export is a
 * second name for one thing, and the next person to add a sign-in would find
 * two places that look like the place.
 */
