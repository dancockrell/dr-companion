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
import { sep } from 'node:path'

const RUST = 'src-tauri/src/game_link.rs'
const TS = 'src/bridge/realBridge.ts'
/**
 * Two more subjects, added with issues #501 and #506.
 *
 * The command bar because its defect was invisible to every existing test:
 * each file passed about itself while two of them disagreed about one socket,
 * and the only thing that could have caught it is a check over the whole
 * consumer set. A census can fail silently in the direction that reads as
 * clean - a broken matcher and a clean tree both print zero - so it needs a
 * violation put back on purpose.
 *
 * The stale mark because "the numbers on screen are current" is a claim the
 * app makes by saying nothing, and a guard against an unspoken claim is
 * exactly the kind that can quietly stop working.
 */
const BAR = 'src/components/game/GameCommandBar.tsx'
const STALE = 'src/store/staleMark.ts'
/**
 * And the footer, added with issue #532.
 *
 * The bridge's half of the same defect the command bar had: a component
 * holding its own reading of a transport status. Its census can fail in the
 * direction that reads as clean, so the violation goes back on purpose - and
 * the violation is the literal expression that was shipped.
 */
const FOOTER = 'src/components/layout/SafetyFooter.tsx'

const subjects = {}
for (const path of [RUST, TS, BAR, STALE, FOOTER]) {
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
 * The census prints the paths it walked, and those carry the platform's
 * separator. Hardcoding a forward slash would make the command-bar case pass
 * on CI and fail here, or worse, match nothing and look like the sabotage was
 * caught by something else.
 */
const SEP = sep

/**
 * Measured, not predicted.
 *
 * Both of these lists were produced by applying the sabotage and reading which
 * checks actually went red, then pasted back. Guessing them is how a case ends
 * up expecting a check that never had anything to do with it - which reads as
 * an entanglement bug in a suite that is fine, or hides a real one.
 */
const STALE_NEVER_SET = [
  'an unexpected drop marks the data, with the time it stopped arriving',
  'and the mark reads as stale',
  "a bridge in 'reconnecting' is not feeding, so the numbers are marked",
  "a bridge in 'gave-up' is not feeding, so the numbers are marked",
  "a bridge in 'error' is not feeding, so the numbers are marked",
  "a bridge in 'disconnected' is not feeding, so the numbers are marked",
  "a bridge in 'connecting' is not feeding, so the numbers are marked",
  'a later attempt does not reset the age: the mark is when the data stopped',
  'an unexpected drop marks the store',
  // These two are downstream of the same damage and are listed because the
  // first run of this case found them and the predicted list did not. With no
  // mark ever set there is nothing for a second status to preserve and nothing
  // for a reconnect to leave alone, so both of the "does not change" checks
  // have nothing to hold on to.
  'a second status does not restart the age',
  'and the socket returning does not clear it either',
]

const STALE_CLEARED_TOO_EARLY = [
  'the socket coming back does not clear the mark on its own',
  'so ten seconds into the replay window the reading is still marked, and its real age is shown',
  'and the words say how old, not merely that something is wrong',
  'and the socket returning does not clear it either',
]

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
      /*
       * Added with issue #532, and measured the same way the rest were.
       *
       * These are the never-connected suite's own view of the same damage: an
       * expected Lich also never stops, its chip counts past its own bound
       * (33/8 was the reading), and the end state stays amber instead of going
       * red. A grown list here is the honest outcome of adding checks over the
       * same mechanism, and leaving it short would have made this case's
       * "nothing it has no business touching" fail forever.
       */
      'the expected-Lich run is still dialling after',
      'an expected Lich gets exactly the bound, then stops',
      'and the number the UI reads agrees with the number of dials that happened',
      'and the end state says it gave up',
      'a give-up with no prior connection still reads as a give-up',
      'the expected-Lich run gives up exactly once',
      'the chip counts 1/8 up to 8/8',
      'and then it stops, in a state that says so',
      'which is the one bridge state that earns a red chip',
      'nothing is left scheduled once it has given up',
      'and no further socket is opened',
    ],
  },
  {
    name: 'the ladder runs before there has ever been anything to connect to',
    subject: TS,
    why:
      'this is issue #532 itself. With the probe arm gone, the first failed ' +
      'dial of the session schedules a retry, so the app spends eight ' +
      'attempts over two minutes on a port that has never answered and cannot ' +
      '— there is no Lich before somebody signs in — and the footer calls the ' +
      'whole run a reconnect of a connection that never existed',
    from: "        if (this.intent === 'probe' && !this.everConnected) {",
    to: '        if (false) {',
    /*
     * Measured, not predicted, per this file's own rule. Twelve checks, and
     * the shape of the list is the point: the damage is one branch and it
     * reaches the transport's state, the chip's phase, the chip's words, the
     * schedule, and the detach case. That is what a defect with a wide blast
     * radius looks like from the test side, and it is why the old build could
     * be wrong in so many ways at once from one missing arm.
     */
    expect: [
      'a probe that finds nothing stops, quietly',
      'and the chip says exactly that',
      'the not-connected chip is in plain words',
      'a connection that never existed is never reported as reconnecting',
      'and no retry is scheduled: there is no ladder before there is a Lich',
      'there were no timers to fire',
      'and running the clock out opens nothing',
      'the state after the clock runs out is unchanged',
      'the quiet stop names what it looked at',
      'and what to do about it',
      'a probe after a detach is still a single attempt',
      'and schedules no ladder: the detach reset the intent as well as the counter',
    ],
  },
  {
    name: 'the ladder re-arms itself after giving up',
    subject: TS,
    why:
      'the bound becomes decorative: the run reaches it, says it gave up, and ' +
      'immediately starts again from attempt one, so the app is dialling ' +
      'forever under a state that says it has stopped. This is the shape the ' +
      'running build was in for a different reason (a reload loop restarting ' +
      'the document every few seconds), and the only thing that would have ' +
      'told either of them apart from a healthy bounded run is a check that ' +
      'the run actually ends',
    from: '          this.shouldReconnect = false\n          this.setStatus(\n            \'gave-up\',',
    to: '          this.reconnectAttempts = 0\n          this.setStatus(\n            \'gave-up\',',
    /*
     * Only two checks, and that is the finding rather than a disappointment.
     *
     * The run still reaches `gave-up`, so everything asserting that the bound
     * is spent stays green. What breaks is the *number*: it is back at zero by
     * the time anyone reads it, so the app says "gave up after 0 attempts".
     * These two are the only checks in the suite that would have noticed, and
     * a bound announced with the wrong count is most of the way to a bound
     * that is not enforced at all.
     */
    expect: [
      'the give-up reason names the attempt count',
      'and the number the UI reads agrees with the number of dials that happened',
    ],
  },
  {
    name: 'the footer keeps its own reading of the bridge status',
    subject: FOOTER,
    why:
      'the exact expression this issue came from. A component comparing the ' +
      'raw status to a literal folds `connecting` in with `reconnecting`, ' +
      'which is what put an amber "Bridge reconnecting" over a screen asking ' +
      'the player to sign in. The census must catch it whether or not the ' +
      'component also imports the phase - it did import it, and was still wrong',
    from: '  const bridgePhaseName = bridgePhase(bridgeReading)',
    to: "  const bridgePhaseName = bridgeStatus === 'reconnecting' ? 'x' : bridgePhase(bridgeReading)",
    /*
     * One check, and it is the one that had to exist.
     *
     * The census-by-import stays green here, because the component does still
     * import `bridgePhase` - it just also keeps a second opinion beside it,
     * which is exactly the state the real bug was in. Only the raw-compare
     * matcher sees this. Two checks over one population, catching different
     * halves of the same rule; either alone would pass this sabotage.
     */
    expect: ['no component compares the raw bridge status to a literal'],
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
      // Added with #532: with `reconnecting` gone, a Lich that is merely still
      // booting after sign-in reads as one that was never there, and the chip
      // tells the player to sign in again instead of to wait.
      'a Lich that is still booting gets re-dialled rather than given up on',
      'and the player is told it is connecting, not reconnecting',
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
  {
    name: 'an inline connected test is put back in the command bar',
    subject: BAR,
    why:
      'this is issue #501 exactly: the box the player is looking at when they ' +
      'press Enter decides for itself what the link is doing, so it can read ' +
      '"Not attached" under a footer reading "Reconnecting 3/6", and its own ' +
      'guard short-circuits before the lane can say what is actually wrong',
    from: '          disabled={searchOpen || sending}',
    to: '          disabled={searchOpen || sending || !link.connected}',
    expect: [
      `${BAR.split('/').join(SEP)} has no inline connected test left`,
      'no inline link.connected test survives in any of the',
    ],
  },
  {
    name: 'an unexpected drop stops marking the data',
    subject: STALE,
    why:
      'issue #506: the character, vitals and script list left by a drop are ' +
      'drawn at full contrast as current readings, and the panels then say ' +
      'nothing at all about a health bar that has not been updated for a minute',
    from: '  if (staleSince !== FRESH) return staleSince\n  return now',
    to: '  return FRESH',
    expect: STALE_NEVER_SET,
  },
  {
    name: 'the mark is cleared when the socket returns',
    subject: STALE,
    why:
      'the plausible wrong fix, and the reason the mark is not cleared on ' +
      "'connected': Lich's replay lands up to ten seconds after the reconnect " +
      'in DragonRealms, so full contrast comes back over pre-drop numbers for ' +
      'that whole window and nothing on screen says which they are',
    from: '  if (FEEDING[status] ?? false) return staleSince',
    to: '  if (FEEDING[status] ?? false) return FRESH',
    expect: STALE_CLEARED_TOO_EARLY,
  },
]

/* ------------------------------------------------------------------ run it */

// The command bar and the stale mark are both asserted by the same node
// suite, so they share its runner. They are separate subjects rather than
// separate cases on one subject because each is restored and re-hashed on its
// own, and a damaged file left behind is the one outcome worse than no
// negative test at all.
const RUNNERS = { [RUST]: runRust, [TS]: runNode, [BAR]: runNode, [STALE]: runNode, [FOOTER]: runNode }
// Floors on what a green baseline must actually have executed. Well below the
// real counts, so they never need touching and still catch a subject that
// silently ran nothing.
const FLOORS = { [RUST]: 15, [TS]: 40, [BAR]: 40, [STALE]: 40, [FOOTER]: 40 }

const SUBJECTS = [RUST, TS, BAR, STALE, FOOTER]

console.log('== every subject is green before any damage ==')
for (const path of SUBJECTS) {
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
for (const path of SUBJECTS) {
  const after = RUNNERS[path]()
  ok(
    after.ran >= FLOORS[path] && after.failed.length === 0,
    `${path}: and its tests are green again`,
    after.failed.join(' | ')
  )
}

console.log(`\n${failures ? 'FAILURES' : 'all passed'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
