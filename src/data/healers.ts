/**
 * Healer / healing-option catalog.
 * Scoped by instance; filtered by account tier at score time.
 * Room IDs to be filled from maps / Elanthipedia research.
 */

import type { AccountTier, GameInstance } from '../types'

export type HealerKind = 'npc_empath' | 'npc_other' | 'self' | 'herb'

export interface HealerOption {
  id: string
  name: string
  kind: HealerKind
  instance: GameInstance
  area: string
  pathDifficulty: number
  costCopper: number
  requiresPremium: boolean
  inZoluren: boolean
  notes?: string
}

export const HEALER_OPTIONS: HealerOption[] = [
  {
    id: 'crossing-empath-guild',
    name: 'Crossing Empath Guild',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Crossing',
    pathDifficulty: 0,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: true,
    notes: 'Standard free NPC empath services',
  },
  {
    id: 'crossing-hospital',
    name: 'Crossing hospital / triage',
    kind: 'npc_other',
    instance: 'Prime',
    area: 'Crossing',
    pathDifficulty: 0,
    costCopper: 50,
    requiresPremium: false,
    inZoluren: true,
  },
  {
    id: 'leth-empath',
    name: 'Leth Deriel empath',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Leth Deriel',
    pathDifficulty: 1,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: true,
  },
  {
    id: 'arthe-aid',
    name: 'Arthe Dale aid',
    kind: 'npc_other',
    instance: 'Prime',
    area: 'Arthe Dale',
    pathDifficulty: 1,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: true,
  },
  {
    id: 'kaerna-aid',
    name: 'Kaerna Village aid',
    kind: 'npc_other',
    instance: 'Prime',
    area: 'Kaerna',
    pathDifficulty: 1,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: true,
  },
  {
    id: 'fang-cove-healer',
    name: 'Fang Cove healer (Yrisa)',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Fang Cove',
    pathDifficulty: 2,
    costCopper: 0,
    requiresPremium: true,
    inZoluren: false,
    notes:
      'Fang Cove is in Ilithi, reached by sea mammoth from Ratha or Acenamacra. ' +
      'Primarily Estate Holder, but the docks and Grazhir shard are open to others. ' +
      'The sea mammoth leg needs an active Ilithi passport.',
  },
  {
    id: 'haven-empath',
    name: 'Riverhaven Empath Guild',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Riverhaven',
    pathDifficulty: 2,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'theren-empath',
    name: 'Therenborough empath',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Therenborough',
    pathDifficulty: 2,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'shard-empath',
    name: 'Shard Empath Guild',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Shard',
    pathDifficulty: 2,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'hib-empath',
    name: 'Hibarnhvidar empath',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Hibarnhvidar',
    pathDifficulty: 3,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'ratha-empath',
    name: 'Ratha empath',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Ratha',
    pathDifficulty: 3,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'self-herbs',
    name: 'Self-care / herbs',
    kind: 'herb',
    instance: 'Prime',
    area: 'Anywhere',
    pathDifficulty: 0,
    costCopper: 20,
    requiresPremium: false,
    inZoluren: true,
    notes: 'If stocked; not full replacement for severe wounds',
  },
  {
    id: 'fallen-shard-empath',
    name: 'Fallen — Shard empath',
    kind: 'npc_empath',
    instance: 'Fallen',
    area: 'Shard',
    pathDifficulty: 0,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'fallen-self',
    name: 'Fallen — self/herbs',
    kind: 'herb',
    instance: 'Fallen',
    area: 'Anywhere',
    pathDifficulty: 0,
    costCopper: 20,
    requiresPremium: false,
    inZoluren: false,
  },
  {
    id: 'platinum-crossing',
    name: 'Platinum — Crossing Empath Guild',
    kind: 'npc_empath',
    instance: 'Platinum',
    area: 'Crossing',
    pathDifficulty: 0,
    costCopper: 0,
    requiresPremium: false,
    inZoluren: true,
  },
]

export interface ScoredHealer {
  option: HealerOption
  score: number
  rejected: boolean
  reasons: string[]
}

export interface HealerScoreContext {
  instance: GameInstance
  accountTier: AccountTier
  mobilityScore: number
  preferFree?: boolean
}

export function scoreHealers(ctx: HealerScoreContext): ScoredHealer[] {
  const results: ScoredHealer[] = []

  for (const option of HEALER_OPTIONS) {
    const reasons: string[] = []
    let rejected = false
    let score = 100

    if (option.instance !== ctx.instance) {
      rejected = true
      reasons.push(`Wrong instance (need ${ctx.instance})`)
    }

    const zolurenLocked =
      ctx.accountTier === 'f2p' || ctx.accountTier === 'unknown'
    if (!rejected && zolurenLocked && !option.inZoluren) {
      rejected = true
      reasons.push('F2P cannot leave Zoluren')
    }

    if (
      !rejected &&
      option.requiresPremium &&
      ctx.accountTier !== 'premium' &&
      ctx.accountTier !== 'platinum'
    ) {
      rejected = true
      reasons.push('Requires Premium or Platinum')
    }

    if (rejected) {
      results.push({ option, score: -1, rejected: true, reasons })
      continue
    }

    if (option.pathDifficulty > 0) {
      const needed = option.pathDifficulty * 15
      if (ctx.mobilityScore < needed) {
        score -= (needed - ctx.mobilityScore) * 1.5
        reasons.push('Path may be hard for current mobility')
      } else {
        score -= option.pathDifficulty * 5
      }
    } else {
      score += 10
      reasons.push('In-town / trivial path')
    }

    if (option.costCopper === 0) {
      score += 15
      reasons.push('Free')
    } else if (ctx.preferFree) {
      score -= Math.min(40, option.costCopper / 10)
      reasons.push(`Costs ~${option.costCopper} copper`)
    }

    if (option.kind === 'npc_empath') {
      score += 8
      reasons.push('Empath services')
    }

    results.push({
      option,
      score: Math.round(score),
      rejected: false,
      reasons,
    })
  }

  return results.sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1
    return b.score - a.score
  })
}

export function pickBestHealer(ctx: HealerScoreContext): ScoredHealer | null {
  const scored = scoreHealers(ctx)
  return scored.find((s) => !s.rejected) ?? null
}

/**
 * Towns a player can nominate as their heal destination.
 *
 * Real configs set one and stick to it. The community combat script's setting
 * reads "HEAL.CITY — will run to this town for HEALING no matter where you
 * are", which is the player explicitly rejecting proximity: they know the
 * route, they want the predictable one.
 *
 * So a preferred city wins by default and the scorer is the fallback for the
 * case where none is set or the preferred one is unreachable. That fallback is
 * the new-player case, which is who this app is for.
 *
 * See docs/DOMAIN.md section 15.
 */
export const HEAL_CITIES = [
  { id: 'crossing', label: 'Crossing', province: 'Zoluren' },
  { id: 'leth', label: 'Leth Deriel', province: 'Zoluren' },
  { id: 'haven', label: 'Riverhaven', province: 'Therengia' },
  { id: 'theren', label: 'Therenborough', province: 'Therengia' },
  { id: 'shard', label: 'Shard', province: 'Ilithi' },
  { id: 'hib', label: 'Hibarnhvidar', province: 'Forfedhdar' },
] as const

export type HealCityId = (typeof HEAL_CITIES)[number]['id']

/** Human name for a heal city id, for anything the player reads. */
export function cityLabel(id: HealCityId): string {
  return HEAL_CITIES.find((c) => c.id === id)?.label ?? id
}

/** Map a preferred city onto the healer entries that sit in it. */
export function healersInCity(
  cityId: HealCityId,
  instance: GameInstance
): HealerOption[] {
  const city = HEAL_CITIES.find((c) => c.id === cityId)
  if (!city) return []
  return HEALER_OPTIONS.filter(
    (o) => o.instance === instance && o.area.toLowerCase() === city.label.toLowerCase()
  )
}

export interface HealChoice {
  option: HealerOption | null
  /** 'preferred' when the player's own setting decided it. */
  source: 'preferred' | 'scored' | 'none'
  reasons: string[]
}

/**
 * Pick a healer, honouring the player's choice first.
 *
 * Falls back to scoring with an explicit reason when the preference cannot be
 * used, so the player can see that their setting was overridden and why. A
 * silent fallback would be worse than no preference at all.
 */
export function chooseHealer(
  ctx: HealerScoreContext & { preferredCity?: HealCityId | null }
): HealChoice {
  if (ctx.preferredCity) {
    const inCity = healersInCity(ctx.preferredCity, ctx.instance)
    const usable = inCity.filter((o) => {
      if (o.requiresPremium && ctx.accountTier !== 'premium' && ctx.accountTier !== 'platinum') {
        return false
      }
      const zolurenLocked = ctx.accountTier === 'f2p' || ctx.accountTier === 'unknown'
      return !(zolurenLocked && !o.inZoluren)
    })

    if (usable.length > 0) {
      const best =
        usable.find((o) => o.kind === 'npc_empath') ?? usable[0]!
      return {
        option: best,
        source: 'preferred',
        reasons: [`Your heal city is ${cityLabel(ctx.preferredCity)}. Going there.`],
      }
    }

    const scored = pickBestHealer(ctx)
    return {
      option: scored?.option ?? null,
      source: scored ? 'scored' : 'none',
      reasons: [
        `Your heal city (${cityLabel(ctx.preferredCity)}) is not reachable on this account or instance.`,
        ...(scored?.reasons ?? ['No healer available at all.']),
      ],
    }
  }

  const scored = pickBestHealer(ctx)
  return {
    option: scored?.option ?? null,
    source: scored ? 'scored' : 'none',
    reasons: scored?.reasons ?? ['No healer available for this tier and instance.'],
  }
}
