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
import { listenTauri, invokeTauri, isTauri } from './tauri.ts'
import { feed, newStreamState, looksTagged, characterState } from './gameStream.ts'
import type { StreamCharacterState } from '../types/stream'
import { validateGameCommand } from './gameCommand.ts'
import type { CommandSource } from './commandLane.ts'

export interface GameLine {
  seq: number
  /** Wall-clock time captured by native when this wire chunk arrived. */
  receivedAtMs: number
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

/**
 * Whether Lich itself is still there, which is not the same question as
 * whether we are attached to it.
 *
 * Lich exits when the game server hangs up - `reason=game_eof` in its own log -
 * and takes its listening ports with it. Before this field the app reported
 * that as `Connection lost`, byte-identical to an attach simply dropping. So
 * every instinct says press Attach, Attach cannot possibly work, and the
 * player goes looking for a fault in the client. It also accounts for the
 * disconnections nobody on this machine could explain tonight.
 *
 * Three states, not two, and the third is the point: a probe that could not
 * answer must not be reported as either. Calling an unreachable Lich "gone"
 * sends somebody to restart a process that is running perfectly, which is the
 * exact mistake inverted.
 */
export type LichPresence = 'alive' | 'gone' | 'unknown'

export interface LinkState {
  connected: boolean
  host: string
  port: number
  /**
   * Whether the link is between sockets rather than without one.
   *
   * Optional for the same reason `lich` is: a hot-reloaded frontend can outrun
   * the Rust binary it is talking to, and an absent field has to degrade to the
   * old two-state reading rather than to a wrong claim. {@link linkPhase} reads
   * it with `??` for exactly that case.
   */
  reconnecting?: boolean
  /**
   * Which re-dial is under way, 1-based and 0 when none is - and, once a run
   * has given up, the count it spent. Carried into the give-up state on
   * purpose: "gave up after 6 attempts" is a fact a player can act on, where
   * "could not connect" is the same sentence as the very first refusal.
   */
  attempt?: number
  /**
   * The bound, published by Rust rather than duplicated here, so the UI can say
   * "3 of 6" without a second copy of the number to forget to update.
   */
  maxAttempts?: number
  lines: number
  note: string
  /**
   * Set by a probe of the port, on the Rust side. **Expect it to change after
   * a disconnect**: establishing "gone" on Windows takes a plain `connect` and
   * about two seconds, against 119µs when something is listening, so the
   * disconnect is emitted at once as `unknown` and a second `game:state`
   * follows when the probe knows. Rendering the first event immediately and
   * letting the second refine it is deliberate - it reads as the app finding
   * out, which is what happened. See src-tauri/src/game_link.rs.
   *
   * Optional here rather than required, because a hot-reloaded frontend can
   * outrun the Rust binary it is talking to, and an absent field is exactly
   * the "could not determine" case the type already has a name for.
   */
  lich?: LichPresence
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
  lich: 'unknown',
}

/**
 * What the UI should say about Lich, given the probe.
 *
 * Kept here rather than in the component so there is one wording of it, and
 * so the `unknown` case cannot quietly acquire a claim later: it returns
 * `null`, and a caller with nothing to add says nothing about Lich at all.
 */
/**
 * Which of the link's states this is, as one word.
 *
 * Four, not two, and every consumer reads them from here rather than testing
 * `connected` and inventing the rest. The two that used to be folded together
 * are `reconnecting` and `gave-up`: both are "not connected", and they ask
 * opposite things of the player - wait, versus go and look at Lich - so a UI
 * that shows one sentence for both is telling half its readers the wrong
 * thing.
 *
 * `idle` is the honest fourth: never attached, or deliberately detached. It is
 * separate from `gave-up` because a link that never tried and one that tried
 * six times and stopped are different facts, and only one of them is a
 * failure.
 *
 * Defensive against an older Rust binary on purpose - see `reconnecting` on
 * {@link LinkState}. With the field absent this returns `connected` or `idle`,
 * which is exactly the behaviour that predates it.
 */
export type LinkPhase = 'connected' | 'reconnecting' | 'gave-up' | 'idle'

export function linkPhase(s: LinkState): LinkPhase {
  if (s.connected) return 'connected'
  if (s.reconnecting ?? false) return 'reconnecting'
  // A spent attempt count with no reconnect in flight is a run that ended.
  // `?? 0` and not `|| 0`: the field is a number and 0 is meaningful.
  if ((s.attempt ?? 0) > 0) return 'gave-up'
  return 'idle'
}

/**
 * What the link bar shows, in one place so the wording cannot drift between
 * the two bars that show it.
 *
 * Returns `null` for `idle` and `connected`: those already have their own
 * treatment in both bars, and a badge that is always on screen is furniture
 * that gets skimmed on the day it changes.
 */
export function linkPhaseLabel(s: LinkState): string | null {
  switch (linkPhase(s)) {
    case 'reconnecting':
      return `Reconnecting ${s.attempt ?? 0}/${s.maxAttempts ?? 0}`
    case 'gave-up':
      return `Link lost after ${s.attempt ?? 0} attempts`
    default:
      return null
  }
}

export function lichNote(lich: LichPresence | undefined): string | null {
  if (lich === 'gone') return 'Lich has exited — restart Lich, then Attach.'
  if (lich === 'alive') return 'Lich is still running — press Attach to reconnect.'
  return null
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
let parser = newStreamState()

/**
 * Drop everything the tag parser has learned so far - vitals, indicators,
 * compass, room occupants, room title.
 *
 * `parser` used to live for the module's whole lifetime, so a detach and a
 * fresh attach to a different character kept the old one's last-known health,
 * mana, and posture flags (bleeding/poisoned/etc.) on screen. `vitals.ts` and
 * `situation.ts` both prefer the stream's answer over the bridge's whenever
 * the stream has one at all, so the new character's UI would keep reporting
 * the previous character's state, with full confidence, until the game
 * happened to resend every one of those tags on its own. Call this anywhere
 * the underlying connection is known to no longer describe the same session.
 */
function resetStream() {
  parser = newStreamState()
}

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

  listenTauri<GameChunk>('game:line', (chunk) => {
    // Queued, not applied, until the backlog has been merged. Applying now
    // would double-render every chunk the backlog also contains, and the
    // backlog is what makes the pane survive a remount at all.
    if (!backfilled) {
      queued.push(chunk)
      return
    }
    applyChunk(chunk)
  })

  void backfill()

  listenTauri<LinkState>('game:state', (s) => {
    state = adopt(s)
    notify()
  })

  /**
   * A reconnect landed. Throw away what the tag parser knows and go and get
   * the state again.
   *
   * An *edge*, deliberately, not a flag on `game:state`: the reset below must
   * happen once per reconnect, and a level would re-run it on every later
   * state event for as long as the flag stayed set.
   *
   * The reset is the point. `parser` accumulates vitals, indicators, compass
   * and room occupants, and `vitals.ts` and `situation.ts` both prefer the
   * stream's answer over the bridge's whenever the stream has one at all - so
   * without this, a character's health from before the drop keeps being
   * reported, with full confidence, as current. Same reasoning as
   * `resetStream` on attach; a reconnect is the case that was missing.
   *
   * Lich replays part of the state on a fresh accept, so some of it comes back
   * on its own — four progress bars, a spell, seven indicators and a compass
   * (`global_defs.rb:2306-2343`), after a wait of up to ten seconds
   * (`:2307`). Room, occupants, roundtime and scripts are not in that replay
   * at all, which is what `linkReplay.ts` asks the bridge for.
   */
  listenTauri<number>('game:reconnected', () => {
    resetStream()
    for (const fn of reconnectListeners) fn()
    notify()
  })
}

/**
 * Subscribers to the reconnect edge, so the module that knows about the bridge
 * does not have to live in here.
 *
 * `gameLink.ts` owns the socket and the parser and deliberately knows nothing
 * about the 7415 bridge; wiring `get_status` in here would put two transports
 * in one module. See `src/lib/linkReplay.ts`.
 */
const reconnectListeners = new Set<() => void>()

/** Called after a reconnect, once the stale parser state has been dropped. */
export function onGameReconnect(fn: () => void): () => void {
  wire()
  reconnectListeners.add(fn)
  return () => reconnectListeners.delete(fn)
}

/** One chunk as Rust emits it: bytes up to and including a newline. */
type GameChunk = { seq: number; receivedAtMs: number; text: string }

/**
 * Whether the backlog has been merged, and what arrived while it had not.
 *
 * `game:line` is an event, and an event fires once. Rust starts reading the
 * instant `game_attach` returns, so every chunk delivered before this module
 * subscribed was simply gone - while `game:state` kept reporting the running
 * total, so the header counted lines the pane could not show. Measured against
 * a live DragonRealms session: `lines: 245` above a pane rendering its
 * "Nothing yet" empty state.
 *
 * Every dev-mode HMR remount reaches that state, and so does every window
 * reload in a release build. The text most often lost is the worst text to
 * lose: Lich replays the room, the vitals and the character's state on attach,
 * which is exactly what arrives before a freshly-mounted pane is listening.
 */
let backfilled = false
let queued: GameChunk[] = []

/** The highest chunk seq applied, so the backlog can be asked for the tail. */
let lastChunkSeq = 0

/**
 * Ask Rust for what was missed, then drain anything that arrived meanwhile.
 *
 * Order matters and the `finally` is not decoration. If the request fails,
 * the queued chunks are still real game text and must still reach the pane -
 * a guard that threw them away would turn a backlog miss into a dead pane,
 * which is worse than the bug this exists to fix.
 */
async function backfill(): Promise<void> {
  try {
    const reply = await invokeTauri('game_backlog', { since: lastChunkSeq })
    const r = reply as { lines?: unknown; dropped?: unknown } | undefined
    if (Array.isArray(r?.lines)) {
      for (const c of r.lines as GameChunk[]) {
        if (
          typeof c?.seq === 'number' &&
          typeof c?.receivedAtMs === 'number' &&
          Number.isFinite(c.receivedAtMs) &&
          typeof c?.text === 'string'
        ) applyChunk(c)
      }
    }
    // Counted, not hidden. A pane that quietly begins mid-session looks
    // exactly like one that lost nothing.
    if (typeof r?.dropped === 'number' && r.dropped > 0) dropped += r.dropped
  } catch (e) {
    // Caught here rather than left to the caller, and this is not tidiness.
    //
    // Every call site is fire-and-forget - there is no caller waiting to be
    // handed an error. Rethrowing therefore produced an unhandled rejection,
    // found by the failure case in tools/backlog-test.mjs, which crashed the
    // run rather than reporting a missing backlog.
    //
    // Missing the backlog is survivable: the `finally` below still delivers
    // every live chunk, so the pane keeps working and only the history before
    // this moment is absent. Say so instead of dying.
    console.warn('game backlog unavailable, scrollback starts from here', e)
  } finally {
    for (const c of queued) if (c.seq > lastChunkSeq) applyChunk(c)
    queued = []
    backfilled = true
    notify()
  }
}

function applyChunk(chunk: GameChunk) {
    lastChunkSeq = chunk.seq
    if (!tagged && looksTagged(chunk.text)) tagged = true

    for (const parsed of feed(parser, chunk.text)) {
      buffer.push({
        seq: ++nextSeq,
        receivedAtMs: chunk.receivedAtMs,
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
      // Cleared here as well as set by Rust, and for the same reason
      // `connected` is: a chunk cannot arrive from a socket that is still
      // being dialled, so this is reading a fact rather than inferring one.
      // Without it a dropped `game:state` would leave the bar counting
      // attempts over a pane filling with live text - which is precisely the
      // shape of the bug the `connected: true` line above was added to fix.
      reconnecting: false,
      attempt: 0,
      lines: nextSeq,
      note: state.connected ? state.note : '',
    }
    notify()
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

/**
 * Vitals, status indicators, compass, spell and room contents as the game's
 * own stream last reported them - see src/types/stream.ts.
 *
 * `characterState` was parsing all of this from the moment `feed` started
 * being called, and nothing outside gameStream.ts and its own test ever read
 * it: `grep -rl StreamCharacterState src/` found exactly the producer and the
 * type, zero consumers. This is the missing wire, not new parsing - the same
 * shape as `gameState()` above it, and for the same reason it belongs beside
 * `gameLines()` rather than in the Zustand store: a panel that needs it
 * subscribes to `subscribeGame` directly, so a health tick does not re-render
 * whatever else the store is holding.
 */
export function streamCharacterState(): StreamCharacterState {
  return characterState(parser)
}

/**
 * `invokeTauri` returns `undefined` outside a Tauri shell (a plain `vite`
 * dev server has no `game_attach`/`game_status` backend to call). Casting
 * that straight into `state` used to leave it `undefined`, and every reader
 * of `gameState()` assumes a full `LinkState` and reads `.connected`
 * unguarded — so the whole app failed to render, not just the game pane.
 * Keep the last known state (initially the disconnected default above)
 * rather than inventing a connected one or leaving state absent.
 */
function asLinkState(v: unknown): LinkState | null {
  return v && typeof v === 'object' && 'connected' in v ? (v as LinkState) : null
}

/**
 * Take a new link state without throwing away a verdict it does not carry.
 *
 * `game_status` builds its answer from whether a handle exists, so once the
 * reader thread has gone it reports `lich: "unknown"` and `note: "Not
 * attached."` - correct about the handle, and blind to the probe that ran
 * afterwards. Any call to it while detached would therefore overwrite "Lich
 * has exited" with silence, and `refreshGameState()` runs on every GamePane
 * mount, so a pop-out or a layout change is enough to trigger it.
 *
 * The rule is narrow on purpose: **never downgrade a definite verdict to
 * unknown while still detached.** An upgrade is exactly what the deliberate
 * second `game:state` emit is for - unknown becoming gone or alive - so that
 * must still pass through. And re-attaching sets `connected`, which lifts the
 * hold, so a stale verdict cannot outlive the disconnect it describes.
 *
 * Found as a could-not-determine lead rather than a reproduction: the app was
 * being hot-reloaded during the measurement, and a reload produces the same
 * three symptoms. The code answers it whether or not that observation did.
 */
export function adoptLink(prev: LinkState, next: LinkState): LinkState {
  const incoming = next.lich ?? 'unknown'
  const held = prev.lich
  if (!next.connected && incoming === 'unknown' && held && held !== 'unknown') {
    return { ...next, lich: held }
  }
  return next
}

/** Module-state wrapper, so callers do not each have to remember to pass `state`. */
function adopt(next: LinkState): LinkState {
  return adoptLink(state, next)
}

/**
 * How long an attach that follows a sign-in waits for Lich to open its port.
 *
 * Twenty seconds because what is being waited on is Lich's *startup*, not a
 * network round trip: `lich_login_launch` returns when `spawn` succeeds, and
 * the detachable listener does not open until `main.rb:842-857` - after Ruby
 * boots, Lich loads and the game connection is made. The wait ends early
 * either way, on the first successful dial or the moment the spawned Lich
 * exits, so this is a ceiling on the pathological case rather than a delay
 * anybody pays (issue #458).
 */
export const LICH_STARTUP_WAIT_MS = 20_000

/**
 * Attach to Lich's detachable-client port.
 *
 * `waitMs` omitted means one dial, which is what the Attach button wants: a
 * player pressing it is asking about a Lich they believe is already up, and
 * twenty seconds of spinner to be told it is not would be worse than an
 * immediate answer. The sign-in passes {@link LICH_STARTUP_WAIT_MS}, because
 * it has just started the Lich it is dialling and the port provably cannot be
 * open yet.
 */
export async function attachGame(
  port: number,
  host?: string,
  waitMs?: number
): Promise<LinkState> {
  wire()

  // Reset BEFORE the attach, not after.
  //
  // A fresh attach gives Rust a fresh backlog whose seq starts at 1 again, so
  // a stale `lastChunkSeq` would filter the whole new session out of the
  // backfill. Resetting first also means any chunk the new reader emits while
  // this call is still in flight is queued rather than applied, which is what
  // stops it being rendered once here and again from the backlog.
  backfilled = false
  queued = []
  lastChunkSeq = 0
  resetStream()

  try {
    state = adopt(asLinkState(await invokeTauri('game_attach', { host: host ?? null, port, waitMs: waitMs ?? null })) ?? state)
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
      state = adopt(asLinkState(await invokeTauri('game_status')) ?? state)
      notify()
    } catch {
      // The status call failed too, so the backend is genuinely unreachable.
      // Let the original error stand rather than inventing a state.
    }
    throw e
  } finally {
    // Always, including the refusal path above. "Already attached" means the
    // reader IS running, and its backlog is precisely what this pane is
    // missing - that refusal is the single most likely way to arrive here
    // with text to catch up on. Skipping it would leave `backfilled` false
    // and strand every live chunk in the queue, turning a display bug into a
    // pane that never renders anything again.
    void backfill()
  }
}

export async function detachGame(): Promise<LinkState> {
  state = asLinkState(await invokeTauri('game_detach')) ?? state
  resetStream()
  notify()
  return state
}

export async function sendGame(command: string, source: CommandSource): Promise<void> {
  await invokeTauri('game_send', { command: validateGameCommand(command), source })
}

export async function refreshGameState(): Promise<LinkState> {
  wire()
  state = adopt(asLinkState(await invokeTauri('game_status')) ?? state)
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
