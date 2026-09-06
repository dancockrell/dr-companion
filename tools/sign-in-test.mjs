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
 *      list this app made up;
 *   7. every `A`-reply refusal token reaches the sentence written for its own
 *      cause, and only a token nobody has written down is told the app cannot
 *      read the reason (#507). Four of Lich's tokens have meanings this app
 *      keeps in its own source and all four used to get one sentence and one
 *      remedy.
 *
 * # The denominator, and the hole that was in it
 *
 * Property 4's required set is stated here rather than derived from the
 * implementation, because a set derived from the thing under test cannot detect
 * a missing member. The cross-check against `src-tauri/src/eaccess.rs` runs
 * when that file exists and prints NOT CHECKED with the reason when it does
 * not - and a run that skipped it cannot end on the words "all passed".
 *
 * **What this file used to do, and why it was worthless** (issue #457). Its
 * end-to-end loop built the string it then classified - a variant name this
 * file had snake_cased itself, a colon, and some invented detail. So it proved
 * the classifier could read a shape *that did not exist*. Rust sent unprefixed
 * prose, every real failure classified as `unknown`, and all seven player
 * sentences were unreachable in the shipped app while fifty-five checks passed
 * here.
 *
 * It now classifies `src/lib/loginErrorFixtures.ts`, which `cargo test`
 * generates from the Rust types and refuses to let drift. Nothing in this file
 * writes a backend error string any more.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')

let pass = 0
let fail = 0
const skipped = []
/** Whether the cross-check against `eaccess.rs` ran. False when that file is
 * absent, which the denominator at the foot has to know: a skipped block must
 * not read as assertions that never executed. */
let eaccessChecked = false
/** How many generated fixtures were classified. Always the whole file, which
 * is checked in - but counted rather than assumed, because a loop over an
 * empty import is exactly what a broken check looks like. */
let fixturesChecked = 0
/** Whether the #507 refusal-token drive ran. Same accounting as the block
 * above: its assertions are skipped with it when `eaccess.rs` is absent, and a
 * skip must not read as assertions that never executed. */
let refusalDriveChecked = false
/** How many `A`-reply tokens were driven through the classifier. Printed, so a
 * drive over an empty token list is visible rather than silently green. */
let refusalTokensDriven = 0
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
  // Two more N9 (#459) forced, by wiring up the stored password nothing read.
  // Neither is a rename of `bad_password`: one is "you typed nothing and
  // there is nothing saved", the other is "the saved one has just been thrown
  // away because the account server refused it". A player told to re-check a
  // password they did not type has nothing to re-check.
  'password_needed',
  'stored_password_rejected',
  // One more #488 forced. The account server refused the sign-in with a token
  // this version cannot read, and the specification half of that is: it is not
  // `bad_password` (nobody knows whether the password is the problem) and it is
  // not `stored_password_rejected` (the saved password is deliberately still
  // there). Before #488 an unrecognised token classified as `bad_credentials`,
  // which since #459 meant deleting the entry from Windows Credential Manager
  // for a code nobody has ever observed.
  'account_refused',
  // And one more #488 §3 forced, from the launcher half rather than the
  // protocol. `lich_did_not_start` sends a player to "Why won't it start?";
  // this is a Lich that started perfectly well and is already running, and the
  // specification half of it is that the screen offers to attach to that Lich
  // rather than to diagnose it.
  'lich_already_running',
]

/**
 * Every code the Rust side can send, stated here as the specification half.
 *
 * The same argument as `REQUIRED_KINDS`: derived from `LoginCode::ALL` this
 * would be unable to notice a code being dropped. It is checked against two
 * independent things below - the generated fixture, which `cargo test` writes
 * from the Rust enum, and `RUST_ERROR_CODES` in `lichLogin.ts`, which is what
 * the classifier's own table is built from.
 */
const REQUIRED_CODES = [
  'bad_credentials',
  'account_locked_or_expired',
  // #488: the third refusal. `EAccessError::from_refusal_code` has three
  // outcomes, and only `bad_credentials` may cost the player a saved password.
  'account_refused',
  'no_such_character',
  'protocol_mismatch',
  'password_length',
  'obscured_byte_out_of_range',
  'network',
  'lich_did_not_start',
  // #488 §3: the app started no Lich because one is already up. A separate
  // code from `lich_did_not_start` because the two want opposite things from
  // the player - attach, or diagnose.
  'lich_already_running',
  'password_needed',
  'stored_password_rejected',
  'internal',
]

/**
 * The one code with no player sentence, and it is deliberate.
 *
 * There is no advice to give about a worker thread that did not finish, so it
 * classifies to `unknown` and prints what happened. Named here rather than
 * left as an exception in a loop, so that a *second* code quietly landing on
 * `unknown` - which is the whole of #457 - goes red.
 */
const CODES_WITHOUT_A_SENTENCE = ['internal']

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

const { listCharacters, launchCharacter, rememberSignIn, classifyLoginError, LOGIN_ERROR_KINDS, LOGIN_ERROR_SENTENCES, EACCESS_VARIANT_KINDS, RUST_ERROR_CODES, CODE_KINDS, usingFakeBackend } =
  await import('../src/lib/lichLogin.ts')
const { loadPrefs, PREFS_STORAGE_KEY } = await import('../src/lib/persistence.ts')
// Generated from the Rust types by `cargo test`. Read, never written here.
const { LOGIN_ERROR_FIXTURES, REFUSAL_SENTENCES } = await import(
  '../src/lib/loginErrorFixtures.ts'
)

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

    // The webview's own vocabulary, which `game_attach`'s string errors and
    // the browser stand-in still use. The *backend's* vocabulary is checked
    // against the generated fixture below, and that is the check #457 needed.
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

    // The third direction, and the one #457 needed: every variant the enum has
    // must appear in the generated fixture. A variant with a mapping entry and
    // no fixture is a code nothing has ever seen classified.
    const unfixtured = variants.filter((v) => !LOGIN_ERROR_FIXTURES.some((f) => f.code === v))
    ok('every EAccessError variant appears in the generated fixture', unfixtured.length === 0,
      unfixtured.join(', ') || `${variants.length} of ${variants.length}`)
    eaccessChecked = true
  }
}

// --------------------------------------------------------------------------
// The check #457 was about: classify what Rust actually sends.
//
// `src/lib/loginErrorFixtures.ts` is written by `cargo test` from the Rust
// types - one real serialisation per code, message included - and that test
// fails if the checked-in copy has drifted. Nothing below builds a string.
// --------------------------------------------------------------------------
{
  const fixtureCodes = LOGIN_ERROR_FIXTURES.map((f) => f.code)

  // The denominator first: a fixture file that failed to import, or came back
  // empty, would make every loop below vacuously true.
  ok('the generated fixture has entries', LOGIN_ERROR_FIXTURES.length >= 7, `${LOGIN_ERROR_FIXTURES.length}`)

  // Both sides of the contract, both directions. `REQUIRED_CODES` is this
  // file's independent statement of the set; the fixture is Rust's; and
  // `RUST_ERROR_CODES` is what the classifier's table is built from.
  const missingFromRust = REQUIRED_CODES.filter((c) => !fixtureCodes.includes(c))
  const extraInRust = fixtureCodes.filter((c) => !REQUIRED_CODES.includes(c))
  ok(
    `Rust sends exactly the required ${REQUIRED_CODES.length} codes`,
    missingFromRust.length === 0 && extraInRust.length === 0,
    `${fixtureCodes.length} in the fixture${missingFromRust.length ? ` - missing ${missingFromRust.join(', ')}` : ''}${extraInRust.length ? ` - extra ${extraInRust.join(', ')}` : ''}`
  )
  const missingFromTs = fixtureCodes.filter((c) => !RUST_ERROR_CODES.includes(c))
  const staleInTs = RUST_ERROR_CODES.filter((c) => !fixtureCodes.includes(c))
  ok(
    'the webview declares the same code set as Rust',
    missingFromTs.length === 0 && staleInTs.length === 0,
    `${RUST_ERROR_CODES.length} declared${missingFromTs.length ? ` - not declared: ${missingFromTs.join(', ')}` : ''}${staleInTs.length ? ` - no longer sent: ${staleInTs.join(', ')}` : ''}`
  )

  // And the classification itself, on the real objects.
  for (const fixture of LOGIN_ERROR_FIXTURES) {
    const got = classifyLoginError(fixture)
    const expectSentence = !CODES_WITHOUT_A_SENTENCE.includes(fixture.code)
    const right = expectSentence
      ? got.kind === CODE_KINDS[fixture.code] && got.kind !== 'unknown' && got.detail === fixture.message
      : got.kind === 'unknown' && got.sentence.includes(fixture.message)
    ok(
      `${fixture.code} classifies to ${expectSentence ? 'a player sentence' : 'unknown, printing what happened'}`,
      right,
      `${got.kind}: ${got.sentence}`
    )
    fixturesChecked += 1
  }

  // The control that makes the loop above mean something: the *old* shape -
  // prose with no code, which is what Rust sent before #457 - must still come
  // out `unknown`. Without this, a classifier that returned a sentence for
  // everything would pass every line above.
  const prose = classifyLoginError(new Error('the account cannot sign in right now (NEW)'))
  ok('control: unprefixed prose still classifies as unknown', prose.kind === 'unknown', prose.kind)
  ok(
    'control: which is what the shipped app used to do with every failure',
    prose.sentence.includes('the account cannot sign in right now')
  )
}

// --------------------------------------------------------------------------
// #507: one sentence per refusal cause, driven over every token.
//
// The player-facing half of the property `lich.rs`'s
// `every_refusal_token_reaches_the_sentence_written_for_its_cause` drives
// through the composed path. The token list is read out of `eaccess.rs`'s
// `REFUSAL_TOKENS` - the same array that test drives - rather than typed here,
// so the two ends cannot end up covering different populations.
//
// Before #507 this loop would have printed one sentence fifteen times, saying
// Play.net "gave a reason this app does not recognise" for four tokens whose
// meanings are written down in `eaccess.rs` itself.
// --------------------------------------------------------------------------
{
  const rel = process.env.DRC_EACCESS_SOURCE ?? 'src-tauri/src/eaccess.rs'
  if (!existsSync(join(root, rel))) {
    notChecked(
      'every refusal token reaches the sentence written for its cause',
      `${rel} does not exist, so the token population cannot be read; the table itself is checked by tools/login-error-fixture-test.mjs`
    )
  } else {
    const body =
      /const REFUSAL_TOKENS: \[&str; (\d+)\] = \[([\s\S]*?)\n {4}\];/.exec(read(rel)) ?? null
    const declared = body ? Number(body[1]) : -1
    const tokens = body ? [...body[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : []
    // The denominator, and it is the whole value of the loop below: a regex
    // that stopped matching would report a perfectly consistent set of
    // sentences for no tokens at all.
    ok(
      'the refusal-token parser found the declared number of tokens',
      tokens.length >= 20 && tokens.length === declared,
      `${tokens.length} found, ${declared} declared`
    )

    // Every token driven as the refusal it would be. Re-implementing
    // `from_refusal_code` here to work out which ones reach `account_refused`
    // would be a second copy of the classifier; `lich.rs` drives the real one
    // through the real path and this drives the real table through the real
    // classifier, which is the half a player sees.
    const message =
      'the login service refused the account for a reason this version does not recognise'
    const sentences = new Map()
    for (const token of tokens) {
      sentences.set(token, classifyLoginError({ code: 'account_refused', message, token }).sentence)
      refusalTokensDriven += 1
    }

    const named = REFUSAL_SENTENCES.map((r) => r.token)
    const wrong = named.filter(
      (t) => sentences.get(t) !== REFUSAL_SENTENCES.find((r) => r.token === t).sentence
    )
    ok(
      `each of the ${named.length} named tokens gets the sentence written for it`,
      wrong.length === 0 && named.every((t) => sentences.has(t)),
      wrong.join(', ') || named.join(', ')
    )
    // Distinctness is the whole of the issue: four causes sharing one remedy
    // is what this replaced, and a table whose rows were copied from one
    // another would pass every other check here.
    const shared = new Map()
    for (const t of named) {
      shared.set(sentences.get(t), [...(shared.get(sentences.get(t)) ?? []), t])
    }
    const sharing = [...shared.values()].filter((t) => t.length > 1)
    ok(
      'and no two of them get the same sentence',
      sharing.length === 0 && shared.size === named.length,
      // Named, not counted: "4 sentences for 5 tokens" does not say which
      // cause lost its remedy, and that is the thing to go and look at.
      sharing.map((t) => t.join(' and ')).join('; ') ||
        `${shared.size} sentences for ${named.length} tokens`
    )
    ok(
      'a named token no longer claims the app cannot read the reason',
      named.every((t) => !/does not recognise/.test(sentences.get(t))),
      named.filter((t) => /does not recognise/.test(sentences.get(t))).join(', ') || 'none do'
    )

    // The other outcome, so neither list is what an inert drive would give:
    // a token nobody has written down keeps the generic wording - which is
    // what that wording is actually true of - and shows the raw token, so a
    // bug report carries the word the server sent.
    const unnamed = tokens.filter((t) => t && !named.includes(t))
    ok('there are unnamed tokens to check the fallback with', unnamed.length >= 5, `${unnamed.length}`)
    const swallowed = unnamed.filter((t) => !sentences.get(t).includes(t))
    ok(
      'an unrecognised token is shown to the player, not swallowed',
      swallowed.length === 0,
      swallowed.join(', ') || `${unnamed.length} of ${unnamed.length}`
    )
    ok(
      'and the fallback still says the reason was not recognised',
      unnamed.every((t) => /does not recognise/.test(sentences.get(t)))
    )
    // A refusal with no token - a string-form failure, or the empty last field
    // a truncated reply leaves behind - gets the generic sentence with nothing
    // appended, rather than a dangling "Play.net said: ".
    const bare = classifyLoginError({ code: 'account_refused', message })
    ok(
      'a refusal carrying no token gets the generic sentence unchanged',
      bare.sentence === LOGIN_ERROR_SENTENCES.account_refused,
      bare.sentence
    )
    refusalDriveChecked = true
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
  // The control itself, not the words. This check was the other way round for
  // one day: N5 shipped while N8 was `[!]`, and it asserted that no checkbox
  // existed, because a disabled one would have read as finished work. N8
  // landed the next day, so the property it was really about - *the player is
  // never storing a password they did not ask to store* - is now checked by
  // asserting the box is there and starts off, which the absent version could
  // not distinguish from a form that quietly stored one.
  ok(
    'the "remember my password" box is mounted from the shared component',
    /<RememberPasswordCheckbox/.test(signIn) && /from '\.\/RememberPassword\.tsx'/.test(signIn)
  )
  ok(
    'it starts from the shared default rather than a literal',
    /useState\(REMEMBER_PASSWORD_DEFAULT\)/.test(signIn) &&
      !/useState\(true\)/.test(signIn) &&
      !/defaultChecked/.test(signIn)
  )
  // The direction that finds things: storing before the account server has
  // accepted the password would remember typing mistakes, so the store call
  // must sit after `listCharacters` resolves and inside the success path.
  {
    // Inside the function body, not the whole file: `rememberIfAsked` is also
    // an import at the top, and the first version of this check compared that
    // import's offset and reported a real ordering as wrong.
    const body = signIn.slice(signIn.indexOf('const signIn = async'))
    const proved = body.indexOf('const result = await listCharacters')
    const store = body.indexOf('rememberIfAsked')
    // Positive control first, so `store > proved` cannot pass on two -1s.
    ok('the call and the proof were both found in signIn()', store > 0 && proved > 0,
      `listCharacters at ${proved}, rememberIfAsked at ${store}`)
    ok(
      'the password is stored only after the sign-in succeeded',
      proved !== -1 && store > proved,
      `listCharacters at ${proved}, rememberIfAsked at ${store}`
    )
  }
  // -- N9 (#459): the form uses a saved password rather than asking again --
  ok(
    'the form asks whether a password is saved for this account',
    /hasStoredPassword\(/.test(signIn) && /fakeCredentialHas\(/.test(signIn),
    'both the real backend and the stand-in'
  )
  ok(
    'a saved password means no password box, and a way past it',
    /usingStoredPassword \?/.test(signIn) && /Use a different password/.test(signIn)
  )
  ok(
    'and the Sign in button stops requiring one to be typed',
    /!password && !usingStoredPassword/.test(signIn),
    'disabled only when there is neither'
  )
  ok(
    'a store that could not be asked shows the field rather than hiding it',
    /storedPassword === true/.test(signIn),
    'null is not treated as false'
  )

  // -- #458: the attach waits, and the screen says so -----------------------
  ok(
    'the attach after a launch is given time for Lich to start',
    /attachGame\(result\.port, undefined, LICH_STARTUP_WAIT_MS\)/.test(signIn)
  )
  ok(
    'and the screen does not claim it is launched until it has attached',
    /setStage\('starting'\)/.test(signIn) && /await attachGame[\s\S]{0,120}setStage\('launched'\)/.test(signIn)
  )
  {
    const link = read('src/lib/gameLink.ts')
    ok(
      'the wait is passed to Rust rather than looped in the webview',
      /waitMs: waitMs \?\? null/.test(link) && /LICH_STARTUP_WAIT_MS = /.test(link)
    )
  }

  for (const f of [
    'src/components/shared/WaitingForCharacter.tsx',
    'src/components/shared/LichLauncher.tsx',
    'src/components/first-run/ConnectGuide.tsx',
    'src/components/dashboard/Dashboard.tsx',
  ]) {
    ok(`${f.split('/').pop()} instructs nobody to configure another client`, !/lichconnect|licharguments/i.test(read(f)))
  }
}

/* ------------------------------------------------------------------ */
/* #504 - the attach offer says which Lich, or says it does not know   */
/* ------------------------------------------------------------------ */
{
  /*
   * `attachAdvice` decides both the sentence and whether there is a button,
   * from one value, so the two cannot disagree. That is the property under
   * test here; the Rust half - which Lich is out there - is
   * `decide_attach_offer` and its cases live in `src-tauri/src/lich.rs`.
   *
   * What this replaced: one button reading "Attach to the Lich that is
   * running", rendered on a `tasklist` image-name match, dialling the
   * constant 11024. The rows below are the four things that button could
   * not say.
   */
  const { attachAdvice } = await import('../src/lib/lichAttachOffer.ts')

  const checking = attachAdvice(null)
  ok(
    'before the answer arrives there is nothing to press',
    checking.action === null && checking.port === null && /Checking/.test(checking.sentence),
    JSON.stringify(checking)
  )

  const ours = attachAdvice({ kind: 'ours', port: 11031 })
  ok(
    'a Lich this app started is attached to on the port it was started with',
    ours.port === 11031 && ours.action !== null,
    JSON.stringify(ours)
  )

  const named = attachAdvice({ kind: 'foreign', port: 11024, character: 'Someoneelse' })
  ok(
    'somebody else\'s character is named in the sentence',
    /Someoneelse/.test(named.sentence),
    named.sentence
  )
  ok(
    'and on the button, which is the last thing read before pressing',
    named.action !== null && named.action.includes('Someoneelse'),
    String(named.action)
  )
  ok(
    'and the sentence warns that the sign-in just typed does not decide it',
    /whoever you just signed in as/.test(named.sentence),
    named.sentence
  )

  const anon = attachAdvice({ kind: 'foreign', port: 11024, character: null })
  ok(
    'a listener Lich named nobody for is not reported as yours',
    /does not say which character/.test(anon.sentence) && anon.action !== null,
    JSON.stringify(anon)
  )

  const noPort = attachAdvice({ kind: 'no_port', port: 11024 })
  ok(
    'a Lich with no detachable port offers no button, because pressing could never work',
    noPort.action === null && noPort.port === null,
    JSON.stringify(noPort)
  )
  ok(
    'and it names the flag it was started without, rather than sending anybody to a diagnostic',
    /--detachable-client/.test(noPort.sentence) && !/did not start/.test(noPort.sentence),
    noPort.sentence
  )

  const gone = attachAdvice({ kind: 'no_lich' })
  ok(
    'a refusal that has gone stale says to sign in again, not to attach',
    gone.action === null && /sign(ing)? in again/i.test(gone.sentence),
    JSON.stringify(gone)
  )

  const unknown = attachAdvice({ kind: 'unknown', why: 'netstat could not be read' })
  ok(
    'a question that was not answered offers nothing and says why',
    unknown.action === null && /netstat could not be read/.test(unknown.sentence),
    JSON.stringify(unknown)
  )

  // The denominator for this block: a stub returning one object for every
  // input would satisfy several rows above on its own.
  const sentences = new Set(
    [checking, ours, named, anon, noPort, gone, unknown].map((a) => a.sentence)
  )
  ok(
    'seven inputs produced seven sentences',
    sentences.size === 7,
    `${sentences.size} distinct`
  )

  // And the one that would catch a revert: the old wording must be gone
  // from the component, not merely unreachable.
  const signIn = read('src/components/shared/SignIn.tsx')
  ok(
    'the unconditional offer is gone from SignIn',
    !/Attach to the Lich that is running/.test(signIn),
    'no fixed sentence left'
  )
  ok(
    'and the port comes from the offer rather than a constant',
    !/attachGame\(Number\(DEFAULT_ATTACH_PORT\)\)/.test(signIn) &&
      /attachGame\(advice\.port\)/.test(signIn),
    'attachGame takes the read port'
  )
}
console.log(`\n${pass} checks passed, ${fail} failed` + (skipped.length ? `, ${skipped.length} not checked` : ''))

// The denominator, derived rather than typed: a throw or an early return
// halfway down otherwise looks exactly like a clean pass.
const source = readFileSync(new URL(import.meta.url), 'utf8')
const declaredStatic = [...source.matchAll(/^\s*ok\(/gm)].length
const ran = pass + fail
// Three `ok(` sites sit in loops whose length is not one: two run once per
// required kind, and one runs once per generated fixture. They are subtracted
// from the static count and added back as the number of times they actually
// ran, so a loop over an empty list cannot pass for a loop that ran.
//
// The six static `ok(`s inside the eaccess block are skipped with it when that
// file is absent - counting them would make an honest skip look like a
// truncated run.
const LOOP_SITES = 3
const eaccessBlockStatic = eaccessChecked ? 0 : 6
// #507's refusal-token drive is skipped with `eaccess.rs` for the same reason
// and needs the same subtraction. Its own loop fills a map rather than
// asserting, so all eight of its `ok(`s are static.
const refusalBlockStatic = refusalDriveChecked ? 0 : 8
const expected =
  declaredStatic -
  LOOP_SITES -
  eaccessBlockStatic -
  refusalBlockStatic +
  REQUIRED_KINDS.length * 2 +
  fixturesChecked
if (ran < expected) {
  console.log(`FAIL only ${ran} of an expected ${expected} assertions ran - the rest never executed`)
  process.exit(1)
}
console.log(`   ${ran} assertions ran (expected at least ${expected})`)
console.log(`   ${refusalTokensDriven} A-reply refusal tokens driven through the classifier`)
if (skipped.length) {
  console.log('\nnot checked (a skip is not a pass):')
  for (const s of skipped) console.log(`  ${s}`)
}
process.exit(fail === 0 ? 0 : 1)
