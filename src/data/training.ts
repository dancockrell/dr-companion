/**
 * Training focus catalog (stub).
 * Real system will map skills to hunting grounds per instance + tier.
 */

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
