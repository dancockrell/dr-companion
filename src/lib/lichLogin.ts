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
 * preferences, saved in plain text like every other preference. **The password
 * is not stored at all.** It is held in one component's `useState` for the
 * length of a call and cleared afterwards; it is passed as a command argument
 * and never comes back in a result, an error or a log line. Remembering it is
 * increment N8, which is opt-in, human-gated on a new Rust dependency, and not
 * built - so there is no "remember my password" control in the UI, because a
 * disabled one would read as a finished feature that merely does nothing.
 *
 * # The error contract, and why it is a token
 *
 * A Tauri command's failure reaches the webview as a string. Matching English
 * prose to decide which sentence to show would break the first time somebody
 * reworded a message on the Rust side, and would break silently - every error
 * would quietly become the generic one. So the contract is that every failure
 * from `lich_login_characters` and `lich_login_launch` starts with a stable
 * token from `LOGIN_ERROR_KINDS`, a colon, and then whatever detail is safe to
 * print. `classifyLoginError` reads the token.
 *
 * `tools/sign-in-test.mjs` checks that every kind has a sentence, N of N, and
 * cross-checks the set against the Rust enum's source once N1 lands
 * `src-tauri/src/eaccess.rs` - printing NOT CHECKED, not a pass, until then.
 */
import { invokeTauri, isTauri } from './tauri.ts'
import { loadPrefs, savePrefs } from './persistence.ts'
import { fakeListCharacters, fakeLaunch, dryRunRequested } from './lichLoginFake.ts'

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
  'character_not_found',
  'service_unreachable',
  'lich_did_not_start',
] as const

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
  character_not_found:
    'That character is not on this account any more. Sign in again to get a fresh list.',
  service_unreachable:
    'The Play.net login service did not answer. Check your connection and try again in a moment.',
  lich_did_not_start:
    'The sign-in worked but Lich did not start. Use "Why won\'t it start?" below to find out why.',
  unknown: 'Signing in failed.',
}

/**
 * The kind and the sentence for a raw failure from either command.
 *
 * Kept separate from the invoking code so it can be run over every kind in a
 * test without a browser, a backend or an account.
 */
export function classifyLoginError(raw: unknown): { kind: LoginErrorKind; sentence: string } {
  const text = raw instanceof Error ? raw.message : String(raw ?? '')
  const token = /^([a-z_]+)\s*:/.exec(text.trim())?.[1]
  const kind = (LOGIN_ERROR_KINDS as readonly string[]).includes(token ?? '')
    ? (token as LoginErrorKind)
    : 'unknown'
  if (kind === 'unknown') {
    // The raw text is more use than a shrug, so it is appended rather than
    // swallowed - but only once, and only when there is something to append.
    const detail = text.trim()
    return {
      kind,
      sentence: detail ? `${LOGIN_ERROR_SENTENCES.unknown} ${detail}` : LOGIN_ERROR_SENTENCES.unknown,
    }
  }
  return { kind, sentence: LOGIN_ERROR_SENTENCES[kind] }
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

export async function listCharacters(args: {
  account: string
  password: string
  gameCode: string
}): Promise<AccountCharacters> {
  if (usingFakeBackend()) return await fakeListCharacters(args)
  return (await invokeTauri('lich_login_characters', {
    account: args.account,
    password: args.password,
    gameCode: args.gameCode,
  })) as AccountCharacters
}

export async function launchCharacter(args: {
  account: string
  password: string
  gameCode: string
  character: string
}): Promise<LaunchResult> {
  if (usingFakeBackend()) return await fakeLaunch(args)
  return (await invokeTauri('lich_login_launch', {
    account: args.account,
    password: args.password,
    gameCode: args.gameCode,
    character: args.character,
  })) as LaunchResult
}

/**
 * Remember what is safe to remember, and nothing else.
 *
 * There is deliberately no `password` parameter here. A function that *could*
 * take one is a function somebody adds a caller to; the shape of this is the
 * guarantee, and `tools/sign-in-test.mjs` drives a whole sign-in and then reads
 * the stored preferences back to prove it.
 */
export function rememberSignIn(fields: {
  account?: string
  gameCode?: string
  character?: string
}): void {
  const next: Parameters<typeof savePrefs>[0] = {}
  if (fields.account !== undefined) next.lichAccount = fields.account
  if (fields.gameCode !== undefined) next.lichGameCode = fields.gameCode
  if (fields.character !== undefined) next.lichCharacter = fields.character
  savePrefs(next)
}

export function rememberedSignIn(): { account: string; gameCode: string; character: string } {
  const prefs = loadPrefs()
  return {
    account: prefs.lichAccount ?? '',
    gameCode: prefs.lichGameCode ?? DEFAULT_GAME_CODE,
    character: prefs.lichCharacter ?? '',
  }
}
