import { create } from 'zustand'
import type { AppState, SetupComponent, UiMode } from '../types'
import { bridge } from '../bridge'
import type { IntentName, BridgeServerMessage } from '../bridge/types'
import type { DemoPresetId } from '../bridge/mockBridge'
import { loadPrefs, savePrefs } from '../lib/persistence'
import { combatRanks } from '../data/skills'

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
    case 'hello':
      get().addLog(
        `Bridge hello — Lich ${msg.lichVersion}, protocol ${msg.protocol}`
      )
      break
    case 'status':
      set({ character: msg.payload })
      break
    case 'inventory':
      set({ inventory: msg.payload })
      break
    case 'scripts':
      set({ runningScripts: msg.payload.map((s) => s.name) })
      break
    case 'log':
      get().addLog(msg.line)
      break
    case 'intent_ack':
      if (!msg.ok)
        get().addLog(`Intent failed: ${msg.intent} — ${msg.detail ?? ''}`)
      break
    case 'error':
      get().addLog(`Bridge error: ${msg.message}`)
      break
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  setupComplete: false,
  setupComponents: defaultSetup,
  uiMode: prefs.uiMode,
  alwaysOnTop: prefs.alwaysOnTop,
  character: null,
  inventory: null,
  runningScripts: [],
  logLines: ['Companion started. Waiting for setup…'],
  bridgeConnected: false,
  bridgeMode: prefs.bridgeMode,
  trainFocus: prefs.trainFocus,
  autoSuggestHealer: prefs.autoSuggestHealer,
  huntFavorites: prefs.huntFavorites ?? [],
  huntMode: prefs.huntMode ?? 'suggest',
  preferredHealCity: prefs.preferredHealCity ?? null,
  selectedHuntId: null,
  houseEntryMethod: prefs.houseEntryMethod ?? 'lockpick_ring',
  houseEntryMaxSearches: prefs.houseEntryMaxSearches ?? 3,
  houseEntryHide: prefs.houseEntryHide ?? true,

  setSetupComplete: (v) => set({ setupComplete: v }),

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
        `${new Date().toLocaleTimeString()}  ${line}`,
        ...state.logLines,
      ].slice(0, 120),
    })),

  clearLog: () => set({ logLines: [] }),

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
    bridge.connect()
    set({ bridgeConnected: true })
    if (bridge.getMode() === 'live') {
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
  loadPreset: (id: string) => bridge.loadPreset(id as DemoPresetId),

  setTrainFocus: (ids: string[]) => {
    savePrefs({ trainFocus: ids })
    set({ trainFocus: ids })
  },
  toggleTrainFocus: (id: string) => {
    const cur = get().trainFocus
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    savePrefs({ trainFocus: next })
    set({ trainFocus: next })
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
  },
  setHuntMode: (m) => {
    savePrefs({ huntMode: m })
    set({ huntMode: m })
  },
  setSelectedHuntId: (id) => set({ selectedHuntId: id }),
  setPreferredHealCity: (id: string | null) => {
    savePrefs({ preferredHealCity: id })
    set({ preferredHealCity: id })
  },
  setHouseEntryMethod: (m) => {
    savePrefs({ houseEntryMethod: m })
    set({ houseEntryMethod: m })
  },
  setHouseEntryMaxSearches: (n) => {
    savePrefs({ houseEntryMaxSearches: n })
    set({ houseEntryMaxSearches: n })
  },
  setHouseEntryHide: (v) => {
    savePrefs({ houseEntryHide: v })
    set({ houseEntryHide: v })
  },
}))
