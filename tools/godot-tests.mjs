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
 *
 * # This file is also a module
 *
 * `tools/gate.mjs` needs to answer "is there an engine here?" *before* it
 * spawns anything, so a missing one reads as NOT RUN rather than as a stage
 * that failed. The engine discovery below is exported for it — imported, not
 * copied, because two lists of where Godot might live would drift and then
 * both would be wrong. Everything that actually runs tests is inside `main()`,
 * which fires only when this file is the process entry point, so importing it
 * costs an import and nothing else.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

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
 *
 * Exported as a function of the explicit override rather than as a bare array,
 * because `gate.mjs` has an override of its own (`DRC_GATE_GODOT`) and needs
 * to ask this same question about a different name.
 */
export function godotCandidates(explicit = process.env.GODOT4 || '') {
  return explicit
    ? [explicit]
    : [
        'C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64_console.exe',
        'C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64.exe',
        'godot',
      ]
}

/**
 * Which engine this project declares, read from `godot/project.godot` rather
 * than typed here.
 *
 * `config/features=PackedStringArray("4.3", "Forward Plus")` is Godot's own
 * statement of the version the project is for, and it is the thing that would
 * change if the project were ever migrated. A constant `'4.3'` in this file
 * would be a second copy of that fact, and the two would drift the day
 * somebody opened the project in a newer editor — which is precisely the
 * situation this check exists to catch, so the check must not be the thing
 * that goes stale.
 *
 * Unreadable or unparseable is a third state, not a pass: without a declared
 * version there is nothing to compare against, and `findGodot` says so rather
 * than waving every binary through.
 */
export function declaredGodotVersion() {
  const path = resolve(fileURLToPath(new URL('../godot/project.godot', import.meta.url)))
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { error: `could not read ${path} (${error.message})` }
  }
  const m = text.match(/config\/features\s*=\s*PackedStringArray\(\s*"(\d+\.\d+)"/)
  if (!m) return { error: `${path} has no config/features=PackedStringArray("<major.minor>") line` }
  return { version: m[1] }
}

/**
 * The first candidate that runs *and is the engine this project declares*,
 * with the version string it printed, or `null`.
 *
 * `--version` rather than a filesystem check: a path that exists and cannot
 * execute is the same absence with more steps. And the string it prints is
 * read rather than merely captured, which it was not until #489: any binary
 * that exited 0 was accepted as a Godot 4.3, so `DRC_GATE_GODOT=node` produced
 * `gate: v24.19.0 at node; 0 already running` and went on to run the suite
 * with it. That is survivable when the impostor is `node`, because everything
 * downstream falls over loudly. It is not survivable when it is a Godot 4.4:
 * the sixteen scripts run, they go green, and the gate's own message — "no
 * Godot 4.3 binary" — was a version claim it never checked. The bug that
 * caused this whole file to exist was a 4.4 API in a 4.3 project.
 *
 * A binary that runs and is the wrong engine is reported as its own state, not
 * folded into "nothing found": the two call for opposite things from whoever
 * is standing there — install an engine, versus you have the wrong one, and
 * here is what it said it was.
 *
 * @returns {{path: string, version: string} | null} the accepted engine, or
 *   null. `findGodot.rejected` is not used; callers wanting the detail call
 *   `findGodotDetailed`.
 */
export function findGodot(candidates = godotCandidates()) {
  const d = findGodotDetailed(candidates)
  return d.found ?? null
}

/**
 * The same search, with everything it learned: what it accepted, and every
 * binary that ran and was refused, with the version string each printed.
 *
 * Separate from `findGodot` only in what it returns — one search, not two, for
 * the same reason `godotCandidates` is imported by `gate.mjs` rather than
 * copied: two answers to "is there an engine here" would drift, and the one
 * that drifts decides whether the other gets to run.
 *
 * @returns {{found?: {path: string, version: string}, want?: string,
 *   rejected: {path: string, version: string}[], error?: string}}
 */
export function findGodotDetailed(candidates = godotCandidates()) {
  const declared = declaredGodotVersion()
  const rejected = []
  if (declared.error) return { rejected, error: declared.error }
  // `4.3.stable.official.abcdef` matches; `4.4.stable...` and `v24.19.0` do
  // not. Anchored, and the trailing dot is deliberate: a bare `^4\.3` would
  // accept a hypothetical `4.30`.
  const wanted = new RegExp(`^${declared.version.replace('.', '\\.')}\\.`)
  for (const candidate of candidates) {
    let out
    try {
      out = execFileSync(candidate, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      // Not here, or not runnable. Try the next one.
      continue
    }
    const version = out.trim().split('\n')[0]
    if (wanted.test(version)) return { found: { path: candidate, version }, want: declared.version, rejected }
    rejected.push({ path: candidate, version })
  }
  return { want: declared.version, rejected }
}

/**
 * One sentence saying why there is no engine, in whichever of the three states
 * the search ended in. Shared so `gate.mjs` and `main()` cannot disagree about
 * what happened, and so "not Godot 4.3, found <what it printed>" is a distinct
 * message from "nothing ran at all".
 */
export function godotNotFoundReason(detail, candidates) {
  if (detail.error) return `the project's declared Godot version is unknown: ${detail.error}`
  if (detail.rejected.length > 0) {
    const list = detail.rejected.map((r) => `${r.path} printed "${r.version}"`).join('; ')
    return `not Godot ${detail.want}: ${list}`
  }
  return `no Godot ${detail.want} binary; looked at ${candidates.join(', ')}`
}

function main() {
  const explicit = process.env.GODOT4 || ''
  const candidates = godotCandidates(explicit)
  const detail = findGodotDetailed(candidates)
  const godot = detail.found ?? null
  const why = godotNotFoundReason(detail, candidates)

  if (!godot && explicit) {
    console.error(`FAILED: GODOT4 is set to ${explicit}, and ${why}.`)
    console.error('  An engine that was named explicitly and is missing — or is the wrong')
    console.error('  version — is a broken setup, not an absent one. Reporting "nothing')
    console.error('  checked" here would let a CI job whose Godot install failed finish')
    console.error('  green having asserted nothing.')
    process.exit(1)
  }
  // A binary that ran and is the wrong engine is a broken setup too, not an
  // absent one: somebody has a Godot on this machine and it is not the one
  // this project declares, and running the suite on it would go green on the
  // wrong engine. Silence about that is the exact defect this file was
  // written for — a 4.4 API in a 4.3 project.
  if (!godot && detail.rejected.length > 0) {
    console.error(`FAILED: ${why}.`)
    console.error(`  ${TESTS} is a Godot ${detail.want} suite; running it on another engine would prove nothing.`)
    process.exit(1)
  }
  if (!godot) {
    console.log(`NOT CHECKED: ${why}.`)
    console.log(`  Looked at: ${candidates.join(', ')}`)
    console.log(`  Set GODOT4 to a Godot ${detail.want ?? '4.3'} executable to run these.`)
    console.log('\nno failures, but 0 of the Godot tests ran: there is no engine to run them with')
    // Deliberately 0: an absent engine is not a broken repository. The summary
    // above is what stops that reading as a pass. `gate.mjs` does not lean on
    // this exit code — it asks `findGodot` itself, and refuses to run the
    // stage at all when there is nothing to run it with.
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
}

// Only when this file *is* the command. `gate.mjs` imports the two functions
// above; an import that ran sixteen headless Godot processes as a side effect
// would be a trap of its own.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main()
}
