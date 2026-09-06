/**
 * Line gags: the parser against a fixture. No real corpus to check against -
 * Config/gags.cfg is empty on this machine - see gags.ts's header for what
 * that means for confidence in the format.
 *
 *   node tools/gags-test.mjs
 */
import { parseGags } from '../src/lib/gags.ts'
import { formatGagLine } from '../src/lib/genieConfigEdit.ts'

let checked = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseGags(`
# a comment, and a blank line

#gag {A gentle breeze blows through the area.}
#gag {}
#gag {tooMany} {a}
not a gag line at all
`)

  ok('the good ones parsed', entries.length === 1, `${entries.length} of 1`)
  ok('every bad one was reported', skipped.length === 2, `${skipped.length} skipped`)
  ok('an empty pattern is named', skipped.some((s) => s.includes('empty pattern')))
  ok('a wrong group count is named', skipped.some((s) => s.includes('2 groups')))
}

console.log('\n-- formatGagLine round-trips through the real parser --')
{
  for (const g of [
    { pattern: 'A gentle breeze blows through the area.' },
    { pattern: 'You feel a bit tired.' },
  ]) {
    const line = formatGagLine(g)
    const { entries } = parseGags(line)
    ok(`round-trips: ${line}`, entries.length === 1 && entries[0].pattern === g.pattern)
  }
}

console.log('')
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
const MIN_EXPECTED = 4
if (checked < MIN_EXPECTED) {
  console.error(`FAILED: only ${checked} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `checked`, not a pass count: the denominator has to be the number of
// checks that ran, or it shrinks by one per failure and reports a smaller
// suite on exactly the run where you need to know the size did not change.
console.log(`${checked} checked, ${failed} failed`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
process.exit(0)
