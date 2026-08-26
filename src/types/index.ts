import type { BodyPart, Injury } from '../lib/body'
/** Core domain types for DR Companion — mirrors design document awareness model */

import type { SkillState } from '../data/skills'
import type { CharacterProfile } from '../lib/profiles'
import type { VersionState } from '../lib/versions'
import type { MapRoom, MapNearest, MapPath, MapZone } from '../bridge/types'

export type { SkillState }
export type { CharacterProfile }

export type GameInstance = 'Prime' | 'Platinum' | 'Fallen' | 'Test' | 'Unknown'

/** Simutronics account / subscription tier — drives travel, inventory, bank, guild, hunting */
export type AccountTier = 'f2p' | 'basic' | 'premium' | 'platinum' | 'fallen' | 'unknown'

/**
 * Two, not three.
 *
 * There were Simple, Standard and Power. Simple was too thin to play from and
 * Standard was what everyone would actually pick, so the choice was really
 * between one usable layout and a dense one. Panels move and resize now, which
 * is a better answer to "I want it arranged differently" than a third preset.
 */
export type UiMode = 'basic' | 'power'

export type SetupComponentId =
  | 'genie'
  | 'ruby'
  | 'lich'
  | 'bridge'
  | 'maps'

export type SetupStatus = 'ready' | 'missing' | 'checking' | 'installing' | 'error'

export interface SetupComponent {
  id: SetupComponentId
  label: string
  description: string
  status: SetupStatus
  detail?: string
}

export interface Vitals {
  health: number
  healthMax: number
  spirit: number
  spiritMax: number
  fatigue: number
  fatigueMax: number
  concentration?: number
  concentrationMax?: number
}

export interface LocationInfo {
  roomId?: string
  title: string
  zone?: string
  province?: string
  isTown?: boolean
  isSafe?: boolean
}

export type SituationFlag =
  | 'in_combat'
  | 'stunned'
  | 'webbed'
  | 'immobilized'
  | 'bleeding'
  | 'dead'
  | 'dying'
  | 'bags_full'
  | 'low_health'
  | 'roundtime'

export interface CharacterStatus {
  name: string
  instance: GameInstance
  /** Subscription tier — critical for travel, inventory, bank, guild, hunting options */
  accountTier: AccountTier
  guild?: string
  race?: string
  circle?: number
  /**
   * Favors held with the gods. Consumed on death to reduce the penalty, so
   * this is the number that answers "can I afford to die right now".
   * See docs/DOMAIN.md section 17.
   */
  favors?: number
  encumbrance?: string
  /**
   * Per-skill ranks and mindstate. This is what drives training decisions:
   * a skill at mind lock earns nothing, so the answer to "what should I
   * train" is computed from here, not chosen from a checkbox.
   * See docs/DOMAIN.md section 1.
   */
  skills?: SkillState[]
  /**
   * @deprecated A single number cannot represent a character, because the
   * whole mechanic is that skills differ. Derived from `skills` when present.
   * Kept so older mock payloads still render.
   */
  skillRanks?: number
  location: LocationInfo
  vitals: Vitals
  /**
   * Sixteen body parts, each with a wound and a scar, 0-3.
   *
   * Optional because absent is not the same as uninjured: right after login
   * the parse may not have run, and a doll showing a clean bill of health it
   * has not actually seen is worse than one admitting it does not know.
   */
  injuries?: Partial<Record<BodyPart, Injury>>
  situation: SituationFlag[]
  activity: string
  connected: boolean
  /** Other players in the room. Hunting grounds are contested. */
  roomPlayers?: string[]
  /**
   * Living creatures, from DRRoom.npcs. Display names as the game wrote
   * them; the noun for art and bestiary lookup is derived, not sent.
   */
  roomCreatures?: string[]
  /** Corpses, from DRRoom.dead_npcs. They stay on screen: a skinnable one
   * with boxes is a task, not a footnote. */
  roomDeadCreatures?: string[]
  /**
   * Summons, pets and familiars fighting on your side.
   *
   * Nothing populates this yet and the bridge does not send it. Lich has
   * no notion of allegiance: DRRoom.npcs is everything the game bolded,
   * GameObj.type classifies items rather than sides, and fam_npcs is the
   * familiar remote view of another room. The field and the Allied deck
   * exist so a real source can be plugged in; until then the deck simply
   * does not render, which is better than guessing.
   */
  roomAllies?: string[]
  groupMembers?: string[]
  /**
   * Bridge-side clock, seconds. An open socket does not mean a live game; if
   * this stops advancing the game has hung. See docs/DOMAIN.md section 13.
   */
  gameTime?: number
}

/** One row from the bridge's command trace. */
export interface TraceRow {
  at: string
  kind: string
  detail: string
  /**
   * Assigned on arrival so trace and log rows can be interleaved in the order
   * they actually happened. Timestamps alone are second-resolution, which is
   * too coarse: a command and its reply routinely land in the same second.
   */
  seq?: number
}

export interface LogRow {
  at: string
  text: string
  seq: number
}

export interface InventorySummary {
  containers: { name: string; used: number; capacity: number }[]
  wornCount: number
  looseCount: number
  pressure: 'ok' | 'high' | 'full'
}

export interface AppState {
  /**
   * Geography as Lich reports it, not as we guessed it.
   *
   * null until asked, and null again if no map is loaded — which is not the
   * same as an empty result and must not render as one.
   */
  mapHere: MapRoom | null
  mapTags: string[]
  mapNearest: MapNearest | null
  mapPath: MapPath | null
  mapZone: MapZone | null

  setupComplete: boolean
  /**
   * Setup opened deliberately from Settings, rather than because something is
   * missing. Kept separate from `setupComplete` because the first-run screen
   * skips itself when everything is present, so once a machine is set up there
   * was no way left to look at what the app had found or where it lives.
   */
  setupReopened: boolean
  setupComponents: SetupComponent[]

  uiMode: UiMode
  alwaysOnTop: boolean

  character: CharacterStatus | null
  inventory: InventorySummary | null
  runningScripts: string[]
  logLines: LogRow[]
  /** Command trace from the bridge, for diagnosing broken patterns. */
  trace: TraceRow[]
  traceEnabled: boolean
  versions: VersionState
  consoleOpen: boolean
  /** Set when the bridge stopped itself for looping. */
  runawayReason: string | null
  bridgeConnected: boolean
  bridgeMode: 'mock' | 'live'
  trainFocus: string[]
  autoSuggestHealer: boolean
  huntFavorites: string[]
  huntMode: 'suggest' | 'favorites_only' | 'manual'
  preferredHealCity: string | null
  /**
   * Which frontend the player uses. Genie starts Lich scripts with a comma;
   * everything else uses a semicolon, so this changes what we tell them to
   * type. See lib/frontends.ts.
   */
  frontend: string
  /** Settings per character, keyed by instance and name. */
  profiles: Record<string, CharacterProfile>
  activeProfileKey: string | null
  selectedHuntId: string | null
  houseEntryMethod: 'rope' | 'lockpick' | 'lockpick_ring'
  houseEntryMaxSearches: number
  houseEntryHide: boolean

  setSetupComplete: (v: boolean) => void
  openSetup: () => void
  updateSetupComponent: (id: SetupComponentId, patch: Partial<SetupComponent>) => void
  setUiMode: (mode: UiMode) => void
  setAlwaysOnTop: (v: boolean) => void
  setCharacter: (c: CharacterStatus | null) => void
  setInventory: (i: InventorySummary | null) => void
  addLog: (line: string) => void
  clearLog: () => void
  addTrace: (row: TraceRow) => void
  setTraceEnabled: (v: boolean) => void
  setConsoleOpen: (v: boolean) => void
  clearRunaway: () => void
  setFrontend: (id: string) => void
  simulateConnect: () => void
  connectBridge: () => void
  disconnectBridge: () => void
  setBridgeMode: (m: 'mock' | 'live') => void
  requestIntent: (intent: string) => void
  demoLowHealth: () => void
  demoCombat: () => void
  demoSafe: () => void
  demoBrokenPattern: () => void
  loadPreset: (id: string) => void
  setTrainFocus: (ids: string[]) => void
  toggleTrainFocus: (id: string) => void
  setAutoSuggestHealer: (v: boolean) => void
  toggleHuntFavorite: (id: string) => void
  setHuntMode: (m: 'suggest' | 'favorites_only' | 'manual') => void
  setPreferredHealCity: (id: string | null) => void
  syncProfile: (name: string, instance: GameInstance, guild?: string) => void
  patchActiveProfile: (patch: Partial<CharacterProfile>) => void
  deleteProfileByKey: (key: string) => void
  copySettingsFrom: (key: string) => void
  setSelectedHuntId: (id: string | null) => void
  setHouseEntryMethod: (m: 'rope' | 'lockpick' | 'lockpick_ring') => void
  setHouseEntryMaxSearches: (n: number) => void
  setHouseEntryHide: (v: boolean) => void
}
