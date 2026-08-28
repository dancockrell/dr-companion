/**
 * The panel registry: one definition per panel, used by both the dashboard and
 * the popped-out windows.
 *
 * Shared on purpose. A panel that rendered differently depending on which
 * window it was in would be two components pretending to be one, and they would
 * drift.
 */
import type { ReactNode } from 'react'
import {
  Users,
  Map as MapIcon,
  Zap,
  Brain,
  Package,
  ShieldAlert,
  ListChecks,
  ListTree,
  MessagesSquare,
} from 'lucide-react'
import type { PanelId } from '../../lib/layout'
import { ActionsPanel } from '../shared/ActionsPanel'
import { MapPanel } from '../shared/MapPanel'
import { RoomColumn } from '../room/RoomColumn'
import { TrainingPanel } from '../shared/TrainingPanel'
import { MindstateBoard } from '../shared/MindstateBoard'
import { useAppStore } from '../../store/useAppStore'
import { InventoryPanel } from '../shared/InventoryPanel'
import { RiskBar } from '../shared/RiskBar'
import { ScriptLauncher } from '../shared/ScriptLauncher'
import { ScriptLibraryPanel } from '../shared/ScriptLibraryPanel'
import { BattlePanel } from '../shared/BattlePanel'
import { getScriptCatalogEntry } from '../../data/scriptCatalog'
import type { Deck } from '../../lib/cards'
import type { DeckPref } from '../../lib/layout'

export const PANEL_TITLES: Record<PanelId, string> = {
  actions: 'Actions',
  map: 'Map',
  training: 'Training',
  inventory: 'Inventory',
  risk: 'Risk',
  launcher: 'Activities',
  vitals: 'Vitals',
  mindstate: 'Mindstate',
  room: 'Battle',
  game: 'Game',
  scripts: 'Script Library',
}

export const PANEL_ICONS: Record<PanelId, ReactNode> = {
  actions: <Zap className="w-3.5 h-3.5" />,
  map: <MapIcon className="w-3.5 h-3.5" />,
  training: <Brain className="w-3.5 h-3.5" />,
  inventory: <Package className="w-3.5 h-3.5" />,
  risk: <ShieldAlert className="w-3.5 h-3.5" />,
  launcher: <ListChecks className="w-3.5 h-3.5" />,
  vitals: <Zap className="w-3.5 h-3.5" />,
  mindstate: <Brain className="w-3.5 h-3.5" />,
  room: <Users className="w-3.5 h-3.5" />,
  game: <MessagesSquare className="w-3.5 h-3.5" />,
  scripts: <ListTree className="w-3.5 h-3.5" />,
}

/**
 * @param dense  Power mode.
 * @param filled The panel has a window or a plane to itself, so it should fill
 *   the height it is given rather than sizing to a box inside one.
 */
/**
 * Panel-specific state the dashboard owns.
 *
 * Threaded in rather than read from a second useLayout inside the panel.
 * Two copies of the layout in one window would each hold a stale view of
 * the other, and the next write from either would quietly drop whatever
 * the other had changed.
 */
export interface PanelContext {
  deckPrefs?: Partial<Record<Deck, DeckPref>>
  onCycleDeck?: (deck: Deck) => void
}

type Render = (dense: boolean, filled: boolean, ctx?: PanelContext) => ReactNode

export const PANEL_CONTENT: Record<PanelId, Render> = {
  actions: (dense) => <ActionsPanel dense={dense} />,
  map: (_dense, filled) => <MapPanel plane={filled} />,
  // The whole right-hand column - room scene, game text, command line -
  // as one panel. Not decomposed into several: those pieces are useless
  // apart, and splitting them would be a layout decision dressed as a
  // refactor.
  game: () => <RoomColumn />,
  training: (dense) => <TrainingPanel dense={dense} />,
  inventory: () => <InventoryPanel />,
  risk: () => <RiskBar />,
  launcher: (dense) => <ScriptLauncher compact={dense} />,
  // Vitals live in the fixed header: identity and health are the two things
  // that must never be closed by accident.
  vitals: () => null,
  mindstate: (dense) => <MindstateContent dense={dense} />,
  room: (_dense, _filled, ctx) => (
    <BattlePanel deckPrefs={ctx?.deckPrefs} onCycleDeck={ctx?.onCycleDeck} />
  ),
  scripts: (dense) => (
    <ScriptLibraryPanel
      dense={dense}
      filter={(n) => getScriptCatalogEntry(n).tier === 'standard'}
      categoryOf={(n) => getScriptCatalogEntry(n).category}
    />
  ),
}

export function panelTitle(id: PanelId): string {
  return PANEL_TITLES[id] ?? id
}

/**
 * The board reads the character itself rather than being handed skills.
 *
 * Kept beside the registry so the panel stays a one-liner, and so nothing
 * above has to know that mindstate comes from the character at all.
 */
function MindstateContent({ dense }: { dense: boolean }) {
  const character = useAppStore((s) => s.character)
  return <MindstateBoard skills={character?.skills ?? []} dense={dense} />
}
