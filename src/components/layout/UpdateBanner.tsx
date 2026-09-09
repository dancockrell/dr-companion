import { useUpdateState, updateController } from '../../lib/updaterWiring.ts'

/**
 * One line, one state, one way out.
 *
 * This appears only for `available`, and that is the whole design. The launch
 * check runs on every start and lands in one of nine states; eight of them are
 * things a player did not ask about and must not be interrupted for. An
 * offline machine, a build with no update channel, a failed check — none of
 * those are the player's problem at the moment they open the app, and all
 * three are legible in Settings for anyone who goes looking.
 *
 * "Later" is a real later. It defers this version for the session and, because
 * `check({atLaunch:true})` consults the deferred set, it stays deferred across
 * the next launch check for that same version too. Nothing here schedules a
 * second offer, and there is no timer in this component or in `updater.ts` —
 * a banner that comes back on its own teaches people to dismiss banners
 * without reading them, which is how the one that matters gets missed.
 *
 * The buttons deliberately do not install. "Update" opens Settings, where the
 * download, the release notes and the sentence about closing the app all live.
 * A one-click install from a banner is exactly the surprise outage this
 * feature was written to avoid.
 */
export function UpdateBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const state = useUpdateState()
  if (state.kind !== 'available') return null

  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-accent/40 bg-accent/10 px-3 py-1.5 text-xs text-ink"
      role="status"
      aria-label="Update available"
    >
      <span className="min-w-0 flex-1">
        DR Companion {state.version} is available. You are running {state.currentVersion}.
      </span>
      <button
        type="button"
        onClick={onOpenSettings}
        className="shrink-0 rounded border border-accent/50 px-2 py-0.5 font-semibold hover:bg-accent/25"
      >
        See what changed
      </button>
      <button
        type="button"
        onClick={() => void updateController.later()}
        className="shrink-0 rounded border border-border px-2 py-0.5 hover:bg-surface-raised"
      >
        Later
      </button>
    </div>
  )
}
