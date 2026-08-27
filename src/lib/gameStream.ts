/**
 * The tagged stream Lich sends an XML-capable frontend, turned into lines.
 *
 * A frontend that claims the `xml` capability does not receive plain text. It
 * receives the game's own markup, and that markup carries things no amount of
 * pattern-matching recovers:
 *
 *     <pushStream id='thoughts'/>Someone thinks something<popStream/>
 *
 * The game is *telling* us that was a thought. Every regexp in
 * `dr-genie-settings` that identifies an arrival, a departure or a whisper is
 * guessing at something the protocol already labels - and guessing is why
 * departures took three attempts and still needed a direction match.
 *
 * See docs/ENGINE.md. Genie is registered with `xml mono` and no `streams`, so
 * Lich never sends it these. Wrayth gets them. That is the gap this closes.
 *
 * # Why this is a state machine over chunks, not a parse of lines
 *
 * Tags do not respect line endings. A `<pushStream>` can arrive in one packet
 * and its text in the next, and a line-splitter that ran first would cut a tag
 * in half and hand the parser two pieces of nothing.
 *
 * So this consumes whatever arrives, in whatever sizes, and *emits* lines. The
 * splitting is an output of parsing rather than an input to it, which is the
 * opposite of how the transport was first written and the reason that had to
 * change.
 *
 * # Why not an XML parser
 *
 * Because this is not XML. It is a twenty-year-old tag soup with unescaped
 * ampersands in creature names, attributes quoted with either kind of quote,
 * and no single root. A real parser rejects it, and a parser that rejects the
 * game is a client that shows nothing on the evening the game says something
 * unusual. This skips what it does not recognise and keeps the text, which is
 * the behaviour every working MUD client has.
 */

/** A line ready to render, with what the game said it was. */
export interface StreamLine {
  text: string
  /**
   * The channel the game put it in: 'thoughts', 'death', 'talk', 'whispers',
   * 'logons', 'room', 'inv', and so on. Empty for the main window.
   *
   * This is the game's own label, not our inference. That is the whole point.
   */
  stream: string
  /** The game marked this emphatic, usually a room title or a shout. */
  bold: boolean
  /** A prompt, which is punctuation rather than content. */
  prompt: boolean
}

export interface StreamState {
  /** Bytes seen but not yet resolved into a line or a tag. */
  buffer: string
  /** Stream stack: the game pushes and pops, and they nest. */
  stack: string[]
  boldDepth: number
  /**
   * Whether the line being built contains any bold text.
   *
   * Separate from boldDepth, and the difference is a bug the tests caught.
   * The game writes <pushBold/>title<popBold/> and *then* the newline, so by
   * the time the line is emitted the depth is back to zero and every bold
   * line reported itself as plain. Boldness is a property of the text that
   * was added, not of the parser's state when the line happens to end.
   */
  partialBold: boolean
  /**
   * Inside a <prompt>, whose content is punctuation rather than content.
   *
   * Without this the "&gt;" between the tags is rendered as its own line, and
   * then the newline after the closing tag adds a blank one - so every prompt
   * cost two lines of scrollback and neither said anything.
   */
  inPrompt: boolean
  /**
   * The closing prompt tag has been seen and its trailing newline has not.
   *
   * Cleared by the next character either way, so a prompt immediately
   * followed by real text cannot swallow the start of it.
   */
  afterPrompt: boolean
  /**
   * A tag boundary just ended a line, and its newline has not arrived.
   *
   * The game writes `<pushStream id='x'/>text<popStream/>` and then a
   * newline. The popStream already ended the line, so that newline terminates
   * something already emitted - and without this it produced an extra blank
   * line after every stream block. Cleared by any real text, so a stream
   * followed straight by more text does not lose its line ending.
   */
  afterTagBreak: boolean
  /** Text of the line being built. */
  partial: string
}

/**
 * The longest a tag may be before it is treated as literal text.
 *
 * The real ones are far shorter: the longest the game sends is a
 * `<pushStream id='...'/>` or a `<prompt time='1756300060'>`. Generous enough
 * that a tag with several attributes still parses, small enough that a stray
 * '<' in a sign cannot swallow a real tag downstream.
 */
const MAX_TAG = 256

/**
 * How deep the stream stack may go.
 *
 * Unbounded, 50,000 pushes cost 20 bytes each on the wire and grow the array
 * without limit. A real stack is one or two deep - the game pushes a channel,
 * writes, and pops. Anything past this is a malformed stream rather than a
 * nesting nobody anticipated, so the push is dropped and the depth holds
 * rather than the client growing until it stops.
 */
const MAX_STREAM_DEPTH = 32

export function newStreamState(): StreamState {
  return { buffer: '', stack: [], boldDepth: 0, partialBold: false, inPrompt: false, afterPrompt: false, afterTagBreak: false, partial: '' }
}

/**
 * The entities the game actually emits.
 *
 * Deliberately short. A full entity table would decode things the game never
 * sends, and every extra entry is a chance to mangle a literal ampersand in a
 * creature name - which the game emits raw, because it is not really XML.
 */
function unescape(s: string): string {
  if (!s.includes('&')) return s
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, so an escaped ampersand in "&amp;lt;" does not become a tag.
    .replace(/&amp;/g, '&')
}

/** Attributes, tolerating single quotes, double quotes and bare values. */
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/g)) {
    out[m[1].toLowerCase()] = unescape(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

/**
 * Feed whatever arrived. Returns the lines that completed.
 *
 * Anything incomplete stays in `state` for the next call, which is the entire
 * reason this takes a state object rather than being a pure function of a
 * string: a tag split across two socket reads has to survive the gap.
 */
export function feed(state: StreamState, chunk: string): StreamLine[] {
  const out: StreamLine[] = []
  state.buffer += chunk

  const emit = (prompt = false) => {
    // Empty lines are kept: the game paragraphs with them, and stripping them
    // turns readable output into a wall.
    out.push({
      text: state.partial,
      stream: state.stack[state.stack.length - 1] ?? '',
      bold: state.partialBold,
      prompt,
    })
    state.partial = ''
    state.partialBold = false
  }

  /** Throw away what is buffered without emitting it. */
  const discard = () => {
    state.partial = ''
    state.partialBold = false
  }

  let i = 0
  while (i < state.buffer.length) {
    const ch = state.buffer[i]

    if (ch === '<') {
      const close = state.buffer.indexOf('>', i)

      // A '<' whose '>' is far away is not a tag.
      //
      // This searched the whole buffer, and a red-team pass showed what that
      // costs. The game can send a literal '<' in ordinary text - a sign
      // reading "<NO ENTRY" - and the search then ran on to the next '>'
      // however distant, swallowing everything between as one bogus tag. That
      // ate a real <popStream/> and the newline with it, so two lines merged
      // AND the stream stack kept 'thoughts' forever.
      //
      // The result is the worst failure this parser has: not garbled text, but
      // correct text delivered to the wrong channel with full confidence. A
      // combat message in the thoughts pane is a message the player is not
      // looking at, in the one situation where not looking costs the
      // character. The docstring promises the label is the game's own rather
      // than an inference - after a stray '<' it was worse than an inference,
      // because an inference does not claim authority.
      //
      // A real tag is tens of characters. `<pushStream id='...'/>` and
      // `<prompt time='1756300060'>` are both well inside this.
      // What actually distinguishes a tag from a stray bracket is not length.
      //
      // A length bound alone was not enough, and the test proved it: in
      // "the sign reads <NO ENTRY\r\n<popStream/>", the run from the stray '<'
      // to the next '>' is about twenty characters, well inside any sane
      // limit, and it still swallowed the real <popStream/>.
      //
      // Two things a real tag in this protocol never contains:
      //
      //   a newline - tags do not span lines, only the text between them does
      //   another '<' - a second opening bracket means the first was text
      //
      // The second is the one that settles the case above, and it generalises:
      // whenever two '<' appear before a '>', the earlier one cannot have been
      // a tag, because the later one would have to be inside it.
      const body = close >= 0 ? state.buffer.slice(i + 1, close) : ''
      const notATag =
        close >= 0 &&
        (close - i > MAX_TAG || body.includes('<') || body.includes('\n') || body.includes('\r'))

      if (notATag) {
        state.partial += ch
        state.afterPrompt = false
        i++
        continue
      }

      if (close < 0) {
        // Possibly a tag split across reads: keep it and wait, rather than
        // rendering half a tag as text.
        //
        // But only while it could still become one. Past MAX_TAG with no '>',
        // this is a literal '<' and waiting for more bytes would hold back
        // text the player should be reading - and on a quiet connection, hold
        // it back indefinitely.
        if (state.buffer.length - i > MAX_TAG) {
          state.partial += ch
          state.afterPrompt = false
          i++
          continue
        }
        break
      }

      const tag = state.buffer.slice(i + 1, close)
      i = close + 1

      const name = (tag.match(/^\/?\s*([a-zA-Z][\w:-]*)/)?.[1] ?? '').toLowerCase()
      const closing = tag.startsWith('/')

      if (name === 'pushstream') {
        // A push ends the current line: the stream's content starts fresh.
        if (state.partial) { emit(); state.afterTagBreak = true }
        // Dropped rather than pushed past the ceiling. Keeping the current
        // channel is a better wrong answer than unbounded growth, and a
        // stream nested 32 deep is not something the game does.
        if (state.stack.length < MAX_STREAM_DEPTH) state.stack.push(attrs(tag).id ?? '')
      } else if (name === 'popstream') {
        if (state.partial) { emit(); state.afterTagBreak = true }
        state.stack.pop()
      } else if (name === 'pushbold' || (name === 'b' && !closing)) {
        state.boldDepth++
      } else if (name === 'popbold' || (name === 'b' && closing)) {
        state.boldDepth = Math.max(0, state.boldDepth - 1)
      } else if (name === 'prompt') {
        if (closing) {
          // The prompt's own text is punctuation. Dropped rather than
          // emitted, so a prompt costs no scrollback at all.
          //
          // The newline that follows the closing tag has to go with it, or
          // the prompt still costs a blank line - which is the bug this was
          // written to fix, moved one character to the right. Swallowing it
          // is deferred rather than done here, because the newline may not
          // have arrived in this chunk yet.
          discard()
          state.inPrompt = false
          state.afterPrompt = true
        } else {
          // Anything pending is real text that the prompt interrupted.
          if (state.partial) emit()
          state.inPrompt = true
        }
      } else if (name === 'clearstream') {
        // Not our business to clear anything: a client that dropped
        // scrollback because the game asked would lose the line somebody was
        // reading. Noted and ignored.
      }
      // Everything else - <d>, <a>, <style>, <component>, <output> - is
      // markup around text we keep. Skipping the tag and keeping the content
      // is what makes this tolerant of a protocol that grows tags over time.
      continue
    }

    if (ch === '\r') {
      i++
      continue
    }

    if (ch === '\n') {
      // A newline inside a prompt, or the one immediately after it, is part
      // of the punctuation rather than a line of its own.
      if (state.inPrompt || state.afterPrompt) discard()
      else if (state.afterTagBreak) discard()
      else emit()
      state.afterPrompt = false
      state.afterTagBreak = false
      i++
      continue
    }

    // Real text means the prompt is over, so its pending newline is not
    // pending any more. Without this, a prompt followed straight by text
    // would swallow that text's line ending.
    state.afterPrompt = false
    state.afterTagBreak = false

    state.partial += ch
    // Recorded as the text is added, not read when the line ends. The game
    // writes <pushBold/>title<popBold/> and only then the newline, so reading
    // the depth at emit time reports every bold line as plain.
    if (state.boldDepth > 0) state.partialBold = true
    i++
  }

  state.buffer = state.buffer.slice(i)

  // Guard against a malformed tag wedging the parser forever. A '<' with no
  // '>' ever arriving would otherwise grow the buffer without bound and the
  // pane would silently stop updating - the worst failure available here,
  // because it looks exactly like a quiet game.
  // A buffer this large means a '<' that never closed, which the MAX_TAG rule
  // above should now prevent. Kept as a backstop, because an unbounded buffer
  // makes the pane stop updating and that looks exactly like a quiet game.
  //
  // The content is re-fed rather than appended as literal text. Appending it
  // turned any complete tag inside the salvaged region into characters - the
  // same loss the tag bound exists to prevent, in a larger unit.
  if (state.buffer.length > 64 * 1024) {
    const salvage = state.buffer
    state.buffer = ''
    // The leading '<' is consumed as text so the re-feed cannot take the same
    // path again and recurse.
    state.partial += salvage[0] === '<' ? '<' : ''
    out.push(...feed(state, salvage.slice(salvage[0] === '<' ? 1 : 0)))
  }

  return out.map((l) => ({ ...l, text: unescape(l.text) }))
}

/**
 * Does this look like the tagged stream at all?
 *
 * Used to tell a real Lich from a plain-text source without asking anybody to
 * configure it. A stream with no tags in its first traffic is text, and text
 * runs through the same path unchanged - the parser emits it line by line and
 * every line carries an empty stream, which is exactly right.
 */
export function looksTagged(sample: string): boolean {
  return /<(pushStream|popStream|prompt|pushBold|popBold|streamWindow|component)\b/i.test(sample)
}
