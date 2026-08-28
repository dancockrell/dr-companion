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

console.log("\n-- the fifth bar: a Bard's concentration --")
{
  // Every DR character sends four bars. A Bard also sends this one - Lich's
  // own comment on the bridge-fed equivalent says a Circle 1 Bard has 330 of
  // it. The parser's allowlist shipped with only the first four and was
  // silently wrong for a Bard, with nothing erroring to say a bar was
  // missing. Found by downloads-c3, checking the allowlist against the
  // bridge's own field list rather than assuming four was the whole set.
  const s = newStreamState()
  feed(s, "<progressBar id='concentration' value='0' text='concentration 250/330'/>\r\n")
  const v = characterState(s).vitals.value.concentration
  ok('concentration reads from text, same as the other four', v?.current === 250, JSON.stringify(v))
  ok('and the maximum comes through', v?.max === 330)
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

console.log('\n-- room players: ported line-for-line from Lich, not re-derived --')
{
  // DragonRealms wraps the whole sentence as one text node with no per-name
  // <a> tags (unlike GemStone) - confirmed from xmlparser.rb, not guessed.
  // A separate implementation guessing at the same English is exactly how
  // two parsers end up disagreeing with the game, so every case below is a
  // faithful port of Lich's own regex chain, including its quirks: a
  // trailing period from a name that was never part of the "and X." splice
  // survives into `name`, and blocks the noun regex's `$` anchor. That is
  // not a bug in this port - it is the same output Lich's own client has
  // produced against this exact protocol for years.
  const s = newStreamState()
  const lines1 = feed(s, "<component id='room players'>Also here: Bob and Alice.</component>\r\n")
  eq('two names split on the lone "and"', characterState(s).roomPlayers?.value, [
    { noun: 'Bob', name: 'Bob', status: null },
    { noun: 'Alice', name: 'Alice', status: null },
  ])
  eq('the sentence still renders as an ordinary line', lines1.map((l) => l.text), [
    'Also here: Bob and Alice.',
  ])
  ok('marked as coming from the stream', characterState(s).roomPlayers?.from === 'stream')
}
{
  const s = newStreamState()
  feed(s, "<component id='room players'>Also here: Bob who is kneeling.</component>\r\n")
  eq('"who is" becomes status, stripped from the name', characterState(s).roomPlayers?.value, [
    { noun: 'Bob', name: 'Bob', status: 'kneeling.' },
  ])
}
{
  const s = newStreamState()
  feed(s, "<component id='room players'>Also here: Alice (prone).</component>\r\n")
  eq('a parenthetical becomes status too', characterState(s).roomPlayers?.value, [
    // The trailing period stays on the name because only " (prone)" is
    // stripped, which is also why the noun regex - anchored on $ - cannot
    // match through it. Same quirk Lich's own regex chain has.
    { noun: null, name: 'Alice.', status: 'prone' },
  ])
}
{
  const s = newStreamState()
  feed(s, "<component id='room players'>Also here: the body of Bob.</component>\r\n")
  eq('"the body of" folds into status as dead', characterState(s).roomPlayers?.value, [
    { noun: null, name: 'Bob.', status: 'dead' },
  ])
}
{
  const s = newStreamState()
  feed(s, "<component id='room players'>Also here: a stunned troll.</component>\r\n")
  eq('"a stunned" folds into status', characterState(s).roomPlayers?.value, [
    { noun: null, name: 'troll.', status: 'stunned' },
  ])
}
{
  // An empty component is a real answer - nobody else is here - not the
  // absence of one. Distinguishing the two is the whole reason `roomPlayers`
  // is a Sourced<[]> rather than an optional list that just never fills in.
  const s = newStreamState()
  feed(s, "<component id='room players'></component>\r\n")
  eq('nobody here parses to an empty list, not one blank entry',
    characterState(s).roomPlayers?.value, [])
}
{
  // Replaces on every arrival, like compass - the game resends the whole
  // room rather than the delta, so merging would keep someone already gone.
  const s = newStreamState()
  feed(s, "<component id='room players'>Also here: Bob.</component>\r\n")
  // A lone name never passes through the "and X." splice, so its trailing
  // period survives and blocks the noun regex - same as the parenthetical
  // and "the body of" cases above; only a multi-name list loses the period.
  eq('first room has Bob', characterState(s).roomPlayers?.value, [
    { noun: null, name: 'Bob.', status: null },
  ])
  feed(s, "<component id='room players'></component>\r\n")
  eq('the next room replaces it, not merges an empty list into it',
    characterState(s).roomPlayers?.value, [])
}

console.log('\n-- room objs: only the loot half, creatures deliberately left out --')
{
  // A plain <a exist noun> is Lich's own loot shape (GameObj.new_loot,
  // xmlparser.rb:1079) - the same tag GemStone and DragonRealms both use for
  // items on the floor, unlike room players which is DR-only prose.
  const s = newStreamState()
  const lines = feed(
    s,
    "<component id='room objs'>You also see " +
      "<a exist='#1001' noun='sword'>a battered sword</a>, " +
      "<a exist='#1002' noun='cloak'>a moth-eaten cloak</a>.</component>\r\n"
  )
  eq('both plain <a> items captured', characterState(s).roomItems?.value, [
    { noun: 'sword', name: 'a battered sword' },
    { noun: 'cloak', name: 'a moth-eaten cloak' },
  ])
  eq('the room text still renders, unaffected', lines.map((l) => l.text), [
    'You also see a battered sword, a moth-eaten cloak.',
  ])
  ok('marked as coming from the stream', characterState(s).roomItems?.from === 'stream')
}
{
  // Bold marks a creature in this component; a bold <a> must be left for the
  // crtrStatus-paired implementation, not folded in as loot. This is the
  // property that keeps the roster honestly incomplete instead of wrong.
  const s = newStreamState()
  feed(
    s,
    "<component id='room objs'>" +
      "<pushBold/><a exist='#2001' noun='troll'>a hill troll</a><popBold/> is here. " +
      "<a exist='#1003' noun='coin'>a gold coin</a>.</component>\r\n"
  )
  eq('the bold creature is excluded, the plain item is not',
    characterState(s).roomItems?.value, [{ noun: 'coin', name: 'a gold coin' }])
}
{
  // Same replace-not-merge call as room players and compass: the component
  // resends the whole floor, so an empty refresh must clear what a stale
  // stack had, not leave yesterday's loot sitting there.
  const s = newStreamState()
  feed(s, "<component id='room objs'>" +
    "<a exist='#1004' noun='rock'>a plain rock</a>.</component>\r\n")
  eq('first room has the rock', characterState(s).roomItems?.value, [
    { noun: 'rock', name: 'a plain rock' },
  ])
  feed(s, "<component id='room objs'></component>\r\n")
  eq('an empty refresh replaces it, not merges an empty list into it',
    characterState(s).roomItems?.value, [])
}
{
  // room players and room objs are independent fields - routing one must not
  // touch or require the other.
  const s = newStreamState()
  feed(s, "<component id='room players'>Also here: Bob.</component>\r\n")
  feed(s, "<component id='room objs'><a exist='#1005' noun='torch'>a torch</a>.</component>\r\n")
  ok('room players survived room objs being routed too',
    characterState(s).roomPlayers?.value.length === 1)
  ok('and room objs landed on its own field',
    characterState(s).roomItems?.value.length === 1)
}

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 18, `${ran} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
