import { useSyncExternalStore } from 'react'
import { getAiStatus, subscribeAiStatus } from '../../lib/aiWorkerHost'

/**
 * What the local AI worker is doing, and every way it is currently failing.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 14 makes this an acceptance
 * criterion rather than a nicety: "model failure, absence, timeout, and
 * out-of-memory state are visible and do not impair ordinary client use." A
 * worker that fails quietly is one nobody can tell apart from a worker with
 * nothing to do.
 *
 * Most installs will read "No local model is installed", and that is the
 * honest, expected, entirely fine state - the client works exactly as well
 * without one. It is shown as information rather than as a warning for that
 * reason.
 *
 * Two numbers are deliberately here even though they are usually zero:
 * unreviewed events, and anything the journal or the display buffer lost.
 * Loss is the one failure this design cannot recover from, so it is never
 * folded into a general "healthy" indicator.
 *
 * This panel watches; it does not host. The worker is started once by
 * `App.tsx` and publishes to the store in `aiWorkerHost.ts`, because a worker
 * hosted by this component only existed while the Settings sheet was open.
 */
export function AiWorkerPanel() {
  const status = useSyncExternalStore(subscribeAiStatus, getAiStatus, getAiStatus)

  const jobRows = Object.entries(status.jobs).filter(([, n]) => n > 0)
  const lost = status.journalLost + status.missedLines

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5">
        <span className="text-xs text-ink-faint">Local model</span>
        <span className="text-xs text-ink">
          {status.available ? 'ready' : (status.providerReason ?? 'not installed')}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5">
        <span className="text-xs text-ink-faint">Unreviewed events</span>
        <span className="text-xs tabular-nums text-ink">{status.journalPending}</span>
      </div>

      {status.pendingAlerts > 0 && (
        <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5">
          <span className="text-xs text-ink-faint">Alerts awaiting review</span>
          <span className="text-xs tabular-nums text-ink">{status.pendingAlerts}</span>
        </div>
      )}

      {/* Never folded into a general health indicator: loss is the one failure
          this design cannot recover from, so it says so plainly when it
          happens and stays out of the way when it does not. */}
      {lost > 0 && (
        <p className="text-xs text-danger leading-snug">
          {lost} event{lost === 1 ? '' : 's'} were discarded before review. The AI has an
          incomplete picture of that period; game state and the client are unaffected.
        </p>
      )}

      {jobRows.length > 0 && (
        <div className="rounded border border-border bg-surface px-2 py-1.5">
          <div className="text-xs text-ink-faint">Background jobs</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {jobRows.map(([state, n]) => (
              <span key={state} className="text-xs text-ink">
                {state.replace('_', ' ')} <span className="tabular-nums text-ink-faint">{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {status.lastFailure && (
        <p className="text-xs text-ink-muted leading-snug">Last attempt: {status.lastFailure}</p>
      )}

      <p className="text-xs text-ink-faint leading-snug">
        The worker reviews changed state and does background research when idle. It cannot
        send game commands - proposals go through the normal command boundary, and nothing
        is written to your maps or notes without review.
      </p>
    </div>
  )
}
