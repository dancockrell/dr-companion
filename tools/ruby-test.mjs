/**
 * Runs the Ruby bridge test, and finds Ruby before giving up on it.
 *
 * `test:server` was `ruby lich-scripts/test/server_test.rb ...`, which fails on
 * this machine with:
 *
 *     'ruby' is not recognized as an internal or external command
 *
 * That is not a test failure, and reporting it as one is the problem. Ruby is
 * installed here — `C:\Ruby4Lich5\4.0.6\bin\ruby.exe`, the interpreter Lich
 * itself runs on, which DEPENDENCIES.md already names as a hard dependency of
 * this project. It is simply not on PATH, because nothing put it there.
 *
 * So `npm test` exited non-zero on a machine where the thing under test was
 * present and working. A suite that cries wolf is one people stop reading, and
 * this one is long enough that a single red line at the end is easy to learn
 * to ignore.
 *
 * `live-bridge-test.mjs` already had the right idea — `process.env.DRC_RUBY ||
 * 'ruby'` — so this uses the same variable, and adds the fallback that makes it
 * work unattended.
 *
 * Three outcomes, never two:
 *
 *   the test ran and passed        exit 0
 *   the test ran and failed        exit 1, ruby's own output
 *   Ruby could not be found        exit 0, NOT CHECKED, and says so loudly
 *
 * The third is a real state and it is not a pass. It prints the reason and the
 * one environment variable that fixes it, rather than a shell error about a
 * command name.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { findRuby, notCheckedMessage } from './find-ruby.mjs'

// Which Ruby test to run, and against what. Every one of these suites took
// the same two arguments and the same bare `ruby`, so they get one runner
// rather than seven copies of the same missing-interpreter failure.
const RUNNER = process.argv[2] || 'lich-scripts/test/server_test.rb'
const SUBJECT = process.argv[3] || 'lich-scripts/companion_bridge.lic'


const found = findRuby()

if (!found) {
  console.log(`-- ${RUNNER}, under Ruby --`)
  console.log(notCheckedMessage(RUNNER))
  process.exit(0)
}

if (!existsSync(RUNNER)) {
  console.log(`NOT CHECKED: ${RUNNER} is missing, so there was nothing to run.`)
  process.exit(0)
}

const r = spawnSync(found, [RUNNER, SUBJECT], { stdio: 'inherit' })
if (r.error) {
  console.log(`NOT CHECKED: could not launch ${found}: ${r.error.message}`)
  process.exit(0)
}
process.exit(r.status ?? 1)
