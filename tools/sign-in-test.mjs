#!/usr/bin/env node
/**
 * Signing in does not keep the password, and every way it can fail says
 * something a player can act on.
 *
 * Run: node --experimental-strip-types tools/sign-in-test.mjs
 *
 * # What this is defending
 *
 * Increment N5 of `docs/PLAN_TO_1_0.md` gave this app its first first-party
 * credential handling. Before it, three documents and one component promised
 * the app never sees a password, and that was true. It is not true any more,
 * and the thing that must stay true instead is narrower and checkable: the
 * password is used for one call and is never written anywhere.
 *
 * A promise like that decays quietly. Somebody adds "remember me" without the
 * Credential Manager work, or a debug `console.log`, or a `savePrefs` call that
 * spreads a whole form object, and nothing goes red - the app keeps working
 * perfectly while a plaintext password sits in `localStorage`. So this drives a
 * whole sign-in and then reads the stored preferences back and greps them.
 *
 * # Properties, not mechanism
 *
 *   1. a complete sign-in leaves no password anywhere in the persisted prefs -
 *      not under a key called `password`, and not as the string itself under
 *      any key at all;
 *   2. the positive control: the *account name* from that same sign-in **is**
 *      persisted, so a green result on 1 cannot mean the writer never ran;
 *   3. `rememberSignIn` has no route to persist a password even if a caller
 *      passes one, because a function that could is a function somebody adds a
 *      caller to;
 *   4. every typed error kind has a sentence, N of N, against a required set
 *      this file states independently - dropping an arm goes red naming it;
 *   5. an unrecognised failure does not silently become one of the known ones;
 *   6. the character picker offers exactly what the command returned, not a
 *      list this app made up.
 *
 * # The denominator, and the one thing this file cannot check yet
 *
 * Property 4's required set is stated here rather than derived from the
 * implementation, because a set derived from the thing under test cannot detect
 * a missing member. The authority it *should* be derived from is the Rust
 * `EAccessError` enum, which increment N1 owns and which had not merged when
 * this was written. So the cross-check against `src-tauri/src/eaccess.rs` runs
 * when that file exists and prints NOT CHECKED with the reason when it does
 * not - and a run that skipped it cannot end on the words "all passed".
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')

let pass = 0
let fail = 0
const skipped = []
/** How many enum variants the cross-check below actually classified. Zero
 * when eaccess.rs is absent, which the denominator at the foot has to know:
 * a skipped loop must not read as assertions that never executed. */
let variantsChecked = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}${detail}`)
}
const notChecked = (name, why) => {
  skipped.push(`${name}: ${why}`)
  console.log(`     NOT CHECKED  ${name.padEnd(51)}${why}`)
}

/**
 * The set every sign-in failure must fall into, written down here and nowhere
 * else in this file's dependency graph.
 *
 * Yes, this is a second copy of a list. It is the specification half of the
 * pair, which is what a test is: derived from `docs/LICH_NATIVE_LOGIN.md` and
 * from N5's own `do:` line ("wrong password; account locked; no such character;
 * the login service did not answer; Lich did not start"). Deriving it from
 * `LOGIN_ERROR_KINDS` instead would make deleting a kind invisible, which is
 * the exact failure this property exists to catch.
 */
const REQUIRED_KINDS = [
  // The five N5's own `do:` line names.
  'bad_password',
  'account_locked',
  'character_not_found',
  'service_unreachable',
  'lich_did_not_start',
  // Two more the enum N1 actually shipped forced, and they are the argument
  // for cross-checking against source rather than against a plan: neither is
  // something a player could have been told about by the other five.
  // `ProtocolMismatch` is nobody's fault and a retry will not fix it, so it
  // must not read as a bad password or an outage. `PasswordLength` and
  // `ObscuredByteOutOfRange` both mean this exact password cannot go down the
  // wire, whatever it is typed into.
  'login_service_changed',
  'password_unsendable',
]

// --------------------------------------------------------------------------
// A browser-shaped environment, so the real modules run unmodified.
// --------------------------------------------------------------------------
// Not a mock of the app's own code: `persistence.ts` and `storage.ts` are the
// real ones, writing into a real (in-memory) localStorage. The only thing
// standing in for something is the platform.
const store = new Map()
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
globalThis.localStorage = localStorage
globalThis.window = {
  localStorage,
  // No `__TAURI_INTERNALS__`, so `isTauri()` is false - and `?lichDryRun=1`,
  // which is the one way to reach the stand-in backend N5 was built against.
  location: { search: '?lichDryRun=1', href: 'http://127.0.0.1/?lichDryRun=1' },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: globalThis.setTimeout.bind(globalThis),
}

const { listCharacters, launchCharacter, rememberSignIn, classifyLoginError, LOGIN_ERROR_KINDS, LOGIN_ERROR_SENTENCES, EACCESS_VARIANT_KINDS, usingFakeBackend } =
  await import('../src/lib/lichLogin.ts')
const { loadPrefs, PREFS_STORAGE_KEY } = await import('../src/lib/persistence.ts')

// Obviously fake, and it has to be: nothing resembling a real credential goes
// in a file in this repository.
const ACCOUNT = 'demo'
const PASSWORD = 'not-a-real-password-9d4f'

ok('the dry-run stand-in is what this run is driving', usingFakeBackend() === true)

// --------------------------------------------------------------------------
// 1, 2, 3. A whole sign-in, then read the disk back.
// --------------------------------------------------------------------------
{
  const account = await listCharacters({ account: ACCOUNT, password: PASSWORD, gameCode: 'DR' })
  // This is what SignIn does on success, and it is the only persistence call
  // anywhere on the path.
  rememberSignIn({ account: ACCOUNT, gameCode: 'DR' })
  const launched = await launchCharacter({
    account: ACCOUNT,
    password: PASSWORD,
    gameCode: 'DR',
    character: account.characters[0].name,
  })
  rememberSignIn({ character: account.characters[0].name })

  ok('a sign-in returns the port to attach on', launched.port === 11024, `port=${launched.port}`)

  const blob = localStorage.getItem(PREFS_STORAGE_KEY) ?? ''
  ok('something was actually written', blob.length > 2, `${blob.length} bytes`)

  // The positive control comes first on purpose. Without it, "the password is
  // not in there" is equally true of an empty file.
  ok(
    'control: the account name from that sign-in IS persisted',
    blob.includes(ACCOUNT) && loadPrefs().lichAccount === ACCOUNT,
    `lichAccount=${JSON.stringify(loadPrefs().lichAccount)}`
  )
  ok(
    'control: and so is the character that was launched',
    loadPrefs().lichCharacter === account.characters[0].name
  )

  ok('the password string is nowhere in the persisted prefs', !blob.includes(PASSWORD))
  const keys = Object.keys(JSON.parse(blob))
  ok(
    'and no key is named for one',
    !keys.some((k) => /pass|secret|credential|token/i.test(k)),
    keys.join(', ')
  )
  ok(
    'nothing else in localStorage carries it either',
    ![...store.values()].some((v) => String(v).includes(PASSWORD)),
    `${store.size} keys`
  )
}

{
  // A caller that tries to persist one gets nowhere: `rememberSignIn` reads
  // three named fields and ignores anything else it is handed.
  rememberSignIn({ account: ACCOUNT, password: PASSWORD, lichPassword: PASSWORD })
  const blob = localStorage.getItem(PREFS_STORAGE_KEY) ?? ''
  ok('rememberSignIn cannot be talked into storing a password', !blob.includes(PASSWORD))
}

// --------------------------------------------------------------------------
// 4, 5. The error map, N of N.
// --------------------------------------------------------------------------
{
  const missing = REQUIRED_KINDS.filter((k) => !LOGIN_ERROR_KINDS.includes(k))
  const extra = LOGIN_ERROR_KINDS.filter((k) => !REQUIRED_KINDS.includes(k))
  ok(
    `the kind set is the required ${REQUIRED_KINDS.length}, no more and no less`,
    missing.length === 0 && extra.length === 0,
    `${LOGIN_ERROR_KINDS.length} declared${missing.length ? ` - missing ${missing.join(', ')}` : ''}${extra.length ? ` - extra ${extra.join(', ')}` : ''}`
  )

  let sentenced = 0
  for (const kind of REQUIRED_KINDS) {
    const sentence = LOGIN_ERROR_SENTENCES[kind]
    const usable =
      typeof sentence === 'string' &&
      sentence.length > 20 &&
      /[.!]$/.test(sentence.trim()) &&
      // No protocol vocabulary, no error codes: this is read by somebody who
      // wants to play a game.
      !/EAccess|sal\b|argv|0x|errno|Err\(/i.test(sentence)
    ok(`${kind} has a sentence a player can act on`, usable, JSON.stringify(sentence ?? null))
    if (usable) sentenced += 1

    const classified = classifyLoginError(new Error(`${kind}: raw detail from Rust`))
    ok(`${kind} is recognised from the wire, not guessed at`, classified.kind === kind && classified.sentence === sentence, classified.kind)
  }
  ok(`all ${REQUIRED_KINDS.length} required kinds carry a sentence`, sentenced === REQUIRED_KINDS.length, `${sentenced} of ${REQUIRED_KINDS.length}`)

  // 5. Something nobody anticipated must not be dressed up as one of the five.
  const odd = classifyLoginError(new Error('the ruby process exploded'))
  ok('an unrecognised failure stays unknown', odd.kind === 'unknown')
  ok('and it prints what actually happened', odd.sentence.includes('the ruby process exploded'))
  ok('an empty failure does not crash the classifier', classifyLoginError(undefined).kind === 'unknown')
}

// --------------------------------------------------------------------------
// The cross-check against the authority, when the authority exists.
// --------------------------------------------------------------------------
{
  // Overridable so the missing-file branch can be executed on purpose rather
  // than only when N1 happens not to have merged.
  const rel = process.env.DRC_EACCESS_SOURCE ?? 'src-tauri/src/eaccess.rs'
  if (!existsSync(join(root, rel))) {
    notChecked(
      'every EAccessError variant has a sentence',
      `${rel} does not exist (increment N1 owns it); the required set above comes from LICH_NATIVE_LOGIN.md instead, which cannot detect a variant nobody wrote down`
    )
  } else {
    const rust = read(rel)
    const body = /enum\s+EAccessError\s*\{([\s\S]*?)\n\}/.exec(rust)?.[1] ?? ''
    // Variant heads only: a line starting at the variant indent with a capital.
    // Field lines are lower-case and doc comments start with `/`.
    const variants = [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9]*)\s*[,{(]/gm)].map((m) =>
      m[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    )
    // The denominator, and it is the whole value of this check: a parser that
    // returns nothing reports every variant as covered.
    ok('the enum parser found variants', variants.length >= 5, `${variants.length}: ${variants.join(', ')}`)

    // Both directions. The first finds a variant nobody wrote a sentence for -
    // the failure this exists to catch. The second finds a mapping entry for a
    // variant that no longer exists, which is how a stale row survives a
    // rename and quietly stops covering anything.
    const uncovered = variants.filter((v) => !EACCESS_VARIANT_KINDS[v])
    ok('every EAccessError variant has a sentence', uncovered.length === 0, uncovered.join(', ') || `${variants.length} of ${variants.length}`)
    const orphaned = Object.keys(EACCESS_VARIANT_KINDS).filter((v) => !variants.includes(v))
    ok('no mapping entry names a variant the enum no longer has', orphaned.length === 0, orphaned.join(', ') || 'none')

    // And every sentence it maps to has to be one that exists.
    const bad = Object.entries(EACCESS_VARIANT_KINDS).filter(([, k]) => !LOGIN_ERROR_SENTENCES[k])
    ok('every mapped kind has a sentence', bad.length === 0, bad.map(([v, k]) => `${v}->${k}`).join(', '))

    // A control on the parser itself: an enum with a variant this table cannot
    // know about must be reported, or a green result above could equally mean
    // the regex matched nothing.
    const fakeVariants = [...'enum EAccessError {\n    ZzNotAVariant { x: u8 },\n}\n'
      .matchAll(/^\s{4}([A-Z][A-Za-z0-9]*)\s*[,{(]/gm)].map((m) =>
      m[1].replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    )
    ok(
      'control: a variant with no mapping is reported',
      fakeVariants.length === 1 && !EACCESS_VARIANT_KINDS[fakeVariants[0]],
      fakeVariants.join(', ')
    )

    // Classification from the Rust vocabulary, end to end, for every variant.
    for (const v of variants) {
      const got = classifyLoginError(new Error(`${v}: raw detail`))
      ok(`${v} classifies to a player sentence`, got.kind === EACCESS_VARIANT_KINDS[v] && got.sentence.length > 20, got.kind)
      variantsChecked += 1
    }
  }
}

// --------------------------------------------------------------------------
// 6. The picker shows what came back, and nothing this app invented.
// --------------------------------------------------------------------------
{
  const result = await listCharacters({ account: ACCOUNT, password: PASSWORD, gameCode: 'DR' })
  ok('the command returns a real list to offer', result.characters.length === 3, `${result.characters.length}`)
  ok(
    'each entry carries the code the L frame needs, not only a name',
    result.characters.every((c) => c.code && c.name),
    result.characters.map((c) => `${c.code}=${c.name}`).join(' ')
  )

  const empty = await listCharacters({ account: 'nochars', password: PASSWORD, gameCode: 'DR' })
  ok('an account with no characters returns an empty list, not an error', empty.characters.length === 0)

  const signIn = read('src/components/shared/SignIn.tsx')
  ok(
    'the picker renders the returned list rather than a hardcoded one',
    /characters\.map\(/.test(signIn) && !/Phemius/.test(signIn),
    'no fixture name in the component'
  )
  ok(
    'an empty list renders a sentence, not an empty row of buttons',
    /characters\.length > 0 \?/.test(signIn) && /has no /.test(signIn)
  )
  ok(
    'and offers a way back rather than a dead end',
    /Back to sign in/.test(signIn)
  )
}

// --------------------------------------------------------------------------
// The passages N5 deleted stay deleted.
// --------------------------------------------------------------------------
{
  const signIn = read('src/components/shared/SignIn.tsx')
  ok(
    'the sign-in screen states the true password sentence',
    // The exact sentence docs/PRIVACY.md states, which
    // tools/doc-claims-test.mjs pins in three files at once. Checked here as
    // the same string rather than a paraphrase, so this suite cannot pass
    // while the four copies drift.
    /held only in memory, and not stored unless you later\s+ask for it/.test(signIn)
  )
  // The retired claims, in both directions and across every document and
  // component, are tools/doc-claims-test.mjs section K's job - it owns the
  // literal list and checks the replacement is present as well as the old one
  // absent. A second copy of that check here would be a fork of it, and would
  // have disagreed the day N2 kept a still-true 'never sees it' on the branch
  // where Lich's own window really does hold the password.
  // The control itself, not the words: the header comment explains at length
  // why there is no checkbox, so grepping for the phrase would fail on the
  // explanation. A checkbox or a stored-password identifier is what must not
  // be there while N8 is unbuilt - a disabled one would read as finished work.
  ok(
    'no "remember my password" control exists while N8 is unbuilt',
    !/type="checkbox"/.test(signIn) && !/rememberPassword|storePassword|savePassword/.test(signIn)
  )
  for (const f of [
    'src/components/shared/WaitingForCharacter.tsx',
    'src/components/shared/LichLauncher.tsx',
    'src/components/first-run/ConnectGuide.tsx',
    'src/components/dashboard/Dashboard.tsx',
  ]) {
    ok(`${f.split('/').pop()} instructs nobody to configure another client`, !/lichconnect|licharguments/i.test(read(f)))
  }
}

console.log(`\n${pass} checks passed, ${fail} failed` + (skipped.length ? `, ${skipped.length} not checked` : ''))

// The denominator, derived rather than typed: a throw or an early return
// halfway down otherwise looks exactly like a clean pass.
const source = readFileSync(new URL(import.meta.url), 'utf8')
const declaredStatic = [...source.matchAll(/^\s*ok\(/gm)].length
const ran = pass + fail
// The loop over REQUIRED_KINDS declares three `ok(` sites and runs them once
// per kind, so the floor is stated in terms of both.
// Three `ok(` sites sit in loops: two run once per required kind, one runs
// once per enum variant. The last is zero when eaccess.rs is absent, and
// counting it as one would make the honest skip look like a truncated run -
// so the count comes from the loop rather than from the source.
// The five static `ok(`s inside the eaccess block are skipped with it.
const eaccessBlockStatic = variantsChecked ? 0 : 5
const expected = declaredStatic - 3 - eaccessBlockStatic + REQUIRED_KINDS.length * 2 + variantsChecked
if (ran < expected) {
  console.log(`FAIL only ${ran} of an expected ${expected} assertions ran - the rest never executed`)
  process.exit(1)
}
console.log(`   ${ran} assertions ran (expected at least ${expected})`)
if (skipped.length) {
  console.log('\nnot checked (a skip is not a pass):')
  for (const s of skipped) console.log(`  ${s}`)
}
process.exit(fail === 0 ? 0 : 1)
