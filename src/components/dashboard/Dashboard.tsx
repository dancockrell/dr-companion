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
import { MAP_PLANE_AT, clampSplit, type PanelId } from '../../lib/layout'
import { isTauri, invokeTauri } from '../../lib/tauri'
import { Panel } from '../shared/Panel'
import { CharacterHeader } from './CharacterHeader'
import { MapPanel } from '../shared/MapPanel'
import { PANEL_CONTENT, PANEL_ICONS, PANEL_TITLES } from './panels'

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, reorder, update, setSplit, cycleDeck } = useLayout(uiMode)

  // Which panel is in the hand, and where it would land. Held here rather than
  // in each Panel so the insertion line can be drawn on a different panel from
  // the one being dragged.
  const [held, setHeld] = useState<PanelId | null>(null)
  const [drop, setDrop] = useState<{ id: PanelId; before: boolean } | null>(null)

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
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
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

  if (!character) {
    return (
      <div className="p-6 text-ink-muted text-sm">
        Not connected. Complete setup first.
      </div>
    )
  }

  const dense = uiMode === 'power'
  const split = dragSplit ?? layout.mapSplit

  // Two planes only when there is room for two. Below that the map returns to
  // the stack rather than being hidden, which is why it stays in `order`.
  const planed = layout.mapPlane && width >= MAP_PLANE_AT

  const stack = layout.order.filter(
    (id) =>
      id !== 'vitals' &&
      !(planed && id === 'map') &&
      // A panel in its own window is not also in the stack. Showing it twice
      // would mean two live copies of the same thing.
      !out.includes(id)
  )

  const panels = (
    <div className="flex flex-col gap-2 p-2">
      {out.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-0.5">
          <span className="text-xs text-ink-faint">In their own windows:</span>
          {out.map((id) => (
            <button
              key={id}
              type="button"
              className="text-xs rounded border border-border px-1.5 py-0.5 text-ink-muted hover:text-ink"
              title="Bring it back into this window"
              onClick={() => popBack(id)}
            >
              {PANEL_TITLES[id] ?? id}
            </button>
          ))}
        </div>
      )}

      {stack.map((id) => {
        const render = PANEL_CONTENT[id]
        if (!render) return null
        const state = layout.panels[id] ?? {}
        const isTarget = drop?.id === id
        return (
          <Panel
            key={id}
            title={PANEL_TITLES[id]}
            icon={PANEL_ICONS[id]}
            onPopOut={isTauri() ? () => popOut(id) : undefined}
            closed={state.closed}
            height={state.height}
            dragging={held === id}
            dropBefore={isTarget && drop.before && held !== id}
            dropAfter={isTarget && !drop.before && held !== id}
            onDragStart={() => setHeld(id)}
            onDragEnd={() => {
              setHeld(null)
              setDrop(null)
            }}
            onDragOverPanel={(before) => setDrop({ id, before })}
            onDropPanel={() => {
              if (held && held !== id) {
                // Index in the full order, not the visible stack, because the
                // map may be living in its own plane and absent from it.
                const target = layout.order.indexOf(id)
                reorder(held, drop?.before ? target : target + 1)
              }
              setHeld(null)
              setDrop(null)
            }}
            onToggle={() => update(id, { closed: !state.closed })}
            onResize={(h) => update(id, { height: h || undefined })}
          >
            {render(dense, false, { deckPrefs: layout.decks, onCycleDeck: cycleDeck })}
          </Panel>
        )
      })}
    </div>
  )

  return (
    <div ref={hostRef} className="flex flex-col h-full min-h-0">
      <CharacterHeader character={character} />

      {planed ? (
        <div className="flex-1 min-h-0 flex">
          {/* The map plane. Fills its column rather than sitting in a box
              inside it, which is the whole point of giving it one. */}
          <div
            className="min-w-0 min-h-0 p-2"
            style={{ width: `${split * 100}%` }}
          >
            <MapPanel plane />
          </div>

          {/* Drag to reapportion. Wide enough to hit, narrow enough not to be
              furniture; double-click returns to an even split. */}
          <div
            className="w-1.5 shrink-0 cursor-col-resize group flex items-center justify-center"
            title="Drag to resize, double-click to even it up"
            onMouseDown={(e) => {
              e.preventDefault()
              dragging.current = true
              document.body.style.cursor = 'col-resize'
              document.body.style.userSelect = 'none'
            }}
            onDoubleClick={() => setSplit(0.5)}
          >
            <div className="w-0.5 h-10 rounded-full bg-border group-hover:bg-ink-faint" />
          </div>

          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">{panels}</div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">{panels}</div>
      )}
    </div>
  )
}
