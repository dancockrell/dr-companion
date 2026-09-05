import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.ts'

/**
 * Roundtime, counting down, because a frozen one is worse than none.
 *
 * The bridge has sent `roundtime` in seconds since 0.7.0. It was being printed
 * straight out as "RT 4.0s", and that number is measured at the instant the
 * bridge builds the payload, not at the instant you read it. Status pushes are
 * seconds apart on an idle tick, so the display sat at 4.0 while the actual
 * roundtime ran out, then jumped. The one field whose entire value is that it
 * shrinks was the one field being shown standing still.
 *
 * So the number is computed here instead: seconds reported, minus how long ago
 * the payload arrived. Redrawn ten times a second, which is fine because a
 * span of text is not a layout, and stopped the moment it hits zero so nothing
 * ticks while nothing is happening.
 *
 * Why this earns space at all: in roundtime you cannot act, and everything you
 * type is queued or lost. "Why is nothing happening" has exactly two answers,
 * the script has died or you are in roundtime, and only one of them is worth
 * waiting out. Genie's players read this off a bar without thinking about it.
 *
 * The colour is warn and it is not a warning about danger. It says the same
 * thing the bar says: you are blocked, and it will pass. Nothing here goes
 * red, because red in this app means health, and confusing "wait two seconds"
 * with "you are dying" is worse than either signal alone.
 */

/**
 * Ten a second.
 *
 * A whole-second tick looked broken: roundtime is routinely two or three
 * seconds, so a display stepping 3, 2, 1 spends a third of its life on each
 * number and reads as frozen, which is the exact fault being fixed. One decimal
 * moving is unmistakably alive.
 */
const TICK_MS = 100

/**
 * The bar draws against the longest roundtime seen in this stretch rather than
 * a fixed maximum. Roundtimes in this game run from about one second for a
 * fast weapon to twenty or more for a bad fall, and a bar scaled to the worst
 * case would leave a normal swing as a sliver that never visibly moves. Scaled
 * to what actually started, a swing drains the full width every time.
 */
export function RoundtimeMeter({ width = 56 }: { width?: number }) {
  const roundtime = useAppStore((s) => s.character?.roundtime ?? 0)
  const at = useAppStore((s) => s.characterAt)

  const [now, setNow] = useState(() => Date.now())
  const [span, setSpan] = useState(0)

  // Elapsed is floored at zero. The ticker stops between roundtimes, so `now`
  // can be older than the status that just landed, and an unclamped subtraction
  // would briefly report more roundtime than the bridge ever sent. It corrects
  // itself on the next tick either way, but reporting a number the game did
  // not say is not something to leave in for a tenth of a second.
  const left = Math.max(0, roundtime - Math.max(0, now - at) / 1000)
  const running = left > 0

  useEffect(() => {
    // A fresh report resets the scale, so each roundtime is drawn against its
    // own length rather than against whatever the worst one this session was.
    if (roundtime > 0) setSpan(roundtime)
  }, [roundtime, at])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [running])

  if (!running) return null

  const share = span > 0 ? Math.min(1, left / span) : 0

  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={`Roundtime: ${left.toFixed(1)}s left of ${span.toFixed(1)}s. You cannot act until it ends.`}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">RT</span>

      {/* The bar carries it without being read, the number carries it exactly.
          Neither is decoration for the other. */}
      <span
        className="relative h-2 overflow-hidden rounded-sm border border-border bg-surface"
        style={{ width }}
        role="progressbar"
        aria-valuenow={Number(left.toFixed(1))}
        aria-valuemin={0}
        aria-valuemax={Number(span.toFixed(1))}
        aria-label="roundtime remaining"
      >
        <span
          className="absolute inset-y-0 left-0 bg-warn"
          style={{ width: `${share * 100}%` }}
        />
      </span>

      <span className="w-8 text-xs font-medium tabular-nums text-warn">{left.toFixed(1)}</span>
    </span>
  )
}
