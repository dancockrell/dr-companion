/**
 * Run every Godot test in `godot/tests`.
 *
 *   node tools/godot-tests.mjs
 *   GODOT4=/path/to/godot node tools/godot-tests.mjs
 *
 * # Why this exists
 *
 * There are twelve `.gd` test scripts under `godot/tests`, several of them
 * carefully written, and nothing ran any of them. No npm script enumerated
 * them, no CI step invoked them, and `test:godot-export` only builds the
 * binary. They were written, reviewed, committed, and never executed again.
 *
 * That is not a hypothetical cost. `live_bridge_transport_test.gd` called
 * `OS.get_temp_dir()`, which arrived in Godot 4.4 while this project is on
 * 4.3, so the script failed to *parse* - fourteen checks about the live bridge
 * transport, none of which had ever run, shipping in every export as a file
 * the engine refuses. One command finds that; no amount of reading does.
 *
 * # Three states, not two
 *
 * This needs a Godot binary, which the build box does not have. A run without
 * one prints NOT CHECKED and says so in the summary rather than exiting 0 with
 * no failures, because "no failures" and "nothing ran" are the same output
 * otherwise, and the second one is a lie. `tools/run-tests.mjs` already makes
 * this distinction for suites; this makes it for its own dependency.
 *
 * # A parse error is a failure, not a skip
 *
 * Godot exits 0 for a script it could not load. So does a script that ran and
 * passed. The exit code alone cannot tell them apart, and the difference is
 * the entire bug this tool was written after. So a run must produce a
 * recognisable result line, and a run that produces none fails with its
 * output attached.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TESTS = 'godot/tests'
const PROJECT = 'godot'

/** Well below the eleven that exist, so it never needs touching and still
 * catches a walk that found nothing. Overridable only so the refusal below can
 * be executed on purpose; a branch nobody can trigger is a branch nobody can
 * prove they fixed. */
const MIN_TESTS = Number(process.env.DRC_GODOT_MIN_TESTS ?? 6)

/**
 * And the number that actually goes to zero when the mechanism breaks.
 *
 * `MIN_TESTS` floors how many scripts were *found*, which is a different claim
 * from how much was *asserted* - and a script that runs, prints
 * `0 checked, 0 failed` and exits clean is accepted below as `OK — 0 checks`.
 * Demonstrated by replacing `_checked += 1` with `_checked += 0` in all eleven
 * scripts under `godot/tests` and running this file against a real Godot 4.3:
 *
 *   11 of 11 Godot test scripts passed, 0 checks
 *   all passed                                       <- exit 0
 *
 * Every script was found, every script ran, every script parsed, nothing
 * failed, and the run asserted nothing at all. `tools/run-tests.mjs` has
 * `CHECK_FLOOR` for exactly this shape and cannot cover this one, because
 * `test:godot` is deliberately outside `tools/test-suites.json` (it needs a
 * Godot binary - see `tools/needs-env.mjs`). So the floor has to live here.
 *
 * 60 against a real 131, on the same reasoning as every other floor in this
 * repo: far enough below that adding or removing a case never touches it, high
 * enough that a suite gutted to nothing cannot clear it.
 */
const MIN_CHECKS = Number(process.env.DRC_GODOT_MIN_CHECKS ?? 60)

/**
 * `GODOT4` names the binary; the rest is where one tends to be on this machine.
 *
 * The two are not the same kind of thing, which is why the explicit one stands
 * alone rather than heading a fallback list. `GODOT4` is what CI sets, and a CI
 * job whose engine failed to install must go red - if a bad `GODOT4` fell
 * through to `godot` on `PATH` and found nothing, this file would print NOT
 * CHECKED and exit 0, and the job would be green having run no test at all.
 * That is the same "a check that cannot fail" shape the rest of this file is
 * written against, one layer out: here it would be the *job* that could not
 * fail.
 *
 * So: set it and it must work. Leave it unset and the convenience list applies.
 */
const EXPLICIT = process.env.GODOT4 || ''
const CANDIDATES = EXPLICIT
  ? [EXPLICIT]
  : [
      'C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64_console.exe',
      'C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64.exe',
      'godot',
    ]

function findGodot() {
  for (const candidate of CANDIDATES) {
    try {
      const out = execFileSync(candidate, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      return { path: candidate, version: out.trim().split('\n')[0] }
    } catch {
      // Not here, or not runnable. Try the next one.
    }
  }
  return null
}

const godot = findGodot()
if (!godot && EXPLICIT) {
  console.error(`FAILED: GODOT4 is set to ${EXPLICIT}, and that does not run.`)
  console.error('  An engine that was named explicitly and is missing is a broken setup,')
  console.error('  not an absent one. Reporting "nothing checked" here would let a CI job')
  console.error('  whose Godot install failed finish green having asserted nothing.')
  process.exit(1)
}
if (!godot) {
  console.log('NOT CHECKED: no Godot binary found.')
  console.log(`  Looked at: ${CANDIDATES.join(', ')}`)
  console.log('  Set GODOT4 to a Godot 4.3 executable to run these.')
  console.log('\nno failures, but 0 of the Godot tests ran: there is no engine to run them with')
  // Deliberately 0: an absent engine is not a broken repository. The summary
  // above is what stops that reading as a pass.
  process.exit(0)
}

const files = readdirSync(TESTS)
  .filter((f) => f.endsWith('.gd'))
  .sort()

if (files.length < MIN_TESTS) {
  console.error(`FAILED: found only ${files.length} test scripts in ${TESTS} (floor ${MIN_TESTS}); the walk is broken`)
  process.exit(1)
}

console.log(`${godot.version}`)
console.log(`running ${files.length} Godot tests from ${TESTS}\n`)

let failed = 0
let checks = 0

for (const file of files) {
  const script = `tests/${file}`
  let output = ''
  try {
    output = execFileSync(godot.path, ['--headless', '--script', script, '--path', '.'], {
      cwd: PROJECT,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (error.killed) output += '\n(timed out)'
  }

  // A result line, in either of the two shapes these scripts use.
  const counted = /(\d+)\s+check(?:ed|s)?,\s*(\d+)\s+failed/.exec(output)
  const allPassed = /^all passed$/m.test(output)
  const parseError = /Parse Error|Failed to load script|Can't load script/i.test(output)
  const scriptFails = [...output.matchAll(/^FAIL\b.*$/gm)].map((m) => m[0])

  if (parseError) {
    failed++
    const detail = /Parse Error: [^\n]*/.exec(output)?.[0] ?? 'script would not load'
    console.log(`FAIL ${file} — ${detail}`)
    continue
  }

  if (!counted && !allPassed) {
    failed++
    console.log(`FAIL ${file} — produced no result line; a run that says nothing is not a pass`)
    console.log(output.split('\n').slice(-4).map((l) => `       ${l}`).join('\n'))
    continue
  }

  if (counted) {
    checks += Number(counted[1])
    const bad = Number(counted[2])
    if (bad > 0) {
      failed++
      console.log(`FAIL ${file} — ${bad} of ${counted[1]} checks failed`)
      for (const line of scriptFails.slice(0, 5)) console.log(`       ${line}`)
      continue
    }
    console.log(`OK   ${file} — ${counted[1]} checks`)
  } else {
    // `all passed` with no count. Trust it, but count its OK lines so the
    // total below is not silently short.
    const oks = [...output.matchAll(/^OK\b/gm)].length
    checks += oks
    console.log(`OK   ${file} — ${oks} checks`)
  }
}

console.log(`\n${files.length - failed} of ${files.length} Godot test scripts passed, ${checks} checks`)
if (failed) {
  console.error(`FAILED: ${failed} Godot test script(s)`)
  process.exit(1)
}

// The denominator, asserted rather than displayed, and checked before the
// verdict so a run that asserted nothing cannot reach the words "all passed".
if (checks < MIN_CHECKS) {
  console.error(
    `FAILED: ${files.length} script(s) ran and asserted only ${checks} checks (floor ${MIN_CHECKS}).`
  )
  console.error(
    '  Every script can be found, parse and exit clean while checking nothing; that is not a pass.'
  )
  process.exit(1)
}

console.log('all passed')
