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
 */
import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { publishWorldSnapshotIfChanged } from './presentationBridge.ts'

export function usePresentationBridgePublisher(enabled: boolean): void {
  const zone = useAppStore((s) => s.mapZone)
  const here = useAppStore((s) => s.mapHere)
  const character = useAppStore((s) => s.character)

  useEffect(() => {
    if (!enabled) return
    void publishWorldSnapshotIfChanged({ zone, here, character })
  }, [enabled, zone, here, character])
}
