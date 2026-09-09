#!/usr/bin/env node
/**
 * The Lich card says a thing a player can do, in every state it has.
 *
 * # What this is defending
 *
 * On 9 September 2026 Dan opened the app to sign in and the card read:
 *
 *   LICH
 *   Ready to start.
 *   [> Phemius]
 *   ...
 *   Signing a character in is `lich_login_launch` now, not `launch_lich`:
 *   Lich's saved-entry route needed Genie to create the entry, and the app
 *   performs the account login itself.
 *
 * Two defects in one card. The red sentence was a developer's migration note
 * rendered to a player - `launch_lich`'s `Err` string, which the panel prints
 * verbatim. And the button above it was dead: it invoked `launch_lich` with a
 * character name, which that command refused unconditionally, so every press
 * produced the note. One of the two had to be wrong and both were.
 *
 * `tools/ui-jargon-test.mjs` owns the class (no rendered string names an
 * internal). This file owns the instance: the card's states, and the fact that
 * its start control points somewhere real or is not there.
 *
 * # Properties, not mechanism
 *
 *   1. every state the card can be in says something a player can act on;
 *   2. no control offers to start a *named character* - signing in is
 *      `SignIn.tsx`'s job and a second entry point beside it is a fork;
 *   3. the one remaining start control invokes `launch_lich` with no
 *      arguments, which is the whole of what that command does now;
 *   4. the password sentence is the one `docs/PRIVACY.md` states, unbranched.
 *
 * # The denominator
 *
 * The state list is derived from the source - every `status.<field>` the
 * render body branches on - and compared against the states asserted here.
 * A branch added without a sentence fails, and so does a sentence asserted
 * for a branch that no longer exists. Counting only the sentences would stay
 * green over a state nobody wrote one for, which is the state a player would
 * be sitting in.
 */
import { readFileSync } from 'node:fs'

let failed = 0
let checks = 0
const ok = (name, cond, detail = '') => {
  checks++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(64)}  ${detail}`)
}

const FILE = process.env.DRC_LICH_CARD_FILE ?? 'src/components/shared/LichLauncher.tsx'
const src = readFileSync(FILE, 'utf8')
ok('the card source was read', src.length > 2000, `${src.length} bytes`)

/**
 * The render body: everything after the last hook, so the doc comment at the
 * top of the file (which is allowed to discuss anything, including states
 * that no longer exist) cannot contribute a branch.
 */
const bodyAt = src.indexOf('  if (!isTauri()) return null')
ok(
  'the render body was located',
  bodyAt > 0,
  bodyAt > 0 ? `at byte ${bodyAt}` : 'ABORT: the guard clause moved; every count below would be wrong',
)
if (bodyAt < 0) process.exit(1)
const body = src.slice(bodyAt)

/** Every status field the render body branches on, derived rather than typed. */
const branched = [...new Set([...body.matchAll(/status\.([A-Za-z]+)/g)].map((m) => m[1]))].sort()
ok('the branch extractor found fields', branched.length >= 3, branched.join(', '))

/**
 * One entry per state a player can land in. `on` is the derived field the
 * state is selected by; `says` is a fragment of the sentence that state must
 * render.
 */
const STATES = [
  {
    name: 'Lich is not installed',
    on: 'launcher',
    says: 'Connection help below walks through installing it.',
  },
  {
    name: 'Ruby is not installed',
    on: 'ruby',
    says: 'Connection help below walks through installing it.',
  },
  {
    name: 'Lich is running',
    on: 'running',
    says: 'Nothing to do here.',
  },
  {
    name: 'Lich is not running',
    on: 'note',
    says: 'Sign in above to start Lich for a character.',
  },
  {
    name: "Lich's own login window can complete",
    on: 'guiLoginUsable',
    says: "Open Lich's own window",
  },
]

// N of N, both directions. A field branched on with no state written for it is
// a player sitting in an unlabelled state; a state asserted for a field that
// has gone is a test defending nothing.
const asserted = [...new Set(STATES.map((s) => s.on))].sort()
ok(
  'every branched field has a state asserted for it',
  branched.every((f) => asserted.includes(f)),
  `derived [${branched}] vs asserted [${asserted}]`,
)
ok(
  'every asserted state names a field the source branches on',
  asserted.every((f) => branched.includes(f)),
  `${asserted.length} of ${branched.length}`,
)

for (const s of STATES) {
  ok(`state: ${s.name} says something to do`, body.includes(s.says), JSON.stringify(s.says))
}

// 2. No control starts a named character.
{
  // The dead control's shape, not a string it happened to contain: a button
  // whose click handler carries a character. Matching on the argument is what
  // catches it coming back under another label.
  const namedStart = /start\(\s*[A-Za-z_$][\w$]*\s*\)/.test(body)
  ok('no control starts a named character', !namedStart)
  ok(
    'the card does not map over a character list',
    !/status\.characters/.test(src),
    'status.characters is gone from the Rust side too',
  )
}

// 3. The one start control's target.
{
  const invokes = [...src.matchAll(/invokeTauri\(\s*'([a-z_]+)'([^)]*)\)/g)].map((m) => ({
    cmd: m[1],
    args: m[2].trim(),
  }))
  ok('the invoke extractor found calls', invokes.length >= 2, invokes.map((i) => i.cmd).join(', '))
  const launches = invokes.filter((i) => i.cmd === 'launch_lich')
  ok('the card invokes launch_lich exactly once', launches.length === 1, `${launches.length} call(s)`)
  ok(
    'it passes no arguments, because the command takes none',
    launches.length === 1 && launches[0].args === '',
    JSON.stringify(launches[0]?.args ?? '(no call)'),
  )
  // The live sign-in path is not this file's to invoke - it belongs to
  // SignIn.tsx. Asserted so a second sign-in route cannot grow back here.
  ok(
    'the card does not invoke the sign-in path itself',
    !invokes.some((i) => i.cmd === 'lich_login_launch'),
  )
}

// 4. The password sentence, unbranched.
{
  const CLAIM = 'held only in memory, and not stored unless you later ask for it'
  const flat = src.replace(/\s+/g, ' ')
  ok('the password sentence is present', flat.includes(CLAIM))
  ok(
    'and it is not one arm of a conditional',
    !/guiLoginUsable[\s\S]{0,80}Your password/.test(flat),
    'a second variant is how the retired promise came back last time',
  )
}

// 5. The screenshot harness quotes the notes Rust builds, because a browser
//    cannot call Rust. A copy that drifts photographs a card nobody ships.
{
  // Both sources: `lich_status` builds the card's own note (`lich.rs`) and
  // `lich_health` builds the diagnostics note (`lich_health.rs`). Reading one
  // and not the other would report a correct copy as drifted.
  const rust =
    readFileSync('src-tauri/src/lich.rs', 'utf8') +
    readFileSync('src-tauri/src/lich_health.rs', 'utf8')
  const harness = readFileSync('tools/lich-card-harness/states.ts', 'utf8')
  const quoted = [...harness.matchAll(/note: '([^']+)'/g)].map((m) => m[1])
  const constNotes = [...harness.matchAll(/^const [A-Z_]+ = '([^']+)'$/gm)].map((m) => m[1])
  const notes = [...new Set([...quoted, ...constNotes])].filter((n) => n.startsWith('Lich'))
  ok('the harness note extractor found notes', notes.length >= 4, `${notes.length} note(s)`)
  const missing = notes.filter((n) => !rust.includes(n))
  ok(
    'every note the harness renders is one lich.rs actually builds',
    missing.length === 0,
    missing.map((n) => JSON.stringify(n)).join('; '),
  )
}

// Controls. Without them a green run may be a file that failed to load.
{
  const planted = body.replace(
    'Sign in above to start Lich for a character.',
    'Something else entirely.',
  )
  ok(
    'positive control: a missing sentence is caught',
    planted !== body && !planted.includes('Sign in above to start Lich for a character.'),
  )
  ok(
    'positive control: a named-character start would be caught',
    /start\(\s*[A-Za-z_$][\w$]*\s*\)/.test('onClick={() => void start(c)}'),
  )
  ok(
    'negative control: the argument-less call is not read as a named start',
    !/start\(\s*[A-Za-z_$][\w$]*\s*\)/.test('onClick={() => void start()}'),
  )
}

console.log(`\n${checks} checks, ${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
