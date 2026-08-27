/**
 * The stream parser, against the ways a socket actually delivers bytes.
 *
 * The interesting cases are not "does it parse a tag". They are the three
 * things a network does that a test written against a tidy string never
 * exercises: split a tag across two reads, deliver a whole room description in
 * one, and send something malformed at two in the morning.
 *
 * Every failure here is silent. A parser that loses a line shows a pane that
 * looks fine and is missing the message that mattered, and a parser that
 * wedges on a bad tag shows a pane that looks like a quiet game.
 */
import { newStreamState, feed, looksTagged } from '../src/lib/gameStream.ts'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(52)}${detail}`)
}
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))

/** Feed a whole string in one go. */
const all = (text) => feed(newStreamState(), text)

/** Feed it one character at a time, which is the worst case a socket can do. */
const byChar = (text) => {
  const s = newStreamState()
  const out = []
  for (const ch of text) out.push(...feed(s, ch))
  return out
}

console.log('-- plain text still works, because most of it is plain text --')
{
  const got = all('[The Crossing, Firulf Vista]\r\nObvious paths: east.\r\n')
  eq('two lines', got.map((l) => l.text), ['[The Crossing, Firulf Vista]', 'Obvious paths: east.'])
  eq('and no stream on either', got.map((l) => l.stream), ['', ''])
}

console.log('\n-- blank lines survive, because the game paragraphs with them --')
{
  const got = all('one\r\n\r\ntwo\r\n')
  eq('the blank is kept', got.map((l) => l.text), ['one', '', 'two'])
}

console.log('\n-- the game labels its own channels, which is the whole point --')
{
  const got = all(
    "<pushStream id='thoughts'/>Someone thinks loudly<popStream/>\r\n" +
      'You see nothing unusual.\r\n'
  )
  eq('the thought is labelled', got[0]?.stream, 'thoughts')
  eq('and its text is clean', got[0]?.text, 'Someone thinks loudly')
  eq('the next line is not', got[1]?.stream, '')
}

console.log('\n-- a tag split across two reads must not become text --')
{
  // The failure this guards: a line-first design cuts the tag in half and
  // renders "<pushStrea" into somebody's scrollback.
  const s = newStreamState()
  const a = feed(s, "<pushStream id='de")
  const b = feed(s, "ath'/>Someone was just killed<popStream/>\r\n")
  ok('nothing emitted from the half tag', a.length === 0, `${a.length}`)
  eq('and the whole tag resolves', b[0]?.stream, 'death')
  eq('with the text intact', b[0]?.text, 'Someone was just killed')
}

console.log('\n-- byte at a time gives the same answer as all at once --')
{
  const text =
    "<pushStream id='talk'/>Someone says hello<popStream/>\r\n" +
    'A shaggy mutt bounds into the area.\r\n'
  eq('same lines', byChar(text).map((l) => l.text), all(text).map((l) => l.text))
  eq('same streams', byChar(text).map((l) => l.stream), all(text).map((l) => l.stream))
}

console.log('\n-- bold is carried, and nesting does not break it --')
{
  const got = all('<pushBold/>[Riverhaven, Town Square]<popBold/>\r\nplain\r\n')
  eq('the title is bold', got[0]?.bold, true)
  eq('the next line is not', got[1]?.bold, false)
}

console.log('\n-- markup we do not know is skipped, its text is kept --')
{
  // A protocol that grows tags over time must not be able to hide text from a
  // client written before the tag existed.
  const got = all(
    'You see <d cmd="look #123">a rusty dagger</d> and <a>something new</a>.\r\n'
  )
  eq('the sentence survives whole', got[0]?.text, 'You see a rusty dagger and something new.')
}

console.log('\n-- entities, including the ampersand the game sends raw --')
{
  const got = all('Rock &amp; Roll &lt;tag&gt; &quot;quoted&quot;\r\n')
  eq('decoded once, not twice', got[0]?.text, 'Rock & Roll <tag> "quoted"')

  // Order matters: decoding &amp; first would turn "&amp;lt;" into "<".
  const tricky = all('&amp;lt;\r\n')
  eq('an escaped entity stays escaped', tricky[0]?.text, '&lt;')
}

console.log('\n-- a prompt is punctuation, not a blank line --')
{
  const got = all('You are ready.\r\n<prompt time="1234">&gt;</prompt>\r\n')
  ok('the prompt does not add an empty line', got.filter((l) => l.text === '').length === 0,
    JSON.stringify(got.map((l) => l.text)))
}

console.log('\n-- a malformed tag cannot wedge the parser forever --')
{
  // The worst failure available: a '<' whose '>' never arrives grows the
  // buffer without bound, the pane silently stops updating, and it looks
  // exactly like a quiet game.
  const s = newStreamState()
  feed(s, '<neverClosed ' + 'x'.repeat(70000))
  const after = feed(s, 'and then real text\r\n')
  ok('the parser recovered', after.length > 0, `${after.length} lines`)
  ok('and kept the real text', after.some((l) => l.text.includes('and then real text')))
}

console.log('\n-- a literal < in game text cannot capture a real tag --')
{
  // The worst failure this parser had, found by a red-team pass. The game
  // sends a literal '<' in ordinary text - a sign reading "<NO ENTRY" - and
  // the tag search ran to the next '>' however far away, swallowing a real
  // <popStream/> and its newline. Two lines merged, and the stream stack kept
  // 'thoughts' forever.
  //
  // Not garbled text: correct text delivered to the wrong channel with full
  // confidence. A combat message in the thoughts pane is one the player is not
  // looking at, in the situation where not looking costs the character.

  // The control first. Without it, "the stack is empty" proves nothing,
  // because a parser that never pushes also ends with an empty stack.
  {
    const s = newStreamState()
    const got = feed(s, "<pushStream id='thoughts'/>a private thought<popStream/>\r\nback in the room\r\n")
    eq('control: balanced push and pop', got.map((l) => [l.stream, l.text]),
      [['thoughts', 'a private thought'], ['', 'back in the room']])
    eq('control: the stack came back empty', s.stack, [])
  }

  const s = newStreamState()
  const got = feed(
    s,
    "<pushStream id='thoughts'/>the sign reads <NO ENTRY\r\n" +
      '<popStream/>back in the room\r\nthe guard nods\r\n'
  )

  ok('the popStream survived', s.stack.length === 0, JSON.stringify(s.stack))
  ok(
    'the guard is not in the thoughts channel',
    got.find((l) => l.text.includes('guard'))?.stream === '',
    got.find((l) => l.text.includes('guard'))?.stream
  )
  ok(
    'and the two lines did not merge',
    got.some((l) => l.text.includes('NO ENTRY')) && got.some((l) => l.text.includes('back in the room')),
    JSON.stringify(got.map((l) => l.text))
  )
  ok(
    'the literal bracket is shown, because that is what the sign says',
    got.some((l) => l.text.includes('<NO ENTRY')),
    JSON.stringify(got.map((l) => l.text))
  )
}

console.log('\n-- a prompt resyncs an orphaned stream stack --')
{
  // The exit from a desync, which the '<'-in-text fix above does not provide.
  // That fix closes one route *into* an orphaned stack; this covers the route
  // that needs no stray bracket at all - a Lich script that pushes a stream
  // and dies before popping, which on a live server is routine.
  //
  // Reported by a red-team pass and confirmed against this parser before
  // fixing: the stack stayed ["thoughts"] across a prompt, so every later line
  // was labelled `thoughts` forever. "someone attacks you" in a pane nobody is
  // watching, with full confidence and no error - the same shape as the bug
  // above, arriving by a different door.
  const s = newStreamState()
  feed(s, "<pushStream id='thoughts'/>a thought whose script died before popping\r\n")
  ok('control: the stack really is orphaned first', s.stack.length === 1, JSON.stringify(s.stack))

  const after = feed(
    s,
    '<prompt time="123">&gt;</prompt>\r\nyou are standing in a room\r\nsomeone attacks you\r\n'
  )
  ok('the prompt cleared it', s.stack.length === 0, JSON.stringify(s.stack))
  eq('and the lines that follow are unlabelled', after.map((l) => l.stream), ['', ''])
  ok(
    'so combat is not delivered to the thoughts pane',
    !after.some((l) => l.stream === 'thoughts'),
    JSON.stringify(after.map((l) => [l.stream, l.text]))
  )
}

console.log('\n-- an unclosed < does not swallow its line --')
{
  // A tag never spans a line, which `feed` already applies to a *closed* tag
  // and did not apply here: an unclosed '<' was held waiting for MAX_TAG bytes
  // that a quiet connection may never send, so a complete line simply vanished
  // and the game looked like it had gone silent.
  const s = newStreamState()
  const got = feed(s, 'the sign reads < and nothing closes it\r\n')
  eq('the line arrives', got.map((l) => l.text), ['the sign reads < and nothing closes it'])

  // And a genuine tag split across two reads must still be waited for, or this
  // fix would have traded one bug for the one it was written to avoid.
  const t = newStreamState()
  const half = feed(t, "<pushStream id='de")
  ok('a real split tag is still held', half.length === 0, `${half.length}`)
  const rest = feed(t, "ath'/>Someone was just killed<popStream/>\r\n")
  eq('and resolves when the rest arrives', rest[0]?.stream, 'death')
}

console.log('\n-- the stream stack has a ceiling --')
{
  // Unbounded, 50,000 pushes cost 20 bytes each on the wire and grow the array
  // without limit. A real stack is one or two deep.
  const s = newStreamState()
  feed(s, "<pushStream id='x'/>".repeat(5000))
  ok('depth is capped', s.stack.length <= 32, `${s.stack.length}`)
  // And it still works afterwards rather than being wedged.
  const after = feed(s, 'still here\r\n')
  ok('and the parser still emits', after.length === 1, JSON.stringify(after.map((l) => l.text)))
}

console.log('\n-- telling a tagged stream from plain text --')
{
  ok('tagged is detected', looksTagged("<pushStream id='thoughts'/>hello"))
  ok('a prompt counts', looksTagged('<prompt time="1">&gt;</prompt>'))
  ok('plain text is not', !looksTagged('[The Crossing, Firulf Vista]\nObvious paths: east.'))
  // Renamed. It read "a stray bracket is not markup", which describes a
  // property of `feed()` while asserting one of `looksTagged()` - so a reader
  // scanning the output had every reason to believe the parser case was
  // covered, and it was not. A red-team pass nearly skipped the whole area
  // because of that line, and the bug above was sitting in it.
  //
  // Same shape as "grep the consuming side": the name was written about the
  // property, the assertion about whatever function was convenient. When a
  // test name states a general property, check it is asserted against the
  // thing that needs it. The real coverage is in the section above.
  ok(
    'looksTagged: a stray bracket does not look tagged',
    !looksTagged('You see a <thing you cannot parse')
  )
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
