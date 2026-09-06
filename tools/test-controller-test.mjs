import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const suites = JSON.parse(readFileSync('tools/test-suites.json', 'utf8'))
const runner = readFileSync('tools/run-tests.mjs', 'utf8')
let checked = 0
let failures = 0

function check(label, value, detail = '') {
  checked++
  console.log(`${value ? 'OK  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`)
  if (!value) failures++
}

check('npm test delegates to the reporting controller', pkg.scripts.test === 'node tools/run-tests.mjs')
check('test:all is an exact compatibility alias', pkg.scripts['test:all'] === pkg.scripts.test)
check('the suite manifest is substantial', suites.length >= 75, `${suites.length} suites`)
check('the suite manifest has no duplicates', new Set(suites).size === suites.length)
check('every listed suite has an npm script', suites.every((name) => typeof pkg.scripts[name] === 'string'))
check('the controller cannot schedule itself recursively', !suites.includes('test') && !suites.includes('test:all'))
check('the controller reads the explicit manifest', /test-suites\.json/.test(runner))
check('the obsolete stop-on-first-failure chain is gone', !pkg.scripts.test.includes('&&'))

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 5
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failures} failed`)
if (failures) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
