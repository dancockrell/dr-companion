import { RANGE_WORD } from './combat.ts'
import type { RoomCombatant } from '../types/index.ts'
import type { RoomCard } from './cards.ts'

/**
 * The pure computation behind `CombatRadar`, pulled out of that file so it
 * can be tested without a DOM. `combatRadarLayout.ts` already did this for
 * the fan/placement geometry (`fanRadarSlots`, `pointOnRadar`) — this is
 * the rest of it: range-ring sizing, assess-relation-to-angle, pin
 * ordering, the hover-card summary string, and the health/nerve colour and
 * icon grading. None of it touches React; it never needed to live in the
 * component file in the first place.
 *
 * `CombatRadar.tsx` re-exports these where other modules still expect to
 * find them there, so this split changes nothing about the board itself.
 */

/** Same threshold as this board has always used — assess data past a
 * minute old is shown softened rather than at full confidence. */
export const STALE_AFTER_SECONDS = 60

type RadarPlacement = Pick<RoomCombatant, 'range' | 'relation' | 'enrichedAgeSeconds'> & {
  range: NonNullable<RoomCombatant['range']>
  relation: string
  enrichedAgeSeconds: number
}

/**
 * Assess is a pull in DragonRealms, not a live position feed. A range-ring
 * position is therefore only honest while the enrichment is complete and no
 * older than the board's existing stale-data threshold.
 */
export function hasFreshRadarPlacement(
  combatant: Pick<RoomCombatant, 'range' | 'relation' | 'enrichedAgeSeconds'>,
): combatant is RadarPlacement {
  const age = combatant.enrichedAgeSeconds
  return Boolean(combatant.range && combatant.relation && age != null && age >= 0 && age <= STALE_AFTER_SECONDS)
}

/**
 * Melee wide, pole and missile progressively tighter. A floor, not the
 * final answer — see `rangeRadiusPct` below, which widens the melee ring
 * far enough that four cardinal-position pucks never overlap regardless of
 * how big pucks get.
 */
export const RANGE_RADIUS_FLOOR_PCT: Record<'melee' | 'pole' | 'missile', number> = {
  melee: 20,
  pole: 27,
  missile: 34,
}

/** How much further out pole and missile sit than melee, once melee's own
 * radius is computed — a fixed gap rather than its own floor, so a melee
 * ring forced wider to fit its pucks still reads as "the same three rings,
 * further apart" instead of three radii drifting independently. */
export const RANGE_DELTA_PCT: Record<'pole' | 'missile', number> = { pole: 6, missile: 12 }

/**
 * How far out each range ring sits, as a percentage of the compass's own
 * width — widened past the floor above only as far as needed so that four
 * pucks at the compass's four cardinal positions (0/90/180/270, the only
 * angles `angleFor` ever returns) can sit on the melee ring at once without
 * their circles overlapping — solved from the real chord distance between
 * two points 90° apart on the ring (`R = diameter · breathing room /
 * (2·sin(π/N))`), not the arc between them, then compared against the floor
 * and the larger one wins.
 */
export function rangeRadiusPct(compassWidth: number, portraitPx: number): Record<'melee' | 'pole' | 'missile', number> {
  if (compassWidth <= 0) return { ...RANGE_RADIUS_FLOOR_PCT }
  const CARDINAL_SLOTS = 4
  const BREATHING_ROOM = 1.5
  const neededRadiusPx = (portraitPx * BREATHING_ROOM) / (2 * Math.sin(Math.PI / CARDINAL_SLOTS))
  const neededRadiusPct = (neededRadiusPx / compassWidth) * 100
  const melee = Math.max(RANGE_RADIUS_FLOOR_PCT.melee, neededRadiusPct)
  return {
    melee,
    pole: Math.max(RANGE_RADIUS_FLOOR_PCT.pole, melee + RANGE_DELTA_PCT.pole),
    missile: Math.max(RANGE_RADIUS_FLOOR_PCT.missile, melee + RANGE_DELTA_PCT.pole + RANGE_DELTA_PCT.missile),
  }
}

/**
 * assess's own relation phrases, mapped to a compass angle (0 = in front of
 * you, clockwise). DR does not disambiguate which side "beside"/"flanking"/
 * "next to" put someone on, so those alternate deterministically by id
 * rather than always defaulting to the same side — real assess output would
 * show them scattered too, this just cannot know which side without asking.
 */
export function angleFor(relation: string, id: string): number {
  const r = relation.toLowerCase()
  if (r.includes('behind')) return 180
  if (r.includes('left')) return 270
  if (r.includes('right')) return 90
  if (r.includes('front') || r.includes('facing') || r.includes('advancing')) return 0
  const hash = Array.from(id).reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0)
  return hash % 2 === 0 ? 90 : 270
}

/**
 * Pinned keys move to the front, in the order they were pinned — the most
 * recently promoted lands first, same as bringing a card to the top of a
 * hand. Everything else keeps the order it already had. A room with six
 * hundred mobs in a scrolling pane is unusable if the one you actually care
 * about can only be found by scrolling to wherever the game happened to
 * list it; this is the whole reason a corner is clickable at all.
 */
export function reorderByPin<T>(entries: T[], keyOf: (t: T) => string, pins: string[]): T[] {
  if (pins.length === 0) return entries
  const byKey = new Map(entries.map((e) => [keyOf(e), e] as const))
  const front: T[] = []
  for (const k of pins) {
    const e = byKey.get(k)
    if (e) {
      front.push(e)
      byKey.delete(k)
    }
  }
  return [...front, ...entries.filter((e) => byKey.has(keyOf(e)))]
}

/**
 * Everything this app currently knows about one entry, in one sentence —
 * the tooltip's whole content. `assess`'s own combat detail first (the
 * closest thing to "wounds" this app has for anything that is not you:
 * stunned, off balance, cursed, hidden are the afflictions the game
 * actually reports on someone else), then the bestiary's static facts
 * (level, HP range, size, attack range, whether it casts or hides, what it
 * carries) for whatever has a lore entry at all. Nothing here is invented:
 * a field that is null or absent just does not appear, rather than being
 * guessed at or padded with a placeholder.
 */
export function detailFor(card: RoomCard, combatant: RoomCombatant | undefined, presence: string): string {
  const bits: string[] = []

  if (card.status === 'dead') bits.push('dead')
  if (card.status === 'stunned') bits.push('stunned')

  if (combatant) {
    if (combatant.relation) bits.push(combatant.relation)
    if (combatant.range) bits.push(`${RANGE_WORD[combatant.range]} range`)
    if (combatant.target) bits.push(`targeting ${combatant.target}`)
    if (combatant.offBalance) bits.push('off balance')
    else if (combatant.balance) bits.push(`balance: ${combatant.balance}`)
    if (combatant.conditions.length) bits.push(combatant.conditions.join(', '))
    if (combatant.statuses.length) bits.push(combatant.statuses.join(', '))
    if (combatant.enrichedAgeSeconds != null && combatant.enrichedAgeSeconds > STALE_AFTER_SECONDS) {
      bits.push(`assessed ${combatant.enrichedAgeSeconds}s ago`)
    }
  } else if (presence && card.status !== 'dead') {
    // "Unassessed" answers "is anyone tracking this fight" — a question a
    // corpse has already answered by being dead. Saying both is not wrong,
    // just redundant every single time, since a dead card never has a
    // combatant to report either way.
    bits.push(presence)
  }

  if (card.lore) {
    const l = card.lore
    if (l.level != null) bits.push(`level ${l.level}`)
    if (l.minCap != null || l.maxCap != null) {
      bits.push(
        l.minCap != null && l.maxCap != null
          ? `${l.minCap}-${l.maxCap} HP`
          : `up to ${l.minCap ?? l.maxCap} HP`
      )
    }
    const shape = [l.bodySize, l.bodyType].filter(Boolean).join(' ').toLowerCase()
    if (shape) bits.push(shape)
    if (l.attackRange) bits.push(`attacks at ${l.attackRange}`)
    if (l.castsSpells) bits.push('casts spells')
    if (l.stealthy) bits.push('stealthy')
    const loot = [l.hasCoins && 'coins', l.hasGems && 'gems', l.hasBoxes && 'boxes', l.skinnable && 'skinnable']
      .filter(Boolean)
      .join(', ')
    if (loot) bits.push(loot)
    if (card.loreApproximate) bits.push('bestiary match approximate')
  }

  return bits.join(' — ')
}

/**
 * Green at full, quite yellow by 80%, orange by 60%, solidly red by 40% and
 * below — four calibration points rather than one straight ramp, because a
 * ramp that only reaches yellow around the halfway mark reads as "basically
 * fine" for exactly the stretch where a player actually wants a warning. A
 * hundred whole-percent steps each get their own point on this curve —
 * hue between the calibration points, and below the red point, a darkening
 * lightness instead (hue has nowhere further red to go) — so 39% and 5%
 * still read as visibly different urgency rather than collapsing into one
 * flat "red" the moment the number crosses 40.
 */
export const VITAL_COLOR_STOPS: Array<{ pct: number; hue: number }> = [
  { pct: 100, hue: 120 }, // green
  { pct: 80, hue: 55 }, // quite yellow
  { pct: 60, hue: 30 }, // orange
  { pct: 40, hue: 0 }, // red
]

export function vitalColor(share: number): string {
  const pct = Math.max(0, Math.min(1, share)) * 100

  if (pct <= 40) {
    // Below the red point, hue is pinned — the remaining 40 steps read
    // through lightness instead, darkening toward empty rather than
    // sitting at one unchanging red the whole way down.
    const lightness = 35 + (pct / 40) * 15
    return `hsl(0, 90%, ${lightness}%)`
  }

  for (let i = 0; i < VITAL_COLOR_STOPS.length - 1; i++) {
    const hi = VITAL_COLOR_STOPS[i]
    const lo = VITAL_COLOR_STOPS[i + 1]
    if (pct <= hi.pct && pct >= lo.pct) {
      const t = (pct - lo.pct) / (hi.pct - lo.pct)
      const hue = lo.hue + t * (hi.hue - lo.hue)
      return `hsl(${hue}, 90%, 50%)`
    }
  }
  return `hsl(${VITAL_COLOR_STOPS[0].hue}, 90%, 50%)`
}

/** Nerves, poisoned and stunned all get a permanent slot in the row instead
 * of only appearing once true, the same "present always, plain when
 * unhurt, coloured when it isn't" rule the doll's own parts use — these
 * three are the ones worth knowing are *fine* as much as knowing they
 * aren't, since all three can end a fight on their own (can't act, can't
 * fight back the disease/poison eating your health) and a player
 * shouldn't have to infer "fine" from an icon's absence. Everything else
 * in `CombatRadar`'s own `STATUS_ICON` stays conditional: rarer, more
 * dramatic events that don't need a permanently-dim placeholder. */
export function alwaysTone(active: boolean, warnOnly = false): string {
  if (!active) return 'text-ink-faint'
  return warnOnly ? 'text-warn' : 'text-danger'
}

/** Nerve damage, told through colour across all four severities rather
 * than the old three-step jump (faint/warn/danger, which read "minor" and
 * "unhurt" as the same colour) — a fourth stop between them for "minor" so
 * the doll's own severity words (unhurt/minor/serious/severe) each get a
 * visibly distinct colour, the same calibration style as CombatRadar's own
 * vital-number gradient. Inline colour, not a text-* class: "minor"'s
 * yellow has no existing utility token, and matching the other three
 * exactly (rather than approximating with what Tailwind ships) is the
 * whole point of grading four steps instead of three. */
export function nsysColor(wound: number): string {
  if (wound >= 3) return 'var(--color-danger)'
  if (wound === 2) return 'var(--color-warn)'
  if (wound === 1) return 'hsl(50, 85%, 55%)'
  return 'var(--color-ink-faint)'
}
