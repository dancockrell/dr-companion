import { useCallback, useRef, useState } from 'react'
import { canSendMacro } from './canSendMacro'
import { nounOf } from './room'
import { useAppStore } from '../store/useAppStore'

const IN_FLIGHT_MS = 900

/**
 * "get X, stow X" for a room item, gated the same way everywhere it can be
 * triggered from — the chip strip on the scene and the radar's own floor
 * cluster both call this rather than each keeping its own copy of the
 * stop-latch/in-flight check, which is exactly how the two would drift the
 * first time one of them changed.
 */
export function useRoomItemTake() {
  const character = useAppStore((s) => s.character)
  const requestIntent = useAppStore((s) => s.requestIntent)
  const [inFlight, setInFlight] = useState(false)
  const timer = useRef<number | null>(null)

  const take = useCallback(
    (name: string) => {
      const state = canSendMacro({ stopLatched: character?.stopLatched, inFlight, connected: !!character })
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

  const itemState = canSendMacro({ stopLatched: character?.stopLatched, inFlight, connected: !!character })

  return { take, canSend: itemState.canSend, reason: itemState.reason }
}
