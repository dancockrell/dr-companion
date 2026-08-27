/**
 * Where the map is, how wide it is, and how far in it is zoomed.
 *
 * Three settings that belong together because they are one decision made in
 * three parts: how much of the screen the player is willing to give the chart.
 *
 * Not in the Zustand store, deliberately. The store carries game state and
 * follows a character profile around; this is a property of this window on
 * this screen. Someone who plays two characters wants the same map width for
 * both, and would be surprised to find it changed when they switched.
 *
 * Not component state either, because two components need the same answer: App
 * decides whether to render the map column and how wide, and MapPanel decides
 * whether it is showing the chart or a "it is in its own window" note. Held in
 * one component and passed down, the popped-out map window - a separate
 * document entirely - could not see it at all.
 *
 * So: localStorage, with a subscription, read through useSyncExternalStore.
 * Every reader sees the same value, writes reach every reader, and the value
 * survives a reload.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'drc.map.v1'

export interface MapDock {
  /** In the main window as a column, rather than in a window of its own. */
  docked: boolean
  /** The map column's width in pixels. Pixels, not a share of the window. */
  width: number
  /**
   * How far in the chart is zoomed, as a multiple of fit-the-whole-zone.
   *
   * 1 means the whole zone is on screen, which is the useful default: the map
   * is a directory of the city and the point of it is that the Bathhouse is
   * findable by looking. Above 1 the chart is drawn larger than the box and
   * the box scrolls, kept centred on where the character is standing.
   */
  zoom: number
  /**
   * Zoom in the popped-out window, which is a different number entirely.
   *
   * Docked, zoom is a multiple of fit-the-zone, because the box has a size and
   * the chart is scaled into it. In its own window the chart is drawn at a
   * size in pixels per map unit and the window scrolls. Squeezing both into
   * one field would mean one of the two windows silently getting a zoom that
   * means something else there.
   */
  windowZoom: number
}

/**
 * 300px and fit.
 *
 * Wide enough that Crossing's street grid is legible at fit, narrow enough
 * that it is not the first thing anyone drags smaller. It is a starting point
 * and nothing else - the whole reason this is stored is that the player moves
 * it and it stays moved.
 */
const DEFAULT: MapDock = { docked: true, width: 300, zoom: 1, windowZoom: 1.5 }

export const ZOOM_MIN = 1
export const ZOOM_MAX = 6
export const WINDOW_ZOOM_MIN = 0.4
export const WINDOW_ZOOM_MAX = 6

/** Narrow enough to be a sliver, wide enough to still be grabbable. */
export const MIN_WIDTH_PX = 80

function read(): MapDock {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return DEFAULT
    return {
      docked: typeof raw.docked === 'boolean' ? raw.docked : DEFAULT.docked,
      width: Number.isFinite(raw.width) ? Math.max(MIN_WIDTH_PX, raw.width) : DEFAULT.width,
      zoom: Number.isFinite(raw.zoom)
        ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw.zoom))
        : DEFAULT.zoom,
      windowZoom: Number.isFinite(raw.windowZoom)
        ? Math.min(WINDOW_ZOOM_MAX, Math.max(WINDOW_ZOOM_MIN, raw.windowZoom))
        : DEFAULT.windowZoom,
    }
  } catch {
    // Private mode, or something else wrote nonsense to the key. A default
    // layout is a worse answer than the player's own and a much better one
    // than a crash on boot.
    return DEFAULT
  }
}

/**
 * The snapshot has to be referentially stable.
 *
 * useSyncExternalStore compares snapshots by identity and re-renders when they
 * differ. Parsing localStorage on every call returns a fresh object every
 * time, which reads as "changed" on every render and loops until React gives
 * up with "getSnapshot should be cached". Cached here, replaced only in set().
 */
let current = read()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  // Another window - the popped-out map - writing the same key.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    current = read()
    fn()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
  }
}

export function setMapDock(patch: Partial<MapDock>) {
  const next = { ...current, ...patch }
  next.width = Math.max(MIN_WIDTH_PX, next.width)
  next.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next.zoom))
  next.windowZoom = Math.min(WINDOW_ZOOM_MAX, Math.max(WINDOW_ZOOM_MIN, next.windowZoom))
  if (
    next.docked === current.docked &&
    next.width === current.width &&
    next.zoom === current.zoom &&
    next.windowZoom === current.windowZoom
  ) {
    return
  }
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Losing the setting is not worth failing the drag that set it.
  }
  for (const fn of listeners) fn()
}

export function useMapDock(): MapDock {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT
  )
}
