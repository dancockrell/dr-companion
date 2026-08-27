/**
 * The game text, as it arrives.
 *
 * The Rust side (`src-tauri/src/game_link.rs`) holds the socket to Lich and
 * emits one `game:line` per line off the wire. This holds them, and decides
 * how many is too many.
 *
 * Deliberately outside the Zustand store. A busy room produces a line every
 * few hundred milliseconds - eighteen movement events in ninety seconds was
 * measured in Firulf Vista, each reprinting the room - and routing every one
 * through a store that a dozen components subscribe to re-renders the whole
 * dashboard to add a line of text to one pane. The pane subscribes here; the
 * map and the vitals never hear about it.
 *
 * See docs/ENGINE.md.
 */
import { listenTauri, invokeTauri, isTauri } from './tauri'
import { feed, newStreamState, looksTagged } from './gameStream'

export interface GameLine {
  seq: number
  text: string
  /**
   * The channel the game put this in - 'thoughts', 'death', 'talk' - or empty
   * for the main window.
   *
   * The game's own label, not our inference. A frontend claiming the `xml`
   * capability is told which channel a line belongs to; Genie is registered
   * without `streams` and never receives it. See docs/ENGINE.md.
   */
  stream: string
  /** The game marked this emphatic: a room title, a shout. */
  bold: boolean
}

export interface LinkState {
  connected: boolean
  host: string
  port: number
  lines: number
  note: string
}

/**
 * How much scrollback is kept.
 *
 * Twenty thousand lines is roughly a long evening in a busy room. Past that
 * the oldest go, because a client that grows without limit is one that has to
 * be restarted, and restarting is exactly what you cannot do mid-hunt.
 *
 * Kept in a plain array with a shift-when-full rather than a ring buffer with
 * an offset. A ring is faster and the difference is unmeasurable at this size,
 * where an array is something anybody can read and reason about.
 */
const MAX_LINES = 20000

/** Dropped when the buffer is full, so "old text is gone" is a fact, not a mystery. */
let dropped = 0

let buffer: GameLine[] = []
const listeners = new Set<() => void>()

let state: LinkState = {
  connected: false,
  host: '',
  port: 0,
  lines: 0,
  note: 'Not attached.',
}

/**
 * Notify on a frame rather than per line.
 *
 * The game can deliver a burst - a room description is four lines that arrive
 * together - and re-rendering four times to show four lines is three renders
 * nobody asked for. Coalescing to the next animation frame turns a burst into
 * one update and costs nothing on a quiet connection.
 */
let pending = false
function notify() {
  if (pending) return
  pending = true
  requestAnimationFrame(() => {
    pending = false
    for (const fn of listeners) fn()
  })
}

/**
 * The parser between the socket and the buffer.
 *
 * What arrives from Rust is a *chunk* - bytes up to and including a newline,
 * which is a convenient place to stop reading and nothing more. Tags do not
 * respect line endings, so the boundary the socket happened to give us is not
 * the boundary the text has.
 *
 * Everything goes through here, tagged or not. Plain text emerges as one line
 * per newline with an empty stream, which is exactly right and means there is
 * no second code path to keep working.
 */
const parser = newStreamState()

/** Sequence numbers are assigned here now, because one chunk can be many lines. */
let nextSeq = 0

/** Whether the source has ever looked like the tagged stream. */
let tagged = false
export function isTaggedStream() {
  return tagged
}

let wired = false
function wire() {
  if (wired || !isTauri()) return
  wired = true

  listenTauri<{ seq: number; text: string }>('game:line', (chunk) => {
    if (!tagged && looksTagged(chunk.text)) tagged = true

    for (const parsed of feed(parser, chunk.text)) {
      buffer.push({
        seq: ++nextSeq,
        text: parsed.text,
        stream: parsed.stream,
        bold: parsed.bold,
      })
    }

    if (buffer.length > MAX_LINES) {
      dropped += buffer.length - MAX_LINES
      buffer = buffer.slice(-MAX_LINES)
    }
    version++

    // A line arriving is proof the socket is open.
    //
    // This used to be `{ ...state, lines: nextSeq }`, which carried the old
    // `connected` forward - so once the frontend believed the link was down,
    // it believed it forever while game text poured into the pane behind the
    // words "not attached". Caught against a live DragonRealms session: Rust
    // reported `connected: true, lines: 270`, real game text was rendering,
    // and the header still offered an Attach button that then refused with
    // "Already attached".
    //
    // Not an inference. `game:line` is emitted only by the reader thread, and
    // only while it is running - the event cannot arrive from a closed
    // socket. Deriving `connected` from it is reading a fact, and it makes
    // the state self-healing rather than dependent on never missing an event.
    state = {
      ...state,
      connected: true,
      lines: nextSeq,
      note: state.connected ? state.note : '',
    }
    notify()
  })

  listenTauri<LinkState>('game:state', (s) => {
    state = s
    notify()
  })
}

export function subscribeGame(fn: () => void): () => void {
  wire()
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * A number that changes whenever the buffer does.
 *
 * This is what React subscribes to; `gameLines()` is a plain read taken after
 * it. The obvious arrangement - subscribing to the array itself - does not
 * work here, and it fails silently, which is why this exists.
 *
 * `buffer.push(...)` mutates in place, so `gameLines()` hands back the same
 * array reference forever. `useSyncExternalStore` compares snapshots with
 * Object.is and sees no change, and a `useMemo(..., [lines])` never recomputes.
 * The game pane appeared to work regardless, because it also subscribes to
 * `gameState()`, which is rebuilt on every chunk and dragged the re-render
 * along behind it. The channel tabs subscribe only to the lines. They never
 * appeared at all.
 *
 * Measured in the running app rather than reasoned about: attached to the
 * replay fixture, 924 lines received, the text of the `thoughts`, `death` and
 * `talk` channels all visibly on screen, and the tab row still reading "no
 * channels yet". The one feature this client is built around did not work, and
 * every test passed, because the tests call the parser directly and no test
 * renders a component.
 *
 * A counter rather than copying the array on each change: a room description is
 * four lines arriving together, and at 20,000 lines a copy per chunk is real
 * work to produce a value nothing keeps.
 */
let version = 0

export function gameVersion(): number {
  return version
}

export function gameLines(): GameLine[] {
  return buffer
}

export function gameState(): LinkState {
  return state
}

export function gameDropped(): number {
  return dropped
}

export async function attachGame(port: number, host?: string): Promise<LinkState> {
  wire()
  try {
    state = (await invokeTauri('game_attach', { host: host ?? null, port })) as LinkState
    notify()
    return state
  } catch (e) {
    // A refusal is information about the real state, so use it rather than
    // dropping it on the floor.
    //
    // The backend refuses a second attach with "Already attached to host:port"
    // - which means it is connected, and the only reason this call happened is
    // that the frontend thought otherwise. Left as a bare throw, the two sides
    // stayed disagreeing: the UI kept offering Attach, every press was refused,
    // and the only way out was restarting the app - which on a live session
    // means dropping the character's connection to fix a display bug.
    //
    // Asking the backend what is actually true costs one call and turns a
    // dead end into a correction.
    try {
      state = (await invokeTauri('game_status')) as LinkState
      notify()
    } catch {
      // The status call failed too, so the backend is genuinely unreachable.
      // Let the original error stand rather than inventing a state.
    }
    throw e
  }
}

export async function detachGame(): Promise<LinkState> {
  state = (await invokeTauri('game_detach')) as LinkState
  notify()
  return state
}

export async function sendGame(command: string): Promise<void> {
  await invokeTauri('game_send', { command })
}

export async function refreshGameState(): Promise<LinkState> {
  wire()
  state = (await invokeTauri('game_status')) as LinkState
  notify()
  return state
}

/** Empty the scrollback. The socket is untouched. */
export function clearGame() {
  buffer = []
  dropped = 0
  version++
  notify()
}

/**
 * Only the lines from one channel.
 *
 * The point of receiving streams: thoughts, deaths and speech can each have a
 * pane without a single pattern being written. Genie users build named windows
 * by hand out of highlights to fake this.
 */
export function gameLinesFrom(stream: string): GameLine[] {
  return buffer.filter((l) => l.stream === stream)
}

/** Which channels have actually been seen, so a UI can offer only real ones. */
export function gameStreams(): string[] {
  return [...new Set(buffer.map((l) => l.stream).filter(Boolean))].sort()
}
