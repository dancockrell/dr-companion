/**
 * Break the outbound command lane on purpose and watch its tests catch it.
 *
 * A green suite proves nothing on its own: a suite that never ran, a suite
 * whose assertions cannot fail, and a suite that is right are three states
 * that print identically. This runs `cargo test --lib command_gate` against a
 * *damaged* `src-tauri/src/command_gate.rs` and requires the named tests to go
 * red — and the named ones only, because a sabotage that reddens more than it
 * should means the checks are entangled and each is saying less than it looks.
 *
 * # What this file is careful about, and why
 *
 * **A green run before anything else.** The unmodified file must pass first,
 * or a red result later could be a compile error, a stale target directory, or
 * this harness mangling the file. The number that disappears when the
 * mechanism breaks is "does this still pass when nothing is wrong".
 *
 * **A sabotage that changes nothing must abort, never pass.** If a fragment
 * stops matching — a rename, a reflow, a CRLF/LF mismatch — the file is
 * rewritten identical, the tests pass, and the output reads exactly like proof
 * that the guard worked. So every fragment is required to be present, exactly
 * once, before anything is written.
 *
 * **CRLF.** This tree checks out CRLF, so a multi-line fragment joined with
 * `\n` matches nothing and fails in that same silent direction. The line
 * ending is read off the file.
 *
 * **A sabotage must reach the line it is aimed at.** Each case names the tests
 * it expects to fail, and a case whose damage produces a *compile* error
 * tested nothing — a loader error is not a red test. Both are checked.
 *
 * **Restoration is verified by hash, not by intent.** These edit a real
 * tracked file. Leaving it damaged is the only outcome worse than having no
 * negative test at all, so the original bytes are hashed before and compared
 * after, and the file is touched so cargo cannot serve a stale object.
 */
import { readFileSync, writeFileSync, utimesSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { watchTree } from './break-check-tree.mjs'
import { execFileSync } from 'node:child_process'

const TARGET = 'src-tauri/src/command_gate.rs'
const original = readFileSync(TARGET)
const originalHash = createHash('sha256').update(original).digest('hex')
const text = original.toString('utf8')
const NL = text.includes('\r\n') ? '\r\n' : '\n'

let failures = 0
let checks = 0
function ok(pass, what, detail = '') {
  checks++
  console.log(`${pass ? "OK  " : "FAIL"} ${what}${!pass && detail ? ` — ${detail}` : ''}`)
  if (!pass) failures++
}

function restore() {
  writeFileSync(TARGET, original)
  // cargo decides staleness by mtime, and a rewrite within the same
  // filesystem tick can be invisible to it. Push the file forward a second.
  const when = new Date(Date.now() + 1000)
  utimesSync(TARGET, when, when)
}

// The "before" reading, taken before anything is damaged: this asserts that
// the run changed nothing, not that the checkout was tidy. See
// tools/break-check-tree.mjs.
const treeBack = watchTree([TARGET])

process.on('exit', () => {
  const now = createHash('sha256').update(readFileSync(TARGET)).digest('hex')
  // git as well as the hash: the hash proves this file came back, and only git
  // can see anything else this run left behind. See tools/break-check-tree.mjs.
  if (now === originalHash && treeBack(0) !== 0) process.exitCode = 1
  if (now !== originalHash) {
    // Loud, and not a silent repair: if this line ever prints, the run above
    // must not be believed either.
    console.log(`FAIL the file was left damaged — restoring ${TARGET}`)
    restore()
    process.exitCode = 1
  }
})

/** Run the lane's tests. Returns `{ compiled, failed: [test names] }`. */
function runTests() {
  let out
  try {
    out = execFileSync('cargo', ['test', '--lib', 'command_gate'], {
      cwd: 'src-tauri',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  // Whether the tests *ran*, not whether the word "error" appears: cargo
  // prints `error: test failed, to rerun pass --lib` on an ordinary red run,
  // so grepping for `error:` reports every successful sabotage as a build
  // failure. The number that disappears when the damage does not compile is
  // the count of test lines, so that is what is counted.
  const failed = [...out.matchAll(/^test (command_gate::tests::\w+) \.\.\. FAILED$/gm)].map(
    (m) => m[1].replace('command_gate::tests::', '')
  )
  const ran = [...out.matchAll(/^test command_gate::tests::(\w+) \.\.\./gm)].length
  return { compiled: ran > 0, failed, ran, out }
}

/**
 * Each case: a `from`→`to` splice, and the exact set of tests that must go red.
 *
 * The expected set is exact rather than "at least one". A sabotage that
 * reddens a test it has no business touching is telling you the checks share
 * an assumption, which is worth knowing before trusting either of them.
 */
const CASES = [
  {
    name: 'the roundtime hold is removed',
    why:
      'the wire is declared free at every instant, so a command queued during a ' +
      'three-second roundtime goes out immediately and is discarded by the game',
    from: [
      '        if now >= self.rt_until_ms.saturating_add(RT_MARGIN_MS) {',
      '            return true;',
      '        }',
    ].join(NL),
    to: ['        if true {', '            return true;', '        }'].join(NL),
    // Measured, not predicted - and the first draft of this list guessed
    // seven and got three. The four it wrongly expected (coalescing, the
    // held key, Stop, the overflow ceiling) each *arrange* a roundtime hold
    // to make the queue form, but assert something the hold is not part of,
    // and with the hold gone their commands simply leave earlier in the same
    // order. That is the list being exact earning its keep: an "at least one
    // went red" check would have hidden the fact that those four say nothing
    // about roundtime at all.
    expect: [
      'a_queued_command_waits_for_roundtime_and_no_longer',
      'a_late_roundtime_cannot_shorten_a_hold_already_running',
      'a_new_roundtime_restores_the_typeahead_allowance',
    ],
  },
  {
    name: 'priority is inverted',
    why:
      'the lane picks the lowest-priority entry, so a script walks in front of ' +
      'the player — the one thing this file exists to make impossible',
    from: 'if (e.source, e.seq) < (cur.source, cur.seq) {',
    to: 'if (e.source, e.seq) > (cur.source, cur.seq) {',
    // Five, because the comparison this inverts is `(priority, seq)`: the two
    // roundtime tests each queue two script commands and assert which comes
    // out first, so inverting the tie-break reddens them too. Recorded rather
    // than trimmed - they are genuinely ordering assertions.
    expect: [
      'mixed_sources_leave_in_priority_order_then_submission_order',
      'a_player_command_submitted_during_a_hold_goes_first_when_it_lifts',
      'pause_holds_scripts_and_not_the_player',
      'a_late_roundtime_cannot_shorten_a_hold_already_running',
      'a_new_roundtime_restores_the_typeahead_allowance',
    ],
  },
  {
    name: 'Stop flushes the player too',
    why: 'Stop becomes a control over the person rather than over automation',
    from: 'if e.source.is_automation() {' + NL + '                self.flushed += 1;',
    to: 'if true {' + NL + '                self.flushed += 1;',
    expect: ['stop_flushes_automation_and_leaves_the_player_alone'],
  },
  {
    name: 'coalescing ignores the source',
    from: '.any(|e| e.source == source && normalized(&e.text) == normalized(&text));',
    to: '.any(|e| normalized(&e.text) == normalized(&text));',
    why: "a script's `north` swallows the player's, which is a dropped player command",
    expect: ['coalescing_is_per_source_and_movement_only'],
  },
  {
    name: 'Pause holds the player as well',
    from: 'self.paused && e.source.is_automation()',
    to: 'self.paused',
    why: 'Pause stops the person from typing, which is not what the button says',
    expect: ['pause_holds_scripts_and_not_the_player'],
  },
  {
    name: 'the roundtime tag is read as a duration',
    from: 'take(v.saturating_mul(1000));',
    to: 'take(now_ms.saturating_add(v));',
    why:
      'the epoch second is treated as milliseconds from now, which puts every ' +
      'hold roughly fifty-five years out and stops the client sending anything',
    expect: ['roundtime_is_read_from_the_tag_and_from_the_text'],
  },
]

/* ------------------------------------------------------------------ */

console.log('-- the subject is green before any damage --')
{
  const first = runTests()
  ok(first.compiled, 'the unmodified file compiles')
  ok(first.ran >= 12, `and its tests ran: ${first.ran} (floor 12)`)
  ok(
    first.failed.length === 0,
    'and every one passes',
    first.failed.join(', ')
  )
  if (failures) {
    console.log('\nnothing below this line would mean anything; stopping.')
    process.exit(1)
  }
}

for (const c of CASES) {
  console.log(`\n-- sabotage: ${c.name} --`)
  console.log(`   ${c.why}`)

  const hits = text.split(c.from).length - 1
  if (hits !== 1) {
    // A hard abort, not a failed check that the run could shrug off. A
    // fragment that matches zero times rewrites the file unchanged and the
    // tests pass, which reads exactly like the sabotage being caught.
    console.log(`FAIL fragment matched ${hits} times, expected exactly 1: ${c.from.slice(0, 60)}`)
    console.log('the sabotage could not be applied, so this run proved nothing')
    restore()
    process.exit(1)
  }

  const damaged = text.replace(c.from, c.to)
  if (damaged === text) {
    console.log('FAIL the splice changed nothing')
    restore()
    process.exit(1)
  }
  writeFileSync(TARGET, damaged, 'utf8')
  const when = new Date(Date.now() + 1000)
  utimesSync(TARGET, when, when)

  const r = runTests()
  restore()

  // A compile error is not a red test: it means the damage never reached the
  // line, and the assertions were never executed.
  ok(r.compiled, `${c.name}: still compiles, so the tests actually ran`, r.out.slice(-400))
  const got = [...r.failed].sort().join(', ')
  const want = [...c.expect].sort().join(', ')
  ok(got === want, `${c.name}: exactly the expected tests go red`, `got [${got}] want [${want}]`)
}

console.log('\n-- and the file is byte-identical to how it was found --')
{
  const now = createHash('sha256').update(readFileSync(TARGET)).digest('hex')
  ok(now === originalHash, `${TARGET} restored (sha256 ${now.slice(0, 12)})`)
  const after = runTests()
  ok(after.compiled && after.failed.length === 0, 'and its tests are green again', after.failed.join(', '))
}

console.log(`\n${failures ? 'FAILURES' : 'all passed'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
