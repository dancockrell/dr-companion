/**
 * Wires `presentationBridge.ts`'s compiler into the running app.
 *
 * `compileWorldSnapshot`/`publishWorldSnapshotIfChanged` existed for a
 * whole PR (#269) with nothing in the app actually calling them - a real
 * compiler with no caller is exactly as inert as no compiler at all. This
 * hook is that caller: it watches the same store fields `BattleColumn`
 * already reads for the existing 2D battle map (`mapZone`, `mapHere`,
 * `character` - see `BattleColumn.tsx`'s own `useAppStore` calls), and
 * republishes on every change. `shouldPublish`'s own gate (inside
 * `publishWorldSnapshotIfChanged`) is what keeps that cheap - most store
 * updates are vitals/roundtime/etc, not a room change, and those compile to
 * the same `currentRoomId` and get skipped before anything reaches Rust.
 *
 * Call this once, unconditionally, near the app root - React's own rule
 * (hooks can't be called conditionally) rather than a preference, since
 * `App.tsx` renders three different windows (main app, popped-out map,
 * popped-out panel) from one component and only the main window should
 * ever publish. `enabled` is how that's expressed instead: pass
 * `v.kind === 'app'` rather than skipping the call. A popped-out window
 * calling this with `enabled: false` still runs the hook (satisfying the
 * rule) but its effect below no-ops, so it never races the main window's
 * sequence numbers or publishes from whatever partial store state a
 * separate webview happens to have.
 *
 * # Reconnect
 *
 * docs/CLAUDE_3D_VIEWER_BRIEF.md requires "on launch, reconnect, dropped
 * event, or renderer crash, request a new snapshot." A *new Godot
 * connection* already gets this for free - `presentation_bridge.rs`'s
 * `handle_client` sends whatever snapshot it's holding immediately on auth,
 * without this hook's involvement. What it does not cover is the *game*
 * connection recovering while an already-connected Godot client is still
 * attached: if the Lich bridge drops and reattaches while the character
 * happens to still be in the same room, `shouldPublish`'s room-changed gate
 * sees no room change and correctly stays quiet - correct for the ordinary
 * case (nothing to tell Godot), wrong for this one, because entities and
 * ground items could easily have changed during the gap and Godot would
 * have no way to know. `bridgeConnected` flipping false -> true is that
 * signal, tracked here (not inside `shouldPublish`, which stays a pure
 * function of room ids on purpose) and forces the next publish regardless
 * of whether the room itself moved.
 */
import { useEffect, useRef } from 'react'
import { useAppStore } from '../store/useAppStore'
import { justReconnected, publishWorldSnapshotIfChanged } from './presentationBridge.ts'

export function usePresentationBridgePublisher(enabled: boolean): void {
  const zone = useAppStore((s) => s.mapZone)
  const here = useAppStore((s) => s.mapHere)
  const character = useAppStore((s) => s.character)
  const bridgeConnected = useAppStore((s) => s.bridgeConnected)

  // Starts false rather than undefined so a session that mounts already
  // connected is not itself mistaken for a reconnect - there is no prior
  // "disconnected" moment to recover from at first mount, `enabled`/the
  // room-changed publish on the first real snapshot already covers that.
  const wasConnected = useRef(false)

  useEffect(() => {
    if (!enabled) return
    const force = justReconnected(bridgeConnected, wasConnected.current)
    wasConnected.current = bridgeConnected
    void publishWorldSnapshotIfChanged({ zone, here, character }, force)
  }, [enabled, zone, here, character, bridgeConnected])
}
