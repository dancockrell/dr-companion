#!/usr/bin/env node
/**
 * The negative suite for `godot/tests/bridge_client_null_target_test.gd`.
 *
 *   node tools/bridge-client-null-target-break-check.mjs
 *
 * A guard that cannot fail is worth nothing, and reading it does not establish
 * that it can. This puts issue #376's second instance back into
 * `godot/scripts/bridge_client.gd` - the real file, one line at a time - runs
 * the Godot test, and asserts that exactly the named checks go red. Then it
 * restores the file and confirms the restore byte for byte.
 *
 * Deliberately not an npm script and not in `tools/test-suites.json`: it writes
 * to a tracked source file, so it must never run inside the ordinary suite,
 * least of all on a machine where another session may be editing the same tree.
 * Run it by hand after changing either the guard or the code it guards.
 *
 * # Four rules it enforces on itself
 *
 *   - **A fragment that is not found is an abort, not a pass.** A sabotage that
 *     edits nothing rewrites the file unchanged, the test stays green, and the
 *     output reads exactly like proof.
 *   - **The run must be green before any sabotage**, or a red line from
 *     something else is indistinguishable from a sabotage landing.
 *   - **A case names every check it expects to redden**, and reddening one it
 *     did not name is a failure too: a sabotage that takes down more than its
 *     target means the checks are entangled and say less than they look.
 *   - **The check count must not move.** This is the one that matters here and
 *     that the doc-claims equivalent does not need. GDScript has no catchable
 *     exception: a raise abandons the running function and lets the summary
 *     print anyway, and a script that fails to *parse* produces no summary at
 *     all. Either would give a red-looking run that asserted less than the
 *     clean one. So the denominator is compared against the baseline, and a
 *     sabotage that changes it is refused rather than counted as a catch.
 *
 * # The two sabotages, and why both
 *
 * They fail in opposite directions, which is what stops either being satisfied
 * by a test that only ever says no:
 *
 *   1. **The defect itself.** `var target_id: String = exit.get("targetCellId",
 *      "")` raises on a Nil and abandons `send_intent` before the rejection two
 *      lines below can run. Nothing is emitted at all - so the checks that go
 *      red are the ones about the rejection *existing*, while the ones about
 *      the player not moving stay green, because a function that raised did not
 *      move anybody either.
 *   2. **The opposite error**: a null target silently resolved to a real cell.
 *      Now the walk succeeds, and the checks that go red are the ones about no
 *      snapshot and no movement. A test asserting only "something was rejected"
 *      would pass this.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const SOURCE = 'godot/scripts/bridge_client.gd'
const SCRIPT = 'tests/bridge_client_null_target_test.gd'
const SCANNER = 'tools/nullable-field-coercion-test.mjs'

/**
 * The fixed lines as they stand today, and what each sabotage replaces them
 * with - as *lines*, joined with whatever ending the file on disk actually
 * uses.
 *
 * Not decoration. This repository checks out CRLF on Windows, so a fragment
 * built with `\n` matches nothing, the sabotage edits nothing, and the run goes
 * green having tested precisely zero. It is the first thing this harness did,
 * and the abort below is the only reason it was not read as proof.
 */
const FIXED_LINES = [
  '\tvar target_value = exit.get("targetCellId")',
  '\tvar target_id: String = target_value if target_value is String else ""',
]

const CASES = [
  {
    what: 'issue #376 itself: the nullable field read into a typed String',
    lines: ['\tvar target_id: String = exit.get("targetCellId", "")'],
    expect: [
      'every null-targeted exit walked was rejected exactly once (13 walks, floor 9)',
      "1-40 via 'east' is rejected as outside the loaded manifest",
    ],
    // The class check must see this one by shape alone, without running
    // anything. That is the whole claim it makes.
    expectScanner: ['no GDScript reads a documented-nullable field into a String'],
  },
  {
    what: 'the opposite error: a null target silently resolved to a real cell',
    lines: [
      '\tvar target_value = exit.get("targetCellId")',
      '\tvar target_id: String = target_value if target_value is String else "1-14"',
    ],
    expect: [
      'every null-targeted exit walked was rejected exactly once (13 walks, floor 9)',
      'and none of them produced a snapshot',
      'and none of them moved the player',
      "1-40 via 'east' is rejected as outside the loaded manifest",
      'and 1-40 stays where it was',
    ],
    // And must NOT see this one: it keeps the type test, so the source shape is
    // correct and only the behaviour is wrong. A source scan that fired here
    // would be firing on something other than the coercion it claims to find.
    expectScanner: [],
  },
]

const md5 = (text) => createHash('md5').update(text).digest('hex')

const EXPLICIT = process.env.GODOT4 || ''
const CANDIDATES = EXPLICIT
  ? [EXPLICIT]
  : [
      'C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64_console.exe',
      'C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64.exe',
      'godot',
    ]

const findGodot = () => {
  for (const candidate of CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      return candidate
    } catch {
      // not here
    }
  }
  return null
}

const godot = findGodot()
if (!godot) {
  console.error('ABORT: no Godot 4.3 binary found; this harness cannot run the test it is supposed to break.')
  console.error(`  Looked at: ${CANDIDATES.join(', ')}`)
  console.error('  Reporting "nothing broke" here would be a negative suite that cannot fail, which is the thing it exists to prevent.')
  process.exit(2)
}

/** The source scan over the same class, run against the same damage. */
const runScanner = () => {
  try {
    return execFileSync(process.execPath, [SCANNER], { encoding: 'utf8' })
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

const run = () => {
  try {
    return execFileSync(godot, ['--headless', '--script', SCRIPT, '--path', '.'], {
      cwd: 'godot',
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    return `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
}

/** The labels of the checks that printed FAIL, in the test's own wording. */
const redLines = (out) =>
  out
    .split('\n')
    .filter((line) => line.startsWith('FAIL'))
    .map((line) => line.slice(4).trim().split(/\s{2,}/)[0])

/** `{checked, failed}` from the summary, or null when the script produced none
 * - which is what a parse error looks like, and is never a pass. */
const counts = (out) => {
  const match = /(\d+)\s+checked,\s*(\d+)\s+failed/.exec(out)
  return match ? { checked: Number(match[1]), failed: Number(match[2]) } : null
}

const baselineOut = run()
const baseline = counts(baselineOut)
if (!baseline) {
  console.error(`ABORT: ${SCRIPT} produced no result line before any sabotage. It did not parse or did not finish.`)
  console.error(baselineOut.split('\n').slice(-6).join('\n'))
  process.exit(2)
}
if (baseline.failed !== 0) {
  console.error(`ABORT: ${SCRIPT} is already red before any sabotage (${baseline.failed} failed). Nothing below would mean anything.`)
  process.exit(2)
}
const scannerBaseline = redLines(runScanner())
if (scannerBaseline.length !== 0) {
  console.error(`ABORT: ${SCANNER} is already red before any sabotage: ${JSON.stringify(scannerBaseline)}`)
  process.exit(2)
}
console.log(`baseline: ${SCRIPT} is green, ${baseline.checked} checked; ${SCANNER} is green\n`)

const original = readFileSync(SOURCE, 'utf8')
const originalHash = md5(original)
console.log(`${SOURCE} md5 before    = ${originalHash}`)

const EOL = original.includes('\r\n') ? '\r\n' : '\n'
const block = (lines) => lines.join(EOL) + EOL
const FIXED = block(FIXED_LINES)
console.log(`${SOURCE} line ending  = ${EOL === '\r\n' ? 'CRLF' : 'LF'}, matched against the file rather than assumed`)

if (!original.includes(FIXED)) {
  console.error(`ABORT ${SOURCE}: the fixed lines are not there, so every case below would edit nothing and pass.`)
  console.error(JSON.stringify(FIXED))
  process.exit(2)
}

let bad = 0
for (const testCase of CASES) {
  const sabotaged = original.replace(FIXED, block(testCase.lines))
  if (sabotaged === original) {
    console.error(`ABORT: "${testCase.what}" changed nothing.`)
    process.exit(2)
  }
  writeFileSync(SOURCE, sabotaged)
  const sabotagedHash = md5(readFileSync(SOURCE, 'utf8'))
  const out = run()
  // While the file is still sabotaged: the source scan, which is the other
  // guard over the same class and must be measured on the same damage.
  const scannerRed = redLines(runScanner())
  writeFileSync(SOURCE, original)
  const restoredHash = md5(readFileSync(SOURCE, 'utf8'))
  const scannerMissing = testCase.expectScanner.filter((label) => !scannerRed.includes(label))
  const scannerExtra = scannerRed.filter((label) => !testCase.expectScanner.includes(label))
  if (restoredHash !== originalHash) {
    console.error(`ABORT ${SOURCE}: the restore did not reproduce the original bytes. Recover it from git before doing anything else.`)
    process.exit(2)
  }

  const seen = counts(out)
  const red = redLines(out)
  const missing = testCase.expect.filter((label) => !red.includes(label))
  const extra = red.filter((label) => !testCase.expect.includes(label))
  // The denominator, checked before the reds are believed: a run that asserted
  // fewer checks is a script that broke, not a sabotage that landed.
  const parsed = seen !== null && seen.checked === baseline.checked
  const good =
    parsed &&
    missing.length === 0 &&
    extra.length === 0 &&
    seen.failed === testCase.expect.length &&
    scannerMissing.length === 0 &&
    scannerExtra.length === 0
  if (!good) bad += 1

  console.log(`\n${good ? 'OK  ' : 'FAIL'} ${testCase.what}`)
  console.log(`       md5 sabotaged = ${sabotagedHash}`)
  console.log(`       md5 restored  = ${restoredHash}  ${restoredHash === originalHash ? '(matches)' : '(DIFFERS)'}`)
  console.log(`       ${seen ? `${seen.checked} checked, ${seen.failed} failed` : 'NO RESULT LINE - the script did not parse'}` +
    `${parsed ? ` (same denominator as the clean run, so the script parsed and ran to the end)` : ` <- expected ${baseline.checked} checked`}`)
  for (const label of red) console.log(`       red: ${label}`)
  if (missing.length) console.log(`       MISSING: ${JSON.stringify(missing)}`)
  if (extra.length) console.log(`       UNEXPECTED: ${JSON.stringify(extra)}`)
  console.log(`       ${SCANNER}: ${scannerRed.length ? scannerRed.map((l) => `red: ${l}`).join('; ') : 'clean'}` +
    `${testCase.expectScanner.length ? '' : ' (expected: this sabotage keeps the source shape correct)'}`)
  if (scannerMissing.length) console.log(`       SCANNER MISSING: ${JSON.stringify(scannerMissing)}`)
  if (scannerExtra.length) console.log(`       SCANNER UNEXPECTED: ${JSON.stringify(scannerExtra)}`)
}

const finalOut = run()
const final = counts(finalOut)
console.log(`\n${SOURCE} md5 after restore = ${md5(readFileSync(SOURCE, 'utf8'))}`)
console.log(`restored: ${final ? `${final.checked} checked, ${final.failed} failed` : 'NO RESULT LINE'}`)
if (!final || final.failed !== 0 || final.checked !== baseline.checked) {
  console.error('FAILED: the tree is not back where it started. Recover bridge_client.gd from git.')
  process.exit(2)
}

console.log(`\n${CASES.length} sabotages of ${SOURCE}; ${bad} did not redden exactly the checks they named`)
if (bad) process.exit(1)
console.log('all passed')
