/**
 * Hunting recommendations — Companion-owned.
 * Rank bands informed by public Elanthipedia-style teaching ranges
 * and long-running community play patterns (reference only; not copied code).
 */

import type { AccountTier, GameInstance } from '../types'
import { capabilitiesFor } from '../lib/accountCapabilities.ts'

export type GuildId =
  | 'barbarian' | 'bard' | 'cleric' | 'empath' | 'moon_mage'
  | 'necromancer' | 'paladin' | 'ranger' | 'thief' | 'trader'
  | 'warrior_mage' | 'commoner' | 'unknown'

export type DefenseProfile = 'tanky' | 'average' | 'soft' | 'special'

export interface GuildProfile {
  id: GuildId
  label: string
  defense: DefenseProfile
  prefersUndead?: boolean
  highRiskSocial?: boolean
  notes: string
}

export const GUILD_PROFILES: Record<GuildId, GuildProfile> = {
  barbarian: { id: 'barbarian', label: 'Barbarian', defense: 'tanky', notes: 'Can press difficulty when skills support it' },
  paladin: { id: 'paladin', label: 'Paladin', defense: 'tanky', prefersUndead: true, notes: 'Strong defenses; undead often favorable' },
  cleric: { id: 'cleric', label: 'Cleric', defense: 'average', prefersUndead: true, notes: 'Undead hunting and recovery advantages' },
  ranger: { id: 'ranger', label: 'Ranger', defense: 'average', notes: 'Outdoor / survival grounds preferred' },
  thief: { id: 'thief', label: 'Thief', defense: 'soft', notes: 'Prefer controllable spawns early' },
  empath: { id: 'empath', label: 'Empath', defense: 'soft', notes: 'Soft early; safer bands + escape routes' },
  moon_mage: { id: 'moon_mage', label: 'Moon Mage', defense: 'soft', notes: 'Soft defenses — bias easier or known-safe' },
  warrior_mage: { id: 'warrior_mage', label: 'Warrior Mage', defense: 'average', notes: 'Match grounds to combat style' },
  bard: { id: 'bard', label: 'Bard', defense: 'average', notes: 'Flexible intermediate risk' },
  trader: { id: 'trader', label: 'Trader', defense: 'soft', notes: 'Prefer safer bands unless geared' },
  necromancer: {
    id: 'necromancer', label: 'Necromancer', defense: 'special', highRiskSocial: true,
    notes: 'Extra social/rules risk — prefer known-safe; stay alert',
  },
  commoner: { id: 'commoner', label: 'Commoner', defense: 'soft', notes: 'Conservative defaults' },
  unknown: { id: 'unknown', label: 'Unknown', defense: 'average', notes: 'Conservative until guild is known' },
}

export interface HuntingGround {
  id: string
  name: string
  instance: GameInstance
  area: string
  inZoluren: boolean
  requiresPremium: boolean
  focus: string[]
  minRanks: number
  maxRanks: number
  creatureLevel?: number
  undead?: boolean
  swarmy?: boolean
  skinnable?: boolean
  boxes?: boolean
  notes?: string
  epedia?: string
}

/** Starter → mid ladder (esp. Zoluren / F2P-reachable). Expand over time from Elanthipedia. */
export const HUNTING_GROUNDS: HuntingGround[] = [
  {
    id: 'crossing-rats', name: 'Crossing rats', instance: 'Prime', area: 'Crossing',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 0, maxRanks: 30, creatureLevel: 0, skinnable: true,
    notes: 'Starter · easy escape to town', epedia: 'https://elanthipedia.play.net/Rat',
  },
  {
    id: 'sleazy-louts', name: 'Sleazy louts', instance: 'Prime', area: 'Crossing area',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor'],
    minRanks: 0, maxRanks: 35, boxes: true, notes: 'Early boxes possible',
  },
  {
    id: 'musk-hogs', name: 'Musk hogs', instance: 'Prime', area: 'Near Crossing',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 10, maxRanks: 35, skinnable: true,
  },
  {
    id: 'rock-trolls', name: 'Rock trolls', instance: 'Prime', area: 'Near Crossing',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor'],
    minRanks: 30, maxRanks: 60, notes: 'Classic early step up',
  },
  {
    id: 'goblin-areas', name: 'Goblin areas', instance: 'Prime', area: 'Zoluren',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 40, maxRanks: 80, swarmy: true,
  },
  {
    id: 'copperheads', name: 'Copperhead vipers', instance: 'Prime', area: 'Zoluren',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 55, maxRanks: 75, skinnable: true,
    epedia: 'https://elanthipedia.play.net/Copperhead_viper',
  },
  {
    id: 'blood-wolves', name: 'Blood wolves', instance: 'Prime', area: 'Zoluren / nearby',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 60, maxRanks: 90, skinnable: true, notes: 'Solid mid-early skinning',
  },
  {
    id: 'young-brocket', name: 'Young brocket deer', instance: 'Prime', area: 'Therengia side / reachable routes',
    inZoluren: false, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 90, maxRanks: 110, skinnable: true, swarmy: true,
    notes: 'Popular teaching; may be busy',
    epedia: 'https://elanthipedia.play.net/Young_red_brocket_deer',
  },
  {
    id: 'blue-crocs', name: 'Blue-belly crocodiles', instance: 'Prime', area: 'NTR edge',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 100, maxRanks: 140, skinnable: true,
    epedia: 'https://elanthipedia.play.net/Blue-belly_crocodile',
  },
  {
    id: 'grave-worms', name: 'Grave worms', instance: 'Prime', area: 'Zoluren',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor'],
    minRanks: 90, maxRanks: 130, swarmy: true, undead: true,
    epedia: 'https://elanthipedia.play.net/Grave_worm',
  },
  {
    id: 'undead-low', name: 'Low undead (Zoluren)', instance: 'Prime', area: 'Zoluren',
    inZoluren: true, requiresPremium: false, focus: ['weapons', 'armor', 'magic'],
    minRanks: 50, maxRanks: 120, undead: true, notes: 'Strong for Cleric / Paladin',
  },
  {
    id: 'fang-cove-practice', name: 'Fang Cove practice grounds', instance: 'Prime', area: 'Fang Cove',
    inZoluren: true, requiresPremium: true, focus: ['weapons', 'armor', 'magic'],
    minRanks: 40, maxRanks: 120, notes: 'Premium+',
  },
  {
    id: 'forest-bandits', name: 'Forest bandits', instance: 'Prime', area: 'Varies',
    inZoluren: false, requiresPremium: false, focus: ['weapons', 'armor', 'advanced_hunt'],
    minRanks: 160, maxRanks: 200, boxes: true,
  },
  {
    id: 'shard-outskirts', name: 'Shard outskirts', instance: 'Prime', area: 'Ilithi',
    inZoluren: false, requiresPremium: false, focus: ['weapons', 'armor', 'advanced_hunt'],
    minRanks: 120, maxRanks: 200,
  },
  {
    id: 'hard-hunt', name: 'Hard open hunt (example)', instance: 'Prime', area: 'Varies',
    inZoluren: false, requiresPremium: false, focus: ['advanced_hunt', 'weapons', 'armor'],
    minRanks: 250, maxRanks: 500, swarmy: true, notes: 'Only when you know you can handle it',
  },
  {
    id: 'fallen-local', name: 'Fallen — local pests', instance: 'Fallen', area: 'Shard',
    inZoluren: false, requiresPremium: false, focus: ['weapons', 'armor', 'survival'],
    minRanks: 0, maxRanks: 40,
  },
  {
    id: 'fallen-mid', name: 'Fallen — mid wilds', instance: 'Fallen', area: 'Ilithi',
    inZoluren: false, requiresPremium: false, focus: ['weapons', 'armor', 'magic', 'advanced_hunt'],
    minRanks: 80, maxRanks: 180,
  },
]

export interface RankedHunt {
  ground: HuntingGround
  score: number
  rejected: boolean
  reasons: string[]
  guildNote?: string
}

export interface HuntRankContext {
  instance: GameInstance
  accountTier: AccountTier
  focus: string[]
  guild: GuildId
  skillRanks: number
  favorites: string[]
  mode: 'suggest' | 'favorites_only' | 'manual'
}

function guildAdjust(ground: HuntingGround, guild: GuildId): { delta: number; note?: string } {
  const profile = GUILD_PROFILES[guild] ?? GUILD_PROFILES.unknown
  let delta = 0
  let note: string | undefined
  if (profile.defense === 'soft') {
    if (ground.swarmy) { delta -= 15; note = 'Swarmy — soft classes often prefer less chaos' }
    delta -= 5
  }
  if (profile.defense === 'tanky') { delta += 8; note = 'Tankier guild can lean into harder spawns' }
  if (profile.prefersUndead && ground.undead) {
    delta += 20
    note = `${profile.label}: undead grounds often favorable`
  }
  if (profile.highRiskSocial) {
    delta -= 10
    note = 'Special social/rules risk — prefer known-safe spots; stay alert'
  }
  return { delta, note }
}

export function rankHuntingGrounds(ctx: HuntRankContext): RankedHunt[] {
  const cap = capabilitiesFor(ctx.accountTier, ctx.instance)
  const ranks = Math.max(0, ctx.skillRanks)

  return HUNTING_GROUNDS.map((ground) => {
    const reasons: string[] = []
    let rejected = false
    let score = 40
    let guildNote: string | undefined

    if (ground.instance !== ctx.instance) {
      rejected = true
      reasons.push('Wrong instance')
    }
    if (!rejected && !cap.canTravelOutsideZoluren && !ground.inZoluren) {
      rejected = true
      reasons.push('Outside Zoluren (tier locked)')
    }
    if (
      !rejected && ground.requiresPremium &&
      ctx.accountTier !== 'premium' && ctx.accountTier !== 'platinum'
    ) {
      rejected = true
      reasons.push('Requires Premium/Platinum')
    }
    if (ctx.mode === 'favorites_only' && !ctx.favorites.includes(ground.id)) {
      rejected = true
      reasons.push('Not in your favorites')
    }

    if (!rejected) {
      if (ranks < ground.minRanks) {
        const gap = ground.minRanks - ranks
        if (gap > 40) {
          rejected = true
          reasons.push(`Above your ranks (${ground.minRanks}–${ground.maxRanks})`)
        } else {
          score -= gap
          reasons.push(`Slightly above band (${ground.minRanks}–${ground.maxRanks})`)
        }
      } else if (ranks > ground.maxRanks) {
        const over = ranks - ground.maxRanks
        if (over > 80) {
          score -= 25
          reasons.push('Likely too easy — low teaching')
        } else {
          score -= Math.min(20, over / 4)
          reasons.push('Near top of teaching range')
        }
      } else {
        score += 30
        reasons.push(`In rank band ${ground.minRanks}–${ground.maxRanks}`)
        const mid = (ground.minRanks + ground.maxRanks) / 2
        score += Math.max(0, 15 - Math.abs(ranks - mid) / 5)
      }
    }

    if (rejected) return { ground, score: -1, rejected: true, reasons }

    if (ctx.focus.length === 0) {
      score += 5
      reasons.push('No focus set — balanced')
    } else {
      const hits = ground.focus.filter((f) => ctx.focus.includes(f)).length
      if (hits === 0) { score -= 15; reasons.push('Weak focus match') }
      else { score += hits * 12; reasons.push(`Focus match ×${hits}`) }
    }

    if (ctx.focus.includes('survival') && ground.skinnable) score += 8
    if (ctx.focus.includes('weapons') && ground.boxes) score += 4

    const g = guildAdjust(ground, ctx.guild)
    score += g.delta
    guildNote = g.note

    if (ctx.favorites.includes(ground.id)) {
      score += 35
      reasons.push('Your favorite')
    }

    return { ground, score: Math.round(score), rejected: false, reasons, guildNote }
  }).sort((a, b) => {
    if (a.rejected !== b.rejected) return a.rejected ? 1 : -1
    return b.score - a.score
  })
}

export function pickSuggestedHunt(ctx: HuntRankContext): RankedHunt | null {
  if (ctx.mode === 'manual') return null
  return rankHuntingGrounds(ctx).find((r) => !r.rejected) ?? null
}
