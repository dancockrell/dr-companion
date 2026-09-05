/**
 * The top bar's location line, and the two rules it exists to keep.
 *
 * From the implementation handoff's section 9:
 *
 *   1. the location carries freshness and confirmation state - "Room 998 ·
 *      confirmed 3 s ago", never a bare name;
 *   2. an unresolved location says "unresolved", and never falls back to the
 *      last known town.
 *
 * Rule 2 is the one worth a test of its own. It is not a formatting
 * preference: `character.location` keeps its last good value when the mapper
 * loses the room, so a line built from it goes on naming Crossing while the
 * character stands somewhere unknown, and nothing on screen distinguishes
 * that from a correct reading. The named town is therefore the thing to
 * assert the ABSENCE of, which is why "Crossing" appears below as a string
 * that must not survive contact with a null room.
 *
 *   node tools/location-line-test.mjs
 */
import { readFileSync } from 'node:fs'
import { ago, locationLine } from '../src/lib/locationLine.ts'

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(58)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(58)} ${detail ?? ''}`)
  }
}

console.log('-- rule 2: an unresolved location says so, and names no town --')
{
  // The exact shape D4 asks for: mapHere = null.
  const line = locationLine(null, null)
  ok('a null room is reported unresolved', line.unresolved === true, JSON.stringify(line))
  ok('the text says "unresolved"', /unresolved/i.test(line.text), line.text)
  ok('the text does not name a town', !/Crossing/i.test(line.text), line.text)

  // The failure this rule exists to prevent is subtler than a null: a room
  // object survives with its id lost while its title still names the last
  // town. That must read unresolved too, not "Crossing".
  const stale = locationLine({ id: null, title: 'Crossing, Town Green' }, 12)
  ok('a room whose id is gone is unresolved even with a title', stale.unresolved === true, JSON.stringify(stale))
  ok('and its stale title is not shown', !/Crossing/i.test(stale.text), stale.text)

  ok('undefined is treated as null, not as a room', locationLine(undefined, null).unresolved === true)
}

console.log('\n-- rule 1: a resolved location carries freshness, never a bare name --')
{
  const line = locationLine({ id: 998, title: 'Town Green' }, 3)
  ok('the room id is present', /Room 998/.test(line.text), line.text)
  ok('the confirmation age is present', /confirmed 3 s ago/.test(line.text), line.text)
  ok('it is not reported unresolved', line.unresolved === false)
  ok(
    'a bare name is never the whole line',
    line.text !== 'Town Green' && /confirmed/.test(line.text),
    line.text,
  )

  // A room with no title still has to carry freshness - the id alone is a
  // name, and rule 1 is about the freshness, not about the title.
  const untitled = locationLine({ id: 41, title: null }, 0)
  ok('an untitled room still carries its freshness', /Room 41 · confirmed/.test(untitled.text), untitled.text)
  ok(
    'an age of zero seconds is a real reading, not a missing one',
    /0 s ago/.test(untitled.text),
    untitled.text,
  )
  ok(
    'a genuinely unknown age says so rather than claiming zero',
    /just now/.test(locationLine({ id: 41 }, null).text),
    locationLine({ id: 41 }, null).text,
  )
}

console.log('\n-- the age wording --')
{
  ok('seconds', ago(3) === '3 s ago', ago(3))
  ok('the boundary into minutes', ago(60) === '1 m ago', ago(60))
  ok('minutes', ago(185) === '3 m ago', ago(185))
  ok('the boundary into hours', ago(3600) === '1 h ago', ago(3600))
  ok('a nonsense age does not print NaN', ago(Number.NaN) === 'just now', ago(Number.NaN))
}

console.log('\n-- the component actually uses this module --')
{
  // Otherwise every rule above is asserted about a function the top bar does
  // not call, which is a green suite guarding nothing.
  const bar = readFileSync(new URL('../src/components/layout/TopBar.tsx', import.meta.url), 'utf8')
  ok('TopBar imports the shared wording', /from '\.\.\/\.\.\/lib\/locationLine\.ts'/.test(bar))
  ok('TopBar renders what it returns', /locationLine\(here, age\)/.test(bar) && /\{line\.text\}/.test(bar))
  // Comments stripped first. The first version of this check read the raw
  // file and went red against TopBar's own doc comment, which explains at
  // length why it must not use `character.location` - a check that cannot
  // tell an explanation of a rule from a violation of it.
  const code = bar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  ok('the comment strip left real code behind', /useAppStore/.test(code), `${code.length} chars`)
  ok(
    'TopBar reads the mapper, not the character record',
    /s\.mapHere/.test(code) && !/character\.location/.test(code),
  )
}

console.log(`\n${pass} checks passed, ${fail} failed`)

// The denominator, derived rather than typed: every assertion written in this
// file must have run. An early return or a throw halfway down otherwise looks
// exactly like a clean pass.
const source = readFileSync(new URL(import.meta.url), 'utf8')
const declared = [...source.matchAll(/^\s+ok\(/gm)].length
const ran = pass + fail
if (ran !== declared) {
  console.log(`FAIL ${ran} of ${declared} assertions in this file ran - the rest never executed`)
  process.exit(1)
}
console.log(`   all ${declared} assertions in the file ran`)
process.exit(fail === 0 ? 0 : 1)
