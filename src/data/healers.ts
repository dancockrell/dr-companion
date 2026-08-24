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
    name: 'Fang Cove healer',
    kind: 'npc_empath',
    instance: 'Prime',
    area: 'Fang Cove',
    pathDifficulty: 1,
    costCopper: 0,
    requiresPremium: true,
    inZoluren: true,
    notes: 'Premium/Platinum only',
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
