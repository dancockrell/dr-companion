import { useCallback, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { canSendMacro } from '../../lib/canSendMacro'

/**
 * Who's teaching nearby, and one click to join.
 *
 * `assess teach` costs a roundtime, so this is a button, never a poll — the
 * roster only updates when a player asks for it, same reasoning as
 * `check_health`. That makes the absent/empty/populated split load-bearing
 * in a way it usually isn't: absent means literally nobody has pressed the
 * button yet, not "still loading", and has to read as an invitation rather
 * than a blank panel.
 *
 * `teachingAgeSeconds` gets the same treatment RoomChips/CombatRadar just
 * got for `enrichedAgeSeconds` — a roster goes stale silently, the teacher
 * finishes and walks off with nothing announcing it, so past a minute the
 * list is shown softened and labelled rather than left looking current.
 *
 * Difficulty-relative-to-your-own-skill is real game data and deliberately
 * not carried past the bridge (see TeachingClass's own doc comment) — Dan's
 * read is players choose a class by the skill on offer, not by how hard it
 * is, so skill is the prominent field here and there is nothing to add for
 * difficulty later; it was left out on purpose, not missed.
 *
 * No "currently listening to X" state is shown, because the bridge does not
 * expose one — inventing an indicator the data can't back up would be a
 * guess dressed as a fact. `listen_to` and `stop_listening` are both here;
 * which one is true right now is between the player and the game.
 */

const IN_FLIGHT_MS = 900
const STALE_AFTER_SECONDS = 60

export function TeachingPanel() {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const [inFlight, setInFlight] = useState(false)
  const timer = useRef<number | null>(null)

  const send = useCallback(
    (intent: 'check_teaching' | 'listen_to' | 'stop_listening', args?: Record<string, unknown>) => {
      const state = canSendMacro({
        stopLatched: character?.stopLatched,
        inFlight,
        connected: !!character,
      })
      if (!state.canSend) return

      requestIntent(intent, args)

      setInFlight(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setInFlight(false)
        timer.current = null
      }, IN_FLIGHT_MS)
    },
    [character, inFlight, requestIntent]
  )

  if (!character) return null

  const state = canSendMacro({
    stopLatched: character.stopLatched,
    inFlight,
    connected: true,
  })

  const teaching = character.teaching
  const stale =
    teaching != null &&
    character.teachingAgeSeconds != null &&
    character.teachingAgeSeconds > STALE_AFTER_SECONDS

  return (
    <div className="flex shrink-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">
          {teaching === undefined
            ? 'Classes: not checked.'
            : teaching.length === 0
              ? 'No one teaching nearby.'
              : `${teaching.length} class${teaching.length === 1 ? '' : 'es'} on offer${stale ? ' (stale)' : ''}.`}
        </p>
        <button
          type="button"
          disabled={!state.canSend}
          title={state.reason ?? 'assess teach'}
          onClick={() => send('check_teaching')}
          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs text-ink-muted hover:bg-surface-overlay hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          {teaching === undefined ? 'Check for classes' : 'Recheck'}
        </button>
      </div>

      {teaching != null && teaching.length > 0 && (
        <ul className={`flex flex-col gap-0.5 ${stale ? 'opacity-60' : ''}`}>
          {teaching.map((c) => (
            <li
              key={c.teacher}
              className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-surface-overlay"
            >
              <span className="truncate text-ink">
                <span className="font-medium">{c.skill}</span>
                <span className="text-ink-faint"> — {c.teacher}</span>
              </span>
              <button
                type="button"
                disabled={!state.canSend}
                title={state.reason ?? `listen to ${c.teacher}`}
                onClick={() => send('listen_to', { teacher: c.teacher })}
                className="shrink-0 rounded px-1 text-ink-faint hover:bg-surface-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
              >
                listen
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              disabled={!state.canSend}
              title={state.reason ?? 'stop listening'}
              onClick={() => send('stop_listening')}
              className="mt-0.5 rounded px-1 py-0.5 text-xs text-ink-faint hover:bg-surface-overlay hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop listening
            </button>
          </li>
        </ul>
      )}

      {state.reason && <p className="text-xs text-ink-faint">{state.reason}</p>}
    </div>
  )
}
