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

export function intentBlockReason(_intent: string, _c: CharacterStatus): string | null {
  return null
}
