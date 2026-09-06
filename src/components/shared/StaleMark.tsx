import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore.ts'
import { staleNote } from '../../store/staleMark.ts'

/**
 * "last known, 12s ago", ticking, or nothing at all.
 *
 * # Why a shared piece rather than a line in each panel
 *
 * Issue #506 is two disconnect paths that disagreed about the same fact. A
 * badge each panel worded and aged for itself would be the same defect one
 * layer up: two panels showing the same drop, one saying 8s and one saying 12s
 * because they mounted at different moments. The words come from
 * `staleMark.ts` and the clock comes from here, so every panel qualifying the
 * same payload says the same thing.
 *
 * # Why it ticks
 *
 * The number's whole value is that it grows. `RoundtimeMeter` learned this the
 * expensive way: a figure computed once at render and left there is a
 * countdown displayed standing still, and the reader takes it for a live one.
 * A stale badge frozen at "2s ago" for a minute is worse than no badge,
 * because it claims freshness it does not have. One redraw a second, stopped
 * the moment nothing is stale, which is a span of text and not a layout.
 */
const TICK_MS = 1000

/**
 * The note, or null while the bridge is still feeding.
 *
 * Returns null rather than an empty string so a caller with nothing to say
 * renders nothing rather than an empty badge - same shape as `linkPhaseLabel`.
 */
export function useStaleNote(): string | null {
  const staleSince = useAppStore((s) => s.bridgeStaleSince)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!staleSince) return
    // Read once immediately: the badge appears the instant the drop lands
    // rather than up to a second later, and the first number is right.
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [staleSince])

  return staleNote(staleSince, now)
}

/**
 * The class to put on whatever the note qualifies.
 *
 * Dimmed, not hidden and not recoloured. Hiding throws away the best answer
 * anybody has while the socket is down; red would read as "you are in
 * trouble", which is what the health bar underneath it says, and stacking two
 * meanings on one colour is how a real emergency gets skimmed.
 */
export const STALE_DIM = 'opacity-50'

export function StaleNote({ className }: { className?: string }) {
  const note = useStaleNote()
  if (!note) return null
  return (
    <span
      className={className ?? 'text-xs leading-none text-warn'}
      role="status"
      aria-live="polite"
      title="The bridge stopped sending. These are the last numbers it sent, not current ones. They update when it comes back and reports again, which in DragonRealms can be about ten seconds after the socket returns."
    >
      {note}
    </span>
  )
}
