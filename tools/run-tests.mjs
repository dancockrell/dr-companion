/**
 * Run every test suite, and report what actually happened to each one.
 *
 *   node tools/run-tests.mjs           run them all
 *   node tools/run-tests.mjs --list    show the suites and exit
 *
 * # Why this exists rather than `a && b && c`
 *
 * `npm test` was thirty-one scripts chained with `&&`. The first failure
 * aborts the run, so every check after it never executes - and a run that
 * stopped at suite 3 of 31 is indistinguishable, from its output, from a run
 * where suites 4 through 31 all passed. On 27 Aug 2026 that produced four
 * masking failures in sequence: 31 green, then 8, then 24, then 3, then back
 * to 31, each fix revealing the next thing that had been hidden the whole
 * time. One of those runs exited non-zero having printed no FAIL line at all.
 *
 * So the rules here, each of which exists because its absence has cost
 * somebody an evening:
 *
 * **Everything runs.** A failure in suite 3 must not discard the information
 * in suite 30. A guard that throws away good work is worse than no guard.
 *
 * **Every failure is named at the end**, not just the first one, because the
 * first one is rarely the interesting one.
 *
 * **The denominator is asserted.** The summary prints how many suites ran and
 * how many individual checks they performed, and the run fails if that count
 * falls below a floor. A suite that executes nothing and exits 0 looks exactly
 * like a suite that passed; only counting the checks separates them. The floor
 * is deliberately far below the real number so it catches a truncated or empty
 * run and never needs adjusting when somebody adds a case.
 *
 * **Three states, not two.** passed, failed, and NOT RUN. A suite that could
 * not execute - a missing interpreter, an absent optional dependency, a file
 * that will not import - is none of the first two, and folding it into either
 * is the lie this whole file exists to remove. `npm run mock-lich` on this
 * machine dies on `ERR_MODULE_NOT_FOUND` because `ws` is an unlisted optional
 * dependency; that is a fact worth reporting, not a failure and not a pass.
 * The count is carried all the way into the final line, so a run that skipped
 * something can never end on the words "all passed".
 *
 * **The exit code is the real one.** Never `cmd | tail`, which reports tail's
 * status - that defect kept a push-retry fallback dead for 22 commits in
 * another repo on this machine.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * The lowest believable number of checks for a complete run.
 *
 * Measured at 1,900+ across 31 suites when this was written. Set far below
 * that on purpose: this is a tripwire for "the run was truncated or nothing
 * executed", not a regression test on the check count, and a floor that has to
 * be edited whenever somebody adds a case is a floor that gets edited without
 * being thought about.
 */
const CHECK_FLOOR = 400

/** Same reasoning, for suites: a run that executes a handful is not a run. */
const SUITE_FLOOR = 20

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

/**
 * The suites, taken from the existing `test` chain rather than a second list.
 *
 * Deriving them means this cannot silently disagree with `npm test` about what
 * the suite *is* - a second hand-maintained list would drift, and the drift
 * would be invisible until something stopped being run.
 */
function suiteNames() {
  const chain = pkg.scripts?.test
  // Returns empty rather than throwing, so the single refusal path below owns
  // every "nothing to run" case. It used to throw here, which was safe but
  // wrong in a way sabotage-testing caught: the uncaught error exited 1, and 1
  // is the code for "tests ran and failed". Anything reading the exit status
  // would conclude the suite had executed and found problems, which is the
  // opposite of what happened. A refusal has to be distinguishable from a
  // failure, and it also made the `names.length === 0` guard below
  // unreachable for the emptiest input there is.
  if (!chain) return []
  return chain
    .split('&&')
    .map((s) => s.trim().replace(/^npm run /, ''))
    .filter(Boolean)
}

/**
 * Signatures of a process that died before it could run anything.
 *
 * Matched against output only when the suite also produced zero checks, so a
 * suite that ran, checked things, and happened to print the word "LoadError"
 * in a passing assertion is not misclassified. The pairing is what makes this
 * safe: could-not-start means no checks *and* a startup-shaped error.
 */
const COULD_NOT_START = [
  [/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/i, 'a node module is missing'],
  [/LoadError|cannot load such file/i, 'a ruby require failed'],
  [/is not recognized as an internal or external command|ENOENT/i, 'the interpreter is not on PATH'],
  [/SyntaxError/i, 'the test file does not parse'],
]

/** Count the individual assertions a suite reported. */
function countChecks(output) {
  const ok = (output.match(/^OK\b/gm) || []).length
  const fail = (output.match(/^FAIL\b/gm) || []).length
  return { ok, fail, total: ok + fail }
}

function classify(result, output) {
  const checks = countChecks(output)

  // The process could not be spawned at all - no shell, no interpreter.
  if (result.error) {
    return { state: 'NOT RUN', why: `could not start: ${result.error.message}`, checks }
  }

  const code = result.status

  if (checks.total === 0) {
    // Zero checks is never a pass, whatever the exit code says. A suite that
    // exits 0 having asserted nothing is the exact shape of a check that
    // cannot fail, and calling it green is how a broken suite survives.
    const hit = COULD_NOT_START.find(([re]) => re.test(output))
    if (hit) return { state: 'NOT RUN', why: hit[1], checks }
    return {
      state: 'NOT RUN',
      why:
        code === 0
          ? 'exited 0 but performed no checks - it asserted nothing'
          : `exited ${code} before performing any check`,
      checks,
    }
  }

  if (code !== 0) return { state: 'FAILED', why: `exit ${code}`, checks }
  return { state: 'PASSED', why: '', checks }
}

function runSuite(name) {
  const script = pkg.scripts?.[name]
  if (!script) {
    return {
      name,
      state: 'NOT RUN',
      why: `package.json has no script named ${name}`,
      checks: { ok: 0, fail: 0, total: 0 },
      output: '',
    }
  }

  // `npm run` rather than executing the command directly, so a suite whose
  // script is itself a chain (`test:bundle` is `npm run build && node ...`)
  // behaves the same here as it does for anybody running it by hand.
  const result = spawnSync('npm', ['run', '--silent', name], {
    encoding: 'utf8',
    shell: true,
    // Inherit stdin from nothing: a suite that blocks waiting for input would
    // otherwise hang the whole run with no indication why.
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const verdict = classify(result, output)
  return { name, ...verdict, output }
}

const names = suiteNames()

if (process.argv.includes('--list')) {
  console.log(names.join('\n'))
  process.exit(0)
}

// An empty suite list must abort rather than sail through to "all passed" on
// a total of zero. This is the degenerate case the whole file is about.
if (names.length === 0) {
  console.error('REFUSING TO RUN: derived an empty suite list from package.json `test`.')
  console.error('Nothing would have been checked, and a run of nothing must never report success.')
  process.exit(2)
}

console.log(`running ${names.length} suites\n`)

const results = []
for (const name of names) {
  process.stdout.write(`  ${name.padEnd(22)}`)
  const r = runSuite(name)
  results.push(r)
  const mark =
    r.state === 'PASSED' ? 'ok' : r.state === 'FAILED' ? 'FAILED' : 'NOT RUN'
  console.log(`${mark.padEnd(8)} ${r.checks.total} checks${r.why ? `  (${r.why})` : ''}`)
}

const passed = results.filter((r) => r.state === 'PASSED')
const failed = results.filter((r) => r.state === 'FAILED')
const notRun = results.filter((r) => r.state === 'NOT RUN')
const totalChecks = results.reduce((n, r) => n + r.checks.total, 0)

console.log('\n' + '-'.repeat(60))

if (failed.length) {
  console.log(`\n${failed.length} suite(s) FAILED:`)
  for (const r of failed) {
    console.log(`\n  ${r.name} (${r.why})`)
    for (const line of r.output.split('\n').filter((l) => /^FAIL\b/.test(l)).slice(0, 8)) {
      console.log(`      ${line}`)
    }
  }
}

if (notRun.length) {
  console.log(`\n${notRun.length} suite(s) NOT RUN - neither passed nor failed:`)
  for (const r of notRun) {
    console.log(`  ${r.name.padEnd(22)} ${r.why}`)
    // The last few lines of what it actually said.
    //
    // Without this a NOT RUN was a dead end: the classification told you the
    // suite could not execute and nothing told you why, so diagnosing it meant
    // running it by hand and hoping it failed the same way. It did not - a
    // suite that would not start under this runner passed six times out of six
    // standalone, and the reason was only ever in the output being discarded
    // here. A report that says "something went wrong" and drops the evidence
    // is most of the way to no report at all.
    const tail = r.output
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(-6)
    for (const line of tail) console.log(`      ${line}`)
  }
}

console.log(
  `\n${passed.length} passed, ${failed.length} failed, ${notRun.length} not run` +
    `  |  ${totalChecks} checks across ${results.length} suites`
)

// The denominator, asserted rather than displayed. Checked before the verdict
// so a truncated run cannot report success on a small number of green suites.
const floorProblems = []
if (results.length < SUITE_FLOOR) {
  floorProblems.push(`only ${results.length} suites ran, expected at least ${SUITE_FLOOR}`)
}
if (totalChecks < CHECK_FLOOR) {
  floorProblems.push(`only ${totalChecks} checks ran, expected at least ${CHECK_FLOOR}`)
}

if (floorProblems.length) {
  console.log('\nREFUSING TO REPORT A RESULT:')
  for (const p of floorProblems) console.log(`  ${p}`)
  console.log('  Too little executed for a pass or a fail to mean anything.')
  process.exit(2)
}

// The summary line can never say "all passed" while something was skipped.
if (failed.length === 0 && notRun.length === 0) {
  console.log('\nall passed')
  process.exit(0)
}

if (failed.length === 0) {
  console.log(
    `\nno failures, but ${notRun.length} not checked: ${notRun.map((r) => r.name).join(', ')}`
  )
  process.exit(1)
}

console.log(`\n${failed.length} failed: ${failed.map((r) => r.name).join(', ')}`)
process.exit(1)
