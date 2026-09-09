/**
 * What is on the bottom bar of icons, in what order, and with which glyph.
 *
 * Dan, 9 September 2026: *"have a bottom bar of icons for various
 * functions"*. This is the list.
 *
 * # It carries icons and an order and nothing else
 *
 * Each entry's **name** comes from `PANEL_TITLES` (`panels.tsx`) and each
 * entry's **description** from `PANEL_DATA_CONTRACTS[id].purpose`
 * (`panelDataContracts.ts`), which already states, per panel, what a player
 * uses it for and whether it needs a live character. A second table of names
 * and descriptions beside those two would be a fork with a guaranteed drift
 * date, and the drift would be invisible - a wrong tooltip looks exactly like
 * a right one.
 *
 * `Record<PanelId, …>` for the icons, so the compiler refuses a panel with no
 * glyph. The order is a separate array because it is a different decision
 * (how often a player reaches for the thing) and because two panels are
 * deliberately not on the bar at all - see `OFF_BAR` below.
 */
import {
  Backpack,
  BarChart3,
  Brain,
  GraduationCap,
  HeartPulse,
  Image,
  Library,
  MessageSquareText,
  Rocket,
  ShieldAlert,
  SlidersHorizontal,
  Swords,
  Wand2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { PanelId } from './layout.ts'

export const PANEL_ICONS: Record<PanelId, LucideIcon> = {
  actions: Wand2,
  board: Image,
  config: SlidersHorizontal,
  game: MessageSquareText,
  inventory: Backpack,
  launcher: Rocket,
  mindstate: Brain,
  risk: ShieldAlert,
  room: Swords,
  scene: Image,
  scripts: Library,
  stats: BarChart3,
  tasks: Workflow,
  training: GraduationCap,
  vitals: HeartPulse,
}

/**
 * The panels that are deliberately **not** on the bar, and why.
 *
 * Written down rather than simply left out of the order, because "missing
 * from a list" and "decided against" look identical six months later, and the
 * next person to notice the gap will helpfully close it.
 *
 * Kept as data so `tools/play-first-layout-test.mjs` can assert that every
 * panel is either on the bar or named here - a panel that is neither is a
 * function a player can no longer reach, which is exactly the failure this
 * rearrangement must not cause.
 */
export const OFF_BAR: Partial<Record<PanelId, string>> = {
  vitals:
    'PANEL_CONTENT.vitals renders null - there is nothing behind this id to open. The vitals themselves are on screen permanently in the right rail.',
  risk: 'On screen permanently in the right rail, directly under the vitals. A bar icon would be a second way to reach something already visible.',
  config:
    "AppControls' own sliders button opens it, and that button is in the window corner whether or not there is a character - which the bar is not, since the bar only appears once one exists. Two routes to one panel is a duplicate, and this is the one that works in more states.",
}

/**
 * Left to right, roughly by how often a player reaches for it while playing.
 *
 * `board` is not here: the scene pane is not a panel you open, it is a pane
 * with three states, and its control is the bar's first button rather than a
 * fourteenth pop-out. See `scenePane.ts`.
 */
export const PANEL_BAR_ORDER: readonly PanelId[] = [
  'tasks',
  'actions',
  'inventory',
  'mindstate',
  'training',
  'room',
  'stats',
  'launcher',
  'scripts',
  'game',
  'scene',
]
