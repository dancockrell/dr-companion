/**
 * Text substitutions: the parser against a fixture. No real corpus to check
 * against - Config/substitutes.cfg is empty on this machine - see
 * substitutes.ts's header for what that means for confidence in the format.
 *
 *   node tools/substitutes-test.mjs
 */
import { parseSubstitutes } from '../src/lib/substitutes.ts'
import { formatSubstituteLine } from '../src/lib/genieConfigEdit.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseSubstitutes(`
# a comment, and a blank line

#substitute {ye olde} {the}
#substitute {} {empty find}
#substitute {onearg} {}
#substitute {tooMany} {a} {b}
not a substitute line at all
`)

  ok('the good ones parsed', entries.length === 2, `${entries.length} of 2`)
  ok('every bad one was reported', skipped.length === 2, `${skipped.length} skipped`)
  ok('an empty find is named', skipped.some((s) => s.includes('empty find text')))
  ok('a wrong group count is named', skipped.some((s) => s.includes('3 groups')))

  // An empty replace is real and legal - "substitute this text with
  // nothing" is a normal use of the directive, not a malformed line.
  const onearg = entries.find((s) => s.find === 'onearg')
  ok('an empty replace parses as the empty string, not a skip', onearg?.replace === '', JSON.stringify(onearg))
}

console.log('\n-- formatSubstituteLine round-trips through the real parser --')
{
  for (const s of [
    { find: 'ye olde', replace: 'the' },
    { find: 'silence a redshirt', replace: '' },
  ]) {
    const line = formatSubstituteLine(s)
    const { entries } = parseSubstitutes(line)
    ok(
      `round-trips: ${line}`,
      entries.length === 1 && entries[0].find === s.find && entries[0].replace === s.replace
    )
  }
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
