import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { canSendMacro } from '../../lib/canSendMacro'
import { nounOf } from '../../lib/room'

/**
 * What's on the floor, one touch to take — not a sentence to read.
 *
 * roomOccupants.ts's `describeRoomItems` (stream-fed) turns this into one
 * line for the places that just need to say what's here. This is for the
 * place that needs to let a player actually pick something up without
 * typing it, so it reads from `character.roomItems` instead — the bridge's
 * own poll of `GameObj.loot`, already reliably populated in both mock and
 * live (unlike the game-text stream, which this app's Tauri-only wiring
 * never feeds outside a real client and so cannot be exercised or verified
 * against the dev mock at all).
 *
 * Each item gets its own `get <noun>; stow <noun>` macro, the same
 * run_macro path every other quick action already uses, so Stop/the
 * latch/the in-flight guard all work here for free rather than needing
 * their own copy.
 */

const IN_FLIGHT_MS = 900

export function RoomItemsPanel({ items }: { items?: string[] }) {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const [inFlight, setInFlight] = useState(false)
  const timer = useRef<number | null>(null)

  const take = useCallback(
    (name: string) => {
      const state = canSendMacro({
        stopLatched: character?.stopLatched,
        inFlight,
        connected: !!character,
      })
      if (!state.canSend) return

      const noun = nounOf(name)
      requestIntent('run_macro', { commands: [`get ${noun}`, `stow ${noun}`] })

      setInFlight(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setInFlight(false)
        timer.current = null
      }, IN_FLIGHT_MS)
    },
    [character, inFlight, requestIntent]
  )

  if (!items) return null

  const state = canSendMacro({
    stopLatched: character?.stopLatched,
    inFlight,
    connected: !!character,
  })

  if (items.length === 0) {
    return (
      <div className="shrink-0 rounded border border-border bg-surface-raised px-2 py-1.5">
        <p className="text-xs text-ink-faint">On the floor: nothing.</p>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col gap-0.5 rounded border border-border bg-surface-raised px-2 py-1.5">
      <ul className="flex flex-col gap-0.5">
        {items.map((name, i) => (
          <li key={`${name}-${i}`}>
            <button
              type="button"
              disabled={!state.canSend}
              title={state.reason ?? `get ${nounOf(name)}`}
              onClick={() => take(name)}
              className="group flex w-full items-center justify-between gap-2 rounded px-1.5 py-0.5 text-left text-xs text-ink-muted hover:bg-surface-overlay hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              <span className="truncate">{name}</span>
              <span className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100">
                take
              </span>
            </button>
          </li>
        ))}
      </ul>
      {state.reason && <p className="text-xs text-ink-faint">{state.reason}</p>}
    </div>
  )
}
