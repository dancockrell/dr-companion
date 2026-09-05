/**
 * What mesh, if any, an item should be rendered as.
 *
 * `docs/THREE_D_REBUILD_HANDOFF.md` section 11 is the contract. The short
 * version: appearance is data the snapshot carries and Godot renders, resolved
 * `override ?? default ?? nothing`, and "nothing" is a real and common answer
 * that must never be filled in with the nearest-looking mesh.
 *
 * Nothing here is a second copy of anything. The class vocabularies and the
 * ids come from `src/data/appearanceDefaults.json`, which
 * `tools/build-appearance-defaults.mjs` compiles from `SKILLS_BY_SET.Weapon`,
 * `ARMOR_COVERAGE` and Codex's asset registry. Item-name normalisation is
 * `armorLoadout.ts`'s `armorCommandTarget`/`armorPieceId`, and armour
 * classification is its `inferArmorCoverage` - the same functions ArmorManager
 * already shows the player, so a piece cannot be one coverage there and
 * another one here.
 */
import defaults from '../data/appearanceDefaults.json' with { type: 'json' }
import {
  ARMOR_COVERAGE,
  armorPieceId,
  inferArmorCoverage,
  type ArmorProvenance,
} from './armorLoadout.ts'
import { readJSON, writeJSON } from './storage.ts'

export const APPEARANCE_STORAGE_KEY = 'drc.appearance.v1'

export type AppearanceKind = 'weapon' | 'armor'

export interface Appearance {
  /**
   * The class the noun resolved to: a `SKILLS_BY_SET.Weapon` entry, or an
   * `ARMOR_COVERAGE` location. Present even when no mesh exists, because the
   * class is the useful fact - a viewer can still label "Large Edged" while it
   * waits for art, and discarding it would throw away the only thing this
   * resolver actually established.
   */
  class: string
  /**
   * A `selections[].id` from the asset registry, or null when the registry
   * admits no mesh for this class yet. Null today for every class: the
   * registry holds two ids and both are scenery.
   */
  modelId: string | null
  /** Same vocabulary as `ArmorLoadoutPiece.provenance`, deliberately. */
  provenance: ArmorProvenance
}

/** Item id (from `armorPieceId`) to a registry id the player picked. */
export interface AppearanceOverrides {
  [itemId: string]: string
}

/** Every id the registry admitted when the defaults were compiled. */
const REGISTRY_IDS = new Set<string>(defaults.registry.ids)

const WEAPON_NOUNS = defaults.weapon.nouns as Record<string, string>
const WEAPON_CLASSES = defaults.weapon.classes as Record<string, string | null>
const ARMOR_CLASSES = defaults.armor.classes as Record<string, string | null>

/**
 * Space-padded and punctuation-flattened, so a noun matches on whole words
 * without a regex escape anywhere near it. `no-dachi` and `no dachi` collapse
 * to the same thing, which is what we want of a game that writes both.
 */
function flatten(name: string): string {
  return ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
}

/**
 * Which weapon class this item name names, or null.
 *
 * Longest phrase wins, so "a heavy bastard sword" is Large Edged rather than
 * matching the bare "sword" entry - both are Large Edged here, but the rule is
 * what keeps "greatsword" out of Large Edged and "throwing knife" out of Small
 * Edged.
 *
 * null is a real answer and the common one. A weapon nobody has mapped gets no
 * class and no mesh; it must never fall back to the nearest entry, which is
 * how a Moon Mage ends up holding a sword.
 */
export function weaponClassFor(name: string): string | null {
  const value = flatten(name)
  let best: { noun: string; className: string } | null = null
  for (const [noun, className] of Object.entries(WEAPON_NOUNS)) {
    if (!value.includes(flatten(noun))) continue
    if (best === null || noun.length > best.noun.length) best = { noun, className }
  }
  return best ? best.className : null
}

/**
 * Which armour class this item name names, or null.
 *
 * `inferArmorCoverage` is the owner of that question and already returns
 * coverage in `ARMOR_COVERAGE` order, so the first entry is the topmost body
 * location the piece protects. A hauberk covering five locations renders as
 * one chest piece rather than five overlapping meshes.
 */
export function armorClassFor(name: string): string | null {
  const coverage = inferArmorCoverage(name)
  return coverage.length > 0 ? coverage[0] : null
}

function classFor(kind: AppearanceKind, name: string): string | null {
  return kind === 'weapon' ? weaponClassFor(name) : armorClassFor(name)
}

export function loadAppearanceOverrides(): AppearanceOverrides {
  const value = readJSON<AppearanceOverrides>(APPEARANCE_STORAGE_KEY, {})
  return value && typeof value === 'object' ? value : {}
}

export function saveAppearanceOverrides(value: AppearanceOverrides): void {
  writeJSON(APPEARANCE_STORAGE_KEY, value)
}

/**
 * The resolver: override, else the compiled default, else nothing.
 *
 * Returns null - not an `Appearance` with a null class - when the noun names
 * no class at all. Absent and "this is Large Edged and there is no mesh for it
 * yet" are different facts, and the caller keeps them apart by omitting the
 * field entirely for the first, exactly as `tactical` does.
 */
export function appearanceFor(kind: AppearanceKind, name: string): Appearance | null {
  const className = classFor(kind, name)
  if (className === null) return null

  const table = kind === 'weapon' ? WEAPON_CLASSES : ARMOR_CLASSES
  const fallback = table[className] ?? null

  const override = loadAppearanceOverrides()[armorPieceId(name)]
  // An override naming an id the registry never admitted is ignored rather
  // than honoured: it would render as nothing at all, which is
  // indistinguishable from the class having no art, and the player would have
  // no way to tell their choice had failed.
  const usable = override != null && REGISTRY_IDS.has(override) ? override : null

  return {
    class: className,
    modelId: usable ?? fallback,
    provenance: usable !== null ? 'player' : 'derived',
  }
}

export function setAppearanceOverride(name: string, modelId: string): boolean {
  if (!REGISTRY_IDS.has(modelId)) return false
  const next = loadAppearanceOverrides()
  next[armorPieceId(name)] = modelId
  saveAppearanceOverrides(next)
  return true
}

export function resetAppearanceOverride(name: string): void {
  const next = loadAppearanceOverrides()
  delete next[armorPieceId(name)]
  saveAppearanceOverrides(next)
}

/** Every registry id the client knows about, for a picker to offer. */
export function knownModelIds(): string[] {
  return [...REGISTRY_IDS].sort()
}

/** Every class a picker can group by, in the order the compiler emitted. */
export function appearanceClasses(kind: AppearanceKind): string[] {
  return Object.keys(kind === 'weapon' ? WEAPON_CLASSES : ARMOR_CLASSES)
}

/**
 * One player's exported choices.
 *
 * `provenance` is always `'player'` on export and is not read back on import:
 * it says what the file is, so a reader who finds one on disk knows it is
 * somebody's hand-made preferences rather than a generated default table.
 */
export interface AppearanceExport {
  version: 1
  overrides: AppearanceOverrides
  provenance: 'player'
}

export interface AppearanceImportResult {
  /** Choices taken from the file because the local player had none. */
  added: number
  /**
   * Items where the file and the local player disagree. Never applied. The
   * local choice always wins, because an import is somebody else's opinion
   * arriving at a machine whose owner has already expressed their own, and
   * silently replacing it would be indistinguishable from losing it.
   */
  conflicts: Array<{ itemId: string; mine: string; theirs: string }>
  /**
   * Entries naming an id this build's registry does not admit. Counted rather
   * than dropped in silence: a file that imports "successfully" while a third
   * of it vanished is the sort of quiet loss that gets discovered months
   * later.
   */
  ignoredUnknownIds: number
  /** Entries the file's shape made unusable (missing id, wrong type). */
  ignoredMalformed: number
}

export function exportAppearanceOverrides(): AppearanceExport {
  return { version: 1, overrides: loadAppearanceOverrides(), provenance: 'player' }
}

/**
 * Merge an exported file into this machine's choices.
 *
 * Three rules, and the first is the one that must never be relaxed:
 * the local player's own choice always wins; a conflict is *returned*, never
 * resolved; and an id this build does not know is counted, not stored.
 *
 * Takes `unknown` because the input is a file somebody handed us, not a value
 * this app built.
 */
export function importAppearanceOverrides(input: unknown): AppearanceImportResult {
  const result: AppearanceImportResult = {
    added: 0,
    conflicts: [],
    ignoredUnknownIds: 0,
    ignoredMalformed: 0,
  }

  const raw = (input as AppearanceExport | null)?.overrides
  if (!raw || typeof raw !== 'object') return result

  const mine = loadAppearanceOverrides()
  const next = { ...mine }

  for (const [itemId, theirs] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof itemId !== 'string' || itemId === '' || typeof theirs !== 'string') {
      result.ignoredMalformed += 1
      continue
    }
    if (!REGISTRY_IDS.has(theirs)) {
      result.ignoredUnknownIds += 1
      continue
    }
    const own = mine[itemId]
    if (own === undefined) {
      next[itemId] = theirs
      result.added += 1
      continue
    }
    // Identical choices are not a conflict; there is nothing to decide.
    if (own !== theirs) result.conflicts.push({ itemId, mine: own, theirs })
  }

  if (result.added > 0) saveAppearanceOverrides(next)
  return result
}

/**
 * The character's own figure: what is in each hand and what is worn.
 *
 * Every field is absent rather than null when nothing resolved, so a viewer
 * cannot mistake "we do not know what is in that hand" for "that hand is
 * empty". `ARMOR_COVERAGE` order is preserved and one class wins once, so a
 * hauberk and a breastplate do not both claim the chest.
 */
export interface PlayerAppearance {
  leftHand?: Appearance
  rightHand?: Appearance
  worn?: Appearance[]
}

export function playerAppearanceFor(
  hands: { left: string | null; right: string | null } | undefined,
  worn: readonly string[] | undefined
): PlayerAppearance | null {
  const left = hands?.left ? appearanceFor('weapon', hands.left) : null
  const right = hands?.right ? appearanceFor('weapon', hands.right) : null

  const byClass = new Map<string, Appearance>()
  for (const name of worn ?? []) {
    const piece = appearanceFor('armor', name)
    // First piece claiming a location keeps it. `armorCandidates` already
    // orders the player's own list; picking a later one would silently
    // reorder what ArmorManager shows.
    if (piece && !byClass.has(piece.class)) byClass.set(piece.class, piece)
  }
  const pieces = (ARMOR_COVERAGE as readonly string[])
    .map((c) => byClass.get(c))
    .filter((p): p is Appearance => p != null)

  if (!left && !right && pieces.length === 0) return null
  return {
    ...(left ? { leftHand: left } : {}),
    ...(right ? { rightHand: right } : {}),
    ...(pieces.length > 0 ? { worn: pieces } : {}),
  }
}
