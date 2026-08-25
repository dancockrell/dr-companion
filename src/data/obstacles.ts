/**
 * Travel obstacles, passports, and what it actually takes to get past them.
 *
 * Replaces the invented `pathDifficulty: 0-3` scale and the `mobilityScore`
 * that was hardcoded to 55 in two places. Mobility in DragonRealms is
 * Athletics ranks measured against a specific obstacle, modified by burden,
 * armor, buffs and whether you are carrying a rope.
 *
 * The rank figures are the conservative numbers community travel tooling uses,
 * which are deliberately set above the bare minimum because the failure mode
 * is not a retry. The Velaka desert crossing warns that you will die out there
 * if the automapper loses you.
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

export const PROVINCES: Province[] = [
  'Zoluren',
  'Therengia',
  'Ilithi',
  'Forfedhdar',
  "Qi'Reshalia",
]

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

export type ObstacleKind =
  | 'swim'
  | 'climb'
  | 'ferry'
  | 'barge'
  | 'gondola'
  | 'mammoth'
  | 'balloon'
  | 'portal'
  | 'walk'
  | 'desert'

export interface Obstacle {
  id: string
  label: string
  kind: ObstacleKind
  /** Athletics ranks the community considers safe. */
  safeRanks: number
  /** Lowest reported success, usually unburdened and unarmored. */
  possibleRanks?: number
  /** Restricted to one guild, e.g. the Thief tunnel under the Segoltha. */
  guild?: string
  /** Province a F2P character needs a passport for to use this leg. */
  requiresPassport?: Province
  /** A rope materially improves the odds. */
  ropeHelps?: boolean
  notes?: string
}

/**
 * Athletics-gated shortcuts, with the published thresholds.
 * Public transport equivalents exist for all of these and are the fallback.
 */
export const OBSTACLES: Obstacle[] = [
  {
    id: 'jantspyre-south',
    label: "Swim the Jantspyre, south (Rossman's)",
    kind: 'swim',
    safeRanks: 100,
    possibleRanks: 90,
    notes: 'The easier of the two Jantspyre crossings',
  },
  {
    id: 'jantspyre-north',
    label: "Swim the Jantspyre, north (Rossman's)",
    kind: 'swim',
    safeRanks: 200,
    possibleRanks: 180,
    notes: 'Possible around 180 with no burden or armor',
  },
  {
    id: 'faldesu',
    label: 'Swim the Faldesu (Riverhaven to NTR)',
    kind: 'swim',
    safeRanks: 190,
    possibleRanks: 160,
    requiresPassport: 'Therengia',
  },
  {
    id: 'under-segoltha',
    label: 'Under-Segoltha tunnel',
    kind: 'climb',
    safeRanks: 50,
    possibleRanks: 35,
    guild: 'thief',
    notes: 'Thief only. 35 works at zero burden.',
  },
  {
    id: 'under-gondola',
    label: 'Under-gondola climb',
    kind: 'climb',
    safeRanks: 515,
    possibleRanks: 480,
    ropeHelps: true,
    notes: 'A rope is worth carrying below about 620 ranks',
  },
  {
    id: 'segoltha',
    label: 'Swim the Segoltha (Tiger Clan to STR)',
    kind: 'swim',
    safeRanks: 565,
    possibleRanks: 540,
    notes: 'A tough swim. Getting stuck mid-river is a real outcome.',
  },
  {
    id: 'velaka',
    label: "Velaka desert crossing to Muspar'i",
    kind: 'desert',
    safeRanks: 850,
    possibleRanks: 780,
    requiresPassport: "Qi'Reshalia",
    notes:
      'The hardest shortcut in the game. Wind moves you and the automapper ' +
      'can lose track. Getting lost out here kills characters. Community ' +
      'tooling ships this disabled by default.',
  },
  {
    id: 'shard-walls',
    label: 'Climb the Shard walls',
    kind: 'climb',
    safeRanks: 350,
    requiresPassport: 'Ilithi',
  },
  {
    id: 'fang-cove-entry',
    label: 'Fang Cove approach',
    kind: 'climb',
    safeRanks: 20,
    requiresPassport: 'Ilithi',
    notes: '50+ to leave the shark area',
  },
]

/** Public transport legs, which are passport-gated but not skill-gated. */
export const TRANSPORT_LEGS: Obstacle[] = [
  {
    id: 'gondola-shard',
    label: 'Gondola to Shard',
    kind: 'gondola',
    safeRanks: 0,
    requiresPassport: 'Ilithi',
  },
  {
    id: 'ferry-riverhaven',
    label: 'Riverhaven ferry',
    kind: 'ferry',
    safeRanks: 0,
    requiresPassport: 'Therengia',
  },
  {
    id: 'barge-ain-ghazal',
    label: 'Barge to Ain Ghazal',
    kind: 'barge',
    safeRanks: 0,
    requiresPassport: 'Forfedhdar',
  },
  {
    id: 'mammoth-fang-cove',
    label: 'Sea mammoth to Fang Cove',
    kind: 'mammoth',
    safeRanks: 0,
    requiresPassport: 'Ilithi',
    notes: 'Needs an active Ilithi passport, not merely a lapsed one',
  },
  {
    id: 'balloon-mriss',
    label: "Balloon, Langenfirth to M'riss",
    kind: 'balloon',
    safeRanks: 0,
    requiresPassport: "Qi'Reshalia",
  },
]

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
 * Burden and armor cut effective Athletics; buffs and a rope raise it.
 * The community thresholds already assume a normally-equipped character, so
 * these adjustments are deliberately small.
 */
export function effectiveAthletics(
  ctx: MobilityContext,
  obstacle?: Obstacle
): number {
  let ranks = Math.max(0, ctx.athleticsRanks)
  const enc = (ctx.encumbrance ?? '').toLowerCase()

  if (enc.includes('none')) ranks *= 1.1
  else if (enc.includes('light')) ranks *= 1.0
  else if (enc.includes('moderate') || enc.includes('somewhat')) ranks *= 0.9
  else if (enc.includes('heavy') || enc.includes('burden')) ranks *= 0.75

  if (ctx.buffed) ranks *= 1.1
  if (obstacle?.ropeHelps && ctx.hasRope) ranks *= 1.08

  return Math.round(ranks)
}

export type ObstacleVerdict = 'safe' | 'risky' | 'blocked' | 'wrong_guild'

export interface ObstacleCheck {
  obstacle: Obstacle
  verdict: ObstacleVerdict
  effective: number
  reason: string
}

export function checkObstacle(
  obstacle: Obstacle,
  ctx: MobilityContext
): ObstacleCheck {
  const effective = effectiveAthletics(ctx, obstacle)

  if (obstacle.guild && obstacle.guild !== (ctx.guild ?? '').toLowerCase()) {
    return {
      obstacle,
      verdict: 'wrong_guild',
      effective,
      reason: `${obstacle.label} is ${obstacle.guild}-only`,
    }
  }

  if (ctx.inGroup && obstacle.safeRanks > 0) {
    return {
      obstacle,
      verdict: 'blocked',
      effective,
      reason: 'In a group — take public transport instead',
    }
  }

  if (effective >= obstacle.safeRanks) {
    return {
      obstacle,
      verdict: 'safe',
      effective,
      reason: `Athletics ${effective} against ${obstacle.safeRanks} needed`,
    }
  }

  if (obstacle.possibleRanks && effective >= obstacle.possibleRanks) {
    return {
      obstacle,
      verdict: 'risky',
      effective,
      reason:
        `Athletics ${effective}. Reported possible from ${obstacle.possibleRanks}, ` +
        `but ${obstacle.safeRanks} is the safe figure.`,
    }
  }

  return {
    obstacle,
    verdict: 'blocked',
    effective,
    reason: `Athletics ${effective}, needs about ${obstacle.safeRanks}`,
  }
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
