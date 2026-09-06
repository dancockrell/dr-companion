import type { ReactNode } from 'react'
import { useAppStore } from '../../store/useAppStore.ts'
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
