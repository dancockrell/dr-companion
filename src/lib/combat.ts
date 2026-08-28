/**
 * Correlating RoomCards with the combat detail Lich's creature tracker sent.
 *
 * Two lists, two sources, two schedules: RoomCard comes from DRRoom's plain
 * name strings (every card, every room, always). RoomCombatant comes from
 * Lich's `assess`-enriched tracker (only what has actually been assessed,
 * possibly stale, possibly a shorter list). Matching by array position would
 * be wrong the moment the two disagree on order or count, so this matches by
 * noun instead — the one field both sides derive the same way from the same
 * name text.
 *
 * Ambiguous on purpose in one case, and worth saying so rather than hiding
 * it: two identical hostiles ("a wild boar" and "a wild boar") cannot be told
 * apart by noun alone, so the second card falls back to the next unclaimed
 * combatant of the same noun rather than doubling up on the first. This is a
 * real limitation, not a bug — DR's own `assess` list numbers are the only
 * thing that could resolve it exactly, and this app does not run assess.
 */
import type { RoomCombatant } from '../types'

/** DR's own three assess range buckets, in the game's own words. */
export const RANGE_WORD: Record<'melee' | 'pole' | 'missile', string> = {
  melee: 'melee',
  pole: 'pole weapon',
  missile: 'missile',
}

/** Build a noun → queue-of-combatants index once per render, not per card. */
export function indexCombatants(
  combatants: RoomCombatant[] | undefined
): Map<string, RoomCombatant[]> {
  const byNoun = new Map<string, RoomCombatant[]>()
  for (const c of combatants ?? []) {
    const key = (c.noun ?? c.name ?? '').toLowerCase()
    if (!key) continue
    const queue = byNoun.get(key)
    if (queue) queue.push(c)
    else byNoun.set(key, [c])
  }
  return byNoun
}

/** Claims and removes the next unclaimed combatant matching this noun. */
export function claimCombatant(
  noun: string,
  index: Map<string, RoomCombatant[]>
): RoomCombatant | undefined {
  return index.get(noun.toLowerCase())?.shift()
}

/** Convenience overload taking a RoomCard directly. */
export function combatantFor(
  card: { noun: string },
  index: Map<string, RoomCombatant[]>
): RoomCombatant | undefined {
  return claimCombatant(card.noun, index)
}
