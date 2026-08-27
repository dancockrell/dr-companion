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

export interface GameLine {
  seq: number
  text: string
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

let wired = false
function wire() {
  if (wired || !isTauri()) return
  wired = true

  listenTauri<GameLine>('game:line', (line) => {
    buffer.push(line)
    if (buffer.length > MAX_LINES) {
      dropped += buffer.length - MAX_LINES
      buffer = buffer.slice(-MAX_LINES)
    }
    state = { ...state, lines: line.seq }
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
  state = (await invokeTauri('game_attach', { host: host ?? null, port })) as LinkState
  notify()
  return state
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
  notify()
}
