/**
 * Town Run planner — builds a step list from instance + account tier.
 * Not a fixed script; vault/bank steps drop when entitlements disallow them.
 */

import type { AccountTier, GameInstance } from '../types'
import { capabilitiesFor } from '../lib/accountCapabilities'

export type TownStepId =
  | 'heal'
  | 'sell_gems'
  | 'sell_skins'
  | 'deposit_bank'
  | 'vault'
  | 'repair'
  | 'done'

export interface TownStep {
  id: TownStepId
  label: string
  area: string
  optional: boolean
  reason?: string
}

export interface TownRunPlan {
  instance: GameInstance
  accountTier: AccountTier
  steps: TownStep[]
  skipped: { id: TownStepId; reason: string }[]
  summary: string
}

/**
 * Plan a town run for this character. Instance selects geography;
 * account tier selects which steps exist.
 */
export function planTownRun(
  instance: GameInstance,
  accountTier: AccountTier,
  opts?: { needsHeal?: boolean; hasGems?: boolean; hasSkins?: boolean }
): TownRunPlan {
  const cap = capabilitiesFor(accountTier, instance)
  const needsHeal = opts?.needsHeal ?? true
  const hasGems = opts?.hasGems ?? true
  const hasSkins = opts?.hasSkins ?? false
  const steps: TownStep[] = []
  const skipped: TownRunPlan['skipped'] = []

  const town = instance === 'Fallen' ? 'Shard' : 'Crossing'

  if (needsHeal) {
    steps.push({
      id: 'heal',
      label: 'Heal',
      area: town,
      optional: false,
      reason: 'Capability-aware healer selection runs inside this step',
    })
  }

  if (hasGems) {
    steps.push({
      id: 'sell_gems',
      label: 'Sell gems',
      area: town,
      optional: true,
    })
  }

  if (hasSkins) {
    steps.push({
      id: 'sell_skins',
      label: 'Sell skins',
      area: town,
      optional: true,
    })
  }

  if (cap.hasVault) {
    steps.push({
      id: 'vault',
      label: `Vault stow (~${cap.vaultApproximateCapacity})`,
      area: town,
      optional: true,
    })
  } else {
    skipped.push({ id: 'vault', reason: 'No vault on this account tier' })
  }

  if (cap.bankCapPlatinum != null) {
    steps.push({
      id: 'deposit_bank',
      label: `Bank deposit (cap ~${cap.bankCapPlatinum}p)`,
      area: town,
      optional: false,
      reason: 'F2P/unknown bank ceiling — do not overflow',
    })
  } else {
    steps.push({
      id: 'deposit_bank',
      label: 'Bank deposit',
      area: town,
      optional: true,
    })
  }

  steps.push({
    id: 'done',
    label: 'Return to ready',
    area: town,
    optional: false,
  })

  const summary = steps
    .filter((s) => s.id !== 'done')
    .map((s) => s.label)
    .join(' → ')

  return { instance, accountTier, steps, skipped, summary }
}
