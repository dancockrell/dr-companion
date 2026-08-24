/** Core domain types for DR Companion — mirrors design document awareness model */

export type GameInstance = 'Prime' | 'Platinum' | 'Fallen' | 'Test' | 'Unknown'

/** Simutronics account / subscription tier — drives travel, inventory, bank, guild, hunting */
export type AccountTier = 'f2p' | 'basic' | 'premium' | 'platinum' | 'fallen' | 'unknown'

export type UiMode = 'simple' | 'standard' | 'power'

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
  skillRanks?: number
  location: LocationInfo
  vitals: Vitals
  situation: SituationFlag[]
  activity: string
  connected: boolean
}

export interface InventorySummary {
  containers: { name: string; used: number; capacity: number }[]
  wornCount: number
  looseCount: number
  pressure: 'ok' | 'high' | 'full'
}

export interface AppState {
  setupComplete: boolean
  setupComponents: SetupComponent[]

  uiMode: UiMode
  alwaysOnTop: boolean

  character: CharacterStatus | null
  inventory: InventorySummary | null
  runningScripts: string[]
  logLines: string[]
  bridgeConnected: boolean
  bridgeMode: 'mock' | 'live'
  trainFocus: string[]
  autoSuggestHealer: boolean
  huntFavorites: string[]
  huntMode: 'suggest' | 'favorites_only' | 'manual'
  selectedHuntId: string | null
  houseEntryMethod: 'rope' | 'lockpick' | 'lockpick_ring'
  houseEntryMaxSearches: number
  houseEntryHide: boolean

  setSetupComplete: (v: boolean) => void
  updateSetupComponent: (id: SetupComponentId, patch: Partial<SetupComponent>) => void
  setUiMode: (mode: UiMode) => void
  setAlwaysOnTop: (v: boolean) => void
  setCharacter: (c: CharacterStatus | null) => void
  setInventory: (i: InventorySummary | null) => void
  addLog: (line: string) => void
  clearLog: () => void
  simulateConnect: () => void
  connectBridge: () => void
  disconnectBridge: () => void
  setBridgeMode: (m: 'mock' | 'live') => void
  requestIntent: (intent: string) => void
  demoLowHealth: () => void
  demoCombat: () => void
  demoSafe: () => void
  loadPreset: (id: string) => void
  setTrainFocus: (ids: string[]) => void
  toggleTrainFocus: (id: string) => void
  setAutoSuggestHealer: (v: boolean) => void
  toggleHuntFavorite: (id: string) => void
  setHuntMode: (m: 'suggest' | 'favorites_only' | 'manual') => void
  setSelectedHuntId: (id: string | null) => void
  setHouseEntryMethod: (m: 'rope' | 'lockpick' | 'lockpick_ring') => void
  setHouseEntryMaxSearches: (n: number) => void
  setHouseEntryHide: (v: boolean) => void
}
