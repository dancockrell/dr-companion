/**
 * The one place a bridge transport status becomes store state.
 *
 * Its own module rather than a few lines inside `bridgeLifecycle.ts`, and the
 * reason is testability rather than tidiness: `bridgeLifecycle.ts` imports the
 * bridge facade, which reaches the mock bridge, the map data and eventually
 * `import.meta.glob` - so importing it outside Vite fails at load. A mapping
 * that decides whether the app believes it can talk to Lich is exactly the
 * thing that should be reachable from a plain `node` test, and it was not.
 *
 * Type-only imports here, deliberately. Nothing in this file may import a
 * module with a runtime side effect, or the reason it exists is gone.
 */
import type { BridgeTransportStatus } from '../types'
import type { RealBridgeStatus } from '../bridge/realBridge.ts'

/**
 * Exhaustive by construction: a `Record` over `RealBridgeStatus`, so adding a
 * status to the transport and forgetting it here is a type error rather than a
 * status that silently falls through to whatever the `else` happened to be.
 *
 * That `else` is how the old mapping worked - two `if`s, `connected` setting
 * true and `disconnected`/`error` setting false, everything else changing
 * nothing at all - and it is why `reconnecting` and `gave-up` had nowhere to
 * land when they were added for issue #479.
 *
 * The mapping is the identity today. It is a table anyway, because the store's
 * type has one member the transport does not (`'mock'`, which has no socket),
 * and because a table is the thing `tools/link-reconnect-test.mjs` can assert
 * is total.
 */
const STORE_STATUS: Record<RealBridgeStatus, BridgeTransportStatus> = {
  disconnected: 'disconnected',
  connecting: 'connecting',
  reconnecting: 'reconnecting',
  connected: 'connected',
  'gave-up': 'gave-up',
  error: 'error',
}

/**
 * Whether anything can be sent, which is a narrower question than the status.
 *
 * Only `connected` qualifies, and it is derived here rather than decided at
 * each call site so a new transport status cannot quietly be treated as live.
 * `connecting` and `reconnecting` in particular are **not** connected -
 * `RealBridge.send` answers "Not connected to Lich bridge" in both - and
 * reading either as live is how a command is handed to a socket that is not
 * there.
 *
 * An unrecognised status degrades to `error`, never to `connected`. A webview
 * can outrun the transport it ships beside, and guessing generously about a
 * state nobody has described is the failure this whole lane is about.
 */
export function storeBridgeStatus(status: RealBridgeStatus): {
  bridgeStatus: BridgeTransportStatus
  bridgeConnected: boolean
} {
  // `??` and not `||`: the fallback is for a status this build has never heard
  // of, and `||` would also swallow a legitimate future empty-ish value.
  const bridgeStatus = STORE_STATUS[status] ?? 'error'
  return { bridgeStatus, bridgeConnected: bridgeStatus === 'connected' }
}
