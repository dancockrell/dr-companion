import { create } from 'zustand'
import type { AppState, SetupComponent, UiMode, AuthMode } from '../types'
import { bridge } from '../bridge/index.ts'
import type { IntentName } from '../bridge/types'
import type { DemoPresetId } from '../bridge/mockBridge'
import { loadPrefs, savePrefs } from '../lib/persistence.ts'
import { DEFAULT_FRONTEND } from '../lib/frontends.ts'
import {
  APP_VERSION,
  EXPECTED_BRIDGE_VERSION,
} from '../lib/versions.ts'
import { loadProfiles } from '../lib/profiles.ts'
import { emptyTrail } from '../lib/trail.ts'
import { bumpStateVersion } from '../lib/stateVersion.ts'
import { loadPins as loadQuickSwitchPins, togglePin, MAX_SLOTS } from '../lib/quickSwitch.ts'
import {
  copySettingsFrom,
  deleteProfileByKey,
  patchActiveProfile,
  syncProfile,
} from './profilePersistence.ts'
import {
  connectBridge,
  disconnectBridge,
  setBridgeMode,
} from './bridgeLifecycle.ts'
import { requestIntent } from './bridgeIntentDispatcher.ts'
import { handleBridgeMessage } from './bridgeMessageHandler.ts'

export { isIntentImplemented } from './bridgePolicy.ts'

const prefs = loadPrefs()

const defaultSetup: SetupComponent[] = [
  {
    id: 'genie',
    label: 'Genie',
    description: 'Your game client (the window you read the game in).',
    status: 'checking',
  },
  {
    id: 'ruby',
    label: 'Ruby runtime',
    description: 'Required so Lich can run automation scripts.',
    status: 'checking',
  },
  {
    id: 'lich',
    label: 'Lich 5',
    description: 'The automation engine that talks to the game.',
    status: 'checking',
  },
  {
    id: 'bridge',
    label: 'Companion bridge',
    description: 'Connects this control panel to Lich.',
    status: 'checking',
  },
  {
    id: 'maps',
    label: 'Map data',
    description: 'Lets the Companion understand rooms and travel.',
    status: 'checking',
  },
]

/**
 * One counter for log lines and trace rows alike.
 *
 * The console interleaves both, and second-resolution timestamps cannot order
 * them: a command and its reply routinely land in the same second, and getting
 * that backwards is exactly the kind of thing that misleads someone reading a
 * trace to work out what broke.
 */
let seqCounter = 0
const nextSeq = () => ++seqCounter

/**
 * The keys that make a write *authoritative* — a new statement by the game
 * about where the character is and what state they are in.
 *
 * Anything that reasons about the game and then proposes to act on it has to
 * be able to ask "is the world I reasoned about still the world in front of
 * me", and a timestamp cannot answer that: two pushes can land in the same
 * millisecond, and an unchanged push is not a new statement. A counter can.
 * `src/lib/aiSuggestions.ts` is the first consumer, and it refuses to send a
 * proposed command whose `basedOnStateVersion` is no longer `stateVersion`.
 */
const AUTHORITATIVE_KEYS: readonly (keyof AppState)[] = ['character', 'mapHere']

/**
 * Wrap `set` so the version is bumped by the *shape of the write*, not by the
 * writer remembering to.
 *
 * Five places write `character` or `mapHere`, in three files, and two of them
 * are disconnect paths. A convention — "bump it when you write these" — holds
 * until the sixth write site, and the failure when it stops holding is silent
 * and exactly the wrong way round: a stale suggestion passes the freshness
 * check because the counter never moved.
 *
 * Every store helper takes `set` as an argument (`bridgeMessageHandler`,
 * `bridgeLifecycle`, `profilePersistence`), so wrapping it once here covers
 * all of them, including write sites nobody has written yet.
 */
function versioned(
  raw: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  read: () => AppState
): (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void {
  return (partial) => {
    const patch = typeof partial === 'function' ? partial(read()) : partial
    if (AUTHORITATIVE_KEYS.some((key) => key in patch)) {
      // One expression writes both the owner in `stateVersion.ts` and the
      // mirror components render from, so they cannot report different
      // numbers.
      raw({ ...patch, stateVersion: bumpStateVersion() })
      return
    }
    raw(patch)
  }
}

export const useAppStore = create<AppState>((rawSet, get) => {
  const set = versioned(rawSet, get)
  return {
  stateVersion: 0,
  mapHere: null,
  mapTrail: emptyTrail(),
  mapdbInstall: null,
  mapPath: null,
  mapNearest: null,
  mapZone: null,

  setupComplete: prefs.setupComplete ?? false,
  setupReopened: false,
  setupComponents: defaultSetup,
  uiMode: prefs.uiMode,
  alwaysOnTop: prefs.alwaysOnTop,
  character: null,
  characterAt: 0,
  inventory: null,
  runningScripts: [],
  scriptStates: [],
  scriptCatalog: null,
  activeFlow: null,
  quickSwitchPins: loadQuickSwitchPins(),
  settingsFiles: null,
  settingsCharacter: null,
  toggles: null,
  vars: null,
  logLines: [
    { at: new Date().toLocaleTimeString(), text: 'Companion started.', seq: nextSeq() },
  ],
  trace: [],
  traceEnabled: false,
  versions: {
    app: APP_VERSION,
    expectedBridge: EXPECTED_BRIDGE_VERSION,
    actualBridge: null,
    lich: null,
    protocol: null,
  },
  consoleOpen: prefs.consoleOpen ?? false,
  runawayReason: null,
  bridgeConnected: false,
  // Unknown until a bridge says otherwise, never assumed good.
  bridgeAuth: 'unknown' as AuthMode,
  bridgeAuthNote: '',
  // null = unknown, same reasoning as bridgeAuth above. Never "none".
  bridgeIntents: null,
  bridgeMode: prefs.bridgeMode,
  trainFocus: prefs.trainFocus,
  autoSuggestHealer: prefs.autoSuggestHealer,
  huntFavorites: prefs.huntFavorites ?? [],
  huntMode: prefs.huntMode ?? 'suggest',
  preferredHealCity: prefs.preferredHealCity ?? null,
  frontend: prefs.frontend ?? DEFAULT_FRONTEND,
  profiles: loadProfiles(),
  activeProfileKey: null,
  selectedHuntId: null,
  houseEntryMethod: prefs.houseEntryMethod ?? 'lockpick_ring',
  houseEntryMaxSearches: prefs.houseEntryMaxSearches ?? 3,
  houseEntryHide: prefs.houseEntryHide ?? true,

  setSetupComplete: (v) => {
    savePrefs({ setupComplete: v })
    set({ setupComplete: v, setupReopened: false })
  },

  // Show the setup screen on purpose. It will not skip itself this time.
  //
  // Deliberately not persisted, unlike finishing setup. Someone who opens the
  // wizard to change one component and then restarts the app wants the app,
  // not the wizard again: reopening it is a thing you do now, and finishing it
  // is a thing that stays done.
  openSetup: () => set({ setupComplete: false, setupReopened: true }),

  updateSetupComponent: (id, patch) =>
    set((state) => ({
      setupComponents: state.setupComponents.map((c) =>
        c.id === id ? { ...c, ...patch } : c
      ),
    })),

  setUiMode: (mode: UiMode) => {
    savePrefs({ uiMode: mode })
    set({ uiMode: mode })
  },
  setAlwaysOnTop: (v) => {
    savePrefs({ alwaysOnTop: v })
    set({ alwaysOnTop: v })
  },
  setCharacter: (c) => set({ character: c }),
  setInventory: (i) => set({ inventory: i }),

  addLog: (line, level) =>
    set((state) => ({
      logLines: [
        ...state.logLines,
        { at: new Date().toLocaleTimeString(), text: line, seq: nextSeq(), level },
      ].slice(-200),
    })),

  readSettings: () => {
    set({ settingsFiles: null, settingsCharacter: null })
    bridge.requestIntent('read_settings')
  },

  checkToggles: () => {
    set({ toggles: null })
    bridge.requestIntent('check_toggles')
  },

  listVars: () => {
    set({ vars: null })
    bridge.requestIntent('list_vars')
  },

  listScripts: () => {
    bridge.requestIntent('list_scripts')
  },

  startScript: (name: string) => {
    bridge.requestIntent('start_script', { name })
  },

  installMapdb: () => {
    set({ mapdbInstall: { status: 'starting' } })
    bridge.requestIntent('install_mapdb')
  },

  setActiveFlow: (v) => set({ activeFlow: v }),

  toggleQuickSwitchPin: (pin) => {
    const { pins, refused } = togglePin(get().quickSwitchPins, pin)
    if (refused) {
      get().addLog(`Quick Switch is full (${MAX_SLOTS} slots) — unpin something first.`, 'warn')
      return
    }
    set({ quickSwitchPins: pins })
  },

  clearLog: () => set({ logLines: [], trace: [] }),

  addTrace: (row) =>
    // Cap it. A trace running all session should not become the reason the
    // app slows down while someone is trying to reproduce a bug.
    set((state) => ({
      trace: [...state.trace, { ...row, seq: nextSeq() }].slice(-400),
    })),

  setTraceEnabled: (v: boolean) => {
    set({ traceEnabled: v })
    // No casts. These are declared in IntentName now - see the note there.
    // The `as IntentName` that used to be on these two lines was the reason
    // three implemented intents were invisible to the type system and to
    // intent-drift-test for as long as the feature existed.
    bridge.requestIntent(v ? 'trace_on' : 'trace_off')
    if (v) bridge.requestIntent('trace_dump')
  },

  setConsoleOpen: (v: boolean) => {
    savePrefs({ consoleOpen: v })
    set({ consoleOpen: v })
  },

  setFrontend: (id: string) => {
    savePrefs({ frontend: id })
    set({ frontend: id })
  },

  clearRunaway: () => {
    set({ runawayReason: null })
    bridge.requestIntent('reset_runaway')
  },

  setBridgeMode: (m: 'mock' | 'live') => {
    setBridgeMode(m, set, get, (mode) => savePrefs({ bridgeMode: mode }))
  },

  connectBridge: () => connectBridge(set, get, handleBridgeMessage),

  disconnectBridge: () => disconnectBridge(set),

  simulateConnect: () => {
    get().connectBridge()
  },

  requestIntent: (
    intent: IntentName | `travel:${string}`,
    extraArgs?: Record<string, unknown>
  ) => requestIntent(intent, extraArgs, get),

  demoLowHealth: () => bridge.simulateLowHealth(),
  demoCombat: () => bridge.simulateCombat(),
  demoSafe: () => bridge.simulateSafe(),
  demoBrokenPattern: () => bridge.simulateBrokenPattern(),
  loadPreset: (id: string) => bridge.loadPreset(id as DemoPresetId),

  /**
   * Adopt the settings belonging to whoever the bridge is reporting.
   *
   * Called on every status where the character identity changed. Creating a
   * profile on first sight is deliberate: a new character should just work,
   * and the player should never have to declare one before playing.
   */
  syncProfile: (name, instance, guild) => syncProfile(name, instance, guild, set, get),

  /** Persist a change onto the active character's profile as well as the UI. */
  patchActiveProfile: (patch) => patchActiveProfile(patch, set, get),

  deleteProfileByKey: (key) => deleteProfileByKey(key, set, get),

  copySettingsFrom: (key) => copySettingsFrom(key, set, get),

  setTrainFocus: (ids: string[]) => {
    savePrefs({ trainFocus: ids })
    set({ trainFocus: ids })
    get().patchActiveProfile({ trainFocus: ids })
  },
  toggleTrainFocus: (id: string) => {
    const cur = get().trainFocus
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    savePrefs({ trainFocus: next })
    set({ trainFocus: next })
    get().patchActiveProfile({ trainFocus: next })
  },
  setAutoSuggestHealer: (v: boolean) => {
    savePrefs({ autoSuggestHealer: v })
    set({ autoSuggestHealer: v })
  },
  toggleHuntFavorite: (id: string) => {
    const cur = get().huntFavorites
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    savePrefs({ huntFavorites: next })
    set({ huntFavorites: next })
    get().patchActiveProfile({ huntFavorites: next })
  },
  setHuntMode: (m) => {
    savePrefs({ huntMode: m })
    set({ huntMode: m })
    get().patchActiveProfile({ huntMode: m })
  },
  setSelectedHuntId: (id) => set({ selectedHuntId: id }),
  setPreferredHealCity: (id: string | null) => {
    savePrefs({ preferredHealCity: id })
    set({ preferredHealCity: id })
    get().patchActiveProfile({ preferredHealCity: id })
  },
  setHouseEntryMethod: (m) => {
    savePrefs({ houseEntryMethod: m })
    set({ houseEntryMethod: m })
    get().patchActiveProfile({ houseEntryMethod: m })
  },
  setHouseEntryMaxSearches: (n) => {
    savePrefs({ houseEntryMaxSearches: n })
    set({ houseEntryMaxSearches: n })
    get().patchActiveProfile({ houseEntryMaxSearches: n })
  },
  setHouseEntryHide: (v) => {
    savePrefs({ houseEntryHide: v })
    set({ houseEntryHide: v })
    get().patchActiveProfile({ houseEntryHide: v })
  },
  }
})

// A handle on the store while developing, so the app can be driven from the
// console without a game attached. Stripped from production builds by the
// import.meta.env.DEV guard, which Vite resolves to false and then dead-code
// eliminates, so this ships as nothing.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__store = useAppStore
}
