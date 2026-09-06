// Battle action bar discoverability contract.
//
// Every assertion below was a top-level `assert.match(...)`, which has two
// costs the rest of the suite does not pay: the run stops at the first
// failure, so one broken pattern hides every later one; and it prints nothing
// per check, so `tools/run-tests.mjs` - which counts `OK`/`FAIL` lines -
// recorded this file as **zero checks**. Zero checks is indistinguishable
// from a file that asserted nothing, which is why the runner calls that state
// NOT RUN. The assertions are unchanged; they are now counted, and all of
// them run.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/room/BattleActionBar.tsx', import.meta.url), 'utf8')

let pass = 0
let fail = 0
const check = (label, fn) => {
  try {
    fn()
    console.log(`OK   ${label}`)
    pass++
  } catch (e) {
    console.log(`FAIL ${label} - ${String(e.message).split('\n')[0]}`)
    fail++
  }
}

for (const label of ['Fight', 'Heal', 'Hunt', 'Items', 'Magic', 'Travel', 'Info']) {
  check(`the ${label} group has a visible name`, () =>
    assert.match(source, new RegExp(`['"]${label}['"]`), `${label} group must have a visible name`))
}
check('actions are searchable through a real search input', () => assert.match(source, /type="search"/))
check('the search box says what it matches', () => assert.match(source, /Name or command/))
check('a variation carries its label, its note and its commands', () =>
  assert.match(source, /variation\.label.*variation\.note.*variation\.commands/s))
check('hovering a variation explains it', () => assert.match(source, /onMouseEnter=/))
check('focusing a variation explains it too, for keyboard users', () => assert.match(source, /onFocus=/))
check('the explanation is announced to a screen reader', () => assert.match(source, /aria-live="polite"/))
check('the explanation names the exact commands that will be sent', () =>
  assert.match(source, /Runs: \{explained\.commands\.join/))
check('clicking a variation runs its commands', () =>
  assert.match(source, /onClick=\{\(\) => run\(variation\.commands\)\}/))

console.log('')
const total = pass + fail
// Far below the real count (15) on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 10
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `total`, not `pass`: the denominator has to be the number of checks that
// ran, or it shrinks by one per failure and reports a smaller suite on
// exactly the run where you need to know the size did not change.
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('battle action discoverability contract passed')
