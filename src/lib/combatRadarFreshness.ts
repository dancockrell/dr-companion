import type { RoomCombatant } from '../types'

/** Assess is a pull in DragonRealms, not a live position feed. */
export const RADAR_PLACEMENT_MAX_AGE_SECONDS = 60

type RadarPlacement = Pick<RoomCombatant, 'range' | 'relation' | 'enrichedAgeSeconds'> & {
  range: NonNullable<RoomCombatant['range']>
  relation: string
  enrichedAgeSeconds: number
}

/**
 * A range-ring position is a claim about where a hostile is now. Only make
 * that claim while the assess enrichment is both complete and recent.
 */
export function hasFreshRadarPlacement(
  combatant: Pick<RoomCombatant, 'range' | 'relation' | 'enrichedAgeSeconds'>,
): combatant is RadarPlacement {
  const age = combatant.enrichedAgeSeconds
  return Boolean(combatant.range && combatant.relation && age != null && age >= 0 && age <= RADAR_PLACEMENT_MAX_AGE_SECONDS)
}
