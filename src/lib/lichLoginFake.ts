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
 * The fixture accounts, keyed by the account name typed into the form.
 *
 * `demo` is the ordinary case. The rest each reach one arm of
 * `LOGIN_ERROR_KINDS` or the empty-list state, so the sabotage in
 * `tools/sign-in-test.mjs` and the screenshots in `tools/sign-in-shots.mjs`
 * have something to press.
 */
const FIXTURES: Record<string, { fail?: string; characters?: string[] }> = {
  demo: { characters: ['Phemius', 'Testwright', 'Nobody'] },
  nochars: { characters: [] },
  locked: { fail: 'account_locked: this account is locked' },
  offline: { fail: 'service_unreachable: eaccess.play.net:7910 did not answer' },
  ghost: { fail: 'character_not_found: no such character on this account' },
  nolich: { fail: 'lich_did_not_start: no launcher found' },
}

const DELAY_MS = 120

function fixtureFor(account: string) {
  return FIXTURES[account.trim().toLowerCase()]
}

export async function fakeListCharacters(args: FakeArgs) {
  await new Promise((r) => setTimeout(r, DELAY_MS))
  const fixture = fixtureFor(args.account)
  if (!fixture) throw new Error('bad_password: no such account in the dry-run fixtures')
  // The launch-only failure is not a sign-in failure, so it has to get past
  // this call to be reachable at all.
  if (fixture.fail && !fixture.fail.startsWith('lich_did_not_start')) throw new Error(fixture.fail)
  if (!args.password) throw new Error('bad_password: no password given')
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
  if (fixture?.fail) throw new Error(fixture.fail)
  return { pid: 4242, port: 11024 }
}
