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
import type { RoomCard } from './cards'
import type { CombatRange, RoomCombatant } from '../types'

const RANGE_ORDER: CombatRange[] = ['melee', 'pole', 'missile']

export const RANGE_LABEL: Record<CombatRange, string> = {
  melee: 'Melee',
  pole: 'Polearm',
  missile: 'Ranged',
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

/** Claims and removes the next unclaimed combatant matching this card's noun. */
export function combatantFor(
  card: RoomCard,
  index: Map<string, RoomCombatant[]>
): RoomCombatant | undefined {
  const queue = index.get(card.noun.toLowerCase())
  return queue?.shift()
}

/**
 * Where a card without any assessed combatant belongs on the range display.
 *
 * Not "melee by default" — that would put an unassessed creature in the
 * lane meant for a specific, known fact. It gets its own bucket instead.
 */
export type RangeBucket = CombatRange | 'unassessed' | 'disengaged'

export function bucketFor(combatant: RoomCombatant | undefined): RangeBucket {
  if (!combatant) return 'unassessed'
  if (combatant.disengaged) return 'disengaged'
  if (combatant.range) return combatant.range
  return 'unassessed'
}

export const BUCKET_ORDER: RangeBucket[] = [...RANGE_ORDER, 'disengaged', 'unassessed']

export const BUCKET_LABEL: Record<RangeBucket, string> = {
  ...RANGE_LABEL,
  disengaged: 'Not fighting',
  unassessed: 'Unassessed',
}

/**
 * A key distinguishing two same-named creatures whose combat state actually
 * differs — collapsing cards is right for four visually identical boars, and
 * wrong the moment one of them is at melee range on you and another has
 * broken off. Two unassessed creatures still collapse together: there is
 * nothing yet to tell them apart, and pretending otherwise would invent a
 * distinction the data does not have.
 */
export function combatantSignature(c: RoomCombatant | undefined): string {
  if (!c) return 'none'
  return [bucketFor(c), c.target ?? '', c.offBalance ? '1' : '0'].join(':')
}
