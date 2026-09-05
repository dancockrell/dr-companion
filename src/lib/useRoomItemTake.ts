import { useCallback } from 'react'
import { nounOf } from './room.ts'
import { useMacroRunner } from './useMacroRunner.ts'

/**
 * "get X, stow X" for a room item, gated the same way everywhere it can be
 * triggered from — the chip strip on the scene and the radar's own floor
 * cluster both call this rather than each keeping its own copy of the
 * stop-latch/in-flight check, which is exactly how the two would drift the
 * first time one of them changed.
 */
export function useRoomItemTake() {
  const { run, canSend, reason } = useMacroRunner()

  const take = useCallback(
    (name: string) => {
      const noun = nounOf(name)
      run([`get ${noun}`, `stow ${noun}`])
    },
    [run]
  )
  return { take, canSend, reason }
}
