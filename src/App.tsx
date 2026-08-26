import { useRef, useState } from 'react'
import { SetupWizard } from './components/first-run/SetupWizard'
import { Dashboard } from './components/dashboard/Dashboard'
import { RoomColumn } from './components/room/RoomColumn'
import { MapColumn } from './components/room/MapColumn'
import { Splitter } from './components/layout/Splitter'
import { AppControls } from './components/layout/AppControls'
import { SafetyFooter } from './components/layout/SafetyFooter'
import { SituationBanner } from './components/layout/SituationBanner'
import { Console } from './components/layout/Console'
import { MapWindow } from './components/MapWindow'
import { PanelWindow } from './components/PanelWindow'
import type { PanelId } from './lib/layout'
import { useAppStore } from './store/useAppStore'

/**
 * Which window this is.
 *
 * The map pops out into a window of its own, which Tauri opens on
 * `index.html?view=map`. A query parameter rather than a route path, because
 * the bundled app is served from a file, where a path would 404 while working
 * fine under the dev server.
 */
function view(): { kind: 'map' } | { kind: 'panel'; id: PanelId } | { kind: 'app' } {
  if (typeof window === 'undefined') return { kind: 'app' }
  const q = new URLSearchParams(window.location.search)
  if (q.get('view') === 'map') return { kind: 'map' }
  if (q.get('view') === 'panel') {
    const id = q.get('id')
    if (id) return { kind: 'panel', id: id as PanelId }
  }
  return { kind: 'app' }
}

const SPLIT_KEY = 'drc.split.v2'

export default function App() {
  const setupComplete = useAppStore((s) => s.setupComplete)
  const hostRef = useRef<HTMLElement | null>(null)

  /**
   * How the window is divided between the companion and the room.
   *
   * Remembered, because a split you have to set again on every launch is one
   * nobody moves a second time. Kept in localStorage rather than the store: it
   * is a property of this window on this screen, and it should not follow a
   * character profile around.
   */
  const [cols, setColsState] = useState<[number, number, number]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? 'null')
      if (Array.isArray(saved) && saved.length === 3 && saved.every((n) => typeof n === 'number')) {
        return saved as [number, number, number]
      }
    } catch {
      // Nothing saved, or saved by an older version with a single number.
    }
    return [0.34, 0.33, 0.33]
  })

  /**
   * The only limit on a divider: a column may not disappear entirely.
   *
   * An earlier version set a comfortable minimum per column - 200, 340, 260 -
   * so that nothing could be made too narrow to read. That was the app
   * deciding how wide the player's columns should be, and it fought them: drag
   * a column narrow and it stopped, or stopped and clipped its own contents.
   *
   * The columns are the player's. If they want the map at 90% and the rest
   * slivers, that is a legitimate thing to want, and the content scrolls
   * rather than the layout refusing. 80px is only enough to keep a column
   * grabbable so it can be dragged back.
   */
  const MIN_PX = 80

  const setCols = (next: [number, number, number]) => {
    setColsState(next)
    try {
      localStorage.setItem(SPLIT_KEY, JSON.stringify(next))
    } catch {
      // Private mode. Losing a divider position is not worth an error.
    }
  }

  /**
   * Move one divider without disturbing the other.
   *
   * A divider drag has to take from its right-hand neighbour only. Spreading
   * the change across both would make the far column twitch while you are
   * adjusting the near one, which reads as the layout fighting you.
   */
  const moveDivider = (i: number) => (share: number) => {
    const total = hostRef.current?.getBoundingClientRect().width ?? 0
    const pair = cols[i] + cols[i + 1]

    // Converted to pixels so the floors mean what they say. On a narrow window
    // the two minimums can exceed the space available, in which case the
    // clamp collapses to the midpoint rather than inverting.
    const lo = total > 0 ? MIN_PX / total : 0.05
    const hi = total > 0 ? pair - MIN_PX / total : pair - 0.05
    const want = share * pair
    const left = hi > lo ? Math.min(hi, Math.max(lo, want)) : pair / 2

    const next = [...cols] as [number, number, number]
    next[i] = left
    next[i + 1] = pair - left
    setCols(next)
  }

  // A popped-out panel is the whole window: no header, no console, no setup
  // wizard. The window *is* the panel, and chrome here would be space charged
  // twice.
  const v = view()
  if (v.kind === 'map') return <MapWindow />
  if (v.kind === 'panel') return <PanelWindow id={v.id} />

  // No max-width. The window is only as wide as the player has decided we are
  // worth against the game window next to it, and capping it at 560px would
  // throw away space they deliberately gave us. See docs/DESIGN.md §2.115.
  return (
    <div className="h-full w-full bg-surface flex flex-col">
      {/* No title bar. The window has one, the character box carries the
          name, and the map says where you are. What is left is three
          controls, which do not need a band of their own. */}
      <AppControls />
      {setupComplete && <SituationBanner />}
      {/* Two columns of equal width: the companion, and the room.
       *
       * The split lives here rather than inside Dashboard because Dashboard
       * measures its own width to decide whether to render dense. Splitting
       * below that point would have it laying out for the full window while
       * occupying half of one.
       *
       * Equal at default scale, and the room column is allowed to give ground
       * first on a narrow window: the companion is the instrument, and a
       * cramped map is a worse loss than a cramped description. */}
      <main ref={hostRef} className="flex min-h-0 flex-1 overflow-hidden">
        {setupComplete ? (
          <>
            {/* The map gets a column of its own.
             *
             * It was a cell in the dashboard grid, competing for vertical
             * space with everything else in that column and losing. The map is
             * the one surface that is watched rather than consulted - players
             * keep it in view while doing something else - so it gets full
             * height and a width you set yourself. */}
            <div className="min-w-0 overflow-hidden border-r border-border" style={{ flex: `${cols[0]} 1 0%` }}>
              <MapColumn />
            </div>
            <Splitter value={cols[0] / (cols[0] + cols[1])} onChange={moveDivider(0)} />
            <div className="min-w-0 overflow-auto" style={{ flex: `${cols[1]} 1 0%` }}>
              <Dashboard />
            </div>
            <Splitter value={cols[1] / (cols[1] + cols[2])} onChange={moveDivider(1)} />
            <div className="min-w-0 overflow-auto" style={{ flex: `${cols[2]} 1 0%` }}>
              <RoomColumn />
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SetupWizard />
          </div>
        )}
      </main>
      {setupComplete && <Console />}
      {setupComplete && <SafetyFooter />}
    </div>
  )
}
