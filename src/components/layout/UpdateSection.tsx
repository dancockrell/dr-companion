import { useState } from 'react'
import {
  LiveSessionRefusal,
  formatBytes,
  updateSummary,
  type UpdateState,
} from '../../lib/updater.ts'
import { RELEASES_URL, updateController, useUpdateState } from '../../lib/updaterWiring.ts'

/**
 * The Settings sheet's "Updates" section, and the only place every state of
 * the updater is reachable.
 *
 * The banner elsewhere shows one state (`available`) because that is the only
 * one worth interrupting somebody for. This shows all of them, including the
 * two that are easy to leave out and are the reason a player writes to you:
 * "this build cannot update itself" and "the last attempt failed, here is what
 * to do instead". Both name the releases page, because the honest fallback for
 * a broken updater is a person downloading an installer.
 *
 * No state here is a spinner with no words. `updateSummary` in `updater.ts`
 * owns the sentences so this component and the banner cannot drift into
 * describing the same state differently.
 */
export function UpdateSection() {
  const state = useUpdateState()
  const [confirming, setConfirming] = useState(false)

  const busy = state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'installing'

  async function install() {
    try {
      await updateController.install({ confirmed: confirming })
    } catch (e) {
      if (e instanceof LiveSessionRefusal) {
        // Not an error state: the app is asking a question. Turning this into
        // `failed` would tell a player something went wrong when nothing did.
        setConfirming(true)
        return
      }
      throw e
    }
  }

  return (
    <section className="space-y-2" aria-label="Updates">
      <h3 className="text-xs font-medium uppercase tracking-wider text-ink-faint">Updates</h3>

      <p className="text-xs text-ink-muted" data-testid="update-summary">
        {updateSummary(state)}
      </p>

      {state.kind === 'downloading' && <Progress state={state} />}

      {state.kind === 'available' && state.notes && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">What changed in {state.version}</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-ink-faint">{state.notes}</pre>
        </details>
      )}

      {confirming && (
        <p className="text-xs text-warn" role="alert">
          You are in the game. Installing closes DR Companion and runs the installer, which drops
          your character out of DragonRealms. Press Install again to go ahead, or Later.
        </p>
      )}

      {state.kind === 'failed' && (
        <p className="text-xs text-ink-muted" data-testid="update-what-to-do">
          {state.whatToDo}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void updateController.check()}
          className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-raised disabled:opacity-50"
        >
          Check for updates
        </button>

        {state.kind === 'available' && (
          <button
            type="button"
            onClick={() => void updateController.download()}
            className="rounded border border-accent/50 bg-accent/15 px-2 py-0.5 text-xs font-semibold hover:bg-accent/25"
          >
            Download {state.version}
          </button>
        )}

        {state.kind === 'ready' && (
          <button
            type="button"
            onClick={() => void install()}
            className="rounded border border-accent/50 bg-accent/15 px-2 py-0.5 text-xs font-semibold hover:bg-accent/25"
          >
            {confirming ? 'Install anyway and close' : `Install ${state.version}`}
          </button>
        )}

        {(state.kind === 'available' || state.kind === 'ready') && (
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              void updateController.later()
            }}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-raised"
          >
            Later
          </button>
        )}

        {state.kind === 'failed' && (
          <button
            type="button"
            onClick={() => updateController.reset()}
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-raised"
          >
            Dismiss
          </button>
        )}

        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-faint underline hover:text-ink-muted"
        >
          Releases page
        </a>
      </div>
    </section>
  )
}

/**
 * Progress, with the unknown-total case rendered as an indeterminate bar
 * rather than a fake percentage.
 *
 * A `Started` event may carry no `contentLength`, and inventing 0% or 100% for
 * that case is the kind of small lie that makes a player kill a download that
 * was working.
 */
function Progress({ state }: { state: Extract<UpdateState, { kind: 'downloading' }> }) {
  const pct = state.total ? Math.min(100, Math.round((state.received / state.total) * 100)) : null
  return (
    <div className="space-y-1">
      <div className="h-1.5 w-full overflow-hidden rounded bg-surface-raised">
        <div
          className={`h-full bg-accent ${pct === null ? 'w-1/3 animate-pulse' : ''}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
          aria-hidden
        />
      </div>
      <p className="text-xs text-ink-faint">
        {pct === null
          ? `${formatBytes(state.received)} downloaded (total size not announced)`
          : `${pct}% of ${formatBytes(state.total ?? 0)}`}
      </p>
    </div>
  )
}
