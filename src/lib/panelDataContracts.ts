/**
 * What data each named auxiliary window/panel needs - the answer to "if
 * Godot (or anything else outside this wrapper) asks us to pull a window up
 * on screen, what does that window actually require to render honestly."
 *
 * # Why this exists
 *
 * The single-viewer architecture (`docs/CLAUDE_3D_VIEWER_BRIEF.md`) moves
 * the map and the tactical battle presentation into Godot. Everything else
 * - inventory, skills/training, the script library, stats, risk - stays
 * exactly what it always was: typed MUD information a player wants to read,
 * not spatial content Godot renders. This app's job past the migration is
 * being the *wrapper* around Godot's single game window: it owns which of
 * these text panels exist, what each one needs to populate itself
 * correctly, and (eventually) answering a request from Godot to bring one
 * up, rather than owning any part of the 3D presentation itself.
 *
 * `PanelId` (`layout.ts`) and `PANEL_TITLES` (`panels.tsx`) already name
 * every panel and its display title. This file is the missing third piece:
 * for each one, the actual data it reads (verified against each panel
 * component's own `useAppStore` calls, not guessed from its name) and a
 * one-line statement of what a player uses it for. A future
 * `show-panel`-shaped intent from Godot (the same `PresentationIntent`
 * family `presentation_bridge.rs` already validates - see that file's own
 * `focus-room`/`inspect-entity` cases for the existing pattern) would name
 * a `PanelId`; this catalog is what the wrapper consults to know it can
 * actually satisfy that request and with what.
 *
 * # What this file is not
 *
 * Not a new store, not a new fetch layer, not a rendering contract. Every
 * field named below already exists on `useAppStore`'s state or on
 * `CharacterStatus` - this file only documents which of them a given panel
 * draws from, so "what does the Inventory window need" has one answer
 * instead of requiring a read of `InventoryPanel.tsx` every time someone
 * (a person, or eventually Godot) needs to know.
 */
import type { PanelId } from './layout.ts'

export interface PanelDataContract {
  /** What a player uses this window for, in one sentence. */
  purpose: string
  /**
   * The `useAppStore` state fields (or, for `character`, the specific
   * `CharacterStatus` sub-fields) this panel actually reads, verified
   * against its own component source - not every field that happens to be
   * available, only what it draws from.
   */
  dataNeeded: string[]
  /**
   * Whether this panel needs a live, connected character to mean anything,
   * or degrades to a static/offline mode when the bridge is offline. A
   * request to pull up a panel that requires a live character while
   * disconnected is answerable honestly ("not available offline"), not a
   * silent empty box.
   */
  requiresLiveCharacter: boolean
}

export const PANEL_DATA_CONTRACTS: Record<PanelId, PanelDataContract> = {
  map: {
    purpose:
      'Retiring from this wrapper once Godot owns world/route presentation (see docs/CLAUDE_3D_VIEWER_BRIEF.md) - kept here only as the current, still-live fallback until that migration slice lands.',
    dataNeeded: ['mapZone', 'mapHere', 'bridgeConnected', 'bridgeIntents', 'character.location.roomId'],
    requiresLiveCharacter: false,
  },
  vitals: {
    purpose: "The player's own health/stamina/mana/spirit and injuries - watched continuously, not looked up.",
    dataNeeded: ['character.vitals', 'character.injuries'],
    requiresLiveCharacter: true,
  },
  actions: {
    purpose: 'The battle command deck - the same catalog BattleActionBar renders in the primary layout, available here as a standalone panel for freeform/power-mode arrangements.',
    dataNeeded: ['character (for canSend/reason gating)', 'quickSwitchPins'],
    requiresLiveCharacter: true,
  },
  training: {
    purpose: "The player's skill focus and mindstate training targets - what they're actively trying to raise.",
    dataNeeded: ['character.skills', 'trainFocus', 'bridgeIntents'],
    requiresLiveCharacter: true,
  },
  inventory: {
    purpose: 'Worn and carried items, container contents, weight/burden - what the character is holding right now.',
    dataNeeded: ['character.inventory', 'bridgeIntents'],
    requiresLiveCharacter: true,
  },
  risk: {
    purpose: "A compact readout of the character's current danger state (wounds, poison, bleeding, stance) - the same facts VitalCluster/StatusBoard already surface, condensed.",
    dataNeeded: ['character.vitals', 'character.situation'],
    requiresLiveCharacter: true,
  },
  stats: {
    purpose: 'Base character stats and derived combat numbers - reference info, not something that updates moment to moment.',
    dataNeeded: ['character.stats'],
    requiresLiveCharacter: true,
  },
  launcher: {
    purpose: 'Quick-start entry points for built-in activities/macros - a menu, not a data display.',
    dataNeeded: ['character (for canSend/reason gating)', 'bridgeIntents'],
    requiresLiveCharacter: true,
  },
  room: {
    purpose:
      'The room/battle presentation this wrapper currently owns directly (BattleColumn) - room description, occupants, floor items, exits. Once Godot renders the tactical table, this panel narrows to the text-equivalent list the brief requires stay reachable outside 3D, rather than disappearing.',
    dataNeeded: ['character (room fields: roomCreatures/roomAllies/roomPlayers/roomItems/etc)', 'mapZone', 'mapHere'],
    requiresLiveCharacter: true,
  },
  mindstate: {
    purpose: 'The full mindstate board - every skill and how close each is to locking, not just the ones being actively trained.',
    dataNeeded: ['character.skills'],
    requiresLiveCharacter: true,
  },
  scripts: {
    purpose: 'The script/task library - what can be started, what is running, and the player\'s pinned hotbar entries. Works with no live character (browsing/editing scripts offline is a real use).',
    dataNeeded: ['scriptCatalog', 'scriptStates', 'quickSwitchPins', 'bridgeConnected'],
    requiresLiveCharacter: false,
  },
  game: {
    purpose: 'The room, the game text and the command line, as one panel - the MUD itself. In the single-viewer architecture this is the one window that keeps most of the screen (see this file\'s own header comment); everything else here is a smaller companion to it.',
    dataNeeded: ['gameLines() (see gameLink.ts)', 'character', 'mapZone', 'mapHere'],
    requiresLiveCharacter: false,
  },
}

/** Whether `id` can be shown right now, given whether a live character
 * exists - the honest-degradation check a `show-panel` request should run
 * before assuming a panel has anything to display. */
export function panelIsShowable(id: PanelId, hasLiveCharacter: boolean): boolean {
  const contract = PANEL_DATA_CONTRACTS[id]
  return !contract.requiresLiveCharacter || hasLiveCharacter
}
