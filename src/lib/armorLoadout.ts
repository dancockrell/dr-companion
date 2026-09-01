import type { InventorySummary } from '../types'
import { readJSON, writeJSON } from './storage'

/**
 * Coverage is deliberately player-editable. The live Lich inventory feed gives
 * DR Companion item names, not the body locations protected by each item, and
 * two similarly named pieces can cover different locations. These guesses are
 * only useful starting points; ArmorManager marks them as derived and stores a
 * player's corrections per character.
 */
export const ARMOR_COVERAGE = [
  'head',
  'eyes',
  'neck',
  'chest',
  'abdomen',
  'back',
  'arms',
  'hands',
  'legs',
  'feet',
  'shield',
] as const

export type ArmorCoverage = (typeof ARMOR_COVERAGE)[number]
export type ArmorProvenance = 'derived' | 'player'

export interface ArmorLoadoutPiece {
  id: string
  name: string
  coverage: ArmorCoverage[]
  provenance: ArmorProvenance
}

export interface ArmorLoadouts {
  [character: string]: ArmorLoadoutPiece[]
}

const STORAGE_KEY = 'drc.armor-loadouts.v1'

export function armorCommandTarget(name: string): string {
  return name.replace(/^(?:a|an|some|the)\s+/i, '').trim()
}

export function armorPieceId(name: string): string {
  return armorCommandTarget(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Conservative name-based defaults. Unknown pieces stay unassigned rather
 * than being confidently put on the wrong body location. */
export function inferArmorCoverage(name: string): ArmorCoverage[] {
  const value = ` ${armorCommandTarget(name).toLowerCase()} `
  const result = new Set<ArmorCoverage>()

  if (/\b(shield|buckler|pavise|targe)\b/.test(value)) result.add('shield')
  if (/\b(helm|helmet|armet|cap|coif|balaclava|hood)\b/.test(value)) result.add('head')
  if (/\b(mask|visor|goggles)\b/.test(value)) {
    result.add('eyes')
    result.add('head')
  }
  if (/\b(aventail|gorget|collar|neckguard)\b/.test(value)) result.add('neck')
  if (/\b(vambrace|vambraces|bracer|bracers|armguard|armguards|sleeve|sleeves)\b/.test(value)) result.add('arms')
  if (/\b(gauntlet|gauntlets|glove|gloves|handguard|handguards)\b/.test(value)) result.add('hands')
  if (/\b(greave|greaves|tasset|tassets|legguard|legguards|chausses)\b/.test(value)) result.add('legs')
  if (/\b(boot|boots|sabatons?|footguards?)\b/.test(value)) result.add('feet')

  if (/\b(breastplate|cuirass|vest|shirt|jerkin)\b/.test(value)) {
    result.add('chest')
    result.add('abdomen')
    result.add('back')
  }

  // These are commonly broad-coverage suits. The manager makes every one of
  // these locations a one-click correction because the exact piece can differ.
  if (/\b(armor|armour|hauberk|leathers?|brigandine|mail|chainmail|plate|robe|robes|gown)\b/.test(value)) {
    result.add('chest')
    result.add('abdomen')
    result.add('back')
    result.add('arms')
    result.add('legs')
  }

  return ARMOR_COVERAGE.filter((part) => result.has(part))
}

export function isLikelyArmor(name: string): boolean {
  return inferArmorCoverage(name).length > 0
}

export function armorCandidates(inventory: InventorySummary | null): string[] {
  if (!inventory) return []
  const seen = new Set<string>()
  const names = [
    ...(inventory.worn ?? []),
    ...inventory.containers.flatMap((container) => container.items ?? []),
  ].filter((name) => {
    const key = armorCommandTarget(name).toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })

  return names.sort((a, b) => {
    const armorOrder = Number(isLikelyArmor(b)) - Number(isLikelyArmor(a))
    return armorOrder || a.localeCompare(b)
  })
}

export function sameArmorItem(a: string, b: string): boolean {
  return armorCommandTarget(a).toLowerCase() === armorCommandTarget(b).toLowerCase()
}

export function loadArmorLoadouts(): ArmorLoadouts {
  const value = readJSON<ArmorLoadouts>(STORAGE_KEY, {})
  return value && typeof value === 'object' ? value : {}
}

export function saveArmorLoadouts(value: ArmorLoadouts): void {
  writeJSON(STORAGE_KEY, value)
}
