/** The game's actual idle warning, observed in issue #546. No local idle
 * timer can raise it: a quiet screen is not evidence of an idle game session. */
export const IDLE_WARNING_TEXT = 'YOU HAVE BEEN IDLE TOO LONG. PLEASE RESPOND.'
/** Observed warning-to-disconnect interval, not a server-supplied deadline. */
export const IDLE_WARNING_WINDOW_MS = 60_000

export interface IdleWarningLine {
  seq: number
  receivedAtMs: number
  text: string
  stream: string
}

export interface IdleWarning {
  seq: number
  receivedAtMs: number
  /** Null means the receipt time is unusable; do not invent a countdown. */
  estimatedDeadlineMs: number | null
}

export interface IdleWarningState {
  seenThrough: number
  warning: IdleWarning | null
}

export function freshIdleWarningState(): IdleWarningState {
  return { seenThrough: 0, warning: null }
}

export function isIdleWarning(line: Pick<IdleWarningLine, 'text' | 'stream'>): boolean {
  // BEL surrounds the real warning, but Lich may already have removed it.
  // Whole-line matching avoids treating quoted player speech as a warning.
  return line.stream === '' &&
    line.text.replaceAll('\u0007', '').trim().replace(/\s+/g, ' ').toUpperCase() === IDLE_WARNING_TEXT
}

/** Read new raw lines once. Gags, substitutions, AI availability and bridge
 * snapshots have no say in this alert. A disconnect retires it and consumes
 * history so an old warning cannot reappear when the same buffer reconnects. */
export function advanceIdleWarning(
  state: IdleWarningState,
  lines: readonly IdleWarningLine[],
  connected: boolean,
  now: number,
): IdleWarningState {
  let seenThrough = state.seenThrough
  let warning = connected ? state.warning : null
  // gameLink orders by monotonically increasing seq. Walk only the fresh
  // tail, not all 20,000 retained lines on every busy-room update.
  let start = lines.length
  while (start > 0 && lines[start - 1].seq > state.seenThrough) start--
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    seenThrough = Math.max(seenThrough, line.seq)
    if (!connected || !isIdleWarning(line)) continue
    const hasReceiptTime = Number.isFinite(line.receivedAtMs) && line.receivedAtMs > 0 && line.receivedAtMs <= now
    // Replayed scrollback must not give a past warning a new minute. Once an
    // alert has been seen live it stays visible even after this estimate ends.
    if (hasReceiptTime && now - line.receivedAtMs > IDLE_WARNING_WINDOW_MS) continue
    warning = {
      seq: line.seq,
      receivedAtMs: line.receivedAtMs,
      estimatedDeadlineMs: hasReceiptTime ? line.receivedAtMs + IDLE_WARNING_WINDOW_MS : null,
    }
  }
  return seenThrough === state.seenThrough && warning === state.warning
    ? state
    : { seenThrough, warning }
}

export function dismissIdleWarning(state: IdleWarningState, seq: number): IdleWarningState {
  return state.warning?.seq === seq ? { ...state, warning: null } : state
}

export function idleWarningSecondsLeft(warning: IdleWarning, now: number): number | null {
  if (warning.estimatedDeadlineMs === null) return null
  return Math.max(0, Math.min(60, Math.ceil((warning.estimatedDeadlineMs - now) / 1000)))
}
