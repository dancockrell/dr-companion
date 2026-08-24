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
  houseEntryMethod?: 'rope' | 'lockpick' | 'lockpick_ring'
  houseEntryMaxSearches?: number
  houseEntryHide?: boolean
}

const defaults: PersistedPrefs = {
  uiMode: 'simple',
  alwaysOnTop: false,
  bridgeMode: 'mock',
  trainFocus: [],
  autoSuggestHealer: true,
  huntFavorites: [],
  huntMode: 'suggest',
  houseEntryMethod: 'lockpick_ring',
  houseEntryMaxSearches: 3,
  houseEntryHide: true,
}

export function loadPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<PersistedPrefs>
    return { ...defaults, ...parsed }
  } catch {
    return { ...defaults }
  }
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
