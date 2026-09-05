/**
 * Rooms the player asked to watch carefully - the opt-in half of the
 * Elanthipedia feature. Dan: "only for rooms that the player chooses to
 * WATCH CAREFULLY with a clickable box in the tool tip. This is for rooms
 * that need frequent updating for whatever reason, likely a festival."
 *
 * Per character, same reasoning as mapPins.ts: a festival room worth
 * watching on one character's map is not necessarily worth watching on
 * another's, and two characters sharing this machine should not see each
 * other's list.
 */
import { readJSON, writeJSON } from './storage.ts'
import { profileKey } from './profiles.ts'
import type { GameInstance } from '../types'

const STORAGE_KEY = 'drc.watched-rooms.v1'
type WatchStore = Record<string, number[]>

function loadStore(): WatchStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as WatchStore) : {}
}

function saveStore(store: WatchStore): void {
  writeJSON(STORAGE_KEY, store)
}

export function loadWatchedRooms(name: string, instance: GameInstance): Set<number> {
  return new Set(loadStore()[profileKey(name, instance)] ?? [])
}

export function isWatched(name: string, instance: GameInstance, roomId: number): boolean {
  return loadWatchedRooms(name, instance).has(roomId)
}

/** Flip a room's watched state and return the new value - the hover card's checkbox reads this back to know which way it just went. */
export function toggleWatched(name: string, instance: GameInstance, roomId: number): boolean {
  const store = loadStore()
  const key = profileKey(name, instance)
  const current = new Set(store[key] ?? [])
  let now: boolean
  if (current.has(roomId)) {
    current.delete(roomId)
    now = false
  } else {
    current.add(roomId)
    now = true
  }
  store[key] = [...current]
  saveStore(store)
  return now
}
