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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Map as MapIcon,
  Zap,
  Brain,
  Package,
  ShieldAlert,
  ListChecks,
} from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import { useLayout } from '../../lib/useLayout'
import { MAP_PLANE_AT, clampSplit, type PanelId } from '../../lib/layout'
import { Panel } from '../shared/Panel'
import { CharacterHeader } from './CharacterHeader'
import { ActionsPanel } from '../shared/ActionsPanel'
import { MapPanel } from '../shared/MapPanel'
import { TrainingPanel } from '../shared/TrainingPanel'
import { InventoryPanel } from '../shared/InventoryPanel'
import { RiskBar } from '../shared/RiskBar'
import { ScriptLauncher } from '../shared/ScriptLauncher'

interface PanelDef {
  title: string
  icon: ReactNode
  render: (dense: boolean) => ReactNode
}

const PANELS: Record<PanelId, PanelDef> = {
  actions: {
    title: 'Actions',
    icon: <Zap className="w-3.5 h-3.5" />,
    render: (dense) => <ActionsPanel dense={dense} />,
  },
  map: {
    title: 'Map',
    icon: <MapIcon className="w-3.5 h-3.5" />,
    render: () => <MapPanel />,
  },
  training: {
    title: 'Training',
    icon: <Brain className="w-3.5 h-3.5" />,
    render: (dense) => <TrainingPanel dense={dense} />,
  },
  inventory: {
    title: 'Inventory',
    icon: <Package className="w-3.5 h-3.5" />,
    render: () => <InventoryPanel />,
  },
  risk: {
    title: 'Risk',
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
    render: () => <RiskBar />,
  },
  launcher: {
    title: 'Activities',
    icon: <ListChecks className="w-3.5 h-3.5" />,
    render: (dense) => <ScriptLauncher compact={dense} />,
  },
  // In the fixed header, not a movable panel: identity and health are the two
  // things that must never be closed by accident.
  vitals: { title: 'Vitals', icon: <Zap className="w-3.5 h-3.5" />, render: () => null },
}

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, reorder, update, setSplit } = useLayout(uiMode)

  // Which panel is in the hand, and where it would land. Held here rather than
  // in each Panel so the insertion line can be drawn on a different panel from
  // the one being dragged.
  const [held, setHeld] = useState<PanelId | null>(null)
  const [drop, setDrop] = useState<{ id: PanelId; before: boolean } | null>(null)

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
    (id) => id !== 'vitals' && !(planed && id === 'map')
  )

  const panels = (
    <div className="flex flex-col gap-2 p-2">
      {stack.map((id) => {
        const def = PANELS[id]
        if (!def) return null
        const state = layout.panels[id] ?? {}
        const isTarget = drop?.id === id
        return (
          <Panel
            key={id}
            title={def.title}
            icon={def.icon}
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
            {def.render(dense)}
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
