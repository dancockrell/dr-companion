/**
 * "You've stood here N times - pin it?"
 *
 * Reuses trail.visits, which MapCanvas already tracks for the ringed-room
 * visual - no new counting, just a second use of a number this app already
 * keeps. Per-room dismissal, not global: saying no to a nudge about the
 * training hall you deliberately don't want pinned must not silence every
 * future nudge about anywhere else, or the feature would only ever fire
 * once per session before going quiet for good.
 */
import { readJSON, writeJSON } from './storage'
import { profileKey } from './profiles'
import type { GameInstance } from '../types'

/** Below this, "you keep coming back" isn't true yet - it's just standing around. */
export const NUDGE_VISIT_THRESHOLD = 5

const STORAGE_KEY = 'drc.nudge.v1'
type DismissStore = Record<string, number[]>

function loadStore(): DismissStore {
  const parsed = readJSON<unknown>(STORAGE_KEY, {})
  return typeof parsed === 'object' && parsed !== null ? (parsed as DismissStore) : {}
}

export function isDismissed(name: string, instance: GameInstance, roomId: number): boolean {
  const store = loadStore()
  return (store[profileKey(name, instance)] ?? []).includes(roomId)
}

export function dismissNudge(name: string, instance: GameInstance, roomId: number): void {
  const store = loadStore()
  const key = profileKey(name, instance)
  const list = store[key] ?? []
  if (!list.includes(roomId)) {
    store[key] = [...list, roomId]
    writeJSON(STORAGE_KEY, store)
  }
}
