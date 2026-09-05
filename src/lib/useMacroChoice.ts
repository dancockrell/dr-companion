import { useCallback, useState } from 'react'
import { DEFAULT_CHOICE } from '../data/macros.ts'
import { readJSON, writeJSON } from './storage.ts'

const KEY = 'drc.macros.v1'

/**
 * Which variation each macro slot runs.
 *
 * Persisted, because the point of the variations is that a player picks once
 * and the bar becomes theirs. Someone who always tends rather than walking to
 * a healer should have to say so a single time.
 */
export function useMacroChoice() {
  const [macroChoice, setState] = useState<Record<string, string>>(() => ({
    // Merged over the defaults so a macro added in a later version appears
    // rather than being absent for anyone who has already chosen.
    ...DEFAULT_CHOICE,
    ...readJSON<Record<string, string>>(KEY, {}),
  }))

  const setMacroChoice = useCallback((macroId: string, variationId: string) => {
    setState((prev) => {
      const next = { ...prev, [macroId]: variationId }
      writeJSON(KEY, next)
      return next
    })
  }, [])

  return { macroChoice, setMacroChoice }
}
