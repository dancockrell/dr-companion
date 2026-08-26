/**
 * One dashboard: a map plane, and a plane of panels beside it.
 *
 * The map is not a widget you consult, it is a surface you watch — players know
 * which rooms break scripts and keep it in view while doing something else. As
 * a panel in a scrolling column it could never do that, because it was always
 * competing for vertical space with whatever sat above it, and it always lost.
 * So it gets a plane of its own and a divider the player drags.
 *
 * Everything else is arranged by the player. There used to be three
 * hand-written dashboards whose panel order was whatever order the panels had
 * been written in. Two players will not agree on what deserves their pixels — a
 * crafter wants inventory open and the map small, someone hunting wants the map
 * large and watched — so the app ships defaults and gets out of the way.
 *
 * No width is assumed anywhere. The window is only as wide as the player has
 * decided we are worth against the game window next to it. See §2.115.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useLayout } from '../../lib/useLayout'
import { clampSplit, type PanelId } from '../../lib/layout'
import { isTauri, invokeTauri } from '../../lib/tauri'
import { CharacterHeader } from './CharacterHeader'
import { MapPanel } from '../shared/MapPanel'
import { PANEL_CONTENT, PANEL_TITLES } from './panels'
import { DockView } from './DockView'
import { FreeCanvas } from './FreeCanvas'
import { dockOf, without } from '../../lib/dock'

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, setSplit, cycleDeck, dock, place, unplace } = useLayout(uiMode)

  // Which panel is in the hand, and where it would land. Held here rather than
  // in each Panel so the insertion line can be drawn on a different panel from
  // the one being dragged.

  // Which panels are in windows of their own. Asked rather than remembered:
  // each is a separate webview, and the player can close one by hand without
  // this window hearing about it.
  const [out, setOut] = useState<PanelId[]>([])
  const refreshOut = useCallback(() => {
    if (!isTauri()) return
    void invokeTauri('panel_windows')
      .then((ids) => setOut(Array.isArray(ids) ? (ids as PanelId[]) : []))
      .catch(() => setOut([]))
  }, [])

  useEffect(() => {
    refreshOut()
    // Cheap poll rather than an event, because the interesting change happens
    // in another window and closing one by hand emits nothing here.
    const t = setInterval(refreshOut, 2000)
    return () => clearInterval(t)
  }, [refreshOut])

  const popOut = useCallback(
    (id: PanelId) => {
      void invokeTauri('open_panel_window', { id, title: PANEL_TITLES[id] })
        .then(refreshOut)
        .catch(refreshOut)
    },
    [refreshOut]
  )

  const popBack = useCallback(
    (id: PanelId) => {
      void invokeTauri('close_panel_window', { id })
        .then(refreshOut)
        .catch(refreshOut)
    },
    [refreshOut]
  )

  // Measured, not read off the viewport. This app can be docked beside other
  // things, and a media query would describe the screen rather than the space
  // we were actually handed.
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
  }, [])

  // Live during a drag, so the divider tracks the cursor without writing
  // localStorage on every mouse move.
  const [dragSplit, setDragSplit] = useState<number | null>(null)
  const dragging = useRef(false)

  const onMove = useCallback((e: MouseEvent) => {
    if (!dragging.current || !hostRef.current) return
    const box = hostRef.current.getBoundingClientRect()
    setDragSplit(clampSplit((e.clientX - box.left) / box.width))
  }, [])

  const onUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    setDragSplit((v) => {
      if (v !== null) setSplit(v)
      return null
    })
  }, [setSplit])

  useEffect(() => {
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onMove, onUp])

  // Open by default: orientation is the first thing you look at.
  const [mapOpen, setMapOpen] = useState(true)

  if (!character) {
    return (
      <div className="p-6 text-ink-muted text-sm">
        Not connected. Complete setup first.
      </div>
    )
  }

  const split = dragSplit ?? layout.mapSplit

  const dense = uiMode === 'power'

  // The map is a drawer, not a region. It is the one surface that is watched
  // rather than consulted, and a panel competing for vertical space in a
  // stack loses that argument every time. See DESIGN-BIBLE section 3.
  //
  // It also means the map is drawn exactly once. The previous build had it in
  // a plane and in the dock at the same time, which is a bug and looked like
  // one.
  const docked = layout.order.filter(
    (id) => id !== 'vitals' && id !== 'map' && !out.includes(id)
  )

  return (
    <div ref={hostRef} className="flex h-full min-h-0 flex-col">
      <CharacterHeader character={character} />

      <div className="flex min-h-0 flex-1">
        {mapOpen && (
          <>
            <div
              className="min-h-0 shrink-0"
              style={{ width: `${Math.round(split * 100)}%` }}
            >
              <MapPanel plane />
            </div>
            <span
              className="w-px shrink-0 cursor-col-resize bg-border/60 hover:bg-ink-faint"
              title="Drag to resize"
              onMouseDown={(e) => {
                e.preventDefault()
                dragging.current = true
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'
              }}
            />
          </>
        )}

        {/* One handle, on the edge the drawer comes from, so it reads as the
            drawer rather than as another panel control. */}
        <button
          type="button"
          onClick={() => setMapOpen((v) => !v)}
          title={mapOpen ? 'Close the map' : 'Open the map'}
          className="w-3 shrink-0 border-r border-border/60 text-ink-faint hover:bg-surface-raised hover:text-ink"
        >
          {mapOpen ? '‹' : '›'}
        </button>

        <div className="min-h-0 min-w-0 flex-1">
          {layout.freeform ? (
            <FreeCanvas
              items={docked.map((id) => ({
                id,
                rect: layout.rects[id],
                node: PANEL_CONTENT[id]?.(dense, false, {
                  deckPrefs: layout.decks,
                  onCycleDeck: cycleDeck,
                }),
              }))}
              onPlace={place}
              onReflow={unplace}
            />
          ) : (
          <DockView
            dock={without(layout.dock ?? dockOf(docked), ['map', 'vitals', ...out])}
            onChange={dock}
            title={(id) => PANEL_TITLES[id] ?? id}
            onPopOut={popOut}
            out={out}
            onPopBack={popBack}
            render={(id) =>
              PANEL_CONTENT[id]?.(dense, false, {
                deckPrefs: layout.decks,
                onCycleDeck: cycleDeck,
              })
            }
          />
          )}
        </div>
      </div>
    </div>
  )
}
