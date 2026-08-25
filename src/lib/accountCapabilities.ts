/**
 * Account tier → capability flags.
 *
 * Figures verified against Elanthipedia. See docs/DOMAIN.md sections 3 and 4.
 * Note that "Premium" and "Estate Holder" are the same tier; Estate Holder is
 * the in-character name and the one script authors use.
 */
import type { AccountTier, GameInstance, CharacterStatus } from '../types'

/** Guilds a free account cannot play at all. */
export const F2P_BLOCKED_GUILDS = ['empath', 'trader', 'necromancer'] as const

export interface AccountCapabilities {
  /**
   * @deprecated Free accounts are passport-gated per province, not locked to
   * Zoluren. A boolean derived from the tier cannot answer the real question.
   * Use `passportCheck` in data/obstacles.ts, which takes live passport state.
   * Retained as a coarse default for callers with no passport data.
   */
  canTravelOutsideZoluren: boolean
  hasVault: boolean
  /** Items, not some other unit. F2P has no base vault but can buy up to 250. */
  vaultApproximateCapacity: number | null
  /** Copper. 10 platinum is 100,000 copper: the same cap as bankCapPlatinum. */
  bankDepositCap: number | null
  /** Platinum. The F2P bank ceiling is 10 plat across all banks combined. */
  bankCapPlatinum: number | null
  inventoryPressureTight: boolean
  /** Items a free account can carry before the junk-room warnings start. */
  carryWarnAt: number | null
  /** Hard carry ceiling for a free account. */
  carryMax: number | null
  expThrottled: boolean
  canUsePremiumAreas: boolean
  canAccessFangCove: boolean
  isFallen: boolean
  blockedGuilds: string[]
  notes: string[]
}

/**
 * Experience absorption as a fraction of the subscriber rate.
 *
 * Free accounts are not throttled by a flat percentage: 60% up to rank 50,
 * then a linear decline to 30% at rank 200, then 30% flat. This matters for
 * hunting advice, because a free character at rank 180 is absorbing at roughly
 * a third the rate of a subscriber at the same ranks.
 */
export function expAbsorptionRate(tier: AccountTier, ranks: number): number {
  const f2p = tier === 'f2p' || tier === 'unknown'
  if (!f2p) return 1
  if (ranks <= 50) return 0.6
  if (ranks >= 200) return 0.3
  return 0.6 - ((ranks - 50) / 150) * 0.3
}

export function capabilitiesFor(
  tier: AccountTier,
  instance: GameInstance
): AccountCapabilities {
  const isFallen = instance === 'Fallen' || tier === 'fallen'
  const premium = tier === 'premium' || tier === 'platinum'
  const f2p = tier === 'f2p' || tier === 'unknown'
  const notes: string[] = []
  if (f2p)
    notes.push(
      'Free account: passport needed to leave Zoluren, 10 plat bank cap, ' +
        '100-item carry limit, no Empath/Trader/Necromancer, experience throttled'
    )
  if (isFallen) notes.push('Fallen instance — separate geography')
  if (premium) notes.push('Estate Holder: home, private hunting, Fang Cove')

  return {
    canTravelOutsideZoluren: !f2p || isFallen,
    hasVault: !f2p,
    // F2P has no base vault; expansions can be bought up to 250 items. There
    // is no published figure for the subscriber vault, so do not invent one.
    vaultApproximateCapacity: f2p ? 250 : null,
    bankDepositCap: f2p ? 100_000 : null,
    bankCapPlatinum: f2p ? 10 : null,
    inventoryPressureTight: f2p,
    carryWarnAt: f2p ? 75 : null,
    carryMax: f2p ? 100 : null,
    expThrottled: f2p,
    canUsePremiumAreas: premium,
    canAccessFangCove: premium,
    isFallen,
    blockedGuilds: f2p ? [...F2P_BLOCKED_GUILDS] : [],
    notes,
  }
}

/** Whether this character's guild is available on their tier. */
export function guildAllowed(guild: string | undefined, tier: AccountTier): boolean {
  if (!guild) return true
  const f2p = tier === 'f2p' || tier === 'unknown'
  if (!f2p) return true
  return !F2P_BLOCKED_GUILDS.includes(
    guild.toLowerCase() as (typeof F2P_BLOCKED_GUILDS)[number]
  )
}

export function capabilitiesForCharacter(c: CharacterStatus): AccountCapabilities {
  return capabilitiesFor(c.accountTier, c.instance)
}

/**
 * Why this intent cannot run right now, or null if it can.
 *
 * This used to be `return null`, which made the "capability-aware rule
 * (mandatory)" in the bridge contract a function that permitted everything.
 * It now enforces the things that are actually true, and deliberately does not
 * guess at the things that are not knowable from a status payload.
 *
 * Two rules govern what belongs here:
 *
 * 1. **Safety intents are never blocked.** Stop, pause, resume and escape go
 *    out whatever the state says. A gate on the emergency control is a bug,
 *    not a feature. See docs/DOMAIN.md.
 * 2. **Only block on things we know.** A wrong refusal is worse than a missing
 *    one, because the player cannot argue with it. Where tier is `unknown` we
 *    warn rather than refuse.
 */
export function intentBlockReason(
  intent: string,
  c: CharacterStatus
): string | null {
  // 1. Never gate the way out.
  if (['stop_all', 'pause', 'resume', 'escape'].includes(intent)) return null

  const tier = c.accountTier
  const f2p = tier === 'f2p'
  const caps = capabilitiesFor(tier, c.instance)

  // Dead is dead. Everything except getting help is pointless.
  if (c.situation.includes('dead') || c.situation.includes('dying')) {
    if (intent !== 'go_healer' && intent !== 'escape_heal') {
      return 'You are down. Get help first.'
    }
  }

  switch (intent) {
    case 'start_training':
    case 'start_combat': {
      if (c.situation.includes('stunned')) {
        return 'Stunned — wait for it to pass.'
      }
      // Guilds a free account cannot play. If the bridge is reporting one, the
      // tier reading is more likely wrong than the guild, so say so carefully.
      if (f2p && !guildAllowed(c.guild, tier)) {
        return `Free accounts cannot play ${c.guild}. If this is wrong, check the account tier setting.`
      }
      return null
    }

    case 'travel': {
      // The real gate is per-province and per-passport, which planTravel
      // handles because it knows the destination. Nothing useful to add here.
      return null
    }

    case 'burgle': {
      // Not a tier rule. Justice is real, fines are large, and the community
      // script's own disclaimer is "NOT RESPONSIBLE FOR YOUR ASTRONOMICAL
      // FINES". Refuse only where the character plainly cannot cope.
      if (c.situation.includes('in_combat')) {
        return 'Something is fighting you. Deal with that first.'
      }
      return null
    }

    case 'town_run': {
      if (f2p && !caps.hasVault) {
        // Not a refusal: the planner drops the vault step. Worth saying once.
        return null
      }
      return null
    }

    default:
      return null
  }
}

/**
 * Things worth telling the player before an intent runs, that are not reasons
 * to refuse it. The mock and the bridge log these; they never block.
 */
export function intentWarnings(intent: string, c: CharacterStatus): string[] {
  const out: string[] = []
  const tier = c.accountTier
  const caps = capabilitiesFor(tier, c.instance)

  if (tier === 'unknown') {
    out.push(
      'Account tier is unknown, so restrictions are being guessed conservatively. Set it in Settings.'
    )
  }

  if (intent === 'town_run' && !caps.hasVault) {
    out.push('No vault on this tier, so the vault step is skipped.')
  }
  if (intent === 'town_run' && caps.bankCapPlatinum != null) {
    out.push(
      `Bank ceiling is ${caps.bankCapPlatinum} platinum across all banks. Do not overflow it.`
    )
  }
  if (intent === 'start_training' && caps.expThrottled) {
    const ranks = c.skills?.length ? Math.max(...c.skills.map((s) => s.ranks)) : 0
    const rate = Math.round(expAbsorptionRate(tier, ranks) * 100)
    out.push(`Free account: absorbing at about ${rate}% of the subscriber rate.`)
  }
  if (c.roomPlayers?.length) {
    out.push(
      `${c.roomPlayers.length} other player${c.roomPlayers.length > 1 ? 's' : ''} here. Hunting grounds are shared.`
    )
  }
  if ((c.favors ?? 0) === 0 && (intent === 'start_combat' || intent === 'start_training')) {
    out.push('No favors. A death will cost full price.')
  }

  return out
}
