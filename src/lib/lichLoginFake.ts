/**
 * A stand-in for `lich_login_characters` and `lich_login_launch`, for the dev
 * server only, until N1 and N3 land the real ones.
 *
 * # This file is scheduled for deletion
 *
 * Increment N5 of `docs/PLAN_TO_1_0.md` was written to be buildable against the
 * published interface in `docs/LICH_NATIVE_LOGIN.md` §8 without waiting for
 * N1's `eaccess.rs` or N3's `sal.rs`. Those had not merged when N5 was built
 * (`git ls-tree origin/main` had no `src-tauri/src/eaccess.rs`), so this is what
 * the browser harness and the screenshots below were driven against.
 *
 * **When N1 and N3 are on `main`, delete this file and the two `usingFakeBackend()`
 * branches in `lichLogin.ts` that reach it.** Nothing else imports it. That is
 * three lines and one deletion, deliberately, so it cannot quietly become a
 * second login path living beside the real one.
 *
 * It is reachable only outside the desktop app (`isTauri()` false) and only when
 * asked for by URL - `?lichDryRun=1`, the same shape as the existing `?bridge=`
 * flag. Inside the app there is no route to it at all, so it cannot be what a
 * player gets by accident.
 *
 * # The fixtures
 *
 * The account names are obviously fake and the passwords are not real
 * credentials. Each one exists to make one branch of the sign-in screen
 * reachable on purpose, which is the whole reason for the file: an unhappy path
 * nobody can trigger is an unhappy path nobody can prove they fixed.
 */

import { LOGIN_ERROR_FIXTURES } from './loginErrorFixtures.ts'

export interface FakeArgs {
  account: string
  password: string
  gameCode: string
  character?: string
}

/** `?lichDryRun=1` in the URL. Nothing else turns this on. */
export function dryRunRequested(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('lichDryRun') === '1'
  } catch {
    return false
  }
}

/**
 * The failure objects, exactly as Rust sends them.
 *
 * **Not written here.** `LOGIN_ERROR_FIXTURES` is generated from the Rust
 * types by `cargo test`, so a stand-in cannot produce a shape the backend
 * never sends - which it did until #457: this file threw
 * `'account_locked: this account is locked'`, a token-prefixed string only the
 * fake could produce, while the real backend sent unprefixed prose. A mock
 * that cannot produce the real state is not a check, and the screenshots taken
 * against it were of a screen no player could reach.
 */
function failureFor(code: string): { code: string; message: string } {
  const found = LOGIN_ERROR_FIXTURES.find((f) => f.code === code)
  // Loud rather than a quiet fallback: a code that has vanished from the
  // generated set means this file is naming something Rust no longer sends,
  // and a stand-in that silently invented a message would hide exactly that.
  if (!found) throw new Error(`no generated fixture for ${code}; regenerate loginErrorFixtures.ts`)
  return { code: found.code, message: found.message }
}

/**
 * The fixture accounts, keyed by the account name typed into the form.
 *
 * `demo` is the ordinary case. The rest each reach one arm of
 * `LOGIN_ERROR_KINDS` or the empty-list state, so the sabotage in
 * `tools/sign-in-test.mjs` and the screenshots in `tools/sign-in-shots.mjs`
 * have something to press. The values are **Rust codes**, not webview kinds:
 * these are the vocabulary the backend speaks.
 */
const FIXTURES: Record<string, { fail?: string; characters?: string[] }> = {
  demo: { characters: ['Phemius', 'Testwright', 'Nobody'] },
  nochars: { characters: [] },
  locked: { fail: 'account_locked_or_expired' },
  offline: { fail: 'network' },
  ghost: { fail: 'no_such_character' },
  nolich: { fail: 'lich_did_not_start' },
  garbled: { fail: 'protocol_mismatch' },
  longpw: { fail: 'password_length' },
  // The two states N9 wired up (#459). `saved` signs in with no typed
  // password at all, which is what the form does when a password is stored;
  // `stale` is the saved password the account server has stopped accepting.
  saved: { characters: ['Phemius', 'Testwright', 'Nobody'] },
  stale: { fail: 'stored_password_rejected' },
}

const DELAY_MS = 120

/** The accounts the stand-in treats as having a password in the store. */
const STORED_PASSWORD_ACCOUNTS = ['saved', 'stale']

/** Whether the stand-in has a saved password for this account. */
export function fakeCredentialHas(account: string): boolean {
  return STORED_PASSWORD_ACCOUNTS.includes(account.trim().toLowerCase())
}

function fixtureFor(account: string) {
  return FIXTURES[account.trim().toLowerCase()]
}

export async function fakeListCharacters(args: FakeArgs) {
  await new Promise((r) => setTimeout(r, DELAY_MS))
  const fixture = fixtureFor(args.account)
  if (!fixture) throw failureFor('bad_credentials')
  // The launch-only failure is not a sign-in failure, so it has to get past
  // this call to be reachable at all.
  if (fixture.fail && fixture.fail !== 'lich_did_not_start') throw failureFor(fixture.fail)
  // An account with a saved password is signed in to with none typed, which is
  // the whole point of N9; every other account still needs one.
  if (!args.password && !fakeCredentialHas(args.account)) throw failureFor('password_needed')
  return {
    subscription: 'NORMAL',
    characters: (fixture.characters ?? []).map((name, i) => ({
      code: `W_DR_${i + 1}`,
      name,
    })),
  }
}

export async function fakeLaunch(args: FakeArgs) {
  await new Promise((r) => setTimeout(r, DELAY_MS))
  const fixture = fixtureFor(args.account)
  if (fixture?.fail) throw failureFor(fixture.fail)
  return { pid: 4242, port: 11024 }
}
