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

console.log('\n-- telling a tagged stream from plain text --')
{
  ok('tagged is detected', looksTagged("<pushStream id='thoughts'/>hello"))
  ok('a prompt counts', looksTagged('<prompt time="1">&gt;</prompt>'))
  ok('plain text is not', !looksTagged('[The Crossing, Firulf Vista]\nObvious paths: east.'))
  // A creature name with an angle bracket must not read as markup.
  ok('a stray bracket is not markup', !looksTagged('You see a <thing you cannot parse'))
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
