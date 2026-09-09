/**
 * The panel registry: one definition per panel, used by both the dashboard and
 * the popped-out windows.
 *
 * Shared on purpose. A panel that rendered differently depending on which
 * window it was in would be two components pretending to be one, and they would
 * drift.
 */
import type { ReactNode } from 'react'
import type { PanelId } from '../../lib/layout'
import { ActionsPanel } from '../shared/ActionsPanel.tsx'
import { RoomColumn } from '../room/RoomColumn.tsx'
import { TrainingPanel } from '../shared/TrainingPanel.tsx'
import { MindstateBoard } from '../shared/MindstateBoard.tsx'
import { useAppStore } from '../../store/useAppStore.ts'
import { InventoryPanel } from '../shared/InventoryPanel.tsx'
import { RiskBar } from '../shared/RiskBar.tsx'
import { StatsPanel } from '../shared/StatsPanel.tsx'
import { ScriptLauncher } from '../shared/ScriptLauncher.tsx'
import { ScriptLibraryPanel } from '../shared/ScriptLibraryPanel.tsx'
import { BattlePanel } from '../shared/BattlePanel.tsx'
import { ScenePanel } from '../shared/ScenePanel.tsx'
import { PlayerConfigPanel } from '../config/PlayerConfigPanel.tsx'
import { BattleColumn } from '../room/BattleColumn.tsx'
import { TaskFlowPanel } from './TaskFlowPanel.tsx'
import { getScriptCatalogEntry } from '../../data/scriptCatalog.ts'
import type { Deck } from '../../lib/cards'
import type { DeckPref } from '../../lib/layout'

export const PANEL_TITLES: Record<PanelId, string> = {
  actions: 'Actions',
  training: 'Training',
  inventory: 'Inventory',
  risk: 'Risk',
  stats: 'Stats',
  launcher: 'Activities',
  vitals: 'Vitals',
  mindstate: 'Mindstate',
  room: 'Battle',
  game: 'Game',
  scripts: 'Script Library',
  scene: 'Scene',
  config: 'Player config',
  board: 'Scene pane',
  tasks: 'Tasks and scripts',
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
  // The whole right-hand column - room scene, game text, command line -
  // as one panel. Not decomposed into several: those pieces are useless
  // apart, and splitting them would be a layout decision dressed as a
  // refactor.
  game: () => <RoomColumn />,
  training: (dense) => <TrainingPanel dense={dense} />,
  inventory: () => <InventoryPanel />,
  risk: () => <RiskBar />,
  stats: (dense) => <StatsPanel dense={dense} />,
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
  scene: () => <ScenePanel />,
  config: () => <PlayerConfigPanel />,
  // The same component the workspace's own corner pane renders. One
  // component, two possible mounts, and only ever one of them at a time:
  // `App.tsx` draws it in the corner while the pane is `minimap` and stops
  // drawing it when the pane is `popped`, which is when this window exists.
  // A second "big scene" component would be the fork.
  board: () => <BattleColumn />,
  tasks: () => <TaskFlowPanel title="Functions & scripts" />,
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
