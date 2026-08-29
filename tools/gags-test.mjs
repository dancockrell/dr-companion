/**
 * Line gags: the parser against a fixture. No real corpus to check against -
 * Config/gags.cfg is empty on this machine - see gags.ts's header for what
 * that means for confidence in the format.
 *
 *   node tools/gags-test.mjs
 */
import { parseGags } from '../src/lib/gags.ts'
import { formatGagLine } from '../src/lib/genieConfigEdit.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
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

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
