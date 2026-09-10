/**
 * The frontend half of remembering a sign-in: the box is **on** by default,
 * everything is stored unless it is unticked, unticking forgets at once, and no
 * password ever reaches anything that persists in plain text.
 *
 * The first three of those were the other way up until 9 September 2026 (N8,
 * #452, which shipped opt-in and off). Dan reversed the default that day for a
 * desktop app on his own machine - `docs/LICH_NATIVE_LOGIN.md` section 5.2
 * carries the dated reasoning. The checks below were turned over with it rather
 * than deleted, which is the point: the sabotage that used to be "default the
 * box on, go red" is now "default it off, go red", so the property is still
 * guarded, in the direction it now points.
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
// A browser-shaped environment first: `rememberSignIn.ts` owns the preferences
// half now as well as the credential half, so it reaches the real
// `persistence.ts`, which reaches a real `localStorage`. Standing one in is the
// platform being replaced, not the app's own code.
const backingStore = new Map()
const localStorageStub = {
  getItem: (k) => (backingStore.has(k) ? backingStore.get(k) : null),
  setItem: (k, v) => backingStore.set(k, String(v)),
  removeItem: (k) => backingStore.delete(k),
  clear: () => backingStore.clear(),
  key: (i) => [...backingStore.keys()][i] ?? null,
  get length() {
    return backingStore.size
  },
}
globalThis.localStorage = localStorageStub
globalThis.window = {
  localStorage: localStorageStub,
  location: { search: '', href: 'http://127.0.0.1/' },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: globalThis.setTimeout.bind(globalThis),
}

const {
  REMEMBER_SIGN_IN_DEFAULT,
  REMEMBER_SIGN_IN_LABEL,
  REMEMBER_SIGN_IN_NOTICE,
  REMEMBERED_FIELDS,
  forgetEverything,
  hasStoredPassword,
  rememberAfterSignIn,
  rememberedPrefs,
} = await import('../src/lib/rememberSignIn.ts')

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

/* -------------------------------------------------------- the default is on */

ok('the remember-sign-in default is on', REMEMBER_SIGN_IN_DEFAULT === true, `default ${REMEMBER_SIGN_IN_DEFAULT}`)

// One box, not one per field. The enumeration is what a future sign-in
// inherits, and it is checked here rather than counted, so a fifth thing cannot
// be remembered without appearing in it.
ok('the remembered things are enumerated', REMEMBERED_FIELDS.length >= 4, `${REMEMBERED_FIELDS.length} field(s)`)
ok(
  'exactly one of them is a secret',
  REMEMBERED_FIELDS.filter((f) => f.secret).length === 1,
  REMEMBERED_FIELDS.filter((f) => f.secret).map((f) => f.name).join(', ') || 'none',
)
ok(
  'and the secret one is the password, in Credential Manager',
  REMEMBERED_FIELDS.some((f) => f.secret && f.name === 'password' && /Credential Manager/.test(f.where)),
)

// Source, as well as value. The constant could be false while the component
// started its state at a literal `true`, and the value check above would be
// perfectly green. So the component is required to seed from the constant and
// forbidden from seeding a checkbox from a literal.
{
  const src = read('src/components/shared/RememberSignIn.tsx')
  ok(
    'the checkbox is controlled rather than defaulting to its own literal',
    // `useState(false)` for a busy flag is not a second opinion about the
    // default: the box is controlled and its default is the constant. Only a
    // literal `true` here would be.
    !/useState\(\s*true\s*\)/.test(src) && !/defaultChecked/.test(src),
    'no useState(true), no defaultChecked',
  )
  ok(
    'the component states the default by name so one edit moves it',
    src.includes('REMEMBER_SIGN_IN_DEFAULT'),
  )
  ok('the label and the warning are rendered from the shared constants',
    src.includes('REMEMBER_SIGN_IN_LABEL') && src.includes('REMEMBER_SIGN_IN_NOTICE'))
  // The control that undoes it must exist in the same file and be mounted.
  ok('the Forget control is exported', /export function ForgetEverything/.test(src))
  const settings = read('src/components/layout/SettingsSheet.tsx')
  ok(
    'the Forget control is mounted in Settings',
    settings.includes('<ForgetEverything') && settings.includes("from '../shared/RememberSignIn.tsx'"),
  )
  // The form seeds from the constant, not from a literal. The constant could be
  // `true` while the form started its state at `false`, and the value check
  // above would be perfectly green.
  const form = read('src/components/shared/SignIn.tsx')
  ok(
    'the sign-in form seeds the box from the shared default',
    /useState\(initial\.remember \?\? REMEMBER_SIGN_IN_DEFAULT\)/.test(form),
    'and with ?? rather than ||, so an unticked box survives a restart',
  )
  ok(
    'and it does not seed it from a literal',
    !/useState\(\s*true\s*\)/.test(form) && !/defaultChecked/.test(form),
  )
}

/* ------------------------------------- nothing is stored unless it is asked */

{
  const backend = fakeBackend()
  const outcome = await rememberAfterSignIn(
    backend,
    { account: 'Somebody', password: 'a-password' },
    false,
  )
  ok('with the box unticked, the outcome says so', outcome === 'not asked', outcome)
  ok(
    'with the box unticked, the backend is never called at all',
    backend.calls.length === 0,
    backend.calls.map((c) => c.join(' ')).join(', ') || '0 calls',
  )
  ok('with the box unticked, nothing is in the store', backend.entries.size === 0)
  // The choice itself is written either way, or unticking would revert to the
  // default on the next launch and the box would be a suggestion.
  ok('and the choice is remembered so it survives a restart', rememberedPrefs().remember === false, `${rememberedPrefs().remember}`)
  ok('with the box unticked, no account name is persisted either', rememberedPrefs().account === '', `"${rememberedPrefs().account}"`)
}

// The positive control for the check above: the same fake, the same call, the
// box ticked. If this does not fill the log then the empty log above was a
// dead harness rather than a working guarantee.
{
  const backend = fakeBackend()
  const outcome = await rememberAfterSignIn(
    backend,
    { account: 'Somebody', password: 'a-password', gameCode: 'DR', character: 'Phemius' },
    true,
  )
  ok('with the box ticked, the sign-in is remembered', outcome === 'remembered', outcome)
  ok(
    'with the box ticked, exactly one store call happens',
    backend.calls.length === 1 && backend.calls[0][0] === 'store' && backend.calls[0][1] === 'Somebody',
    backend.calls.map((c) => c.join(' ')).join(', '),
  )
  ok('the stored value is the password that was passed', backend.entries.get('Somebody') === 'a-password')
  // Everything, not the password alone: that is what "remember everything about
  // anything signed in" asked for, and one call writes all of it.
  const prefs = rememberedPrefs()
  ok(
    'and the account, game and character are remembered with it',
    prefs.account === 'Somebody' && prefs.gameCode === 'DR' && prefs.character === 'Phemius' && prefs.remember === true,
    JSON.stringify(prefs),
  )
}

// Ticked, but there is nothing to store. An entry that signs nobody in must
// not be created; the Rust side refuses one too, and this is the half that
// stops the round trip being made at all.
{
  const backend = fakeBackend()
  const outcome = await rememberAfterSignIn(backend, { account: '   ', password: 'a-password' }, true)
  ok('ticked with a blank account stores nothing', outcome === 'nothing to store' && backend.calls.length === 0, outcome)
}
// An empty password is not the same absence. It is what a sign-in that *used*
// the already-stored password passes, and overwriting a good entry with an
// empty string would be the worst possible reading of it - so the credential
// call is skipped and the preferences are still written.
{
  const backend = fakeBackend()
  const outcome = await rememberAfterSignIn(
    backend,
    { account: 'Somebody', password: '', character: 'Phemius' },
    true,
  )
  ok(
    'ticked with no typed password leaves the stored one alone',
    outcome === 'remembered' && backend.calls.length === 0,
    `${outcome}, ${backend.calls.length} call(s)`,
  )
  ok('and still remembers the character', rememberedPrefs().character === 'Phemius')
}

/* --------------------------------------------------------------- forgetting */

{
  const backend = fakeBackend()
  await rememberAfterSignIn(
    backend,
    { account: 'Somebody', password: 'a-password', gameCode: 'DR', character: 'Phemius' },
    true,
  )
  ok('the store reports the entry', (await hasStoredPassword(backend, 'Somebody')) === true)
  ok('forget removes it', (await forgetEverything(backend, 'Somebody')) === true)
  ok('and then it is gone', (await hasStoredPassword(backend, 'Somebody')) === false)
  // One action, both stores. Two controls that each forgot half of a thing
  // would leave somebody who used one believing they had used both.
  const after = rememberedPrefs()
  ok(
    'and the remembered preferences went with it',
    after.account === '' && after.gameCode === '' && after.character === '' && after.remember === false,
    JSON.stringify(after),
  )
  // False, not an error: pressing Forget twice is a thing people do.
  ok('forgetting again is false rather than a throw', (await forgetEverything(backend, 'Somebody')) === false)
  ok('forgetting a blank account touches nothing', (await forgetEverything(backend, '  ')) === false)
}

/* ------------------------------------------- no password reaches persistence */

// The direction that finds things. `rememberSignIn.ts` is the one module
// allowed to handle a password in the frontend, and it must not be able to put
// one anywhere else: not localStorage, not a preference, not a log line.
{
  const src = read('src/lib/rememberSignIn.ts')
  // `loadPrefs`/`savePrefs` are no longer forbidden here - this module owns the
  // preferences half now, which is the whole point of there being one owner. So
  // the property is checked structurally instead of by absence: no line that
  // writes a preference may mention a password. That is a stronger check than
  // the old list, which was satisfied by a module that simply could not reach
  // storage at all.
  const forbidden = ['localStorage', 'sessionStorage', 'writeJSON', 'console.log']
  const found = forbidden.filter((f) => src.includes(f))
  ok('the module reaches no store but the two it declares', found.length === 0, found.join(', ') || `${forbidden.length} checked`)
  // Positive control: the matcher can fire.
  ok(
    'that matcher is not simply matching nothing',
    forbidden.some((f) => `const x = ${f}`.includes(f)),
  )
  {
    const writes = src.split('\n').filter((l) => /savePrefs\(|next\./.test(l) && !/^\s*(\/\/|\*)/.test(l))
    ok('the preference-write scan found the writes', writes.length >= 4, `${writes.length} line(s)`)
    const leaky = writes.filter((l) => /password/i.test(l))
    ok('no preference write mentions a password', leaky.length === 0, leaky.join(' | ') || `${writes.length} checked`)
    ok(
      'that leak matcher would catch one',
      /password/i.test('next.lichPassword = fields.password'),
    )
  }
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
  // The label no longer says "password", because the box no longer decides only
  // that. A box labelled for one of the four things it governs is a box whose
  // other three are ungoverned as far as the reader can tell.
  ok('the label names the whole sign-in, not the password alone', REMEMBER_SIGN_IN_LABEL === 'Remember my sign-in on this computer', REMEMBER_SIGN_IN_LABEL)
  ok(
    'the notice names the store and who else can read it',
    REMEMBER_SIGN_IN_NOTICE ===
      'Stored in Windows Credential Manager. Anyone signed in to this Windows account can use it.',
    REMEMBER_SIGN_IN_NOTICE,
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
