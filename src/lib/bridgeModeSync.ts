/**
 * One demo mode for the whole app, across every window.
 *
 * # What was wrong
 *
 * A popped-out panel is a real second webview (`WebviewWindowBuilder` in
 * `src-tauri/src/lib.rs`), so it is a separate JS realm with its own zustand
 * store. `setBridgeMode` set that store and wrote the preference, and nothing
 * anywhere read the preference again. So "Leave the demo" pressed in a
 * popped-out stats panel took *that window* out of the demo and left the main
 * window in it - the control did less than its label said, and the persisted
 * preference and the running main window disagreed from that moment on
 * (issue #424).
 *
 * # The shape of the fix
 *
 * The mode is one fact about the app, so it needs one channel:
 *
 *   - the window where the mode changed persists it and publishes it once;
 *   - every window subscribes at startup and applies the mode locally,
 *     *without* publishing again.
 *
 * That last clause is the whole risk. Applying a received mode goes through
 * the same `setBridgeMode` a person's click goes through, and that path
 * publishes - so without a guard, one click is an unbounded round of windows
 * telling each other the same thing. `createBridgeModeSync` holds the guard,
 * and `first-screen-test.mjs` asserts the count: one change puts exactly one
 * message on the transport, no matter how many windows are listening.
 *
 * # Two transports, one abstraction
 *
 * The transport is the only part that differs between the app and the browser
 * stand-in, so it is the only part that is swapped:
 *
 *   - **In the app**, a Tauri event. `emit` reaches every webview of the
 *     process, which is exactly the population that has to follow. Covered by
 *     `core:default` in `src-tauri/capabilities/default.json`, which includes
 *     `core:event:default`; no new capability entry.
 *   - **In a browser** (the dev server, and every browser-driven harness),
 *     the localStorage channel this app already uses to carry pins and the
 *     player marker between windows - `subscribeStorageKey`, which pairs a
 *     `StorageEvent` (another document) with a `CustomEvent` (this one,
 *     because browsers deliberately do not echo `storage` to the writer).
 *     Reused rather than reinvented: a second cross-window channel for the
 *     same kind of fact is two things that would drift.
 *
 * A third transport - an in-memory one - is what the Node test drives, which
 * is why the interface exists at all rather than the two branches being
 * written inline.
 */
import { useEffect } from 'react'
import type { BridgeModeChoice } from './bridgeModeSelect.ts'
import { subscribeStorageKey } from './subscribedStorage.ts'
import { PREFS_STORAGE_KEY, loadPrefs } from './persistence.ts'
import { emitTauri, isTauri, listenTauri } from './tauri.ts'

/** The Tauri event name, and the same string as the browser's CustomEvent. */
export const BRIDGE_MODE_EVENT = 'drc:bridge-mode-changed'

export interface BridgeModeTransport {
  /** Send this mode to every window, including - as Tauri's `emit` does - this one. */
  publish(mode: BridgeModeChoice): void
  /** Called for every message that arrives. Returns an unsubscribe function. */
  subscribe(handler: (mode: BridgeModeChoice) => void): () => void
}

export interface BridgeModeSync {
  publish(mode: BridgeModeChoice): void
  subscribe(apply: (mode: BridgeModeChoice) => void): () => void
}

/**
 * The echo guard, and nothing else.
 *
 * One flag covers both halves of the round trip, because both are the same
 * mistake - this window reacting to its own message:
 *
 *   - while a received mode is being applied, `publish` is a no-op, so a
 *     window that is only following cannot start a second round;
 *   - while a message is going out, an arriving one is ignored, because both
 *     transports deliver to the sender as well. Tauri's `emit` reaches every
 *     webview including this one, and the browser transport's event is
 *     delivered *synchronously, inside the publish* - measured: without this
 *     half, pressing "Start the demo" re-entered `setBridgeMode` from inside
 *     itself, before the store had been set, and the mock bridge never
 *     finished connecting. `tools/first-screen-shots.mjs` caught that; no
 *     amount of reading the source did.
 *
 * The flag is per window - each document builds its own sync - so one window
 * publishing never silences another.
 */
export function createBridgeModeSync(transport: BridgeModeTransport): BridgeModeSync {
  let busy = false
  return {
    publish(mode) {
      if (busy) return
      busy = true
      try {
        transport.publish(mode)
      } finally {
        busy = false
      }
    },
    subscribe(apply) {
      return transport.subscribe((mode) => {
        if (busy) return
        busy = true
        try {
          apply(mode)
        } finally {
          busy = false
        }
      })
    },
  }
}

/** In the app: one Tauri event, delivered to every webview of the process. */
export const tauriTransport: BridgeModeTransport = {
  publish(mode) {
    emitTauri(BRIDGE_MODE_EVENT, mode)
  },
  subscribe(handler) {
    return listenTauri<BridgeModeChoice>(BRIDGE_MODE_EVENT, (mode) => {
      if (mode === 'mock' || mode === 'live') handler(mode)
    })
  },
}

/**
 * In a browser: the persisted preference is the message.
 *
 * The payload is deliberately not carried on the event - the reader loads the
 * preference, which is the value that has to win anyway. That also means a
 * `storage` event fired by some *other* preference write (a volume, say)
 * simply reports the mode that is already in force, and the store's own
 * "already this mode" check makes it a no-op.
 */
export const storageTransport: BridgeModeTransport = {
  publish() {
    // `persistence.ts` has already written the preference by the time this
    // runs - see the `persistMode` callback in `useAppStore.ts`. All that is
    // left is to tell this document, since `storage` reaches every document
    // except the one that wrote it.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(BRIDGE_MODE_EVENT))
  },
  subscribe(handler) {
    if (typeof window === 'undefined') return () => {}
    return subscribeStorageKey(PREFS_STORAGE_KEY, BRIDGE_MODE_EVENT, () => {
      handler(loadPrefs().bridgeMode)
    })
  },
}

let shared: BridgeModeSync | null = null

/** The one sync every window uses. Chooses its transport once, at first use. */
export function bridgeModeSync(): BridgeModeSync {
  shared ??= createBridgeModeSync(isTauri() ? tauriTransport : storageTransport)
  return shared
}

/** Called from the `persistMode` seam in the store, after the write. */
export function publishBridgeMode(mode: BridgeModeChoice): void {
  bridgeModeSync().publish(mode)
}

/**
 * Follow the app's mode for as long as this window is open.
 *
 * Mounted in `WindowShell`, which is the one component every window kind
 * passes through - the same structural argument that puts the demo banner
 * there. A window added tomorrow follows the mode without anybody
 * remembering to subscribe.
 *
 * `apply` gets the mode and decides for itself whether it is already in it.
 * The mode deliberately is *not* a parameter here: a value captured when the
 * subscription was made is stale by exactly the change being reported, and a
 * dependency on it would tear the subscription down and rebuild it on every
 * switch. The caller reads the live store instead.
 */
export function useBridgeModeSync(apply: (mode: BridgeModeChoice) => void): void {
  useEffect(() => bridgeModeSync().subscribe(apply), [apply])
}
