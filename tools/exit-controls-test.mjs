/**
 * Travel by clicking on the words in the interface. Issue #444.
 *
 * Dan, 6 September 2026: "remove the route markers. you travel by clicking on
 * another tile or by clicking on the words in the interface or by hotkey."
 * The route markers are gone from the viewer, so this list is now one of only
 * three ways out of a room, and the property that matters is a denominator:
 * *every* exit the game reported is offered, and each control sends the exact
 * word rather than something rewritten on the way.
 *
 * # Where the exits come from, and why that matters here
 *
 * The words are not typed into this file. They are parsed out of a real
 * `<compass><dir value="..."/></compass>` block by `gameStream.ts`, which is
 * the same source `BattleColumn` reads (`stream.compass?.value`). So a parser
 * that started dropping a direction, or a control list that started dropping
 * one, both fail here - and the count is asserted against what the parser
 * found, not against a number written below, because a number written below
 * stays true when the parser returns nothing.
 *
 * # What this cannot see
 *
 * There is no DOM in this repository's test environment, so nothing here
 * renders `ExitButtons`. It asserts the pure list the component is built from
 * (`exitControls`) and then reads the component's own source to confirm it
 * renders that list and sends `control.command` - which is a weaker check than
 * a click, and is said so plainly rather than dressed up. The strong half is
 * the list; the source check exists so the list cannot be right while the
 * component quietly renders something else.
 */
import { readFileSync } from 'node:fs'
import { newStreamState, feed, characterState } from '../src/lib/gameStream.ts'
import { exitControls } from '../src/lib/roomExits.ts'

let checked = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(66)}${detail}`)
}

/** A room the game actually sends: eight compass directions plus `out`. */
const COMPASS = [
  'north', 'northeast', 'east', 'southeast',
  'south', 'southwest', 'west', 'northwest',
  'out',
]
const ROOM_TEXT =
  '<compass>' + COMPASS.map((d) => `<dir value="${d}"/>`).join('') + '</compass>\r\n'

console.log('-- the words come out of the parser, not out of this file --')
{
  const state = newStreamState()
  feed(state, ROOM_TEXT)
  const parsed = characterState(state).compass?.value ?? []
  ok('the parser found every direction the room sent',
    parsed.length === COMPASS.length, `${parsed.length} of ${COMPASS.length}`)
  ok('and they are the words themselves, in order',
    JSON.stringify(parsed) === JSON.stringify(COMPASS), JSON.stringify(parsed))

  // The denominator. Counted against what the parser produced, so a parser
  // that returns nothing collapses this to 0 of 0 and the check above is what
  // refuses it - "every exit is offered" is trivially true of no exits.
  const controls = exitControls(parsed)
  ok('every parsed exit becomes exactly one control',
    controls.length === parsed.length && parsed.length > 0,
    `${controls.length} controls for ${parsed.length} parsed exits`)

  const verbatim = controls.filter((c, i) => c.label === parsed[i] && c.command === parsed[i])
  ok('and each control sends the exact word, unrewritten',
    verbatim.length === controls.length,
    `${verbatim.length} of ${controls.length} verbatim`)
}

console.log('\n-- a multi-word exit is a command too, and must not be split --')
{
  // `go gate`, `climb ladder`, `go weaponsmith's` - the exits the viewer's
  // deleted chevrons could not draw a direction for. They are ordinary
  // DragonRealms commands and the whole string is what gets sent.
  const controls = exitControls(['go gate', "go weaponsmith's", 'climb ladder', 'up'])
  ok('four exits, four controls', controls.length === 4, JSON.stringify(controls.map((c) => c.command)))
  ok('"go gate" is sent whole', controls[0].command === 'go gate', controls[0].command)
  ok('an apostrophe survives', controls[1].command === "go weaponsmith's", controls[1].command)
}

console.log('\n-- the two cases that would otherwise be a control that does nothing --')
{
  ok('a blank entry is not offered',
    exitControls(['north', '', '   ', 'south']).length === 2,
    JSON.stringify(exitControls(['north', '', '   ', 'south'])))
  ok('a repeated direction is offered once',
    exitControls(['north', 'north', 'south']).length === 2,
    JSON.stringify(exitControls(['north', 'north', 'south']).map((c) => c.command)))
  ok('surrounding whitespace is trimmed off the command, not carried into it',
    exitControls(['  north  '])[0]?.command === 'north',
    JSON.stringify(exitControls(['  north  '])))
  ok('no exits at all is no controls', exitControls(undefined).length === 0)
  ok('and an empty list is not an error', exitControls([]).length === 0)
}

console.log('\n-- the component renders that list and sends that command --')
{
  // Weaker than a click, and named as such in this file's own doc comment. It
  // is here so the list above cannot be correct while the component ignores it.
  const source = readFileSync('src/components/room/ExitButtons.tsx', 'utf8')
  ok('ExitButtons builds its list from exitControls', /exitControls\(exits\)/.test(source))
  ok('renders one <button> per control', /controls\.map\(/.test(source) && /<button/.test(source))
  ok('and the click sends the control\'s own command',
    /onClick=\{\(\) => run\(\[control\.command\]\)\}/.test(source))
  ok('nothing else in it sends a command',
    (source.match(/run\(/g) ?? []).length === 1,
    `${(source.match(/run\(/g) ?? []).length} call(s) to run()`)
}

// The floor. Well below the real count, so it never needs touching, and high
// enough that a file that threw halfway cannot reach "no failures".
const FLOOR = 12
console.log(`\n${checked} checked, ${failed} failed`)
if (checked < FLOOR) {
  console.log(`FAILED: only ${checked} checks ran (floor ${FLOOR}); this run asserted almost nothing`)
  process.exit(1)
}
if (failed) {
  console.log('FAILED')
  process.exit(1)
}
console.log('no failures')
