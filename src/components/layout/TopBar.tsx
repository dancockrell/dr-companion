import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { locationLine } from '../../lib/locationLine.ts'

/**
 * The 48px bar across the top of the frame.
 *
 * `docs/mockups/dr-companion-isometric-mvp.html` row 1. Its job is the
 * location line, and the handoff's section 9 makes three rules about that
 * line which are the reason this is a component rather than a `<span>` in
 * App.tsx:
 *
 *   1. the location carries freshness and confirmation state - "Room 998 ·
 *      confirmed 3 s ago", never a bare name;
 *   2. an unresolved location says so, and never falls back to the last
 *      known town;
 *   3. nothing here is a second minimap.
 *
 * Rule 2 is the one with teeth, and it is the reason this reads `mapHere`
 * and nothing else. `character.location` keeps its last good value when the
 * mapper loses the room, so a line built from it would go on confidently
 * naming Crossing while the character stood somewhere unknown - which is
 * worse than saying nothing, because it is indistinguishable from a correct
 * reading. `mapHere` goes null instead, and null is rendered as "unresolved".
 */

/**
 * When the current room was last confirmed.
 *
 * Held here rather than in the store because it is a fact about this
 * display, not about the character: the store has no timestamp on `mapHere`,
 * and adding one would mean editing `useAppStore`, `bridgeMessageHandler`
 * and the wire type for a label. What this measures is "how long since the
 * room id last changed under us", which is exactly the freshness a player
 * asking "is this current?" wants, and it degrades honestly - a room that
 * has genuinely not changed for five minutes because nobody moved reads as
 * five minutes old, which it is.
 */
function useConfirmedAge(roomId: number | null): number | null {
  const since = useRef<number | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    since.current = roomId === null ? null : Date.now()
    tick((n) => n + 1)
  }, [roomId])

  useEffect(() => {
    // One second is the resolution the label is written in; anything faster
    // repaints a number that has not changed.
    const timer = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (roomId === null || since.current === null) return null
  return Math.max(0, Math.round((Date.now() - since.current) / 1000))
}

export function TopBar() {
  const character = useAppStore((s) => s.character)
  const here = useAppStore((s) => s.mapHere)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)
  const bridgeMode = useAppStore((s) => s.bridgeMode)

  const roomId = here?.id ?? null
  const age = useConfirmedAge(roomId)
  const line = locationLine(here, age)
  const live = bridgeConnected && character?.connected === true

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-3"
      style={{ height: '100%' }}
      aria-label="Character and location"
    >
      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span
          className={`inline-block h-2 w-2 rounded-full ${live ? 'bg-good' : 'bg-ink-faint'}`}
          aria-hidden
        />
        <span className="uppercase tracking-wider">{bridgeMode === 'live' ? 'Live' : 'Mock'}</span>
      </span>

      {character && (
        <span className="truncate text-sm font-medium text-ink">{character.name}</span>
      )}

      {/* The wording is `locationLine`'s, not this component's - see that
          module for the two rules it enforces and why they are testable
          from outside React. */}
      <span
        className={`min-w-0 truncate text-xs ${line.unresolved ? 'text-warn' : 'text-ink-muted'}`}
        aria-label="Location"
      >
        {line.text}
      </span>

      <div className="flex-1" />
    </header>
  )
}
