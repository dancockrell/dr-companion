/**
 * The highlight engine, against the corpus it has to run and the text it has
 * to run on.
 *
 * Two things are being asserted and they are different claims:
 *
 *   1. The parser reads Genie's format. Cheap, and a config that fails to load
 *      fails loudly.
 *   2. **Real observed game lines get the colour they were written for.** That
 *      is the one that matters, and it is the same lesson dr-genie-settings
 *      learned the hard way: "the pattern is in the file" and "the pattern
 *      matches the line" are different claims, and a config that fires on
 *      nothing passes every check that only reads the file.
 *
 * The lines below were captured off the wire on 27 Aug 2026. Invented game
 * text would encode what somebody assumed DragonRealms looks like, which is
 * exactly how a GemStone mindstate ladder ended up in a DragonRealms config.
 */
import { readFileSync, existsSync } from 'node:fs'
import { parseHighlights, paint, segments } from '../src/lib/highlights.ts'

let failed = 0
const unchecked = []
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(50)}${detail}`)
}
const skip = (name, why) => {
  unchecked.push(name)
  console.log(`SKIP ${name.padEnd(50)}${why}`)
}

console.log('-- the parser reads the format, and says what it could not --')
{
  const { entries, skipped } = parseHighlights(`
# a comment, and a blank line

#highlight {line} {#FF0000} {HAS FLAGGED YOU AS IDLE} {alert} {Help.wav}
#highlight {string} {#66DDFF} {just arrived} {people}
#highlight {beginswith} {#5C7A99} {Obvious paths:} {room}
#highlight {regexp} {#4499BB} { (?:east|west)\\.$} {people}
#highlight {nonsense} {#FF0000} {x} {y}
#highlight {line} {red} {x} {y}
#highlight {line} {#FF0000} {} {y}
#highlight {regexp} {#FF0000} {([unclosed} {y}
`)

  ok('the good ones parsed', entries.length === 4, `${entries.length} of 4`)
  ok('every bad one was reported', skipped.length === 4, `${skipped.length} skipped`)
  ok('an unknown type is named', skipped.some((s) => s.includes('nonsense')))
  ok('a bad colour is named', skipped.some((s) => s.includes('not a colour')))
  ok('an empty pattern is named', skipped.some((s) => s.includes('empty pattern')))

  // The one Genie itself gets wrong: it drops a malformed regexp in silence,
  // so the alert you thought you had never fires and nothing tells you.
  ok('a regexp that will not compile is named', skipped.some((s) => s.includes('([unclosed')))
}

console.log('\n-- line and string are different, which is most of the point --')
{
  const { entries } = parseHighlights(`
#highlight {line} {#FF0000} {bleeding} {wounds}
#highlight {string} {#66DDFF} {black lynx} {people}
`)

  const whole = paint('You are bleeding from a wound.', entries)
  ok('line claims the whole line', whole.lineColour === '#FF0000', whole.lineColour ?? 'none')
  ok('and adds no substring span', whole.spans.length === 0, `${whole.spans.length}`)

  const part = paint('You notice as a black lynx pads into the area.', entries)
  ok('string does not claim the line', part.lineColour === undefined, part.lineColour ?? 'none')
  ok('string colours just the match', part.spans.length === 1, `${part.spans.length} spans`)

  const cut = segments('You notice as a black lynx pads into the area.', part)
  ok('the line is cut into three', cut.length === 3, `${cut.length} pieces`)
  ok('the middle piece is the creature', cut[1]?.text === 'black lynx', cut[1]?.text ?? '')
  ok(
    'and rejoining gives the line back',
    cut.map((c) => c.text).join('') === 'You notice as a black lynx pads into the area.'
  )
}

console.log('\n-- beginswith survives the indentation the game actually uses --')
{
  const { entries } = parseHighlights('#highlight {beginswith} {#7FB069} {Performance} {learning}')
  // The experience window indents every row. A beginswith that failed on that
  // would be a rule nobody could ever make work.
  const p = paint('     Performance:      5 07% perusing       (2/34)', entries)
  ok('an indented row still matches', p.lineColour === '#7FB069', p.lineColour ?? 'none')
}

console.log('\n-- classes switch off, the way #class people off does --')
{
  const { entries } = parseHighlights('#highlight {line} {#66DDFF} {just arrived} {people}')
  ok('on by default', paint('Wipsy just arrived.', entries).lineColour === '#66DDFF')
  ok(
    'and off when the class is off',
    paint('Wipsy just arrived.', entries, new Set(['people'])).lineColour === undefined
  )
}

console.log('\n-- overlapping spans cannot duplicate the text --')
{
  // Two entries matching overlapping stretches. Rendered naively this produces
  // crossing spans and the text comes out twice, which is the kind of bug that
  // looks like the game sent something strange.
  const { entries } = parseHighlights(`
#highlight {string} {#FF0000} {black lynx pads} {a}
#highlight {string} {#00FF00} {lynx pads into} {b}
`)
  const line = 'a black lynx pads into the area'
  const p = paint(line, entries)
  ok('overlaps are resolved to one', p.spans.length === 1, `${p.spans.length}`)
  ok('and the text is intact', segments(line, p).map((s) => s.text).join('') === line)
}

console.log('\n-- the real corpus, against the real lines it was written for --')
{
  const CFG = 'C:/Users/Admin/dev/dr-genie-settings/Config/highlights.cfg'
  if (!existsSync(CFG)) {
    // Not a pass. The instrument is missing and the summary has to say so.
    skip('the shipped corpus loads', `not at ${CFG}`)
    skip('every observed line gets a colour', 'no corpus to run')
  } else {
    const { entries, skipped } = parseHighlights(readFileSync(CFG, 'utf8'))

    // The fragile denominator: every assertion below is trivially true against
    // an empty entry list, which is what a broken parser produces.
    ok('the shipped corpus loads', entries.length >= 40, `${entries.length} entries`)
    ok('with nothing skipped', skipped.length === 0, skipped.slice(0, 2).join('; '))

    const OBSERVED = [
      ['GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!', 'idle warning'],
      ['Wipsy just arrived.', 'player arrives'],
      ['Commoner Brommoner hobbles east.', 'player leaves, odd verb'],
      ['A shaggy mutt bounds into the area.', 'creature arrives'],
      ['The black lynx pads off.', 'creature leaves'],
      ['     Performance:      5 07% perusing       (2/34)', 'an experience row'],
      ['You feel fully attuned to the mana streams again.', 'mana'],
      ['Obvious paths: east, south, west.', 'room block'],
      ['You are relaxed and your mind has entered a light state of rest.', 'resting'],
      ['The armor on your head makes playing your cocobolo txistu more difficult.', 'the helm'],
    ]

    const bare = OBSERVED.filter(([line]) => {
      const p = paint(line, entries)
      return p.lineColour === undefined && p.spans.length === 0
    })
    ok(
      'every observed line gets a colour',
      bare.length === 0,
      bare.length ? bare.map(([, why]) => why).join(', ') : `${OBSERVED.length} lines`
    )

    // The alerts that cost a session have to reach the ear, not just the eye.
    const idle = paint('GENIE HAS FLAGGED YOU AS IDLE, PLEASE RESPOND!', entries)
    ok('the idle warning still makes a sound', idle.sounds.length > 0, idle.sounds.join(', '))

    // And the line that fires several times a minute must not.
    const mana = paint('You feel fully attuned to the mana streams again.', entries)
    ok('the most frequent line stays silent', mana.sounds.length === 0, mana.sounds.join(', '))
  }
}

console.log(
  failed
    ? `\n${failed} failed`
    : unchecked.length
      ? `\nno failures, but ${unchecked.length} not checked: ${unchecked.join(', ')}`
      : '\nall passed'
)
process.exit(failed ? 1 : 0)
