/**
 * One dashboard, composed from the player's arrangement.
 *
 * There used to be three hand-written dashboards whose panel order was whatever
 * order the panels had been written in. Two players will not agree on what
 * deserves their pixels — a crafter wants inventory open and the map small,
 * someone hunting wants the map large and watched — so the app should not have
 * an opinion. It ships defaults and gets out of the way.
 *
 * Basic and Power differ in density and in default arrangement, not in which
 * panels exist. Anything hidden in one mode would be a feature most people
 * never find.
 *
 * Width is not assumed anywhere. The window is only as wide as the player has
 * given us, taken from the game window next to it, and the better we are the
 * more we are worth — so the same panels have to work in a narrow strip and in
 * half a screen. See docs/DESIGN.md §2.115.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
import type { PanelId } from '../../lib/layout'
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
  // Vitals live in the fixed header, not as a movable panel — identity and
  // health are the two things that must never be closed by accident.
  vitals: {
    title: 'Vitals',
    icon: <Zap className="w-3.5 h-3.5" />,
    render: () => null,
  },
}

/** Below this the layout is one column; above it, two. */
const TWO_COLUMN_AT = 720

export function Dashboard() {
  const character = useAppStore((s) => s.character)
  const uiMode = useAppStore((s) => s.uiMode)
  const { layout, move, update } = useLayout(uiMode)

  // Measured, not guessed from the viewport: this panel can be docked beside
  // other things, and a media query would describe the screen rather than the
  // space we were actually given.
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      setWide(entry.contentRect.width >= TWO_COLUMN_AT)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!character) {
    return (
      <div className="p-6 text-ink-muted text-sm">
        Not connected. Complete setup first.
      </div>
    )
  }

  const dense = uiMode === 'power'
  const visible = layout.order.filter((id) => id !== 'vitals')

  return (
    <div ref={hostRef} className="flex flex-col h-full min-h-0">
      <CharacterHeader character={character} />

      <div
        className={`px-3 py-3 gap-3 ${
          wide ? 'grid grid-cols-2 items-start' : 'flex flex-col'
        }`}
      >
        {visible.map((id, i) => {
          const def = PANELS[id]
          if (!def) return null
          const state = layout.panels[id] ?? {}
          return (
            <Panel
              key={id}
              title={def.title}
              icon={def.icon}
              closed={state.closed}
              height={state.height}
              canMoveUp={i > 0}
              canMoveDown={i < visible.length - 1}
              onMove={(d) => move(id, d)}
              onToggle={() => update(id, { closed: !state.closed })}
              onResize={(h) => update(id, { height: h || undefined })}
            >
              {def.render(dense)}
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
