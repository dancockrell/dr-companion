/**
 * localStorage persistence for user preferences.
 * Does not store credentials or game session secrets.
 */

import type { UiMode } from '../types'

const KEY = 'dr-companion-prefs-v1'

export interface PersistedPrefs {
  uiMode: UiMode
  alwaysOnTop: boolean
  bridgeMode: 'mock' | 'live'
  /** Skills the player wants to emphasize in training */
  trainFocus: string[]
  /** Auto-open healer banner actions */
  autoSuggestHealer: boolean
  huntFavorites: string[]
  huntMode: 'suggest' | 'favorites_only' | 'manual'
  /** Town the player wants to heal in, overriding the scorer. */
  preferredHealCity?: string | null
  consoleOpen?: boolean
  /**
   * Global type scale, as a multiplier on the root font size.
   *
   * A setting rather than a fixed size because this audience is squarely in the
   * band where presbyopia is near-universal, and because eyes differ enough
   * that any single number would be wrong for a lot of people. Tailwind's sizes
   * are rem-based, so scaling the root scales everything together and keeps the
   * proportions the layout was built with.
   */
  typeScale?: number
  /** Frontend id, which decides the Lich script prefix. */
  frontend?: string
  houseEntryMethod?: 'rope' | 'lockpick' | 'lockpick_ring'
  houseEntryMaxSearches?: number
  houseEntryHide?: boolean
  /**
   * Whether first-run setup has been through once.
   *
   * Kept out here with the preferences rather than in the store, because the
   * store is rebuilt from nothing on every load and this is precisely the fact
   * that has to survive that. Without it the app opens on the setup wizard
   * forever: everything else about a returning player is remembered and the
   * one bit saying they are a returning player was not.
   */
  setupComplete?: boolean
}

const defaults: PersistedPrefs = {
  uiMode: 'basic',
  alwaysOnTop: false,
  bridgeMode: 'mock',
  trainFocus: [],
  autoSuggestHealer: true,
  huntFavorites: [],
  huntMode: 'suggest',
  preferredHealCity: null,
  consoleOpen: false,
  typeScale: 1,
  frontend: 'genie',
  houseEntryMethod: 'lockpick_ring',
  houseEntryMaxSearches: 3,
  houseEntryHide: true,
  setupComplete: false,
}

export function loadPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<PersistedPrefs>
    return { ...defaults, ...parsed, uiMode: migrateMode(parsed.uiMode) }
  } catch {
    return { ...defaults }
  }
}

/**
 * There used to be three modes. Anyone who ran an earlier build has 'simple'
 * or 'standard' stored, and reading one of those back would leave the app
 * matching neither branch and rendering an empty window.
 */
function migrateMode(stored: unknown): UiMode {
  return stored === 'power' ? 'power' : 'basic'
}

export function savePrefs(partial: Partial<PersistedPrefs>): PersistedPrefs {
  const next = { ...loadPrefs(), ...partial }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore quota / private mode
  }
  return next
}
