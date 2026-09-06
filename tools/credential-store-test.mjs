/**
 * N8's frontend half: the box that offers to remember a Play.net password is
 * off by default, nothing is stored unless it is ticked, and no password ever
 * reaches anything that persists.
 *
 *     node --experimental-strip-types tools/credential-store-test.mjs
 *
 * # Why this is a separate suite from doc-claims
 *
 * `doc-claims-test.mjs` section K checks the *claims* - that no document says
 * the app never sees a password, and that nothing in `PersistedPrefs` is one.
 * This checks the *behaviour*: given a fake backend, which calls happen. The
 * two are different questions and share no code, so a mistake in one is not
 * hidden by the other.
 *
 * # The two directions
 *
 * Counting what is present cannot detect what is absent (CLAUDE.md §1), and
 * the interesting fact here is an absence: with the box unticked, `store` is
 * *not* called. So the fake backend records every call, and the unticked case
 * asserts an empty log - against a positive control in the same run where the
 * ticked case fills it. Without that control, a backend nobody wired up at all
 * would pass the check that matters most.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  REMEMBER_PASSWORD_DEFAULT,
  REMEMBER_PASSWORD_LABEL,
  REMEMBER_PASSWORD_NOTICE,
  forgetStoredPassword,
  hasStoredPassword,
  rememberIfAsked,
} from '../src/lib/rememberPassword.ts'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** A backend that stores nothing and remembers what it was asked to do. */
function fakeBackend() {
  const calls = []
  const entries = new Map()
  return {
    calls,
    entries,
    async store(account, password) {
      calls.push(['store', account])
      entries.set(account, password)
    },
    async has(account) {
      calls.push(['has', account])
      return entries.has(account)
    },
    async forget(account) {
      calls.push(['forget', account])
      return entries.delete(account)
    },
  }
}

/* ------------------------------------------------------- the default is off */

ok('the remember-password default is off', REMEMBER_PASSWORD_DEFAULT === false, `default ${REMEMBER_PASSWORD_DEFAULT}`)

// Source, as well as value. The constant could be false while the component
// started its state at a literal `true`, and the value check above would be
// perfectly green. So the component is required to seed from the constant and
// forbidden from seeding a checkbox from a literal.
{
  const src = read('src/components/shared/RememberPassword.tsx')
  ok(
    'the checkbox is controlled rather than defaulting to its own literal',
    !/useState\(\s*true\s*\)/.test(src) && !/defaultChecked/.test(src),
    'no useState(true), no defaultChecked',
  )
  ok(
    'the component states the default by name so one edit moves it',
    src.includes('REMEMBER_PASSWORD_DEFAULT'),
  )
  ok('the label and the warning are rendered from the shared constants',
    src.includes('REMEMBER_PASSWORD_LABEL') && src.includes('REMEMBER_PASSWORD_NOTICE'))
  // The control that undoes it must exist in the same file and be mounted.
  ok('the Forget control is exported', /export function ForgetStoredPassword/.test(src))
  const settings = read('src/components/layout/SettingsSheet.tsx')
  ok(
    'the Forget control is mounted in Settings',
    settings.includes('<ForgetStoredPassword') && settings.includes("from '../shared/RememberPassword.tsx'"),
  )
}

/* ------------------------------------- nothing is stored unless it is asked */

{
  const backend = fakeBackend()
  const outcome = await rememberIfAsked(backend, 'Somebody', 'a-password', false)
  ok('with the box unticked, the outcome says so', outcome === 'not asked', outcome)
  ok(
    'with the box unticked, the backend is never called at all',
    backend.calls.length === 0,
    backend.calls.map((c) => c.join(' ')).join(', ') || '0 calls',
  )
  ok('with the box unticked, nothing is in the store', backend.entries.size === 0)
}

// The positive control for the check above: the same fake, the same call, the
// box ticked. If this does not fill the log then the empty log above was a
// dead harness rather than a working guarantee.
{
  const backend = fakeBackend()
  const outcome = await rememberIfAsked(backend, 'Somebody', 'a-password', true)
  ok('with the box ticked, the password is stored', outcome === 'stored', outcome)
  ok(
    'with the box ticked, exactly one store call happens',
    backend.calls.length === 1 && backend.calls[0][0] === 'store' && backend.calls[0][1] === 'Somebody',
    backend.calls.map((c) => c.join(' ')).join(', '),
  )
  ok('the stored value is the password that was passed', backend.entries.get('Somebody') === 'a-password')
}

// Ticked, but there is nothing to store. An entry that signs nobody in must
// not be created; the Rust side refuses one too, and this is the half that
// stops the round trip being made at all.
for (const [what, account, password] of [
  ['a blank account', '   ', 'a-password'],
  ['an empty password', 'Somebody', ''],
]) {
  const backend = fakeBackend()
  const outcome = await rememberIfAsked(backend, account, password, true)
  ok(`ticked with ${what} stores nothing`, outcome === 'nothing to store' && backend.calls.length === 0, outcome)
}

/* --------------------------------------------------------------- forgetting */

{
  const backend = fakeBackend()
  await rememberIfAsked(backend, 'Somebody', 'a-password', true)
  ok('the store reports the entry', (await hasStoredPassword(backend, 'Somebody')) === true)
  ok('forget removes it', (await forgetStoredPassword(backend, 'Somebody')) === true)
  ok('and then it is gone', (await hasStoredPassword(backend, 'Somebody')) === false)
  // False, not an error: pressing Forget twice is a thing people do.
  ok('forgetting again is false rather than a throw', (await forgetStoredPassword(backend, 'Somebody')) === false)
  ok('forgetting a blank account touches nothing', (await forgetStoredPassword(backend, '  ')) === false)
}

/* ------------------------------------------- no password reaches persistence */

// The direction that finds things. `rememberPassword.ts` is the one module
// allowed to handle a password in the frontend, and it must not be able to put
// one anywhere else: not localStorage, not a preference, not a log line.
{
  const src = read('src/lib/rememberPassword.ts')
  const forbidden = ['localStorage', 'sessionStorage', 'writeJSON', 'loadPrefs', 'savePrefs', 'console.log']
  const found = forbidden.filter((f) => src.includes(f))
  ok('the password module writes to no store of its own', found.length === 0, found.join(', ') || `${forbidden.length} checked`)
  // Positive control: the matcher can fire.
  ok(
    'that matcher is not simply matching nothing',
    forbidden.some((f) => `const x = ${f}`.includes(f)),
  )
  // The command surface, named, so a fourth command cannot appear here quietly.
  const invoked = [...src.matchAll(/invokeTauri\('([a-z_]+)'/g)].map((m) => m[1]).sort()
  ok(
    'exactly the three credential commands are invoked',
    invoked.join(',') === 'credential_forget,credential_has,credential_store',
    invoked.join(', ') || 'none',
  )
  const lib = read('src-tauri/src/lib.rs')
  ok(
    'and all three are registered in Rust',
    invoked.every((c) => lib.includes(`credential_store::${c}`)),
  )
}

/* ------------------------------------- the warning says what is actually true */

{
  ok('the label is the increment’s wording', REMEMBER_PASSWORD_LABEL === 'Remember password on this computer', REMEMBER_PASSWORD_LABEL)
  ok(
    'the notice names the store and who else can read it',
    REMEMBER_PASSWORD_NOTICE ===
      'Stored in Windows Credential Manager. Anyone signed in to this Windows account can use it.',
    REMEMBER_PASSWORD_NOTICE,
  )
  // One sentence, two places. docs/PRIVACY.md is generated, so a drift here is
  // a generator edit rather than a prose edit - which is the point.
  ok(
    'docs/PRIVACY.md carries the same sentence word for word',
    read('docs/PRIVACY.md').replace(/\n/g, ' ').replace(/\s+/g, ' ').includes(REMEMBER_PASSWORD_NOTICE),
  )
}

/* ---------------------------------- the stored password is actually read --- */

// Issue #459: N8 shipped a checkbox that wrote a password into Windows
// Credential Manager and **nothing ever read it back**. The player typed it
// again on every sign-in, so the stored secret bought nothing and cost a
// persisted credential - and every check in this file passed throughout,
// because they all check the write half.
//
// The check that would have noticed is the one this repo uses elsewhere: grep
// the *consuming* side.
{
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p, out)
      else if (p.endsWith('.rs')) out.push(p)
    }
    return out
  }
  const rs = walk(join('src-tauri', 'src'))
  // The denominator: a walker that reached nothing would report "no caller"
  // for a function with a hundred of them.
  ok('the Rust source walk reached the crate', rs.length >= 15, `${rs.length} files`)

  const find = (needle) => {
    const hits = []
    for (const file of rs) {
      const text = read(file)
      // Everything from the test *module* on is test code, and a caller
      // inside one is exactly the state #459 was in: a function only its own
      // suite had ever run.
      //
      // The module, not the first `#[cfg(test)]`. This check was written the
      // shorter way first and reported a real caller as absent, because
      // `lich.rs` has a `#[cfg(test)]` static three hundred lines above its
      // test module - so the scan cut the file in half and then said the
      // second half did not exist. A false "it is missing" deserves the same
      // suspicion as a false "it passed".
      const cut = /#\[cfg\(test\)\]\s*\r?\n\s*(?:pub(?:\([a-z]+\))?\s+)?mod\s/.exec(text)?.index
      const shipped = cut === undefined ? text : text.slice(0, cut)
      for (const [i, line] of shipped.split('\n').entries()) {
        if (line.includes(needle)) hits.push(`${file}:${i + 1}`)
      }
    }
    return hits
  }

  // The positive control, and it is the same shape as the thing under test:
  // the write half has always had a shipped caller, so a scan that reports
  // nothing for `store(` is broken rather than informative.
  const writes = find('credential_store(')
  ok('control: the write half is found by the same scan', writes.length > 0, writes.join(', ') || 'none')

  const reads = find('credential_store::load(')
  ok(
    'credential_store::load has a caller outside its own tests',
    reads.length > 0,
    reads.join(', ') || 'none - the stored password is written and never read (#459)',
  )
}

console.log(`\n${checked} checked, ${failed} failed`)
if (checked < 20) {
  console.log('REFUSING TO REPORT A RESULT: too few checks ran for a pass to mean anything.')
  process.exit(2)
}
process.exit(failed > 0 ? 1 : 0)
