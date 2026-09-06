/**
 * Break the reconnect on purpose and watch its tests catch it.
 *
 *   node tools/link-reconnect-break-check.mjs
 *
 * A green suite proves nothing on its own: a suite that never ran, a suite
 * whose assertions cannot fail, and a suite that is right print identically.
 * This damages the real files and requires the *named* tests to go red - the
 * named ones only, because a sabotage that reddens more than it should means
 * the checks are entangled and each is saying less than it appears to.
 *
 * # Two subjects, because the feature has two halves
 *
 * The game socket's reconnect is Rust (`src-tauri/src/game_link.rs`, driven by
 * `cargo test --lib game_link`). The bridge's is TypeScript
 * (`src/bridge/realBridge.ts`, driven by `tools/link-reconnect-test.mjs`).
 * They are separate transports that drop independently, so a harness that only
 * sabotaged one would certify half a feature.
 *
 * # What this file is careful about, and why
 *
 * **A green run before anything else.** Each subject must pass unmodified
 * first, or a red result later could be a compile error, a stale target
 * directory, or this harness mangling the file. The number that disappears
 * when the mechanism breaks is "does this still pass when nothing is wrong".
 *
 * **A sabotage that changes nothing must abort, never pass.** If a fragment
 * stops matching - a rename, a reflow, a CRLF/LF mismatch - the file is
 * rewritten identical, the tests pass, and the output reads exactly like proof
 * that the guard worked. Every fragment must be present exactly once before
 * anything is written, and a mismatch is a hard exit.
 *
 * **A sabotage must reach the line it is aimed at.** A compile error, or a
 * suite that fails to import, is not a red test: the assertions were never
 * executed. Both subjects check that their tests *ran* before believing that
 * any of them failed.
 *
 * **Restoration is verified by hash, not by intent.** These edit real tracked
 * files. Leaving one damaged is the only outcome worse than having no negative
 * test at all, so the original bytes are hashed before and compared after, an
 * `exit` hook restores unconditionally, and the Rust file is touched forward a
 * second so cargo cannot serve a stale object.
 */
import { readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const RUST = 'src-tauri/src/game_link.rs'
const TS = 'src/bridge/realBridge.ts'

const subjects = {}
for (const path of [RUST, TS]) {
  const original = readFileSync(path)
  const text = original.toString('utf8')
  subjects[path] = {
    original,
    text,
    hash: createHash('sha256').update(original).digest('hex'),
    NL: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

let failures = 0
let checks = 0
function ok(pass, what, detail = '') {
  checks++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${what}${!pass && detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

function restore(path) {
  writeFileSync(path, subjects[path].original)
  // cargo decides staleness by mtime, and a rewrite within the same
  // filesystem tick can be invisible to it. Push the file forward a second.
  const when = new Date(Date.now() + 1000)
  utimesSync(path, when, when)
}

function restoreAll() {
  for (const p of Object.keys(subjects)) restore(p)
}

process.on('exit', () => {
  for (const [path, s] of Object.entries(subjects)) {
    const now = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (now !== s.hash) {
      // Loud, and not a silent repair: if this line ever prints, nothing above
      // it should be believed either.
      console.log(`FAIL ${path} was left damaged — restoring`)
      restore(path)
      process.exitCode = 1
    }
  }
})

// --------------------------------------------------------------- the runners

/** The Rust half. Returns `{ ran, failed, out }`. */
function runRust() {
  let out
  try {
    out = execFileSync('cargo', ['test', '--lib', 'game_link'], {
      cwd: 'src-tauri',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  // Counting test lines rather than grepping for "error": cargo prints
  // `error: test failed, to rerun pass --lib` on an ordinary red run, so a
  // grep would report every successful sabotage as a build failure. The number
  // that disappears when the damage does not compile is the count of test
  // lines, so that is what is counted.
  const failed = [...out.matchAll(/^test game_link::tests::(\w+) \.\.\. FAILED$/gm)].map(
    (m) => m[1]
  )
  const ran = [...out.matchAll(/^test game_link::tests::(\w+) \.\.\./gm)].length
  return { ran, failed, out }
}

/**
 * The TypeScript half.
 *
 * The suite prints one `OK`/`FAIL` line per check and a summary, so the failed
 * *checks* are the unit here rather than test function names. A run that
 * cannot import at all produces neither, which is why `ran` is counted
 * separately: an import failure is not a caught sabotage.
 */
function runNode() {
  let out
  try {
    out = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--experimental-test-module-mocks',
        'tools/link-reconnect-test.mjs',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  const failed = [...out.matchAll(/^FAIL (.+)$/gm)].map((m) => m[1])
  const ran = [...out.matchAll(/^(?:OK {3}|FAIL )/gm)].length
  return { ran, failed, out }
}

/* ------------------------------------------------------------------ cases */

/**
 * Each case names its subject, the splice, why it matters, and the exact set
 * of checks that must go red.
 *
 * Exact rather than "at least one". A sabotage that reddens something it has
 * no business touching is telling you the checks share an assumption, which is
 * worth knowing before trusting either of them.
 *
 * The Rust expectations are test function names. The TypeScript ones are the
 * suite's own check labels, matched as a prefix, because several carry a
 * measured value in their text.
 */
const CASES = [
  {
    name: 'the attempt bound is removed',
    subject: RUST,
    why:
      'the reconnect dials forever, so a Lich that has genuinely gone and one ' +
      'mid-restart produce the same permanent spinner and the app can never ' +
      'say it has stopped — which is the whole of issue #479',
    from: '    for attempt in 1..=max_attempts {',
    to: '    for attempt in 1..=u32::MAX {',
    expect: ['an_exhausted_run_gives_up_naming_the_attempt_count'],
  },
  {
    name: 'the lane queues into a dead socket',
    subject: RUST,
    why:
      'a command sent while the link is down is accepted and sits in the queue ' +
      'looking sent, then either fails silently much later or goes out into a ' +
      'session that has moved on — an absent result that reads as success',
    from:
      '    let h = guard.as_ref().ok_or("Not attached to a game.")?;\n' +
      '    if !h.running.load(Ordering::Relaxed) {\n' +
      '        return Err(closed_reason(h));\n' +
      '    }\n' +
      '    Ok(())',
    // `drop(guard)` and not `let _ = guard`, which is a compile error here:
    // `let_underscore_lock` is deny-by-default and drops a MutexGuard
    // immediately. Caught on this file's first run - the damage never reached
    // the tests, and the "still compiles" check is what said so rather than
    // the run reading as a sabotage nothing caught.
    to: '    drop(guard);\n    Ok(())',
    expect: [
      'a_send_during_a_reconnect_is_refused_naming_the_attempt',
      'a_closed_link_that_is_not_reconnecting_keeps_the_old_words',
    ],
  },
  {
    name: 'the refusal stops naming the reconnect',
    subject: RUST,
    why:
      'a held command reads as "not attached", which sends a player to press ' +
      'Attach — the one thing that cannot work while a dial is already running',
    from: '    let attempt = h.reconnecting.load(Ordering::Relaxed);\n    if attempt > 0 {',
    to: '    let attempt = h.reconnecting.load(Ordering::Relaxed);\n    if false && attempt > 0 {',
    expect: ['a_send_during_a_reconnect_is_refused_naming_the_attempt'],
  },
  {
    name: 'the backoff stops backing off',
    subject: RUST,
    why:
      'every retry fires at the base delay, so six attempts are spent inside ' +
      'three seconds and a Lich restart is never waited out',
    from: '    let scaled = base.saturating_mul(1u32.checked_shl(shift).unwrap_or(u32::MAX));',
    to: '    let scaled = base;',
    expect: [
      'the_backoff_doubles_and_then_stops_at_the_cap',
      'a_link_that_comes_back_is_reconnected_to_on_the_scheduled_attempt',
    ],
  },
  {
    name: 'a live link can also read as reconnecting',
    subject: RUST,
    why:
      'connected and reconnecting stop being exclusive, so a stale counter puts ' +
      'a reconnect badge over a pane full of live text and every consumer has ' +
      'to decide for itself which of the two wins',
    // Anchored on the comment above it. The bare line is a substring of the
    // identically-shaped, more deeply indented one inside `start_reconnect`'s
    // emit closure, so it matched twice - caught by the exactly-once guard
    // below on this file's first run, which is that guard doing precisely the
    // job it exists for.
    from:
      '                // consumer does not have to decide which wins.\n' +
      '                reconnecting: !connected && attempt > 0,',
    to:
      '                // consumer does not have to decide which wins.\n' +
      '                reconnecting: attempt > 0,',
    expect: ['the_link_reports_exactly_one_of_connected_reconnecting_or_down'],
  },
  {
    name: "the bridge's give-up branch is removed",
    subject: TS,
    why:
      'the bridge retries forever again: there is no state in which it can say ' +
      'it stopped, and SafetyFooter\'s "Bridge gave up" badge becomes dead code',
    from: 'if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {',
    to: 'if (false) {',
    // Measured, not predicted. The first draft also expected 'a deliberate
    // reconnect opens a socket' and 'and can connect again' to redden, and
    // they do not: with the give-up gone the run leaves the loop by this
    // file's own guard rather than by the bound, and a later connect still
    // opens a socket that still accepts. Those two say nothing about the
    // bound, which is exactly what an exact expected set is for finding out.
    expect: [
      'the bridge is still dialling after',
      'the reconnect run is bounded and stops',
      'it spent exactly the bound, no more and no fewer',
      'it gives up once, not on every later close',
      'the give-up reason names the attempt count',
      'the give-up reason names what it gave up on',
      'every retry published a reconnecting state',
      'each reconnecting state names its own attempt and the bound',
      'the run gave up, so there is something to retry from',
      'and starts from a fresh budget rather than at the bound',
    ],
  },
  {
    name: 'the bridge reports a reconnect as a plain disconnect',
    subject: TS,
    why:
      'the state that says "wait, it is coming back" is gone, and a reconnect ' +
      'is indistinguishable from a bridge nobody started — which is exactly ' +
      'the two-state reporting this lane replaced',
    from: "        this.setStatus(\n          'reconnecting',",
    to: "        this.setStatus(\n          'disconnected',",
    expect: [
      'every retry published a reconnecting state',
      'each reconnecting state names its own attempt and the bound',
      'a reconnect is never reported as a plain disconnect',
    ],
  },
  {
    name: "the bridge stops asking for a status on reopen",
    subject: TS,
    why:
      'the half of the state Lich will not replay — room, occupants, scripts, ' +
      'roundtime — is never re-fetched, so every panel fed by it goes on ' +
      'showing the session before the drop as current',
    from: "        this.send({ type: 'get_status' })",
    to: '        // sabotage: no status request',
    expect: [
      'a fresh status is requested on every open, which is the bridge half of the replay',
    ],
  },
]

/* ------------------------------------------------------------------ run it */

const RUNNERS = { [RUST]: runRust, [TS]: runNode }
// Floors on what a green baseline must actually have executed. Well below the
// real counts, so they never need touching and still catch a subject that
// silently ran nothing.
const FLOORS = { [RUST]: 15, [TS]: 40 }

console.log('== both subjects are green before any damage ==')
for (const path of [RUST, TS]) {
  const first = RUNNERS[path]()
  ok(first.ran >= FLOORS[path], `${path}: its tests ran (${first.ran}, floor ${FLOORS[path]})`)
  ok(first.failed.length === 0, `${path}: and every one passes`, first.failed.join(' | '))
}
if (failures) {
  console.log('\nnothing below this line would mean anything; stopping.')
  restoreAll()
  process.exit(1)
}

for (const c of CASES) {
  const s = subjects[c.subject]
  console.log(`\n-- sabotage: ${c.name} (${c.subject}) --`)
  console.log(`   ${c.why}`)

  // Fragments are written with `\n` and matched against the file's own line
  // ending. This tree checks out CRLF, and a fragment joined with `\n` would
  // match nothing and fail in the silent direction this whole file exists to
  // prevent.
  const from = c.from.split('\n').join(s.NL)
  const to = c.to.split('\n').join(s.NL)

  const hits = s.text.split(from).length - 1
  if (hits !== 1) {
    // A hard abort, not a failed check the run could shrug off. A fragment
    // matching zero times rewrites the file unchanged, the tests pass, and the
    // output reads exactly like the sabotage being caught.
    console.log(`FAIL fragment matched ${hits} times, expected exactly 1: ${from.slice(0, 70)}`)
    console.log('the sabotage could not be applied, so this run proved nothing')
    restoreAll()
    process.exit(1)
  }

  const damaged = s.text.replace(from, to)
  if (damaged === s.text) {
    console.log('FAIL the splice changed nothing')
    restoreAll()
    process.exit(1)
  }
  writeFileSync(c.subject, damaged, 'utf8')
  const when = new Date(Date.now() + 1000)
  utimesSync(c.subject, when, when)

  const r = RUNNERS[c.subject]()
  restore(c.subject)

  ok(
    r.ran >= FLOORS[c.subject],
    `${c.name}: the tests still ran (${r.ran}), so the damage reached them`,
    r.out.slice(-500)
  )

  // The Rust half compares test names exactly. The TypeScript half compares
  // the set of *prefixes* that matched, because several of its check labels
  // carry a measured value in their text.
  const got =
    c.subject === RUST
      ? [...r.failed].sort()
      : [...new Set(c.expect.filter((p) => r.failed.some((f) => f.startsWith(p))))].sort()
  const want = [...c.expect].sort()
  const extra =
    c.subject === RUST
      ? []
      : r.failed.filter((f) => !c.expect.some((p) => f.startsWith(p)))

  ok(
    got.join(' | ') === want.join(' | '),
    `${c.name}: exactly the expected checks go red`,
    `got [${got.join(' | ')}] want [${want.join(' | ')}]`
  )
  ok(extra.length === 0, `${c.name}: and nothing it has no business touching`, extra.join(' | '))
}

console.log('\n== and both files are byte-identical to how they were found ==')
for (const [path, s] of Object.entries(subjects)) {
  const now = createHash('sha256').update(readFileSync(path)).digest('hex')
  ok(now === s.hash, `${path} restored (sha256 ${now.slice(0, 12)})`)
}
for (const path of [RUST, TS]) {
  const after = RUNNERS[path]()
  ok(
    after.ran >= FLOORS[path] && after.failed.length === 0,
    `${path}: and its tests are green again`,
    after.failed.join(' | ')
  )
}

console.log(`\n${failures ? 'FAILURES' : 'all passed'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
