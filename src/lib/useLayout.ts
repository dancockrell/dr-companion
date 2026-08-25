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
  setPanel,
  defaultLayout,
  type Layout,
  type PanelId,
  type PanelState,
} from './layout'

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

  const update = useCallback(
    (id: PanelId, patch: PanelState) => commit(setPanel(layout, id, patch)),
    [commit, layout]
  )

  const reset = useCallback(() => commit(defaultLayout(mode)), [commit, mode])

  return { layout, move, update, reset }
}
