/**
 * The game's structured tags, routed to state rather than dropped.
 *
 * Every shape here is real. They come from Lich's own source -
 * `detachable_client_send_init` (global_defs.rb:2306) for the attach dump and
 * `XMLParser#tag_start` (xmlparser.rb:698, :788) for the ongoing parse -
 * cross-checked against 22 seconds of wire capture from a live DragonRealms
 * session. Nothing below is a guess at what the protocol looks like, which
 * matters because a fixture that encodes a guess produces a parser and a test
 * that agree with each other and disagree with the game.
 *
 * The headline case is `value` versus `text`, and it is first because it is
 * the one a future refactor is most likely to reintroduce: it produces a
 * confidently wrong panel rather than a blank one, and nothing errors.
 */
import { newStreamState, feed, characterState } from '../src/lib/gameStream.ts'

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${detail}`)
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))

console.log('-- vitals come from text, never from value --')
{
  // The trap, stated as a test. Lich hardcodes value='0' in the attach dump
  // and puts the real numbers in text; its own parser reads text. A reader
  // taking value shows zero health on a healthy character.
  const s = newStreamState()
  feed(s, "<progressBar id='health' value='0' text='health 100/100'/>\r\n")
  const v = characterState(s).vitals.value.health
  ok('health reads 100, not the value="0" beside it', v?.current === 100, JSON.stringify(v))
  ok('and the maximum comes through', v?.max === 100)
}

console.log('\n-- all four bars DragonRealms sends --')
{
  const s = newStreamState()
  feed(
    s,
    "<progressBar id='mana' value='0' text='mana 98/100'/>" +
      "<progressBar id='spirit' value='0' text='spirit 100/100'/>" +
      "<progressBar id='stamina' value='0' text='stamina 96/100'/>\r\n"
  )
  const v = characterState(s).vitals.value
  eq('mana', v.mana, { current: 98, max: 100 })
  eq('spirit', v.spirit, { current: 100, max: 100 })
  eq('stamina', v.stamina, { current: 96, max: 100 })
}

console.log('\n-- a bar this does not understand is left out, not guessed --')
{
  // One number is not "a vital with an unknown maximum". Inventing a max
  // would put a plausible bar on screen built from something nobody parsed.
  const s = newStreamState()
  feed(s, "<progressBar id='health' value='0' text='health 100'/>\r\n")
  ok('a single number yields no vital', characterState(s).vitals.value.health === undefined)

  const t = newStreamState()
  feed(t, "<progressBar id='pbarStance' value='80' text='Offensive'/>\r\n")
  ok(
    'a GemStone-only bar is ignored rather than stored',
    characterState(t).vitals.value.health === undefined &&
      Object.keys(characterState(t).vitals.value).length === 0
  )
}

console.log('\n-- indicators keep the three states the game uses --')
{
  const s = newStreamState()
  feed(
    s,
    "<indicator id='IconSTANDING' visible='y'/>" +
      "<indicator id='IconKNEELING' visible='n'/>" +
      "<indicator id='IconPOISONED' visible=''/>\r\n"
  )
  const ind = characterState(s).indicators.value
  ok("'y' is on", ind.standing === 'on', ind.standing)
  ok("'n' is off", ind.kneeling === 'off', ind.kneeling)
  // Observed as visible='' on IconPOISONED in a real capture. Collapsing this
  // to 'off' asserts "not poisoned" about something nobody has been told.
  ok("empty is unknown, not off", ind.poisoned === 'unknown', ind.poisoned)
  // Absence is a fourth state and it is meaningful: never reported at all.
  ok('an icon never sent is absent, not unknown', ind.bleeding === undefined)
}

console.log('\n-- the compass replaces, it does not accumulate --')
{
  // The game re-sends the whole set on every room change. Merging would keep
  // a west door from a room already left, which is worse than no compass.
  const s = newStreamState()
  feed(s, "<compass><dir value='e'/><dir value='s'/></compass>\r\n")
  eq('first room', characterState(s).compass?.value, ['e', 's'])
  feed(s, "<compass><dir value='n'/></compass>\r\n")
  eq('second room replaces the first', characterState(s).compass?.value, ['n'])
}

console.log('\n-- provenance travels with the value --')
{
  const s = newStreamState()
  feed(s, "<progressBar id='health' value='0' text='health 42/100'/>\r\n")
  const v = characterState(s).vitals
  ok('marked as coming from the stream', v.from === 'stream', v.from)
  ok('and timestamped, so precedence can be decided', v.at > 0, String(v.at))
}

console.log('\n-- the attach dump does not leave a blank line in the pane --')
{
  // Lich sends the whole dump as a single write (`puts_main_stream(init_str)`),
  // a dozen tags and a newline with no text. Emitted naively that is a
  // mystery blank at the top of every session.
  const s = newStreamState()
  const dump =
    "<progressBar id='health' value='0' text='health 100/100'/>" +
    "<indicator id='IconSTANDING' visible='y'/>" +
    "<compass><dir value='e'/></compass>\r\n"
  eq('nothing is rendered for a tags-only line', feed(s, dump).map((l) => l.text), [])
  ok('but the state landed', characterState(s).vitals.value.health?.current === 100)
}

console.log('\n-- and the game\'s own blank lines still survive --')
{
  // The reason tag-only suppression is conditional rather than "drop blanks".
  // The game paragraphs with real blank lines and stripping them walls the
  // text up - which is the bug the parser's "empty lines are kept" rule
  // exists to prevent.
  const s = newStreamState()
  eq(
    'paragraphing is untouched',
    feed(s, 'one\r\n\r\ntwo\r\n').map((l) => l.text),
    ['one', '', 'two']
  )
}

console.log('\n-- state tags mixed with text on one line --')
{
  const s = newStreamState()
  const got = feed(s, "<indicator id='IconPRONE' visible='n'/>You stand up.\r\n")
  eq('the text is kept', got.map((l) => l.text), ['You stand up.'])
  ok('and the state was still read', characterState(s).indicators.value.prone === 'off')
}

console.log('\n-- split across reads, as a socket delivers it --')
{
  const s = newStreamState()
  const a = feed(s, "<progressBar id='health' value='0' text='hea")
  ok('nothing emitted from half a tag', a.length === 0, `${a.length}`)
  feed(s, "lth 73/100'/>\r\n")
  ok('and it resolves when the rest arrives', characterState(s).vitals.value.health?.current === 73,
    JSON.stringify(characterState(s).vitals.value.health))
}

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 18, `${ran} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
