import { bridge } from '../bridge'
import type { AppState } from '../types'
import type { BridgeServerMessage } from '../bridge/types'

export type StoreSet = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)
) => void
export type StoreGet = () => AppState

let unsubscribeMessages: (() => void) | null = null
let unsubscribeLiveStatus: (() => void) | null = null

export function setBridgeMode(
  mode: 'mock' | 'live',
  set: StoreSet,
  get: StoreGet,
  persistMode: (mode: 'mock' | 'live') => void
): void {
  bridge.disconnect()
  unsubscribeMessages?.()
  unsubscribeMessages = null
  unsubscribeLiveStatus?.()
  unsubscribeLiveStatus = null
  bridge.setMode(mode)
  persistMode(mode)
  set({
    bridgeMode: mode,
    bridgeConnected: false,
    bridgeAuth: 'unknown',
    bridgeAuthNote: '',
    bridgeIntents: null,
    character: null,
    characterAt: 0,
    scriptStates: [],
    runningScripts: [],
    scriptCatalog: null,
    settingsFiles: null,
    toggles: null,
    vars: null,
  })
  get().addLog(mode === 'mock' ? 'Switched to mock bridge' : 'Switched to live Lich bridge')
}

export function connectBridge(
  set: StoreSet,
  get: StoreGet,
  handleMessage: (message: BridgeServerMessage, set: StoreSet, get: StoreGet) => void
): void {
  unsubscribeMessages?.()
  unsubscribeMessages = bridge.onMessage((message) => handleMessage(message, set, get))
  bridge.setMode(get().bridgeMode)
  const live = bridge.getMode() === 'live'

  if (live) {
    // Subscribe before connecting so an immediate refusal is not lost.
    unsubscribeLiveStatus?.()
    unsubscribeLiveStatus = bridge.onLiveStatus((status, detail) => {
      get().addLog(`Live bridge: ${status}${detail ? ` — ${detail}` : ''}`)
      if (status === 'connected') set({ bridgeConnected: true })
      if (status === 'disconnected' || status === 'error') {
        set({ bridgeConnected: false })
      }
    })
  }

  bridge.connect()
  // A reused live transport may already be open and will not emit a second
  // connected event, so read its actual state after connect.
  set({ bridgeConnected: live ? bridge.getLiveStatus() === 'connected' : true })
}

export function disconnectBridge(set: StoreSet): void {
  bridge.disconnect()
  unsubscribeMessages?.()
  unsubscribeMessages = null
  unsubscribeLiveStatus?.()
  unsubscribeLiveStatus = null
  set({
    bridgeConnected: false,
    character: null,
    characterAt: 0,
    scriptStates: [],
    runningScripts: [],
    scriptCatalog: null,
  })
}
