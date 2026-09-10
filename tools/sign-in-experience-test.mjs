#!/usr/bin/env node
/**
 * The whole first-contact experience: every state a player can be in has a
 * screen with something to press, the form behaves like a form, everything
 * about a sign-in is remembered by default and used on the next one, unticking
 * forgets at once, and there is exactly one path by which a secret can be
 * stored.
 *
 *     node --experimental-strip-types tools/sign-in-experience-test.mjs
 *
 * # Why this suite exists rather than more checks in sign-in-test
 *
 * `tools/sign-in-test.mjs` checks the protocol half: the error contract, the
 * classifier, the fixtures, what is persisted. This checks the *experience* -
 * whether a person who opens this app can get into the game and, when
 * something goes wrong, whether the screen tells them what to do. Those are
 * different questions, and the second one had no suite at all: the screen had
 * four rendered stages and about twenty situations, and nothing counted the
 * difference.
 *
 * # The denominator, and where it comes from
 *
 * `SIGN_IN_STATES` is assembled from four sources, three of them generated:
 * the login error codes and refusal tokens come from
 * `src/lib/loginErrorFixtures.ts`, which `cargo test` writes from the Rust
 * types; the attach answers come from `ATTACH_OFFER_KINDS`, which is the union
 * `lich_attach_offer` returns; only the fourteen base states are hand-written.
 * So a code Rust starts sending grows this suite's denominator without anybody
 * editing it, and a state with no screen goes red naming itself.
 *
 * That is the property worth having. A test that counted a literal would stay
 * green over a new failure code with no screen, which is the exact shape of the
 * defect this whole increment is about.
 *
 * # Both registries
 *
 * Registered in `package.json` as `test:sign-in-experience` **and** in
 * `tools/test-suites.json`, because `tools/needs-env.mjs` checks the two
 * against each other and a suite in one but not the other runs in some
 * commands and not others - which is indistinguishable from a suite that
 * passes.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  // Two spaces after the padding, not only the padding. A break-check reads
  // this output with /^FAIL\s+(.+?)\s{2,}/, and a check whose name is longer
  // than the pad width would have run its name straight into its detail and
  // become invisible to that scan - a red result the harness could not see,
  // which reads as a sabotage that was not caught.
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(66)}  ${detail}`)
}
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

// --------------------------------------------------------------------------
// A browser-shaped environment, so the real modules run unmodified.
// --------------------------------------------------------------------------
// The same shape `sign-in-test.mjs` uses: the app's own `persistence.ts` and
// `storage.ts` are the real ones, writing into a real in-memory localStorage.
// Only the platform is stood in for.
const backing = new Map()
const localStorageStub = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
  clear: () => backing.clear(),
  key: (i) => [...backing.keys()][i] ?? null,
  get length() {
    return backing.size
  },
}
globalThis.localStorage = localStorageStub
globalThis.window = {
  localStorage: localStorageStub,
  // No `__TAURI_INTERNALS__`, so `isTauri()` is false, and `?lichDryRun=1` is
  // the one way to reach the stand-in backend.
  location: { search: '?lichDryRun=1', href: 'http://127.0.0.1/?lichDryRun=1' },
  addEventListener() {},
  removeEventListener() {},
  setTimeout: globalThis.setTimeout.bind(globalThis),
}

const {
  BASE_STATES,
  FAILURE_STATES,
  REFUSAL_STATES,
  RUNNING_STATES,
  SIGN_IN_STATES,
  SIGN_IN_STATE_FLOOR,
  SIGN_IN_ACTIONS,
  screenFor,
} = await import('../src/lib/signInStates.ts')
const {
  REMEMBER_SIGN_IN_DEFAULT,
  REMEMBERED_FIELDS,
  actionsToPlay,
  forgetEverything,
  rememberAfterSignIn,
  rememberedPrefs,
  resolveRemembered,
} = await import('../src/lib/rememberSignIn.ts')
const { LOGIN_ERROR_FIXTURES, REFUSAL_SENTENCES } = await import(
  '../src/lib/loginErrorFixtures.ts'
)
const { ATTACH_OFFER_KINDS } = await import('../src/lib/lichAttachOffer.ts')
const { listCharacters } = await import('../src/lib/lichLogin.ts')

const signInSrc = read('src/components/shared/SignIn.tsx')
const statesSrc = read('src/lib/signInStates.ts')

/**
 * `screenFor`, but a missing screen is `null` rather than a thrown error.
 *
 * Section B asserts that a state with no screen throws - that is the mechanism
 * that makes the absence visible at all. Every section after it has to keep
 * running when one is missing, or a single unhandled state ends the process and
 * the checks below it report nothing, which reads as "they were fine".
 */
const safeScreen = (state, character = 'Phemius') => {
  try {
    return screenFor(state, character)
  } catch {
    return null
  }
}

// ==========================================================================
// A. Every state is enumerated, and the denominator comes from the code.
// ==========================================================================
{
  ok(
    'the state list is assembled from four sources',
    SIGN_IN_STATES.length ===
      BASE_STATES.length + FAILURE_STATES.length + REFUSAL_STATES.length + RUNNING_STATES.length,
    `${BASE_STATES.length} base + ${FAILURE_STATES.length} failures + ${REFUSAL_STATES.length} refusals + ${RUNNING_STATES.length} running = ${SIGN_IN_STATES.length}`,
  )
  // Each derived group against the thing that generates it. Without these the
  // list could be hand-written and still add up.
  ok(
    'the failure states are one per generated login code',
    FAILURE_STATES.length === LOGIN_ERROR_FIXTURES.length &&
      LOGIN_ERROR_FIXTURES.every((f) => FAILURE_STATES.includes(`failed_${f.code}`)),
    `${LOGIN_ERROR_FIXTURES.length} generated code(s)`,
  )
  ok(
    'the refusal states are one per generated A-reply token',
    REFUSAL_STATES.length === REFUSAL_SENTENCES.length &&
      REFUSAL_SENTENCES.every((r) => REFUSAL_STATES.includes(`refused_${r.token}`)),
    `${REFUSAL_SENTENCES.length} token(s)`,
  )
  ok(
    'the running states are one per answer lich_attach_offer can give',
    RUNNING_STATES.length === ATTACH_OFFER_KINDS.length,
    ATTACH_OFFER_KINDS.join(', '),
  )
  // A floor against a constant, well under the real count, so an emptied table
  // reports itself rather than reading as a clean sweep over nothing.
  ok(
    'the enumeration is not empty or truncated',
    SIGN_IN_STATES.length >= SIGN_IN_STATE_FLOOR,
    `${SIGN_IN_STATES.length} states, floor ${SIGN_IN_STATE_FLOOR}`,
  )
  ok('no state is listed twice', new Set(SIGN_IN_STATES).size === SIGN_IN_STATES.length)
}

// ==========================================================================
// B. N of N: every state renders a distinct screen with an action.
// ==========================================================================
{
  const screens = []
  const missing = []
  for (const state of SIGN_IN_STATES) {
    try {
      screens.push(screenFor(state, 'Phemius'))
    } catch (e) {
      missing.push(`${state}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  // The name is constant and the count is in the detail. A check whose *name*
  // carries a number cannot be named by a sabotage list without that list
  // having to be edited every time a login code is added in Rust.
  ok(
    'every enumerated state has a screen',
    missing.length === 0 && screens.length === SIGN_IN_STATES.length,
    missing.join('; ') || `${screens.length} of ${SIGN_IN_STATES.length}`,
  )
  // Positive control on the mechanism that reports the absence: a state nobody
  // wrote a screen for must throw naming itself, or the loop above would call a
  // silent fallback a pass.
  let threw = ''
  try {
    screenFor('a_state_nobody_wrote')
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e)
  }
  ok(
    'control: an unhandled state throws naming itself',
    threw.includes('a_state_nobody_wrote'),
    threw || 'it returned something instead',
  )

  const noAction = screens.filter((s) => s.actions.length === 0)
  ok(
    'every screen has at least one thing to press',
    noAction.length === 0,
    noAction.map((s) => s.state).join(', ') || `${screens.length} screens checked`,
  )
  const blank = screens.filter((s) => !s.heading.trim() || !s.sentence.trim())
  ok(
    'every screen says what it is and what happened',
    blank.length === 0,
    blank.map((s) => s.state).join(', ') || `${screens.length} checked`,
  )
  // Distinct, so two states cannot share one screen and leave a player unable
  // to tell which of them they are in.
  //
  // The fingerprint includes the detail line, and that is not a loophole. Two
  // Rust codes deliberately land on one player sentence - `password_length` and
  // `obscured_byte_out_of_range` are both "this password cannot go down this
  // wire", for arithmetic reasons a player cannot see and can only route around
  // one way. `EACCESS_VARIANT_KINDS` maps them to one kind on purpose, so
  // demanding two sentences would be demanding a distinction that does not
  // exist. What must differ is what a bug report carries, and that is the
  // detail.
  const fingerprints = screens.map((s) => `${s.heading} ${s.sentence} ${s.detail}`)
  const dupes = fingerprints.filter((f, i) => fingerprints.indexOf(f) !== i)
  ok(
    'no two states render the same screen',
    dupes.length === 0,
    dupes.map((d) => d.slice(0, 40)).join(', ') || `${fingerprints.length} distinct`,
  )
  // And the sentences themselves, counted against the kinds they come from
  // rather than against the codes. This is the check that would catch a *third*
  // code quietly collapsing onto an existing sentence: the number of distinct
  // failure sentences has to equal the number of distinct kinds those codes
  // classify to, derived from the classifier rather than written down here.
  {
    const { classifyLoginError } = await import('../src/lib/lichLogin.ts')
    const kinds = new Set(
      LOGIN_ERROR_FIXTURES.map((f) => classifyLoginError({ code: f.code, message: f.message }).kind),
    )
    const sentences = new Set(FAILURE_STATES.map((s) => safeScreen(s)?.heading ?? s))
    ok('the failure-kind derivation found kinds', kinds.size >= 8, `${kinds.size} kind(s)`)
    ok(
      'one player screen per kind, and no kind sharing another kind\u2019s',
      sentences.size === kinds.size,
      `${sentences.size} heading(s) for ${kinds.size} kind(s)`,
    )
  }

  // Every action a screen offers is one the component actually handles. A
  // button that does nothing is the same defect as a state with no screen,
  // one layer down.
  const offered = [...new Set(screens.flatMap((s) => s.actions.map((a) => a.id)))].sort()
  ok('the action scan found actions', offered.length >= 5, offered.join(', '))
  const undeclared = offered.filter((id) => !SIGN_IN_ACTIONS.includes(id))
  ok('every offered action is in the closed set', undeclared.length === 0, undeclared.join(', ') || `${offered.length} checked`)
  const handlerBlock = signInSrc.slice(
    signInSrc.indexOf('const handlers: Record<string, () => void>'),
    signInSrc.indexOf('const field ='),
  )
  ok('the handler block was found in the component', handlerBlock.length > 100, `${handlerBlock.length} bytes`)
  const unhandled = offered.filter(
    (id) => !new RegExp(`(^|\\s)'?${id}'?:`, 'm').test(handlerBlock),
  )
  ok(
    'every offered action names a handler in SignIn.tsx',
    unhandled.length === 0,
    unhandled.join(', ') || `${offered.length} handled`,
  )
  ok(
    'control: that handler matcher would miss one it was not given',
    !new RegExp(`(^|\\s)'?not-a-real-action'?:`, 'm').test(handlerBlock),
  )
}

// ==========================================================================
// C. Never stranded (#523): every screen has a way onward.
// ==========================================================================
{
  /** The actions that get somebody out of where they are. */
  const WAYS_OUT = ['back', 'cancel', 'retry', 'sign-in', 'attach', 'pick', 'type-password']
  // A state with no screen at all counts as stranded here, not as skipped: an
  // absent screen is the worst version of having nothing to press.
  const stuck = SIGN_IN_STATES.filter((state) => {
    const s = safeScreen(state)
    return !s || !s.actions.some((a) => WAYS_OUT.includes(a.id))
  })
  ok(
    'no state offers only a disclosure and no way onward',
    stuck.length === 0,
    stuck.join(', ') || `${SIGN_IN_STATES.length} checked`,
  )
  // The three answers that were the actual dead ends. `no_port`, `no_lich` and
  // `unknown` each explain why nothing can be pressed, and until this change
  // that explanation was the whole screen.
  for (const kind of ['no_port', 'no_lich', 'unknown']) {
    const s = safeScreen(`running_${kind}`)
    ok(
      `running_${kind} has no attach and still has a way back`,
      Boolean(s) && !s.actions.some((a) => a.id === 'attach') && s.actions.some((a) => a.id === 'back'),
      s ? s.actions.map((a) => a.id).join(', ') : 'no screen at all',
    )
  }
  // And the two link states, which used to render as the success screen they
  // had been a second earlier.
  for (const state of ['dropped', 'gave_up']) {
    const s = safeScreen(state)
    ok(
      `${state} is a screen of its own with an action`,
      Boolean(s) && s.actions.length > 0 && signInSrc.includes(`'${state}'`),
      s ? s.actions.map((a) => a.id).join(', ') : 'no screen at all',
    )
  }
  ok(
    'the component reads the link phase rather than assuming it is up',
    /linkPhase\(link\)/.test(signInSrc) && /phase === 'reconnecting'/.test(signInSrc),
  )
}

// ==========================================================================
// D. Form semantics.
// ==========================================================================
{
  ok('the fields are inside a real form', /<form\b/.test(signInSrc) && /onSubmit=/.test(signInSrc))
  ok(
    'so Enter submits without a keydown handler pretending to be one',
    /type="submit"/.test(signInSrc) && !/e\.key === 'Enter'/.test(signInSrc),
    'no hand-rolled Enter handling left',
  )
  ok('the account field declares autocomplete username', /autoComplete="username"/.test(signInSrc))
  ok(
    'the password field declares autocomplete current-password',
    /autoComplete="current-password"/.test(signInSrc),
  )
  ok(
    'focus lands on the first empty field, or the button when there is none',
    /accountRef\.current\?\.focus/.test(signInSrc) &&
      /passwordRef\.current\?\.focus/.test(signInSrc) &&
      /submitRef\.current\?\.focus/.test(signInSrc),
  )
  // The character list. Buttons in a list: keyboard reachable by construction,
  // Enter picks because that is what a button does, and the remembered one is
  // first because that is what a returning player wants.
  ok('the character list is a list of buttons', /<ul/.test(signInSrc) && /<li key=/.test(signInSrc))
  ok(
    'the last-used character is sorted first',
    /a\.name === rememberedCharacter \? -1/.test(signInSrc),
  )
  ok(
    'and the screen says what picking one does',
    /starts Lich for that character and attaches this app to it/.test(statesSrc),
  )
  // Errors: a sentence, with the technical line behind a disclosure.
  ok(
    'the technical line is behind a disclosure rather than on the panel',
    /Details for a bug report/.test(signInSrc) && /showDetail &&/.test(signInSrc),
  )
  // Progress names the step. A spinner alone is not enough (#458: the attach
  // retry runs to twenty seconds by design).
  for (const [state, words] of [
    ['contacting', 'Signing in to Play.net'],
    ['starting_lich', 'Starting Lich'],
    ['attaching', 'Attaching'],
  ]) {
    ok(`the ${state} step names itself`, safeScreen(state)?.heading.includes(words) === true, safeScreen(state)?.heading ?? 'no screen at all')
  }
  ok(
    'and elapsed time appears once a step runs long',
    /ELAPSED_AFTER_MS/.test(signInSrc) && /Math\.round\(elapsed \/ 1000\)/.test(signInSrc),
  )
}

// ==========================================================================
// E. Remembered by default, and used on the next sign-in.
// ==========================================================================
{
  ok('the default is on', REMEMBER_SIGN_IN_DEFAULT === true, `${REMEMBER_SIGN_IN_DEFAULT}`)
  ok(
    'everything a sign-in produces is enumerated',
    REMEMBERED_FIELDS.length >= 4 &&
      ['account name', 'game', 'character', 'password'].every((n) =>
        REMEMBERED_FIELDS.some((f) => f.name === n),
      ),
    REMEMBERED_FIELDS.map((f) => f.name).join(', '),
  )

  /** A credential store that records what it was asked to do. */
  const backend = () => {
    const calls = []
    const entries = new Map()
    return {
      calls,
      entries,
      async store(a, p) {
        calls.push(['store', a])
        entries.set(a, p)
      },
      async has(a) {
        calls.push(['has', a])
        return entries.has(a)
      },
      async forget(a) {
        calls.push(['forget', a])
        return entries.delete(a)
      },
    }
  }

  // Drive the store: a sign-in with the default, then ask the one resolver what
  // is remembered afterwards.
  {
    localStorageStub.clear()
    const b = backend()
    await rememberAfterSignIn(
      b,
      { account: 'demo', password: 'not-a-real-password-9d4f', gameCode: 'DR', character: 'Phemius' },
      REMEMBER_SIGN_IN_DEFAULT,
    )
    const after = await resolveRemembered(b)
    ok(
      'the next sign-in knows the account, game and character',
      after.account === 'demo' && after.gameCode === 'DR' && after.character === 'Phemius',
      JSON.stringify({ a: after.account, g: after.gameCode, c: after.character }),
    )
    ok('and that a password is stored, without ever reading it', after.hasPassword === true)
    ok(
      'the resolver never returns the password itself',
      !JSON.stringify(after).includes('not-a-real-password-9d4f'),
      Object.keys(after).join(', '),
    )
    ok(
      'and nothing in localStorage carries it either',
      ![...backing.values()].some((v) => String(v).includes('not-a-real-password-9d4f')),
      `${backing.size} key(s)`,
    )
  }

  // The stored path is *taken*, not merely available: the stand-in refuses an
  // empty password unless it has one saved for that account, so a sign-in with
  // no typed password proves which branch ran.
  {
    const saved = await listCharacters({ account: 'saved', password: '', gameCode: 'DR' })
    ok(
      'a remembered account signs in with no password typed',
      saved.characters.length > 0,
      `${saved.characters.length} character(s) back`,
    )
    // The control: the same call for an account with nothing saved must fail,
    // or the check above would pass against a backend that ignores passwords.
    let refused = ''
    try {
      await listCharacters({ account: 'demo', password: '', gameCode: 'DR' })
    } catch (e) {
      refused = typeof e === 'object' && e !== null ? String(e.code) : String(e)
    }
    ok(
      'control: an account with nothing saved is refused for the same call',
      refused === 'password_needed',
      refused || 'it succeeded, so the stored path proves nothing',
    )
  }

  // The number, before and after. Counted by the rule in `actionsToPlay`, which
  // is stated in that function rather than here so it can be re-derived.
  {
    const before = actionsToPlay({ account: true, password: false, character: false })
    const after = actionsToPlay({ account: true, password: true, character: true })
    const cold = actionsToPlay({ account: false, password: false, character: false })
    ok('a returning player used to take four acts to get in', before === 4, `${before}`)
    ok('and now takes one', after === 1, `${after}`)
    ok('a first-time player takes six', cold === 6, `${cold}`)
    ok('the component reports the number it is offering', /data-actions-to-play=/.test(signInSrc))
  }

  // The one press: the picker is skipped only when the remembered character is
  // still on the account.
  {
    ok(
      'the remembered character is launched straight from the list it came back in',
      /result\.characters\.find\(\(c\) => c\.name === rememberedCharacter\)/.test(signInSrc),
    )
    ok(
      'and a character that has gone falls back to the picker rather than a substitute',
      /if \(straightIn\) \{/.test(signInSrc) && /setStage\('picker'\)/.test(signInSrc),
    )
  }

  // Unticking forgets now, not at the next sign-in.
  {
    localStorageStub.clear()
    const b = backend()
    await rememberAfterSignIn(b, { account: 'demo', password: 'p', gameCode: 'DR', character: 'Phemius' }, true)
    ok('control: something was remembered to forget', b.entries.size === 1 && rememberedPrefs().account === 'demo')
    const had = await forgetEverything(b, 'demo')
    ok('forget everything removes the credential entry', had === true && b.entries.size === 0)
    const prefs = rememberedPrefs()
    ok(
      'and the remembered preferences in the same act',
      prefs.account === '' && prefs.gameCode === '' && prefs.character === '' && prefs.remember === false,
      JSON.stringify(prefs),
    )
    ok(
      'the untick path in the component forgets rather than waiting',
      /const changeRemember = \(next: boolean\) => \{[\s\S]{0,400}forgetEverything\(/.test(signInSrc),
      'forgetEverything called from the change handler',
    )
  }
}

// ==========================================================================
// F. One path for a secret, derived rather than promised.
// ==========================================================================
{
  const walk = (dir, ext, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p, ext, out)
      else if (ext.test(entry.name)) out.push(p)
    }
    return out
  }

  const ts = walk('src', /\.tsx?$/)
  ok('the frontend walk reached the source', ts.length >= 50, `${ts.length} files`)
  // The webview's only way to write a secret is this command. Derived by
  // scanning for it rather than by asserting the one module contains it, so a
  // *second* site anywhere is what goes red.
  const sites = ts.filter((f) => /invokeTauri\(\s*'credential_store'/.test(read(f)))
  ok(
    'exactly one frontend file can store a secret',
    sites.length === 1 && sites[0].replace(/\\/g, '/') === 'src/lib/rememberSignIn.ts',
    sites.join(', ') || 'none - the scan is broken, not the tree',
  )
  ok(
    'control: that scan does find the site it is looking for',
    sites.length > 0,
    sites.join(', '),
  )
  // And on the Rust side: the keyring is reached from one module. A second
  // `Entry::new` anywhere else would be a store nobody described.
  const rs = walk(join('src-tauri', 'src'), /\.rs$/)
  ok('the Rust walk reached the crate', rs.length >= 15, `${rs.length} files`)
  const keyringSites = rs.filter((f) => /keyring::/.test(read(f)))
  ok(
    'exactly one Rust module reaches the keyring',
    keyringSites.length === 1 &&
      keyringSites[0].replace(/\\/g, '/') === 'src-tauri/src/credential_store.rs',
    keyringSites.join(', ') || 'none - the scan is broken, not the tree',
  )
  // The other direction, which is the one that finds things: a fourth
  // credential command would be a way out for the password that nobody
  // described. `doc-claims-test.mjs` section K owns the Rust half of this; here
  // it is the webview's surface that is pinned.
  const invoked = [
    ...new Set(
      ts.flatMap((f) => [...read(f).matchAll(/invokeTauri\(\s*'(credential_[a-z_]+)'/g)].map((m) => m[1])),
    ),
  ].sort()
  ok(
    'the webview knows exactly three credential commands',
    invoked.join(',') === 'credential_forget,credential_has,credential_store',
    invoked.join(', ') || 'none',
  )
}

// ==========================================================================
// G. No user-facing string names an internal identifier.
// ==========================================================================
{
  // The population is every word this screen can put in front of a player: the
  // headings, the sentences and the button labels, for every state.
  const strings = SIGN_IN_STATES.flatMap((s) => {
    const screen = safeScreen(s)
    return screen ? [screen.heading, screen.sentence, ...screen.actions.map((a) => a.label)] : []
  })
  ok('the user-facing string scan found strings', strings.length >= 90, `${strings.length} strings`)

  // `snake_case`, Tauri command names, Rust function names and the retired
  // product. `--detachable-client` is deliberately allowed: it is Lich's own
  // command-line flag, which is what the player has to go and look for.
  const ALLOWED = ['--detachable-client', 'Play.net', 'DragonRealms', 'Windows Credential Manager']
  const offenders = []
  for (const s of strings) {
    const scrubbed = ALLOWED.reduce((acc, a) => acc.split(a).join(' '), s)
    for (const m of scrubbed.matchAll(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g)) offenders.push(`${m[0]} in "${s.slice(0, 50)}"`)
    if (/\bgenie\b/i.test(scrubbed)) offenders.push(`Genie in "${s.slice(0, 50)}"`)
    if (/\blich_[a-z_]+|credential_[a-z_]+|game_attach\b/.test(scrubbed)) offenders.push(`command name in "${s.slice(0, 50)}"`)
  }
  ok('no user-facing string names an internal identifier', offenders.length === 0, offenders.slice(0, 4).join('; ') || `${strings.length} checked`)
  // The control, because a matcher that fires on nothing is the same as no
  // matcher: it has to catch one when it is given one.
  ok(
    'control: that matcher catches a snake_case name and a retired product',
    /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test('lich_already_running happened') &&
      /\bgenie\b/i.test('set up Genie first'),
  )
  /*
   * Why this suite keeps a matcher of its own, when an app-wide one now exists.
   *
   * `tools/ui-jargon-test.mjs` landed from another lane (#528, #530) while this
   * branch was being built, and it is the better check: it derives its name set
   * from `generate_handler!` rather than typing one, so a command added tomorrow
   * is covered without anybody remembering. Two matchers for one property is a
   * fork, and this one should be deleted the day the other can see these
   * strings.
   *
   * It cannot see them yet, and that was measured rather than assumed: with
   * `lich_login_characters` planted in a heading in `signInStates.ts`, that
   * suite stayed green (11 checks, 0 failures). Its walk takes `.tsx` files, and
   * the sign-in's words moved into a `.ts` module - which is exactly the way a
   * string escapes a component-shaped scan.
   *
   * So the reason is a check rather than a comment. The day that walk grows to
   * read `.ts` files, this goes red and tells whoever is here to delete the
   * duplicate above.
   */
  ok('the app-wide jargon check exists (control)', readdirSync('tools').includes('ui-jargon-test.mjs'))
  {
    const jargon = read('tools/ui-jargon-test.mjs')
    const tsxOnly = /entry\.name\)\) files\.push/.test(jargon) && /\/\\.tsx\$\/\.test\(entry\.name\)/.test(jargon)
    ok(
      'and still cannot see a .ts module, which is why the check above is not a fork',
      tsxOnly,
      tsxOnly
        ? 'its walk is .tsx only'
        : 'its walk has grown - re-measure, and if it now covers signInStates.ts, DELETE the matcher above',
    )
  }
}

console.log(`\n${checked} checked, ${failed} failed`)
// A floor against a constant, not against the list this run happened to build.
if (checked < 40) {
  console.log('REFUSING TO REPORT A RESULT: too few checks ran for a pass to mean anything.')
  process.exitCode = 2
} else {
  // `process.exitCode`, not `process.exit()` - see the note at the end of
  // `tools/lich-lifetime-test.mjs`, which this branch had to fix for exactly
  // this reason: tearing the loop down on Windows can abort on a libuv
  // assertion *after* every check has printed as passed, and the runner reads
  // the status rather than the output.
  process.exitCode = failed > 0 ? 1 : 0
}
