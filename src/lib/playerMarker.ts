/**
 * The character's own mark on the map - Dan's ask, 30 Aug 2026: "show where
 * the character is with a big player icon coat of arms chosen from a picker
 * with many symbols and a color editor to choose from."
 *
 * Per character, the same way mapPins.ts is: two characters sharing this
 * machine should not be stuck with each other's chosen symbol. Any colour
 * at all, not the six-entry PIN_COLORS palette pins use - a coat of arms is
 * a personal choice in a way a pin's category colour is not, and six swatches
 * for hundreds of accounts on this game is not "a colour editor."
 */
import { readJSON, writeJSON } from './storage.ts'
import { profileKey } from './profiles.ts'
import { PIN_COLOR_HEX, PIN_ICONS, type PinIcon } from './mapPins.ts'
import type { GameInstance } from '../types'

export interface PlayerMarker {
  icon: PinIcon
  /** Any CSS hex colour - a real colour editor, not a fixed palette. */
  color: string
}

export const DEFAULT_MARKER: PlayerMarker = { icon: 'shield', color: PIN_COLOR_HEX.red }

const STORAGE_KEY = 'drc.player-marker.v1'
export const PLAYER_MARKER_STORAGE_KEY = STORAGE_KEY
export const PLAYER_MARKER_CHANGED_EVENT = 'drc:player-marker-changed'
type MarkerStore = Record<string, PlayerMarker>

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
}

function loadStore(): MarkerStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as MarkerStore) : {}
}

export function loadPlayerMarker(name: string, instance: GameInstance): PlayerMarker {
  const raw = loadStore()[profileKey(name, instance)]
  if (!raw) return DEFAULT_MARKER
  const icon: PinIcon = (PIN_ICONS as readonly string[]).includes(raw.icon) ? raw.icon : DEFAULT_MARKER.icon
  const color = isHexColor(raw.color) ? raw.color : DEFAULT_MARKER.color
  return { icon, color }
}

export function savePlayerMarker(name: string, instance: GameInstance, marker: PlayerMarker): void {
  const store = loadStore()
  store[profileKey(name, instance)] = marker
  writeJSON(STORAGE_KEY, store)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAYER_MARKER_CHANGED_EVENT))
}
