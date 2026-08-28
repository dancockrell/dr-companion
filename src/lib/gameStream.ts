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
import type {
  StreamCharacterState,
  StreamVital,
  IndicatorState,
  RoomPlayer,
  RoomItem,
} from '../types/stream'

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
   * Vitals, status icons, compass and spell, as the game last reported them.
   *
   * Accumulated here rather than emitted per line because these are *state*,
   * not text: a `progressBar` says what health is now, and the reader wants
   * the current value rather than a history of announcements. Callers read
   * this after `feed` returns - see `characterState`.
   *
   * See `src/types/stream.ts` for why vitals are parsed from `text` and never
   * `value`, why the indicator map has three states plus absence, and why
   * hands and wounds are deliberately not here.
   */
  character: StreamCharacterState
  /**
   * Whether anything on the line being built was a state tag.
   *
   * Needed to tell "a line that was nothing but tags" from "a genuinely blank
   * line". The game paragraphs with real blank lines and the parser keeps
   * them on purpose, so blanks cannot simply be dropped - but Lich's attach
   * dump is a dozen state tags and a newline with no text at all, and
   * emitting that as an empty line puts a mystery blank at the top of every
   * session's scrollback.
   */
  partialWasStateOnly: boolean
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
  /**
   * Text seen so far inside `<component id='room players'>...</component>`,
   * or `null` when not inside one.
   *
   * DragonRealms sends the entire "Also here: ..." sentence as one text node
   * with no nested tags - confirmed from Lich's own parser, which processes
   * it as a single `text_string` rather than per-`<a>` fragments the way
   * GemStone's room players do. So a plain running capture is enough; this
   * does not need the tag-awareness `partial` has.
   *
   * Mirrors `partial` rather than reusing it: the sentence must still render
   * as an ordinary line (unchanged from before this existed), and capturing
   * separately means the structured parse can't perturb what's on screen.
   */
  roomPlayersCapture: string | null
  /** Inside `<component id='room objs'>`, collecting its loot `<a>` tags. */
  inRoomObjsComponent: boolean
  /**
   * Loot found so far in the `room objs` component now open, or `null`
   * outside one. Built up across possibly several `<a>` tags and committed
   * to `state.character.roomItems` as one replacement when the component
   * closes - matching Lich's own `GameObj.commit_room_objs` on the closing
   * tag, not per item as each `<a>` resolves.
   */
  roomItemsBuilding: RoomItem[] | null
  /**
   * The `<a>` tag currently being read as one loot item, or `null` between
   * them. Only a plain (non-bold) `<a>` starts this - a bold one is a
   * creature and is left alone, see `RoomItem` for why.
   */
  roomItemCapture: { noun: string | null; text: string } | null
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
  return {
    buffer: '', stack: [], boldDepth: 0, partialBold: false, inPrompt: false,
    afterPrompt: false, afterTagBreak: false, partial: '',
    partialWasStateOnly: false, roomPlayersCapture: null,
    inRoomObjsComponent: false, roomItemsBuilding: null, roomItemCapture: null,
    // Empty rather than absent, and the two are different on purpose: an
    // empty indicator map means no icon has ever been reported, which a
    // reader must be able to tell from an icon reported as 'unknown'.
    character: {
      vitals: { value: {}, from: 'stream', at: 0 },
      indicators: { value: {}, from: 'stream', at: 0 },
    },
  }
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

/**
 * A vital from a `progressBar`'s **`text`**, never its `value`.
 *
 * This is the trap the stream routing is most likely to reintroduce, so it
 * lives in one function with the reason attached rather than inline.
 *
 * Lich's attach dump hardcodes `value='0'` on every bar it synthesises and
 * puts the real numbers in the text:
 *
 *     <progressBar id='health' value='0' text='health 100/100'/>
 *
 * Lich's own parser reads it the same way (`attributes['text'].scan(/-?d+/)`,
 * xmlparser.rb:709). A reader taking `value` shows zero health on a healthy
 * character and nothing errors anywhere: confidently wrong, which is worse
 * than blank.
 *
 * Returns null rather than guessing when the text carries no pair of numbers.
 * A bar with one number is not a vital with an unknown maximum, it is a shape
 * this does not understand, and inventing a max puts a plausible bar on screen
 * built from something nobody parsed.
 */
function vitalFromText(text: string | undefined): StreamVital | null {
  if (!text) return null
  const nums = text.match(/-?\d+/g)
  if (!nums || nums.length < 2) return null
  const current = Number(nums[0])
  const max = Number(nums[1])
  if (!Number.isFinite(current) || !Number.isFinite(max)) return null
  return { current, max }
}

/**
 * The game's three-state `visible`, kept as three states.
 *
 * 'y' and 'n' are the game speaking. Anything else - and empty is what turns
 * up, observed as `visible=''` on IconPOISONED in a real capture - is an icon
 * nobody has been told about. Collapsing that to 'off' asserts "not poisoned"
 * about something unknown.
 */
function indicatorState(visible: string | undefined): IndicatorState {
  if (visible === 'y') return 'on'
  if (visible === 'n') return 'off'
  return 'unknown'
}

/**
 * DragonRealms' `<component id='room players'>` text, split into names.
 *
 * Ported line-for-line from Lich's own `xmlparser.rb` (the `@game =~ /^DR/`
 * branch under `@active_ids.include?('room players')`), not re-derived from
 * the game's prose, because a second implementation guessing at the same
 * sentence is exactly how two parsers end up disagreeing with each other
 * instead of with the game. Lich has run this against real DragonRealms text
 * for years; this keeps its exact order of operations, including whichever
 * of its edge cases are quirks rather than intent - faithfulness to a proven
 * parser beats a "cleaner" version nobody has run.
 *
 * Order matters and mirrors the source: the who-is/parenthetical status is
 * pulled off first, then the trailing-capitalised-word noun is sliced from
 * what's left, and only after that are "the body of " and "a stunned "
 * stripped and folded into status - so `noun` can still carry either of
 * those words if they were part of it.
 *
 * Ruby's `.sub` replaces only the first match; the `.replace` calls below
 * deliberately omit the global flag to match that, including the
 * one-`and`-only splice for "A, B and C." style lists.
 */
function parseRoomPlayers(raw: string): RoomPlayer[] {
  const trimmed = raw.trim()
  // An empty component is a real answer - nobody else is here - and must not
  // become one bogus blank entry from splitting an empty string.
  if (!trimmed) return []

  const cleaned = trimmed
    .replace(/^Also here: /, '')
    .replace(/ and ([^,]+)\./, (_m, tail: string) => `, ${tail}`)

  return cleaned.split(', ').map((raw) => {
    let player = raw
    let status: string | null = null

    const whoIs = player.match(/ who is (.+)/)
    const parens = player.match(/ \((.+)\)/)
    if (whoIs) {
      status = whoIs[1]
      player = player.replace(/ who is .+/, '')
    } else if (parens) {
      status = parens[1]
      player = player.replace(/ \(.+\)/, '')
    }

    const noun = player.match(/\b[A-Z][a-z]+$/)?.[0] ?? null

    if (player.includes('the body of ')) {
      player = player.replace('the body of ', '')
      status = status ? `${status} dead` : 'dead'
    }
    if (player.includes('a stunned ')) {
      player = player.replace('a stunned ', '')
      status = status ? `${status} stunned` : 'stunned'
    }

    return { noun, name: player, status }
  })
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
    // The one exception to keeping empty lines: a line that was *nothing but
    // state tags*. Lich's attach dump is a dozen progressBar/indicator/compass
    // tags and a newline with no text at all, so without this every session
    // opens with a mystery blank at the top of its scrollback, and every
    // ongoing state update adds another.
    //
    // Different from the game's own paragraphing blank, which arrives as a
    // newline with no tags before it. The two must not be conflated -
    // dropping all blanks would wall the text back up, which is the bug the
    // "empty lines are kept" rule above exists to prevent.
    if (state.partial.length === 0 && state.partialWasStateOnly) {
      state.partialWasStateOnly = false
      state.partialBold = false
      return
    }

    out.push({
      text: state.partial,
      stream: state.stack[state.stack.length - 1] ?? '',
      bold: state.partialBold,
      prompt,
    })
    state.partial = ''
    state.partialBold = false
    state.partialWasStateOnly = false
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
        // But only while it could still become one. Two things end that.
        //
        // A newline after the '<' settles it immediately, and this is the
        // same rule `notATag` above already applies to a *closed* tag - a tag
        // never spans a line. Without it, a line like
        //
        //   the sign reads < and nothing closes it
        //
        // was held back waiting for MAX_TAG bytes that a quiet connection may
        // never send, so the whole line vanished and the game looked like it
        // had gone silent. Found by a red-team pass, and the comment that used
        // to sit here named that exact failure - "on a quiet connection, hold
        // it back indefinitely" - while only guarding the length half of it.
        const rest = state.buffer.slice(i)
        const lineEnded = rest.includes('\n') || rest.includes('\r')

        if (lineEnded || state.buffer.length - i > MAX_TAG) {
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

          // A prompt means the game is back at top level, so an unclosed
          // stream is over whether or not anyone sent `<popStream/>`.
          //
          // This is the exit from a desync, and it was missing. The rule above
          // that stops a stray '<' in game text from swallowing a real
          // `<popStream/>` closes one route *into* an orphaned stack, but a
          // Lich script that pushes a stream and dies before popping needs no
          // stray bracket at all - and on a live server that is routine rather
          // than exotic. Without this, every subsequent line is labelled
          // `thoughts` forever: "someone attacks you" delivered to a pane the
          // player is not watching, with full confidence and no error.
          //
          // Confirmed against this parser before fixing, from a red-team
          // report - stack `["thoughts"]` before the prompt and `["thoughts"]`
          // after, with the two following lines both mislabelled.
          //
          // Safe because a prompt cannot legitimately appear inside a stream:
          // it is the game's own "your turn" marker, which is top-level by
          // definition.
          if (state.stack.length > 0) state.stack.length = 0
        }
      } else if (name === 'progressbar') {
        // State, not text. See vitalFromText for why this reads `text` and
        // never `value`, and types/stream.ts for why only these five ids
        // matter to a DragonRealms client - four for everyone, plus
        // concentration for a Bard. This allowlist shipped with four and was
        // silently wrong for a Bard character until downloads-c3 checked it
        // against the bridge's own field list and found the gap.
        const a = attrs(tag)
        const id = (a.id ?? '').toLowerCase()
        const vital = vitalFromText(a.text)
        if (
          vital &&
          (id === 'health' ||
            id === 'mana' ||
            id === 'spirit' ||
            id === 'stamina' ||
            id === 'concentration')
        ) {
          state.character.vitals = {
            value: { ...state.character.vitals.value, [id]: vital },
            from: 'stream',
            at: Date.now(),
          }
        }
        state.partialWasStateOnly = state.partial.length === 0
      } else if (name === 'indicator') {
        const a = attrs(tag)
        // Ids arrive as 'IconBLEEDING'; stored as 'bleeding' so a reader is
        // not carrying the game's Hungarian prefix around. The raw id is
        // recoverable from the game if anyone ever needs it; the prefix
        // carries no information a caller wants.
        const raw = a.id ?? ''
        const key = raw.replace(/^Icon/i, '').toLowerCase()
        if (key) {
          state.character.indicators = {
            value: { ...state.character.indicators.value, [key]: indicatorState(a.visible) },
            from: 'stream',
            at: Date.now(),
          }
        }
        state.partialWasStateOnly = state.partial.length === 0
      } else if (name === 'compass') {
        // An opening <compass> replaces the previous exits rather than
        // merging: the game re-sends the whole set on every room change, and
        // merging would accumulate exits from rooms already left - a west
        // door that is not there any more is worse than no compass at all.
        if (!closing) {
          state.character.compass = { value: [], from: 'stream', at: Date.now() }
        }
        state.partialWasStateOnly = state.partial.length === 0
      } else if (name === 'dir') {
        const a = attrs(tag)
        const dir = a.value
        if (dir && state.character.compass) {
          state.character.compass = {
            value: [...state.character.compass.value, dir],
            from: 'stream',
            at: Date.now(),
          }
        }
        state.partialWasStateOnly = state.partial.length === 0
      } else if (name === 'clearstream') {
        // Not our business to clear anything: a client that dropped
        // scrollback because the game asked would lose the line somebody was
        // reading. Noted and ignored.
      } else if (name === 'component') {
        // The component's own tags carry no text and must not touch what
        // renders - only a `room players`/`room objs` component's *content*
        // is wanted, and only for structured state on the side. The room's
        // own text still displays exactly as it did before this existed.
        if (!closing) {
          const id = attrs(tag).id
          if (id === 'room players') state.roomPlayersCapture = ''
          else if (id === 'room objs') {
            state.inRoomObjsComponent = true
            state.roomItemsBuilding = []
          }
        } else if (state.roomPlayersCapture !== null) {
          state.character.roomPlayers = {
            value: parseRoomPlayers(state.roomPlayersCapture),
            from: 'stream',
            at: Date.now(),
          }
          state.roomPlayersCapture = null
        } else if (state.inRoomObjsComponent) {
          // Commits what was captured, same moment Lich's own
          // GameObj.commit_room_objs fires - once for the whole component,
          // not per item as each <a> resolves.
          state.character.roomItems = {
            value: state.roomItemsBuilding ?? [],
            from: 'stream',
            at: Date.now(),
          }
          state.inRoomObjsComponent = false
          state.roomItemsBuilding = null
          // Defensive: a malformed stream closing the component with an <a>
          // still open should not leak a half-built item into the next one.
          state.roomItemCapture = null
        }
      } else if (name === 'a' && state.inRoomObjsComponent) {
        // Bold marks a creature in room objs; only a plain <a> is loot
        // (Lich's own GameObj.new_loot path, xmlparser.rb:1080). A bold one
        // is left alone here - see RoomItem for why creatures wait on the
        // crtrStatus pairing this parser does not implement.
        if (!closing) {
          if (state.boldDepth === 0) {
            state.roomItemCapture = { noun: attrs(tag).noun ?? null, text: '' }
          }
        } else if (state.roomItemCapture !== null) {
          state.roomItemsBuilding?.push({
            noun: state.roomItemCapture.noun,
            name: state.roomItemCapture.text,
          })
          state.roomItemCapture = null
        }
      }
      // Everything else - <d>, <style>, <output> - is markup around
      // text we keep. Skipping the tag and keeping the content is what makes
      // this tolerant of a protocol that grows tags over time.
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
    if (state.roomPlayersCapture !== null) state.roomPlayersCapture += ch
    if (state.roomItemCapture !== null) state.roomItemCapture.text += ch
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

/**
 * What the stream currently knows about the character.
 *
 * A read, not an event. `progressBar` says what health *is*, so a caller
 * wants the present value rather than a history of announcements - and a
 * reader that arrives late still gets the truth rather than having missed it.
 *
 * Returned by reference on purpose: `feed` replaces these objects wholesale
 * rather than mutating them, so a caller comparing identity sees a change
 * exactly when one happened. That is what makes it usable from
 * `useSyncExternalStore` without copying on every read.
 */
export function characterState(state: StreamState): StreamCharacterState {
  return state.character
}
