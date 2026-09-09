/**
 * What happens to Lich when the app closes, from the webview's side. Issue #488 §3.
 *
 * # The two things this holds
 *
 * **The prompt is offered for exactly one situation.** A Lich this app started
 * that is still running. Not a Lich the player started themselves - this app
 * has never had a handle on that one and must not offer to end it - and not one
 * that has already exited, which would be asking about a process that is not
 * there. `shouldPromptOnClose` is the whole decision and it is driven here over
 * every combination of the payload, rather than left to a component nothing in
 * this repository can render.
 *
 * **The two answers reach the two commands.** "Leave it running" is
 * `lich_release` and "Stop Lich" is `lich_stop`, and both close the window
 * afterwards - including when the command itself fails, because a window that
 * will not shut is a worse outcome than a Lich that outlived the app, which is
 * the state the whole design tolerates by default. Driven with a stub `invoke`
 * so the calls are observed rather than assumed.
 *
 * # What it cannot do, said rather than dressed up
 *
 * There is no DOM here, so nothing renders `LichClosePrompt.tsx`. The strong
 * half is `lichLifetime.ts`, which is pure; the component is checked by reading
 * its source, which is weaker and is only there so the decisions above cannot
 * be right while the component quietly renders something else. The Rust half -
 * that `stop` really ends the process and `release` really does not - is
 * `cargo test`'s, in `lich.rs`, against a loopback stand-in.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n')

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) pass += 1
  else fail += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(62)}${detail}`)
}

// ---------------------------------------------------------------------------
// A Tauri stand-in, installed before the module under test is imported.
//
// `invokeTauri` returns undefined outside the app, so without this every call
// below would be a no-op and every assertion about "which command was sent"
// would be vacuously... unmet, actually - which is the good failure. The stub
// is here so the calls can be *observed*, not so they can appear to happen.
// ---------------------------------------------------------------------------
const calls = []
let failNext = null
globalThis.window = globalThis.window ?? {}
globalThis.window.__TAURI_INTERNALS__ = {
  invoke: async (cmd) => {
    calls.push(cmd)
    if (failNext === cmd) throw new Error(`stubbed failure of ${cmd}`)
    if (cmd === 'lich_stop') return 'killed'
    if (cmd === 'lich_release') return true
    return undefined
  },
  transformCallback: (cb) => cb,
}

const {
  shouldPromptOnClose,
  stopLichAndClose,
  leaveLichRunningAndClose,
} = await import('../src/lib/lichLifetime.ts')

// ---------------------------------------------------------------------------
// 1. When the prompt appears, over every shape of the payload.
// ---------------------------------------------------------------------------

const CASES = [
  // [ours, running, expected, why]
  [true, true, true, 'a Lich this app started, still running'],
  [true, false, false, 'ours, but it has already exited'],
  [false, true, false, 'running, but the player started it - not ours to end'],
  [false, false, false, 'neither'],
]
let prompted = 0
for (const [ours, running, expected, why] of CASES) {
  const got = shouldPromptOnClose({ ours, running, exit_code: null })
  if (got === expected) prompted += 1
  ok(`prompt ${expected ? 'shown' : 'not shown'}: ${why}`, got === expected, `${got}`)
}
ok('every payload shape was decided', prompted === CASES.length, `${prompted} of ${CASES.length}`)

// Rust not having asked at all is its own case, and it is the one a `?.` would
// have turned into a crash on the way out of the app.
ok('no question asked means no prompt', shouldPromptOnClose(null) === false)

// The control that makes the four above mean something: a decision function
// that always said true would pass three of them and this one would still be
// false. Stated as the count of `true` answers, which is one and only one.
ok(
  'exactly one of the four shapes prompts',
  CASES.filter(([o, r]) => shouldPromptOnClose({ ours: o, running: r, exit_code: null })).length ===
    1,
)

// ---------------------------------------------------------------------------
// 2. The two answers reach the two commands, and both close the window.
// ---------------------------------------------------------------------------

calls.length = 0
const stopped = await stopLichAndClose()
ok('"Stop Lich" sends lich_stop', calls.includes('lich_stop'), calls.join(', '))
ok('and does not release instead', !calls.includes('lich_release'))
ok('and then closes the window', calls.includes('close_main_window'))
ok('and reports what the stop did', stopped === 'killed', String(stopped))

calls.length = 0
const released = await leaveLichRunningAndClose()
ok('"Leave it running" sends lich_release', calls.includes('lich_release'), calls.join(', '))
ok(
  'and never stops the Lich - this is the answer that must not end a session',
  !calls.includes('lich_stop'),
)
ok('and then closes the window', calls.includes('close_main_window'))
ok('and says there was a handle to release', released === true)

// The failure path, which is the one nobody writes and the one that traps a
// player in a window that will not shut.
calls.length = 0
failNext = 'lich_stop'
await stopLichAndClose()
ok('a failing lich_stop still closes the window', calls.includes('close_main_window'))
calls.length = 0
failNext = 'lich_release'
await leaveLichRunningAndClose()
ok('a failing lich_release still closes the window', calls.includes('close_main_window'))
failNext = null

// ---------------------------------------------------------------------------
// 3. The Rust side owns the lifetime, and says so where it is decided.
//
// Source checks, and weaker than the behaviour above - `cargo test` is what
// proves `stop` kills and `release` does not. These exist so the exit path
// cannot quietly acquire a kill: #488 §3's actual warning was that a future
// tidy-up "making the two consistent" with the viewer would log a player out,
// and nothing in the tree would have objected.
// ---------------------------------------------------------------------------

const libRs = read('src-tauri/src/lib.rs')
const exitBlock = /RunEvent::Exit\)\s*\{([\s\S]*?)\n            \}/.exec(libRs)?.[1] ?? ''
ok('the exit handler was found in lib.rs', exitBlock.includes('close_viewer'), `${exitBlock.length} chars`)
ok(
  'nothing on the app-exit path ends Lich',
  exitBlock.length > 0 && !/lich/i.test(exitBlock),
  exitBlock.replace(/\s+/g, ' ').trim().slice(0, 60),
)
ok(
  'and the viewer is still killed there, so this is a contrast and not an empty handler',
  /close_viewer/.test(exitBlock),
)
ok(
  'the close prompt is raised from CloseRequested and holds the window',
  /CloseRequested/.test(libRs) && /prevent_close\(\)/.test(libRs) && /lich-close-prompt/.test(libRs),
)
ok(
  'and it is raised only for a running Lich this app started',
  /if owned\.ours && owned\.running \{/.test(libRs),
)

const lichRs = read('src-tauri/src/lich.rs')
ok(
  'the Rust lifetime is written down where the handle lives',
  /pub struct LichProcess/.test(lichRs) && /Lich outlives the app/.test(lichRs),
)
ok(
  'stop kills by the handle, never by image name',
  /child\.kill\(\)/.test(lichRs) && !/taskkill.*rubyw/i.test(lichRs),
)

const prompt = read('src/components/shared/LichClosePrompt.tsx')
ok(
  'source: the component renders nothing unless shouldPromptOnClose says so',
  /if \(!shouldPromptOnClose\(owned\)\) return null/.test(prompt),
)
ok(
  'source: its two buttons are the two answers and nothing else',
  /leaveLichRunningAndClose/.test(prompt) && /stopLichAndClose/.test(prompt),
)
// The markup only. Both phrases appear in the doc comment at the top of that
// file, in the opposite order, so searching the whole source would have made
// this check answer a question about prose.
const promptMarkup = prompt.slice(prompt.indexOf('return ('))
ok(
  'source: "Leave it running" is offered first and is the focused default',
  promptMarkup.indexOf('Leave it running') > 0 &&
    promptMarkup.indexOf('Leave it running') < promptMarkup.indexOf('Stop Lich') &&
    /autoFocus[\s\S]{0,400}Leave it running/.test(promptMarkup),
)

// ---------------------------------------------------------------------------
// 4. "Already running" offers Attach, and offers it first.
// ---------------------------------------------------------------------------

const { LOGIN_ERROR_SENTENCES, CODE_KINDS } = await import('../src/lib/lichLogin.ts')
ok(
  'lich_already_running is its own kind, not lich_did_not_start',
  CODE_KINDS['lich_already_running'] === 'lich_already_running' &&
    CODE_KINDS['lich_already_running'] !== CODE_KINDS['lich_did_not_start'],
  String(CODE_KINDS['lich_already_running']),
)
const sentence = LOGIN_ERROR_SENTENCES['lich_already_running'] ?? ''
ok('and its sentence tells the player to attach', /attach/i.test(sentence), sentence)
ok(
  'and does not send them to the diagnostic',
  !/why won't it start/i.test(sentence) && !/why won.t it start/i.test(sentence),
)

const signIn = read('src/components/shared/SignIn.tsx')
ok(
  'source: the sign-in screen offers the attach for that kind alone',
  /kind === 'lich_already_running'/.test(signIn) && /alreadyRunning && \(/.test(signIn),
)
ok(
  'source: and the offer is a real attach, not another sign-in',
  // The name is the property; the body used to be the mechanism, and the
  // mechanism it asserted - `attachGame(Number(DEFAULT_ATTACH_PORT))` - is
  // precisely what #504 found wrong. Dialling the constant on a `tasklist`
  // image-name match could join another account's character with nothing on
  // screen saying so. So this now asks what its own name asks: does pressing
  // the button attach, at a port that was read rather than assumed.
  //
  // Either call name, for the same reason: `attachGame` became the store's
  // `connectToGame`, which leaves the demo first so an attach cannot land
  // beside invented text (#525). Same port, same act, one more guarantee.
  /(?:attachGame|connectToGame)\(advice\.port\)/.test(signIn) && /lichAttachOffer\(/.test(signIn),
)
ok(
  'source: the port is the one shared constant, not a retyped number',
  !/1102[0-9]/.test(signIn),
)
ok(
  'source: and no attach is offered before the offer has been read',
  // The three answers that must not produce a button are decided in
  // `attachAdvice`; what this holds is that SignIn renders the button from
  // that decision rather than from `alreadyRunning` alone, which is the
  // shape the old screen had.
  /attachAdvice\(offer\)\.action && \(/.test(signIn),
)

// ---------------------------------------------------------------------------

console.log(`\n${pass} checks passed, ${fail} failed`)

// The denominator, derived rather than typed: a throw halfway down otherwise
// looks exactly like a clean pass. One `ok(` site is in a loop over CASES.
const self = readFileSync(new URL(import.meta.url), 'utf8')
const declared = [...self.matchAll(/^ {0,2}ok\(/gm)].length
const LOOP_SITES = 1
const expected = declared - LOOP_SITES + CASES.length
const ran = pass + fail

/*
 * `process.exitCode`, not `process.exit()`.
 *
 * Both endings said the same thing and one of them could not be trusted to say
 * it. `process.exit()` tears the loop down where it stands, and on Windows this
 * file reached that call with a handle already closing, which aborts the
 * process on a libuv assertion - `!(handle->flags & UV_HANDLE_CLOSING)`,
 * src\winsync.c:94 - *after* all 34 checks have printed as passed. The
 * runner reads the exit status, so a suite that had passed reported
 * `FAILED 34 checks (exit 3221226505)`.
 *
 * Measured on 9 Sep 2026, because a flake that is only sometimes there is a
 * flake nobody fixes: 0 of 8 runs failed on `origin/main`, 8 of 8 on a branch
 * whose only relevant change was that `lichLogin.ts` stopped importing
 * `persistence.ts`. Nothing about that import runs code - it has no top-level
 * side effects - so the module graph's shape is what moved the race, and the
 * next change to any module this file imports could move it back. Reinstating a
 * dead import to keep the timing lucky would have been the fix that leaves the
 * trap in place for whoever touches it next.
 *
 * Setting the code and letting Node exit on its own is the same contract with
 * no teardown to lose: the status is identical in all three cases, and the
 * process ends once the loop is genuinely empty.
 */
if (ran < expected) {
  console.log(`FAIL only ${ran} of an expected ${expected} assertions ran - the rest never executed`)
  process.exitCode = 1
} else {
  console.log(`   ${ran} assertions ran (expected at least ${expected})`)
  process.exitCode = fail === 0 ? 0 : 1
}
