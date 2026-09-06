import { bridge } from '../bridge/index.ts'
import type { AppState } from '../types'
import type { RealBridgeStatus } from '../bridge/realBridge.ts'
import { storeBridgeStatus } from './bridgeStatus.ts'
import { FRESH, nextStaleSince } from './staleMark.ts'
import type { BridgeServerMessage } from '../bridge/types'

export type StoreSet = (
  partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)
) => void
export type StoreGet = () => AppState

let unsubscribeMessages: (() => void) | null = null
let unsubscribeLiveStatus: (() => void) | null = null

/**
 * One transport status becoming store state, including what it does to the
 * stale mark.
 *
 * Lifted out of the `onLiveStatus` closure it used to live inside, and it is
 * now the only place either of those two decisions is made. Issue #506 is what
 * a second copy of this looks like: `disconnectBridge` and `setBridgeMode`
 * blanked the character on the way out and this path did not, so the same fact
 * - the bridge is no longer feeding us - left the store in two different
 * shapes depending on which door it came through.
 *
 * `hasData` is asked of the store rather than assumed, because a drop before
 * the first status ever landed has nothing to mark, and a mark over an empty
 * panel is furniture that teaches a reader to skim the badge.
 */
export function applyLiveStatus(
  status: RealBridgeStatus,
  set: StoreSet,
  get: StoreGet,
  now: number = Date.now()
): void {
  const mapped = storeBridgeStatus(status)
  const state = get()
  set({
    ...mapped,
    bridgeAttempt: bridge.getLiveAttempt(),
    bridgeMaxAttempts: bridge.getLiveMaxAttempts(),
    bridgeStaleSince: nextStaleSince({
      status: mapped.bridgeStatus,
      hasData: Boolean(state.character) || state.scriptStates.length > 0,
      staleSince: state.bridgeStaleSince,
      now,
    }),
  })
}

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
    // Cleared with the data it qualifies. A mark left standing over a `null`
    // character would make the next panel to mount say "last known, 0s ago"
    // about nothing at all.
    bridgeStaleSince: FRESH,
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
      applyLiveStatus(status as RealBridgeStatus, set, get)
    })
  }

  bridge.connect()
  // A reused live transport may already be open and will not emit a second
  // connected event, so read its actual state after connect.
  if (live) {
    applyLiveStatus(bridge.getLiveStatus() as RealBridgeStatus, set, get)
  } else {
    // The mock has no socket, so it is not in any transport state. Saying
    // `connected` here would put a live-transport word on a thing with no
    // transport, and the status bars would then offer a reconnect for
    // something that never dials.
    set({ bridgeConnected: true, bridgeStatus: 'mock', bridgeAttempt: 0, bridgeStaleSince: FRESH })
  }
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
    bridgeStaleSince: FRESH,
    scriptStates: [],
    runningScripts: [],
    scriptCatalog: null,
  })
}
