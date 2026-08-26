import { useCallback, useState } from 'react'
import { DEFAULT_CHOICE } from '../data/macros'

const KEY = 'drc.macros.v1'

/**
 * Which variation each macro slot runs.
 *
 * Persisted, because the point of the variations is that a player picks once
 * and the bar becomes theirs. Someone who always tends rather than walking to
 * a healer should have to say so a single time.
 */
export function useMacroChoice() {
  const [macroChoice, setState] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      // Merged over the defaults so a macro added in a later version appears
      // rather than being absent for anyone who has already chosen.
      return raw ? { ...DEFAULT_CHOICE, ...JSON.parse(raw) } : { ...DEFAULT_CHOICE }
    } catch {
      return { ...DEFAULT_CHOICE }
    }
  })

  const setMacroChoice = useCallback((macroId: string, variationId: string) => {
    setState((prev) => {
      const next = { ...prev, [macroId]: variationId }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // Private mode or a full quota. Losing a preference is not worth an
        // error in front of someone mid-fight.
      }
      return next
    })
  }, [])

  return { macroChoice, setMacroChoice }
}
