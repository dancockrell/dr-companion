import { bridge } from '../bridge/index.ts'
import type { AppState } from '../types'
import type { RealBridgeStatus } from '../bridge/realBridge.ts'
import { storeBridgeStatus } from './bridgeStatus.ts'
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
    bridgeStatus: 'disconnected',
    bridgeAttempt: 0,
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
      // Every status now lands somewhere. It used to be two `if`s with no
      // `else`, so `connecting` changed nothing at all and the attempt count
      // reached the store only inside the log line above - a number in prose
      // that no component could render, which is the same absence as no number
      // (issue #479).
      set({
        ...storeBridgeStatus(status as RealBridgeStatus),
        bridgeAttempt: bridge.getLiveAttempt(),
        bridgeMaxAttempts: bridge.getLiveMaxAttempts(),
      })
    })
  }

  bridge.connect()
  // A reused live transport may already be open and will not emit a second
  // connected event, so read its actual state after connect.
  set(
    live
      ? {
          ...storeBridgeStatus(bridge.getLiveStatus() as RealBridgeStatus),
          bridgeAttempt: bridge.getLiveAttempt(),
          bridgeMaxAttempts: bridge.getLiveMaxAttempts(),
        }
      : // The mock has no socket, so it is not in any transport state. Saying
        // `connected` here would put a live-transport word on a thing with no
        // transport, and the status bars would then offer a reconnect for
        // something that never dials.
        { bridgeConnected: true, bridgeStatus: 'mock', bridgeAttempt: 0 }
  )
}

export function disconnectBridge(set: StoreSet): void {
  bridge.disconnect()
  unsubscribeMessages?.()
  unsubscribeMessages = null
  unsubscribeLiveStatus?.()
  unsubscribeLiveStatus = null
  set({
    bridgeConnected: false,
    bridgeStatus: 'disconnected',
    bridgeAttempt: 0,
    character: null,
    characterAt: 0,
    scriptStates: [],
    runningScripts: [],
    scriptCatalog: null,
  })
}
