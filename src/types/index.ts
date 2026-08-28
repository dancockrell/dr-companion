import type { BodyPart, Injury } from '../lib/body'
/** Core domain types for DR Companion — mirrors design document awareness model */

import type { SkillState } from '../data/skills'
import type { IntentName } from '../bridge/types'
import type { CharacterProfile } from '../lib/profiles'
import type { VersionState } from '../lib/versions'
import type {
  MapRoom,
  MapPath,
  MapZone,
  ScriptState,
  SettingsFile,
  ToggleStatus,
} from '../bridge/types'
import type { Trail } from '../lib/trail'

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

/** What the bridge reports about its own connection gates. */
export type AuthMode = 'token' | 'origin-only' | 'unknown'

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
  /**
   * Mana.
   *
   * The bridge has been sending this since the beginning and the client had
   * no field for it, so every update arrived with mana and threw it away.
   * Genie puts it on the status bar beside health.
   */
  mana?: number
  manaMax?: number
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
  /**
   * The bridge emitted this from the moment it started reading IconPRONE, and
   * the union never listed it. Nothing crashed, because the only consumer maps
   * over the strings, but every piece of code that believed it had handled all
   * ten flags had in fact handled ten of eleven. Prone is not cosmetic: you
   * are on the ground, most of your defence is gone, and standing up costs
   * roundtime you probably do not have.
   */
  | 'prone'
  /**
   * The rest of the indicator hash.
   *
   * The game sends one flag set and the bridge was probing five names out of
   * it. Poisoned and diseased in particular were reachable only by running the
   * `check_health` intent and reading the sentence it printed to the console,
   * so a character could be poisoned for an hour with nothing on screen.
   *
   * Hidden, invisible and joined are grouped here with the injuries on purpose
   * even though they are states you wanted: what matters is that they are
   * true, not that they are bad, and a status board that only shows bad news
   * cannot tell you your hiding broke.
   */
  | 'kneeling'
  | 'sitting'
  | 'poisoned'
  | 'diseased'
  | 'hidden'
  | 'invisible'
  | 'joined'

/**
 * A spell that is up, and how long it has left.
 *
 * The only status in this game that comes with a real clock. Everything in
 * `SituationFlag` is an icon that is either lit or not, with no magnitude and
 * no duration behind it, so this is the one place a timer can be honest rather
 * than invented. dr-scripts maintains the durations from the game's own spell
 * messaging and the bridge reads them out of DRSpells.active_spells.
 */
export interface ActiveSpell {
  name: string
  /** Minutes remaining, as dr-scripts counts them. */
  minutes: number
}

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
   * False while DRInfomon's post-login startup (~1s) is still filling in
   * skills — an empty `skills` during that window means "not asked yet", not
   * "no skills". Undefined for a bridge or mock that predates this field;
   * treat that the same as true, the old always-ready behaviour, rather than
   * as a third "unknown" state — this flag exists to catch one specific race,
   * not to become another thing every reader has to branch on.
   */
  skillsReady?: boolean
  /**
   * @deprecated A single number cannot represent a character, because the
   * whole mechanic is that skills differ. Derived from `skills` when present.
   * Kept so older mock payloads still render.
   */
  skillRanks?: number
  location: LocationInfo
  vitals: Vitals
  /**
   * What is in each hand.
   *
   * In a fight this is the question: whether you are holding your weapon, a
   * lockpick, or nothing at all. Genie keeps it on the status bar permanently.
   * The bridge already reads both hands and was only counting them.
   */
  hands?: { left: string | null; right: string | null }
  /**
   * Seconds left of roundtime, from XMLData.roundtime_end.
   *
   * A boolean "in roundtime" tells you that you cannot act. The number tells
   * you how long, which is the difference between waiting and switching to
   * something else.
   */
  roundtime?: number
  /**
   * Sixteen body parts, each with a wound and a scar, 0-3.
   *
   * Optional because absent is not the same as uninjured: right after login
   * the parse may not have run, and a doll showing a clean bill of health it
   * has not actually seen is worse than one admitting it does not know.
   */
  injuries?: Partial<Record<BodyPart, Injury>>
  situation: SituationFlag[]
  /**
   * Spells up, shortest remaining first. Empty when dr-scripts is not loaded,
   * which is not the same as no spells and is why the board says which.
   */
  spells?: ActiveSpell[]
  activity: string
  connected: boolean
  /**
   * The bridge is refusing game commands until Resume is pressed.
   *
   * Set by `stop_all` and cleared only by `resume` — deliberately not by the
   * next macro, so a Stop survives whatever was already queued behind it. The
   * defect this exists to surface: before the latch, a macro arriving after a
   * Stop cleared the flag on entry and ran in full, and the Task Flow driver
   * sends one automatically on its own timer.
   *
   * On the wire so the safety bar can say "stopped, press Resume" *before*
   * somebody presses a macro button, rather than only refusing them
   * afterwards. The refusal itself is honest now (`ok: false`, "stopped —
   * press Resume"), but a control that explains itself only when pressed is
   * still a control that looks available and is not.
   *
   * Two states, not three, for the same reason as `skillsReady` above:
   * undefined means a bridge that predates the field, and `false` is the
   * correct read for one — its behaviour is exactly the pre-latch behaviour.
   * A separate "unknown" would be a third branch for every reader to handle
   * and would describe nothing that happens.
   */
  stopLatched?: boolean
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
   * Loose items on the ground here, from GameObj.loot.
   *
   * Display names as the game wrote them. Separate from inventory on purpose:
   * what is on the floor is a decision, and what is in your pack is a fact.
   */
  roomItems?: string[]
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
  /**
   * How serious the bridge said this was.
   *
   * It has been setting this on the lines that matter since the beginning, and
   * the store dropped it on the floor: `addLog(msg.line)` took the text and
   * nothing else. So "this settings file will not parse at line 41" arrived
   * marked as an error and rendered in the same grey as "pong".
   */
  level?: 'info' | 'warn' | 'error'
}

export interface InventorySummary {
  containers: { name: string; used: number; capacity: number }[]
  /**
   * What is worn, by name.
   *
   * Optional because an older bridge does not send it, and absent has to stay
   * distinguishable from empty: no list means nothing is known about what is
   * worn, an empty list means nothing is worn. Anything reading this to decide
   * whether to warn about gear must treat the two differently or it will tell
   * a fully dressed character they are fine.
   *
   * Capped by the bridge. `wornCount` stays authoritative for how many.
   */
  worn?: string[]
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
  /** Where you have been this session. See lib/trail.ts. */
  mapTrail: Trail
  mapPath: MapPath | null
  mapZone: MapZone | null
  /**
   * The install_mapdb intent's own lifecycle, distinct from the map's.
   *
   * `install_mapdb` returns as soon as the bridge has started the download
   * script — it does not wait for the fetch to finish, because that would
   * block the bridge thread and freeze every other panel. So "started" is a
   * real, distinct state from "done": the map staying absent right after a
   * successful start is expected, not a sign the button failed. `null` is
   * "never asked", not "no map" — see mapZone for that half of the picture.
   */
  mapdbInstall: { status: 'starting' | 'started' | 'failed'; detail?: string } | null

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
  /**
   * When the last status landed, by the local clock, in ms.
   *
   * Roundtime arrives as a number of seconds measured at the moment the bridge
   * built the payload. Rendering that number directly means showing "RT 4.0s"
   * for however long it is until the next push, which on an idle tick is
   * several seconds, so the one field whose whole value is that it counts down
   * was displayed frozen. Anything that wants live roundtime subtracts from
   * here. See components/shared/RoundtimeMeter.tsx.
   */
  characterAt: number
  inventory: InventorySummary | null
  runningScripts: string[]
  /**
   * Scripts with their status, as the bridge sent them.
   *
   * `runningScripts` is kept beside this rather than replaced because several
   * places only ever wanted the names, and widening their type to get a
   * distinction they do not use would be churn. This is the honest list.
   */
  scriptStates: ScriptState[]
  /**
   * Every script Lich can actually launch, from `list_scripts`.
   *
   * null until asked — distinct from an empty catalogue, which would mean
   * Lich searched its script directories and found nothing. Names only; any
   * category or grouping is a cosmetic label applied on top in the UI, never
   * a filter, so a real script never disappears just because nobody has
   * classified it yet.
   */
  scriptCatalog: string[] | null
  /**
   * The task flow running, if one is, as a sentence.
   *
   * Kept in the store rather than only in the panel because the safety bar has
   * to answer "is this thing doing something" and a flow is the most likely
   * thing it is doing. With flow state living only in TaskFlowPanel's local
   * React state, the bar read Idle through an hour-long hunting loop.
   */
  activeFlow: string | null
  setActiveFlow: (v: string | null) => void
  /**
   * dr-scripts settings files, from the `read_settings` intent.
   *
   * null until asked. The bridge answers with a structured file list, which
   * had no type and no case in the store, and the intent that produces it was
   * never wired to a control, so the feature existed end to end except for
   * the two lines that would let anybody use it.
   */
  settingsFiles: SettingsFile[] | null
  settingsCharacter: string | null
  /**
   * BRIEF, INVBRIEF and ShowRoomID, from the `check_toggles` intent.
   *
   * Same gap as `settingsFiles` above: the bridge has read and logged these
   * since before this field existed, and null-until-asked here means "never
   * checked this session," not "confirmed off" - see ToggleStatus for why
   * that distinction matters per field.
   */
  toggles: ToggleStatus | null
  logLines: LogRow[]
  /** Command trace from the bridge, for diagnosing broken patterns. */
  trace: TraceRow[]
  traceEnabled: boolean
  versions: VersionState
  consoleOpen: boolean
  /** Set when the bridge stopped itself for looping. */
  runawayReason: string | null
  bridgeConnected: boolean
  /**
   * Which gates the bridge has up: both, origin only, or not reported.
   *
   * Three states on purpose. 'unknown' is a bridge too old to say, and it must
   * not be rendered as 'token' - a reassuring default standing in for an
   * answer nobody has is the failure this whole field exists to fix.
   */
  bridgeAuth: AuthMode
  /** Why the token is absent, when the bridge said. Empty otherwise. */
  bridgeAuthNote: string
  /**
   * The intents the connected bridge actually implements, or `null`.
   *
   * `null` covers two cases that must behave identically: no bridge connected
   * yet, and a connected bridge older than the version that advertises this.
   * Either way it means "unknown" rather than "none" — a control gated on
   * this must render enabled, not disabled, when it is null. Only a non-null
   * array is grounds to disable anything. See BRIDGE_CONTRACT.md's
   * "Implemented-intents contract" and `isIntentImplemented` in
   * useAppStore.ts.
   */
  bridgeIntents: string[] | null
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
  addLog: (line: string, level?: LogRow['level']) => void
  /** Ask the bridge which dr-scripts files apply to this character. */
  readSettings: () => void
  /** Ask the bridge to read BRIEF, INVBRIEF and ShowRoomID from the game. */
  checkToggles: () => void
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
  /** args carries a macro's literal commands; named intents build their own. */
  requestIntent: (
    intent: IntentName | `travel:${string}`,
    args?: Record<string, unknown>
  ) => void
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
  /** Ask the bridge what it can launch. Populates scriptCatalog. */
  listScripts: () => void
  /** Launch a script by its bare name (no extension, no arguments). */
  startScript: (name: string) => void
  /**
   * Ask the bridge to fetch Lich's map database (runs download-prime-map or
   * repository, whichever is installed). Fire-and-forget on the wire; see
   * mapdbInstall for how the UI should read the reply.
   */
  installMapdb: () => void
}
