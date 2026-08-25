import { create } from 'zustand'
import type { AppState, SetupComponent, UiMode, GameInstance } from '../types'
import { bridge } from '../bridge'
import type { IntentName, BridgeServerMessage } from '../bridge/types'
import type { DemoPresetId } from '../bridge/mockBridge'
import { loadPrefs, savePrefs } from '../lib/persistence'
import { combatRanks } from '../data/skills'
import { DEFAULT_FRONTEND } from '../lib/frontends'
import {
  APP_VERSION,
  EXPECTED_BRIDGE_VERSION,
  compareVersions,
} from '../lib/versions'
import {
  loadProfiles,
  upsertProfile,
  newProfile,
  profileKey,
  copyProfileSettings,
  deleteProfile as deleteProfileEntry,
  type CharacterProfile,
} from '../lib/profiles'

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

let unsubBridge: (() => void) | null = null
let unsubLiveStatus: (() => void) | null = null

/** Intents that must never be blocked by game state. See docs/DOMAIN.md. */
const SAFETY_INTENTS = ['stop_all', 'pause', 'resume', 'escape']

function handleBridgeMessage(
  msg: BridgeServerMessage,
  set: (
    partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)
  ) => void,
  get: () => AppState
) {
  switch (msg.type) {
    case 'hello': {
      set({
        versions: {
          app: APP_VERSION,
          expectedBridge: EXPECTED_BRIDGE_VERSION,
          actualBridge: msg.bridgeVersion,
          lich: msg.lichVersion,
          protocol: msg.protocol,
        },
      })
      get().addLog(
        `Bridge v${msg.bridgeVersion} on Lich ${msg.lichVersion}, protocol ${msg.protocol}`
      )
      // Version mismatch is the largest time sink in this ecosystem's support.
      // Say it now and loudly, rather than letting someone spend a week
      // filing reports against a script that was fixed two releases ago.
      const v = compareVersions(get().versions)
      if (v.message) get().addLog(v.message)
      break
    }
    case 'status': {
      set({ character: msg.payload })
      // Adopt this character's own settings the moment we learn who they are.
      const p = msg.payload
      if (p.name) get().syncProfile(p.name, p.instance, p.guild)
      break
    }
    case 'inventory':
      set({ inventory: msg.payload })
      break
    case 'scripts':
      set({ runningScripts: msg.payload.map((s) => s.name) })
      break
    case 'log':
      get().addLog(msg.line)
      break
    case 'trace':
      get().addTrace(msg.row)
      break
    case 'runaway':
      // The bridge stopped itself for looping. Put it where it cannot be
      // missed: this is the case where the character has been doing something
      // pointless and visible, which is exactly what should not run unwatched.
      set({ runawayReason: msg.reason })
      get().addLog(`Stopped itself: ${msg.reason}`)
      break
    case 'intent_ack':
      if (!msg.ok)
        get().addLog(`Intent failed: ${msg.intent} — ${msg.detail ?? ''}`)
      break
    case 'error':
      get().addLog(`Bridge error: ${msg.message}`)
      break

    // Geography, answered by Lich's own map rather than by a list we ship.
    case 'map_here':
      set({ mapHere: msg.payload.available ? msg.payload : null })
      break
    case 'map_tags':
      set({ mapTags: msg.payload })
      break
    case 'map_nearest':
      set({ mapNearest: msg.payload })
      if (!msg.payload.ok) get().addLog(`Map: ${msg.payload.reason ?? 'not found'}`)
      break
    case 'map_path':
      set({ mapPath: msg.payload })
      if (!msg.payload.ok) get().addLog(`Map: ${msg.payload.reason ?? 'no route'}`)
      break
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  mapHere: null,
  mapTags: [],
  mapNearest: null,
  mapPath: null,

  setupComplete: false,
  setupReopened: false,
  setupComponents: defaultSetup,
  uiMode: prefs.uiMode,
  alwaysOnTop: prefs.alwaysOnTop,
  character: null,
  inventory: null,
  runningScripts: [],
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

  setSetupComplete: (v) => set({ setupComplete: v, setupReopened: false }),

  // Show the setup screen on purpose. It will not skip itself this time.
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

  addLog: (line) =>
    set((state) => ({
      logLines: [
        ...state.logLines,
        { at: new Date().toLocaleTimeString(), text: line, seq: nextSeq() },
      ].slice(-200),
    })),

  clearLog: () => set({ logLines: [], trace: [] }),

  addTrace: (row) =>
    // Cap it. A trace running all session should not become the reason the
    // app slows down while someone is trying to reproduce a bug.
    set((state) => ({
      trace: [...state.trace, { ...row, seq: nextSeq() }].slice(-400),
    })),

  setTraceEnabled: (v: boolean) => {
    set({ traceEnabled: v })
    bridge.requestIntent((v ? 'trace_on' : 'trace_off') as IntentName)
    if (v) bridge.requestIntent('trace_dump' as IntentName)
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
    bridge.requestIntent('reset_runaway' as IntentName)
  },

  setBridgeMode: (m: 'mock' | 'live') => {
    bridge.disconnect()
    if (unsubBridge) {
      unsubBridge()
      unsubBridge = null
    }
    bridge.setMode(m)
    savePrefs({ bridgeMode: m })
    set({ bridgeMode: m, bridgeConnected: false, character: null })
    get().addLog(
      m === 'mock' ? 'Switched to mock bridge' : 'Switched to live Lich bridge'
    )
  },

  connectBridge: () => {
    if (unsubBridge) unsubBridge()
    unsubBridge = bridge.onMessage((msg) => handleBridgeMessage(msg, set, get))
    bridge.setMode(get().bridgeMode)

    const live = bridge.getMode() === 'live'

    if (live) {
      // Subscribed before connect, not after. A refused connection can report
      // itself almost immediately, and a listener attached afterwards misses
      // the one event that explains why nothing is happening.
      //
      // Keep the unsubscribe. Dropping it leaked a listener per connect and
      // per reconnect, which multiplied every log line.
      if (unsubLiveStatus) unsubLiveStatus()
      unsubLiveStatus = bridge.onLiveStatus((status, detail) => {
        get().addLog(`Live bridge: ${status}${detail ? ' — ' + detail : ''}`)
        if (status === 'connected') set({ bridgeConnected: true })
        if (status === 'disconnected' || status === 'error')
          set({ bridgeConnected: false })
      })
    }

    bridge.connect()

    // `bridgeConnected` means the transport is open, so only the mock can say
    // so here: it is in-process and connects synchronously. A live socket is
    // merely *connecting*, and may never arrive if Lich is not running.
    //
    // It used to be set true for both. The socket layer refuses to send on a
    // socket that is not open, so nothing was ever lost down a hole — but the
    // gate in requestIntent reads this flag, so pressing Stop during those
    // first moments got "Not connected to Lich bridge" from the transport
    // instead of this store's clear "stop scripts in Lich directly". Wrong
    // message, worst moment.
    set({ bridgeConnected: !live })
  },

  disconnectBridge: () => {
    bridge.disconnect()
    if (unsubBridge) {
      unsubBridge()
      unsubBridge = null
    }
    if (unsubLiveStatus) {
      unsubLiveStatus()
      unsubLiveStatus = null
    }
    set({ bridgeConnected: false, character: null })
  },

  simulateConnect: () => {
    get().connectBridge()
  },

  requestIntent: (intent: string) => {
    const { character, addLog, bridgeConnected } = get()

    // Stop, pause and escape are never gated. `character.connected` is a flag
    // the *game* side sets, so a stale or false value used to disable the Stop
    // button at exactly the moment someone is hammering it. If the transport
    // is up, these go out.
    const isSafetyIntent = SAFETY_INTENTS.includes(intent)

    if (!bridgeConnected) {
      addLog(
        isSafetyIntent
          ? `Bridge is down — cannot send ${intent}. Stop scripts in Lich directly.`
          : 'Not connected — cannot run intent: ' + intent
      )
      return
    }
    if (!isSafetyIntent && !character?.connected) {
      addLog('Character is not connected — cannot run intent: ' + intent)
      return
    }

    let args: Record<string, unknown> | undefined
    if (intent === 'start_training') {
      const { trainFocus, huntFavorites, huntMode, selectedHuntId } = get()
      args = {
        focus: trainFocus,
        favorites: huntFavorites,
        huntMode,
        selectedHuntId,
        guild: character?.guild ?? 'unknown',
        skills: character?.skills ?? [],
        skillRanks: character?.skills?.length
          ? combatRanks(character.skills)
          : character?.skillRanks ?? 50,
      }
    }
    if (intent.startsWith('travel:')) {
      args = { destination: intent.split(':')[1] || 'crossing' }
      bridge.requestIntent('travel' as IntentName, args)
      return
    }
    if (intent === 'go_healer' || intent === 'escape_heal') {
      args = { preferredCity: get().preferredHealCity }
    }
    if (intent === 'burgle') {
      const { houseEntryMethod, houseEntryMaxSearches, houseEntryHide } = get()
      args = {
        method: houseEntryMethod,
        maxSearches: houseEntryMaxSearches,
        hide: houseEntryHide,
        guild: character?.guild ?? 'unknown',
      }
    }
    bridge.requestIntent(intent as IntentName, args)
  },

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
  syncProfile: (name: string, instance: GameInstance, guild?: string) => {
    const key = profileKey(name, instance)
    if (key === get().activeProfileKey) return

    const map = loadProfiles()
    const existing = map[key]
    const profile = existing
      ? { ...existing, guild: guild ?? existing.guild, lastSeen: Date.now() }
      : newProfile(name, instance, { guild })

    upsertProfile(profile)

    set({
      activeProfileKey: key,
      profiles: loadProfiles(),
      trainFocus: profile.trainFocus,
      huntFavorites: profile.huntFavorites,
      huntMode: profile.huntMode,
      preferredHealCity: profile.preferredHealCity,
      houseEntryMethod: profile.houseEntryMethod,
      houseEntryMaxSearches: profile.houseEntryMaxSearches,
      houseEntryHide: profile.houseEntryHide,
    })

    get().addLog(
      existing
        ? `Loaded settings for ${name} on ${instance}.`
        : `New character: ${name} on ${instance}. Started a profile.`
    )
  },

  /** Persist a change onto the active character's profile as well as the UI. */
  patchActiveProfile: (patch: Partial<CharacterProfile>) => {
    const key = get().activeProfileKey
    if (!key) return
    const map = loadProfiles()
    const current = map[key]
    if (!current) return
    const next = { ...current, ...patch, lastSeen: Date.now() }
    upsertProfile(next)
    set({ profiles: loadProfiles() })
  },

  deleteProfileByKey: (key: string) => {
    const map = loadProfiles()
    const p = map[key]
    if (!p) return
    const next = deleteProfileEntry(p.name, p.instance)
    set({ profiles: next })
    get().addLog(`Deleted the profile for ${p.name}.`)
  },

  copySettingsFrom: (key: string) => {
    const map = loadProfiles()
    const from = map[key]
    const activeKey = get().activeProfileKey
    const onto = activeKey ? map[activeKey] : undefined
    if (!from || !onto) return
    const merged = copyProfileSettings(from, onto)
    upsertProfile(merged)
    set({
      profiles: loadProfiles(),
      trainFocus: merged.trainFocus,
      huntFavorites: merged.huntFavorites,
      huntMode: merged.huntMode,
      preferredHealCity: merged.preferredHealCity,
      houseEntryMethod: merged.houseEntryMethod,
      houseEntryMaxSearches: merged.houseEntryMaxSearches,
      houseEntryHide: merged.houseEntryHide,
    })
    get().addLog(`Copied ${from.name}'s settings onto ${onto.name}.`)
  },

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
}))
