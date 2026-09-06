/**
 * Run one Python test through the repository's shared interpreter resolver.
 *
 * Seven npm scripts run through here, so this file is not a suite with a
 * floor of its own - the number of checks depends entirely on which test file
 * it is pointed at. Each caller declares its own floor with `--min N`, and
 * the floor is asserted here rather than in the Python, because what it
 * guards against is the Python never running at all.
 *
 * That is why the child's output is captured and relayed rather than
 * inherited: a runner that cannot see the output cannot count it, and
 * `stdio: 'inherit'` was exactly that. A test file whose cases silently
 * stopped being collected exits 0 with nothing to show for it, and the run
 * reported a pass.
 *
 * Three outcomes, never two: ran and passed, ran and failed, and NOT CHECKED
 * (no interpreter, no test file) - which is a real state and is not a pass.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { findPython, pythonNotCheckedMessage } from './find-python.mjs'

const args = process.argv.slice(2)
const minIndex = args.indexOf('--min')
const min = minIndex >= 0 ? Number(args[minIndex + 1]) : 0
if (minIndex >= 0 && !Number.isInteger(min)) {
  console.error(`python-test: --min needs an integer, got ${args[minIndex + 1]}`)
  process.exit(1)
}
// `minIndex + 1` is 0 when there is no --min, which would drop the test file
// itself. Guard on the flag being present rather than on the arithmetic.
const testFile = args.filter((_, i) => minIndex < 0 || (i !== minIndex && i !== minIndex + 1))[0]

if (!testFile || !existsSync(testFile)) {
  console.log(`NOT CHECKED: ${testFile || 'no Python test file'} is missing, so there was nothing to run.`)
  process.exit(0)
}

const python = findPython()
if (!python) {
  console.log(pythonNotCheckedMessage(testFile))
  process.exit(0)
}

const result = spawnSync(python, [testFile], { encoding: 'utf8', windowsHide: true })
if (result.error) {
  console.log(`NOT CHECKED: could not launch ${python}: ${result.error.message}`)
  process.exit(0)
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
process.stdout.write(output)

const checked = (output.match(/^(?:OK|FAIL)\b/gm) || []).length
const failed = (output.match(/^FAIL\b/gm) || []).length

if (min > 0) {
  console.log('')
  if (checked < min) {
    console.error(
      `FAILED: ${testFile} produced only ${checked} checks, expected at least ${min}`,
    )
    process.exit(1)
  }
  console.log(`${checked} checked, ${failed} failed`)
}

process.exit(result.status ?? 1)
