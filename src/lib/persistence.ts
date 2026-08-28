/**
 * localStorage persistence for user preferences.
 * Does not store credentials or game session secrets.
 */

import type { UiMode } from '../types'
import { readJSON, writeJSON } from './storage'

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
  /**
   * Which invented character Mock is playing.
   *
   * Remembered because it was not, and the app went back to the barbarian on
   * every reload - so anyone testing against a different guild reset their
   * own setup several times a minute. It is also what lets the dashboard be
   * rendered without a person clicking through to it, which is how it gets
   * looked at rather than described.
   */
  demoPreset?: string
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
  /**
   * Sound levels, 0 to 1.5 (0% to 150%) each, no separate mute flag - 0 is
   * silent. Three independent channels because a listener who wants the
   * idle warning but not a music bed, or the ambience but not the radio,
   * should be able to have exactly that - see ambientSound.ts and
   * alertSound.ts for where these are actually applied.
   */
  alertsVolume?: number
  ambientVolume?: number
  musicVolume?: number
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
  demoPreset: 'basic_prime',
  houseEntryMethod: 'lockpick_ring',
  houseEntryMaxSearches: 3,
  houseEntryHide: true,
  setupComplete: false,
  // Kept identical to alertSound.ts's own default, by hand - there is no
  // single source of truth between the two, and letting them drift is
  // exactly what happened here once already (this stood at 0.8 after the
  // module's own default had already been lowered to 0.45, and nothing
  // caught it - see SoundControls.tsx's header for the read-order bug that
  // made the drift actually reach the screen).
  alertsVolume: 0.45,
  ambientVolume: 1,
  musicVolume: 1,
}

export function loadPrefs(): PersistedPrefs {
  const parsed = readJSON<Partial<PersistedPrefs>>(KEY, {})
  return { ...defaults, ...parsed, uiMode: migrateMode(parsed.uiMode) }
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
  writeJSON(KEY, next)
  return next
}
