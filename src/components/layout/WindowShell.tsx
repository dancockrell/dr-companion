import { useCallback, type ReactNode } from 'react'
import { useAppStore } from '../../store/useAppStore.ts'
import { useBridgeModeSync } from '../../lib/bridgeModeSync.ts'
import { DemoBanner } from './DemoBanner.tsx'

/**
 * The frame every window of this app is rendered inside.
 *
 * It exists for one reason: the demo banner has to be present in *every*
 * window, and the only way to guarantee that is for there to be one place
 * that mounts it and no way to reach a view except through that place.
 *
 * Issue #400: the banner was mounted inside the `v.kind === 'app'` return of
 * `App.tsx`, below the returns for the map window and the popped-out panel
 * windows. A player who popped out the stats panel while in the demo got a
 * full invented stat block in its own window with nothing saying so, and no
 * way out of the demo - the windows most likely to be left open on a second
 * monitor and come back to later. The `MOCK` badge did not cover it either,
 * because that lives in `AppControls`, which is also main-window only.
 *
 * So the fix is structural rather than three copies of the same line: the
 * view switch returns a body, this owns the banner, and a new window kind
 * added tomorrow gets the banner without anybody remembering to add it.
 *
 * `aux` is the pop-out case. Those windows are small, so the banner drops its
 * `DEMO` pill and some padding - but it keeps the sentence and the exit,
 * because a shorter warning that no longer says what is wrong is the defect
 * this is fixing. No `MOCK` badge is added to pop-outs: the badge answers "is
 * this live" for somebody who already knows the app, and in a window with one
 * panel in it the band above already says the same thing in words.
 */
export function WindowShell({ aux = false, children }: { aux?: boolean; children: ReactNode }) {
  const setupComplete = useAppStore((s) => s.setupComplete)
  const bridgeMode = useAppStore((s) => s.bridgeMode)

  /*
   * The demo is one fact about the app, not one per window - issue #424.
   * Subscribing here rather than in `App.tsx` for the same reason the banner
   * is here: this is the one component every window kind passes through, so
   * a window kind added tomorrow follows the mode with nobody remembering to
   * wire it.
   *
   * The store is read through `getState()` rather than from a rendered value,
   * so the comparison is against the mode as it stands when the message
   * arrives - a captured one is stale by exactly the change being reported.
   * The pair after it is the one `DemoBanner` and Settings use, in the same
   * order: switch the mode, which clears the invented character, then attach
   * whichever bridge that mode means.
   */
  useBridgeModeSync(
    useCallback((mode) => {
      const state = useAppStore.getState()
      if (state.bridgeMode === mode) return
      state.setBridgeMode(mode)
      state.connectBridge()
    }, [])
  )

  return (
    <div className="flex h-full w-full flex-col bg-surface">
      {setupComplete && bridgeMode === 'mock' && <DemoBanner compact={aux} />}
      {/* `relative` on purpose: `AppControls` pins the status dot and the
          window buttons with `absolute right-1 top-1`, and with no positioned
          ancestor those anchored to the viewport - so with the banner above
          them they landed on top of its "Leave the demo" button (measured:
          the overlay is 153px wide at the window's top right, exactly where
          the exit sits). Anchoring them to the content area instead puts them
          back at the top right of the app, below the band. */}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}
