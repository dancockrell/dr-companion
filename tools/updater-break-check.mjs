/**
 * Break the updater on purpose and watch `tools/updater-test.mjs` notice.
 *
 * # Why this exists in this shape
 *
 * `updater-test.mjs` is mostly assertions about calls that did not happen -
 * no download during a check, no install during a "later". A suite of
 * negatives is the easiest kind to write and the easiest kind to have silently
 * stop working: if the fakes drifted so that `download` was never reachable at
 * all, every one of those propositions would still be true and every line
 * would still say OK. Green would mean nothing.
 *
 * So each case below damages one rule and declares, by name, which checks must
 * go red. Asserting *which* rather than *that something did* is the part that
 * earns its keep: a sabotage that reddens more than it should means the checks
 * are entangled and the suite is saying less than it appears to, and a
 * sabotage that reddens less means the rule was never actually being asserted.
 *
 * # The tree is never touched
 *
 * Every case copies `src/lib/updater.ts` into a fresh temp directory, edits
 * the copy, and runs the suite against it through `DRC_UPDATER_MODULE`. That
 * is not tidiness: six sessions edit this repository at once, and a break
 * check that mutates a tracked file and restores it afterwards is one crash
 * away from leaving somebody else's checkout sabotaged. There is nothing to
 * restore here, so there is nothing to fail to restore.
 *
 * A sabotage whose anchor no longer matches is a hard abort naming the
 * pattern, never a pass - a `replace` that changed nothing rewrites the file
 * identically, the suite passes, and the run reads as "this rule is
 * unnecessary" when it means "this test did nothing".
 *
 *     node tools/updater-break-check.mjs
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const SOURCE = join(root, 'src', 'lib', 'updater.ts')
const SUITE = join(root, 'tools', 'updater-test.mjs')
const original = readFileSync(SOURCE, 'utf8')

/**
 * Run the suite against a module and return the set of check labels that
 * failed, plus how many ran.
 *
 * The exit code is deliberately not the signal. A suite that crashed before
 * running anything also exits non-zero, and this whole file would then report
 * every sabotage as caught while nothing had been asserted - the exact defect
 * `docs/TESTING.md` records as counting FAIL lines in a crashed run. So the
 * denominator comes out of the suite's own `N checked` line and is checked
 * against a floor.
 */
function runSuite(modulePath) {
  let stdout = ''
  try {
    stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', SUITE],
      { env: { ...process.env, DRC_UPDATER_MODULE: modulePath }, encoding: 'utf8', stdio: 'pipe' }
    )
  } catch (e) {
    stdout = `${e.stdout ?? ''}${e.stderr ?? ''}`
  }
  const reds = stdout
    .split(/\r?\n/)
    .filter((l) => l.startsWith('FAIL '))
    .map((l) => l.slice(5).trim())
  // Unanchored on purpose: on the failure path this string is stdout with
  // stderr concatenated onto it, and `$` under /m does not survive that join.
  const counted = /(\d+) checked, (\d+) failed/.exec(stdout)
  return { reds, ran: counted ? Number(counted[1]) : 0, stdout }
}

/**
 * The floor. Well below the real count so it does not need editing when a case
 * is added, and far enough above zero that a suite which failed to import its
 * module cannot be mistaken for a suite that ran.
 */
const MIN_RAN = 20

let pass = 0
let fail = 0
const failures = []
function ok(label, condition, detail) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (detail && !condition) console.log(`     ${detail}`)
  if (condition) pass++
  else {
    fail++
    failures.push(label)
  }
}

// ── The positive control ────────────────────────────────────────────────────
//
// Runs before any sabotage. Without it, a suite that had become impossible to
// pass would score a perfect sheet below: every case would report the expected
// checks going red, for entirely the wrong reason.
{
  const dir = mkdtempSync(join(tmpdir(), 'drc-upd-control-'))
  const copy = join(dir, 'updater.ts')
  writeFileSync(copy, original)
  const { reds, ran } = runSuite(copy)
  ok(`the control: an unmodified copy passes, and ${ran} checks ran`, reds.length === 0 && ran >= MIN_RAN, `${ran} ran, reds: ${reds.join(' | ')}`)
  rmSync(dir, { recursive: true, force: true })
}

/**
 * @type {{name: string, find: string, replace: string, expect: string[]}[]}
 */
const CASES = [
  {
    name: 'the launch check stops honouring "later"',
    find: 'if (atLaunch && this.#deferred.has(result.version)) {',
    replace: 'if (false && atLaunch && this.#deferred.has(result.version)) {',
    expect: ['a version the player deferred is not raised again at launch'],
  },
  {
    name: 'a finished download runs the installer by itself',
    find: "    this.#set({ kind: 'ready', version: update.version })\n    return this.#state",
    // `.catch(() => {})` on the injected call, and it is not decoration. The
    // first version of this sabotage threw out of `download()` on the
    // `failOn: 'install'` fixture, which the suite calls without a try — so the
    // run died on an unhandled rejection partway through. The FAIL lines it had
    // already printed happened to be exactly the expected set, so the case
    // "passed" on a suite that never finished, and only the `ran >= MIN_RAN`
    // floor caught it. A sabotage has to leave the suite able to reach its own
    // summary, or it is measuring a crash rather than a rule.
    replace: "    this.#set({ kind: 'ready', version: update.version })\n    await update.install().catch(() => {})\n    return this.#state",
    // Four, and the fourth is the interesting one: with an install wired into
    // the end of `download`, the *refused* install case already has an
    // installer run behind it, so `a refused install runs no installer` goes
    // red as well. That is the correct entailment and it is listed rather than
    // waved through - a sabotage list that only names the obvious victims
    // cannot tell an entangled suite from a precise one.
    // `a failed download installs nothing` stays green: that download throws
    // before it reaches the injected line.
    expect: ['downloading installs nothing', 'a refused install runs no installer', 'a confirmed install runs the installer exactly once', 'installing outside a game session needs no confirmation'],
  },
  {
    name: 'the live-session gate is removed',
    find: 'if (this.#deps.isInGame() && !confirmed) {',
    replace: 'if (false && this.#deps.isInGame() && !confirmed) {',
    expect: ['installing during a live game session is refused', 'the refusal names the version', 'a refused install runs no installer', 'a confirmed install runs the installer exactly once'],
  },
  {
    name: 'checking for updates downloads as a side effect',
    find: '    this.#update = result\n',
    replace: '    this.#update = result\n    await result.download(() => {}).catch(() => {})\n',
    // Two: `later downloads nothing` is asserted after a check, so a check
    // that downloads makes it false too. Named rather than trimmed.
    expect: ['checking for updates downloads nothing', 'later downloads nothing'],
  },
  {
    name: '"later" forgets which version was deferred',
    find: 'this.#deferred.add(version)',
    replace: 'void version',
    expect: ['later records the version as deferred', 'a version the player deferred is not raised again at launch'],
  },
  {
    name: 'a failure stops saying what to do',
    find: "        whatToDo: `You can carry on using this version. To check by hand, open ${this.#deps.releasesUrl}.`,",
    replace: "        whatToDo: 'Something went wrong.',",
    expect: ['a failed check names the releases page'],
  },
]

for (const c of CASES) {
  const count = original.split(c.find).length - 1
  if (count !== 1) {
    console.error(
      `ABORT: the sabotage "${c.name}" expected exactly one occurrence of its anchor and found ${count}.`
    )
    console.error(`  anchor: ${JSON.stringify(c.find)}`)
    console.error(
      '  Refusing to continue. A sabotage that changes nothing rewrites the file identically, ' +
        'the suite passes, and this run reports the rule as unnecessary when it means the test did nothing.'
    )
    process.exit(1)
  }

  const dir = mkdtempSync(join(tmpdir(), 'drc-upd-'))
  const copy = join(dir, 'updater.ts')
  const damaged = original.replace(c.find, c.replace)
  if (damaged === original) {
    console.error(`ABORT: the sabotage "${c.name}" produced an identical file.`)
    process.exit(1)
  }
  writeFileSync(copy, damaged)

  const { reds, ran } = runSuite(copy)
  const expected = [...c.expect].sort()
  const got = [...reds].sort()
  const same = expected.length === got.length && expected.every((e, i) => e === got[i])
  ok(
    `sabotage: ${c.name} → exactly ${expected.length} named check(s) go red`,
    same && ran >= MIN_RAN,
    `ran ${ran}\n     expected red: ${expected.join(' | ') || '(none)'}\n     actually red: ${got.join(' | ') || '(none)'}`
  )
  rmSync(dir, { recursive: true, force: true })
}

// The tree was never written to, but say so with a fact rather than a promise.
const after = readFileSync(SOURCE, 'utf8')
ok('src/lib/updater.ts is byte-identical to how this run found it', after === original)

console.log('')
const total = pass + fail
const MIN_EXPECTED = 6
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error(`FAILED: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('all passed')
