/**
 * Genie variables: the parser against a fixture and Dan's real 46-line
 * corpus, then referencedVariables' extraction property. Read-only - see
 * variables.ts's header for why there is no write path to test.
 *
 *   node tools/variables-test.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseVariables, referencedVariables } from '../src/lib/variables.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(56)}${detail}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseVariables(`
# a comment, and a blank line

#var {roomid} {143}
#var {Time.timeOfDay} {mid-morning}
#var {} {empty name}
#var {onearg} {}
#var {tooMany} {a} {b}
not a variable line at all
`)

  ok('the good ones parsed', entries.length === 3, `${entries.length} of 3`)
  ok('every bad one was reported', skipped.length === 2, `${skipped.length} skipped`)
  ok('an empty name is named', skipped.some((s) => s.includes('empty name')))
  ok('a wrong group count is named', skipped.some((s) => s.includes('3 groups')))

  // An empty value is a real, legal entry - #var {onearg} {} is exactly
  // "the empty string", not a malformed line, unlike an empty name or a
  // missing group. Confirmed it parsed rather than got skipped.
  const onearg = entries.find((v) => v.name === 'onearg')
  ok('an empty value parses as the empty string, not a skip', onearg?.value === '', JSON.stringify(onearg))
}

console.log('\n-- the real corpus, 46 variables Genie actually tracks --')
{
  const CFG = 'C:/Genie4/Config/variables.cfg'
  if (!existsSync(CFG)) {
    console.log('SKIP the shipped corpus loads'.padEnd(60) + `not at ${CFG}`)
  } else {
    const text = readFileSync(CFG, 'utf8')
    const { entries, skipped } = parseVariables(text)
    const nonBlank = text.split('\n').filter((l) => l.trim().length > 0).length

    ok('the shipped corpus loads', entries.length >= 40, `${entries.length} of ${nonBlank} non-blank lines`)
    ok('with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    // Spot-checked against the file as read on 27 Aug 2026, not invented.
    const game = entries.find((v) => v.name === 'game')
    ok('a known entry parsed with its real value', game?.value === 'DR', game?.value ?? 'missing')
  }
}

console.log('\n-- referencedVariables finds $name tokens, in order, de-duplicated --')
{
  ok(
    'a simple reference',
    JSON.stringify(referencedVariables('appraise $0 $preposition $shop careful')) === JSON.stringify(['preposition', 'shop'])
  )
  ok(
    'a repeat is not duplicated, order is first-appearance',
    JSON.stringify(referencedVariables('$shop then $preposition then $shop again')) === JSON.stringify(['shop', 'preposition'])
  )
  ok('a dotted name is captured whole', JSON.stringify(referencedVariables('$Time.timeOfDay')) === '["Time.timeOfDay"]')
  ok('positional alias args are excluded, not mistaken for variables', JSON.stringify(referencedVariables('$0 $1 $2')) === '[]')
  ok('no dollar signs, nothing found', JSON.stringify(referencedVariables('look my backpack')) === '[]')
  ok('a bare trailing $ with nothing after it is not a token', JSON.stringify(referencedVariables('cost is $')) === '[]')
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
