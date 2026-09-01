/**
 * Passport gates and the live mobility estimate used by travel/demo state.
 *
 * Replaces the invented `pathDifficulty: 0-3` scale and the `mobilityScore`
 * that was hardcoded to 55 in two places. Mobility in DragonRealms is
 * Athletics ranks measured against a specific obstacle, modified by burden,
 * armor, buffs and whether you are carrying a rope.
 *
 * See docs/DOMAIN.md section 6.
 */

import type { AccountTier, GameInstance } from '../types'

export type Province =
  | 'Zoluren'
  | 'Therengia'
  | 'Ilithi'
  | 'Forfedhdar'
  | "Qi'Reshalia"

/**
 * Passport state per province.
 *
 * F2P characters are not "locked to Zoluren": they are passport-gated, and a
 * passport can expire while they are away. `expiresAt` is an epoch ms value
 * when known. Subscribers are unrestricted, so this is only consulted for F2P.
 */
export interface PassportState {
  province: Province
  valid: boolean
  expiresAt?: number
  /** 24-hour visa from the Citizenship Office rather than a bought passport. */
  temporary?: boolean
}

export interface MobilityContext {
  athleticsRanks: number
  /** DRStats.encumbrance, e.g. "None", "Light", "Heavy". */
  encumbrance?: string
  hasRope?: boolean
  guild?: string
  buffed?: boolean
  /** Grouped travellers take public transport; shortcuts are single-traveller. */
  inGroup?: boolean
}

/**
 * Burden cuts effective Athletics and a reported buff raises it. This is a
 * displayed estimate, not an obstacle-safety claim or route permission.
 */
export function effectiveAthletics(ctx: MobilityContext): number {
  let ranks = Math.max(0, ctx.athleticsRanks)
  const enc = (ctx.encumbrance ?? '').toLowerCase()

  if (enc.includes('none')) ranks *= 1.1
  else if (enc.includes('light')) ranks *= 1.0
  else if (enc.includes('moderate') || enc.includes('somewhat')) ranks *= 0.9
  else if (enc.includes('heavy') || enc.includes('burden')) ranks *= 0.75

  if (ctx.buffed) ranks *= 1.1
  return Math.round(ranks)
}

/**
 * Whether this character may enter a province right now.
 *
 * Subscribers always may. F2P needs a valid, unexpired passport, and the
 * "expired while you were away" case is the one that strands people.
 */
export function passportCheck(
  province: Province | undefined,
  tier: AccountTier,
  passports: PassportState[] | undefined,
  now = Date.now()
): { ok: boolean; reason: string } {
  if (!province) return { ok: true, reason: '' }
  if (province === 'Zoluren') return { ok: true, reason: '' }

  const restricted = tier === 'f2p' || tier === 'unknown'
  if (!restricted) return { ok: true, reason: '' }

  const p = passports?.find((x) => x.province === province)
  if (!p || !p.valid) {
    return {
      ok: false,
      reason:
        `No valid ${province} passport. Free accounts need one to enter, and ` +
        'the Citizenship Office in Crossing Town Hall issues 24-hour visas.',
    }
  }
  if (p.expiresAt && p.expiresAt < now) {
    return {
      ok: false,
      reason: `${province} passport expired. Entering now risks being stranded.`,
    }
  }
  if (p.expiresAt && p.expiresAt - now < 60 * 60 * 1000) {
    return {
      ok: true,
      reason: `${province} passport expires within the hour. An expired passport blocks re-entry if you leave.`,
    }
  }
  return { ok: true, reason: '' }
}

/**
 * Platinum cross-world portals need six months of tenure, so they are not a
 * property of the tier alone. Without a tenure figure, do not offer them.
 */
export function canUsePlatinumPortals(
  tier: AccountTier,
  instance: GameInstance,
  monthsSubscribed?: number
): boolean {
  if (tier !== 'platinum') return false
  if (instance === 'Fallen') return false
  return (monthsSubscribed ?? 0) >= 6
}
