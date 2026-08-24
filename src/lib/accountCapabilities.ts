/**
 * Account tier → capability flags.
 */
import type { AccountTier, GameInstance, CharacterStatus } from '../types'

export interface AccountCapabilities {
  canTravelOutsideZoluren: boolean
  hasVault: boolean
  vaultApproximateCapacity: number | null
  bankDepositCap: number | null
  bankCapPlatinum: number | null
  inventoryPressureTight: boolean
  expThrottled: boolean
  canUsePremiumAreas: boolean
  canAccessFangCove: boolean
  isFallen: boolean
  notes: string[]
}

export function capabilitiesFor(
  tier: AccountTier,
  instance: GameInstance
): AccountCapabilities {
  const isFallen = instance === 'Fallen' || tier === 'fallen'
  const premium = tier === 'premium' || tier === 'platinum'
  const f2p = tier === 'f2p' || tier === 'unknown'
  const notes: string[] = []
  if (f2p) notes.push('F2P: Zoluren focus, no vault, bank limits, exp throttle')
  if (isFallen) notes.push('Fallen instance — separate geography')
  if (premium) notes.push('Premium areas available')

  return {
    canTravelOutsideZoluren: !f2p || isFallen,
    hasVault: !f2p,
    vaultApproximateCapacity: f2p ? null : 500,
    bankDepositCap: f2p ? 100000 : null,
    bankCapPlatinum: f2p ? 10 : null,
    inventoryPressureTight: f2p,
    expThrottled: f2p,
    canUsePremiumAreas: premium,
    canAccessFangCove: premium,
    isFallen,
    notes,
  }
}

export function capabilitiesForCharacter(c: CharacterStatus): AccountCapabilities {
  return capabilitiesFor(c.accountTier, c.instance)
}

export function intentBlockReason(_intent: string, _c: CharacterStatus): string | null {
  return null
}
