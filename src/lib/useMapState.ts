import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { GameInstance } from '../types'
import {
  loadPins,
  MAP_PINS_CHANGED_EVENT,
  MAP_PINS_STORAGE_KEY,
  type MapPin,
} from './mapPins.ts'
import {
  loadPlayerMarker,
  PLAYER_MARKER_CHANGED_EVENT,
  PLAYER_MARKER_STORAGE_KEY,
  type PlayerMarker,
} from './playerMarker.ts'
import { subscribeStorageKey } from './subscribedStorage.ts'

type Cached<T> = { signature: string; value: T }
const pinCache = new Map<string, Cached<MapPin[]>>()
const markerCache = new Map<string, Cached<PlayerMarker | undefined>>()
const EMPTY_PINS: MapPin[] = []

function profile(name: string | undefined, instance: GameInstance | undefined) {
  return `${instance ?? 'none'}:${name?.trim().toLowerCase() ?? 'none'}`
}

export function useMapPins(name: string | undefined, instance: GameInstance | undefined): MapPin[] {
  const key = profile(name, instance)
  const getSnapshot = useCallback(() => {
    if (!name || !instance) return EMPTY_PINS
    const next = loadPins(name, instance)
    const signature = JSON.stringify(next)
    const cached = pinCache.get(key)
    if (cached?.signature === signature) return cached.value
    pinCache.set(key, { signature, value: next })
    return next
  }, [instance, key, name])
  const subscribePins = useCallback(
    (notify: () => void) => subscribeStorageKey(MAP_PINS_STORAGE_KEY, MAP_PINS_CHANGED_EVENT, notify),
    []
  )
  return useSyncExternalStore(subscribePins, getSnapshot, getSnapshot)
}

export function usePlayerMarker(name: string | undefined, instance: GameInstance | undefined): PlayerMarker | undefined {
  const key = profile(name, instance)
  const getSnapshot = useCallback(() => {
    if (!name || !instance) return undefined
    const next = loadPlayerMarker(name, instance)
    const signature = `${next.icon}:${next.color}`
    const cached = markerCache.get(key)
    if (cached?.signature === signature) return cached.value
    markerCache.set(key, { signature, value: next })
    return next
  }, [instance, key, name])
  const subscribeMarker = useCallback(
    (notify: () => void) => subscribeStorageKey(PLAYER_MARKER_STORAGE_KEY, PLAYER_MARKER_CHANGED_EVENT, notify),
    []
  )
  return useSyncExternalStore(subscribeMarker, getSnapshot, getSnapshot)
}

export function usePinsByRoom(pins: MapPin[]) {
  return useMemo(() => new Map(pins.map((pin) => [pin.roomId, pin])), [pins])
}
