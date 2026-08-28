/**
 * Per-character settings.
 *
 * The problem this solves, stated plainly: the most-used community combat
 * script keeps its settings in a 930 KB text file containing sixty-one copies
 * of the same block, each wrapped in
 *
 *     if ("$charactername" = "%CHARACTER1") then { ... }
 *
 * Adding a character means copying a block and editing it by hand. Changing a
 * default across characters means editing it sixty-one times. That is not a
 * criticism of the script; it is what configuration looks like when the only
 * surface is a text file the interpreter also reads.
 *
 * It is also the single clearest thing a GUI can fix, it needs no game
 * knowledge we do not already have, and it would be worth having on day one
 * even if every automation feature were removed.
 *
 * See docs/DOMAIN.md section 18.
 */

import type { GameInstance, AccountTier } from '../types'
import { readJSON, writeJSON } from './storage'

export interface CharacterProfile {
  /** Character name as the game spells it. */
  name: string
  instance: GameInstance
  /** Set by the player, since there is no reliable in-game read for it. */
  accountTier: AccountTier
  guild?: string

  /** Skills the player wants biased upward when suggesting what to train. */
  trainFocus: string[]
  huntFavorites: string[]
  huntMode: 'suggest' | 'favorites_only' | 'manual'

  /** Overrides healer scoring. See docs/DOMAIN.md section 15. */
  preferredHealCity: string | null

  houseEntryMethod: 'rope' | 'lockpick' | 'lockpick_ring'
  houseEntryMaxSearches: number
  houseEntryHide: boolean

  /** Free-text, for anything the player wants to remember about this one. */
  notes?: string

  /** Epoch ms, so the UI can show and sort by recency. */
  lastSeen: number
}

/**
 * A character is identified by name *and* instance.
 *
 * The same name can exist on Prime and on The Fallen as different characters
 * with different everything, so keying on name alone would silently merge two
 * people's settings.
 */
export function profileKey(name: string, instance: GameInstance): string {
  return `${instance}:${name.trim().toLowerCase()}`
}

export function newProfile(
  name: string,
  instance: GameInstance,
  overrides?: Partial<CharacterProfile>
): CharacterProfile {
  return {
    name,
    instance,
    accountTier: 'unknown',
    trainFocus: [],
    huntFavorites: [],
    huntMode: 'suggest',
    preferredHealCity: null,
    houseEntryMethod: 'lockpick_ring',
    houseEntryMaxSearches: 3,
    houseEntryHide: true,
    lastSeen: Date.now(),
    ...overrides,
  }
}

const KEY = 'dr-companion-profiles-v1'

export type ProfileMap = Record<string, CharacterProfile>

export function loadProfiles(): ProfileMap {
  const parsed = readJSON<unknown>(KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as ProfileMap) : {}
}

export function saveProfiles(map: ProfileMap): void {
  writeJSON(KEY, map)
}

export function upsertProfile(profile: CharacterProfile): ProfileMap {
  const map = loadProfiles()
  map[profileKey(profile.name, profile.instance)] = profile
  saveProfiles(map)
  return map
}

export function deleteProfile(name: string, instance: GameInstance): ProfileMap {
  const map = loadProfiles()
  delete map[profileKey(name, instance)]
  saveProfiles(map)
  return map
}

/**
 * Copy one character's settings onto another.
 *
 * This is the operation the text-file approach cannot do at all, and the
 * reason people end up with sixty-one blocks that have drifted apart. Identity
 * is never copied.
 */
export function copyProfileSettings(
  from: CharacterProfile,
  onto: CharacterProfile
): CharacterProfile {
  return {
    ...onto,
    trainFocus: [...from.trainFocus],
    huntFavorites: [...from.huntFavorites],
    huntMode: from.huntMode,
    preferredHealCity: from.preferredHealCity,
    houseEntryMethod: from.houseEntryMethod,
    houseEntryMaxSearches: from.houseEntryMaxSearches,
    houseEntryHide: from.houseEntryHide,
  }
}

export function profilesByRecency(map: ProfileMap): CharacterProfile[] {
  return Object.values(map).sort((a, b) => b.lastSeen - a.lastSeen)
}
