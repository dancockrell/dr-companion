/**
 * Panel arrangement, per mode, persisted.
 *
 * Kept out of the Zustand store on purpose: this is view state that belongs to
 * the dashboard, changes on every drag, and nothing else in the app needs to
 * read it. Putting it in the global store would re-render everything that
 * subscribes while somebody is resizing a panel.
 */
import { useCallback, useEffect, useState } from 'react'
import type { UiMode } from '../types'
import {
  loadLayout,
  saveLayout,
  movePanel,
  reorderPanel,
  setPanel,
  defaultLayout,
  setMapPlane,
  setMapSplit,
  cycleDeckPref,
  setPanelRect,
  clearPanelRects,
  type Layout,
  type PanelId,
  type PanelState,
} from './layout'
import type { Deck } from './cards'
import type { Rect } from './freeLayout'

export function useLayout(mode: UiMode) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout(mode))

  // Switching mode swaps the whole arrangement, because Basic and Power are
  // different arrangements of the same panels rather than one arrangement at
  // two densities.
  useEffect(() => {
    setLayout(loadLayout(mode))
  }, [mode])

  const commit = useCallback(
    (next: Layout) => {
      setLayout(next)
      saveLayout(mode, next)
    },
    [mode]
  )

  const move = useCallback(
    (id: PanelId, delta: number) => commit(movePanel(layout, id, delta)),
    [commit, layout]
  )

  const reorder = useCallback(
    (id: PanelId, index: number) => commit(reorderPanel(layout, id, index)),
    [commit, layout]
  )

  const update = useCallback(
    (id: PanelId, patch: PanelState) => commit(setPanel(layout, id, patch)),
    [commit, layout]
  )

  const reset = useCallback(() => commit(defaultLayout(mode)), [commit, mode])

  const setPlane = useCallback(
    (on: boolean) => commit(setMapPlane(layout, on)),
    [commit, layout]
  )

  // Not committed on every mouse move: a drag fires continuously, and writing
  // localStorage per pixel is both wasteful and enough to make the drag stutter.
  // The caller keeps the live value and calls this once on release.
  const setSplit = useCallback(
    (split: number) => commit(setMapSplit(layout, split)),
    [commit, layout]
  )

  const cycleDeck = useCallback(
    (deck: Deck) => commit(cycleDeckPref(layout, deck)),
    [commit, layout]
  )

  const place = useCallback(
    (id: PanelId, rect: Rect) => commit(setPanelRect(layout, id, rect)),
    [commit, layout]
  )

  const unplace = useCallback(() => commit(clearPanelRects(layout)), [commit, layout])

  return {
    layout,
    move,
    reorder,
    update,
    reset,
    setPlane,
    setSplit,
    cycleDeck,
    place,
    unplace,
  }
}
