/**
 * Training focus catalog (stub).
 * Real system will map skills to hunting grounds per instance + tier.
 */

import type { AccountTier, GameInstance } from '../types'

export interface TrainFocusOption {
  id: string
  label: string
  /** Rough difficulty band for UI */
  band: 'novice' | 'mid' | 'high'
  /** Unavailable on F2P if outside Zoluren routes */
  zolurenOk: boolean
}

export const TRAIN_FOCUS_OPTIONS: TrainFocusOption[] = [
  { id: 'weapons', label: 'Weapons', band: 'mid', zolurenOk: true },
  { id: 'armor', label: 'Armor & defenses', band: 'mid', zolurenOk: true },
  { id: 'magic', label: 'Primary magic', band: 'mid', zolurenOk: true },
  { id: 'survival', label: 'Survival / outdoors', band: 'novice', zolurenOk: true },
  { id: 'lore', label: 'Lore', band: 'novice', zolurenOk: true },
  { id: 'advanced_hunt', label: 'Harder hunting', band: 'high', zolurenOk: false },
]

export function filterTrainFocusForTier(
  tier: AccountTier,
  _instance: GameInstance
): TrainFocusOption[] {
  if (tier === 'f2p' || tier === 'unknown') {
    return TRAIN_FOCUS_OPTIONS.filter((o) => o.zolurenOk)
  }
  return TRAIN_FOCUS_OPTIONS
}

export function describeTrainingPlan(
  focusIds: string[],
  tier: AccountTier,
  instance: GameInstance
): string {
  if (focusIds.length === 0) {
    return 'No focus selected — using balanced defaults for this character.'
  }
  const labels = TRAIN_FOCUS_OPTIONS.filter((o) => focusIds.includes(o.id)).map(
    (o) => o.label
  )
  const zone =
    instance === 'Fallen'
      ? 'Fallen hunting data'
      : tier === 'f2p' || tier === 'unknown'
        ? 'Zoluren-only grounds'
        : 'full-world grounds'
  return `Focus: ${labels.join(', ')} · ${zone}`
}
