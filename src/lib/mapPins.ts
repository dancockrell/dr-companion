/**
 * Places worth remembering: pins on the map, colour-coded, one hotbutton
 * each below it.
 *
 * A pin is a Lich room id and nothing else needs to be geography — the
 * label and colour are the player's own words for the place, and travel
 * (map_walk) already works off room ids independent of whichever zone
 * happens to be drawn on screen right now. So a pin set in The Crossing
 * still works as a hotbutton while browsing a gate three zones away.
 *
 * Per character, the same way profiles.ts is: Home for one character is not
 * Home for another, and two characters sharing this machine should not see
 * each other's hangouts. Keyed with the same `profileKey` for exactly that
 * reason — one localStorage entry per character, not per zone or per pin.
 */
import { readJSON, writeJSON } from './storage'
import { profileKey } from './profiles'
import type { GameInstance } from '../types'

/**
 * A small fixed palette rather than a colour picker. Six is enough to tell
 * hangouts from hazards from "just remember this" at a glance, and a free
 * colour picker on a five-button hotbar would be a UI nobody could scan.
 */
export const PIN_COLORS = ['blue', 'gold', 'green', 'red', 'purple', 'slate'] as const
export type PinColor = (typeof PIN_COLORS)[number]

export const PIN_COLOR_HEX: Record<PinColor, string> = {
  blue: '#4f8fe0',
  gold: '#d4a83a',
  green: '#4caf6e',
  red: '#e0554f',
  purple: '#a476dd',
  slate: '#8a94a6',
}

export interface MapPin {
  id: string
  /** Lich's room id — what map_walk and Room#path_to both take. */
  roomId: number
  /** The genie_zone this room reported when pinned, for grouping only. */
  zone: string
  label: string
  color: PinColor
  /** Epoch ms, so pins can be listed oldest/newest if that's ever wanted. */
  createdAt: number
}

const STORAGE_KEY = 'drc.pins.v1'
type PinStore = Record<string, MapPin[]>

function loadStore(): PinStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as PinStore) : {}
}

function saveStore(store: PinStore): void {
  writeJSON(STORAGE_KEY, store)
}

export function loadPins(name: string, instance: GameInstance): MapPin[] {
  return loadStore()[profileKey(name, instance)] ?? []
}

export function addPin(
  name: string,
  instance: GameInstance,
  pin: { roomId: number; zone: string; label: string; color: PinColor }
): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const full: MapPin = {
    ...pin,
    id: `${pin.roomId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    createdAt: Date.now(),
  }
  const next = [...(store[key] ?? []), full]
  store[key] = next
  saveStore(store)
  return next
}

export function removePin(name: string, instance: GameInstance, id: string): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const next = (store[key] ?? []).filter((p) => p.id !== id)
  store[key] = next
  saveStore(store)
  return next
}

export function updatePin(
  name: string,
  instance: GameInstance,
  id: string,
  patch: Partial<Pick<MapPin, 'label' | 'color'>>
): MapPin[] {
  const store = loadStore()
  const key = profileKey(name, instance)
  const next = (store[key] ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p))
  store[key] = next
  saveStore(store)
  return next
}

/** Whether a room already has a pin, for the map to offer "unpin" instead of "pin" a second time. */
export function pinFor(pins: MapPin[], roomId: number): MapPin | undefined {
  return pins.find((p) => p.roomId === roomId)
}
