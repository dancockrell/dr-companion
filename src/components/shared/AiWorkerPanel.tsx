import { useState, useSyncExternalStore } from 'react'
import {
  getAiStatus,
  readProviderUrl,
  subscribeAiStatus,
  testProviderConnection,
  writeProviderUrl,
} from '../../lib/aiWorkerHost.ts'
import { failureSentence } from '../../lib/aiModelProvider.ts'

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
  // Local draft, committed on Connect. Writing on every keystroke would
  // rebuild the provider - and open a probe - for every character of a URL
  // somebody is halfway through typing.
  const [draft, setDraft] = useState(() => readProviderUrl() ?? '')
  const [testing, setTesting] = useState(false)

  const jobRows = Object.entries(status.jobs).filter(([, n]) => n > 0)
  const lost = status.journalLost + status.missedLines

  const connect = async () => {
    writeProviderUrl(draft)
    setTesting(true)
    try {
      // The button probes the provider the worker is actually using, not a
      // second one built here: a connection test that passes for an object
      // nobody runs is worse than no test.
      await testProviderConnection()
    } finally {
      setTesting(false)
    }
  }

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

      {/* An install with no model journals every line and acknowledges none,
          so the bound is reached and events fall off the back exactly as
          designed. The capture is correct; calling it "discarded before
          review" would be a permanent red warning about a review that was
          never going to happen. Loss is a failure only when there is
          something to fail. */}
      {!status.available && status.unreviewedWithoutModel > 0 && (
        <p className="text-xs text-ink-muted leading-snug">
          No local model, so {status.unreviewedWithoutModel} captured event
          {status.unreviewedWithoutModel === 1 ? ' is' : 's are'} unreviewed. Nothing is
          wrong: capture runs continuously and the client is unaffected.
        </p>
      )}

      {/* Never folded into a general health indicator: loss is the one failure
          this design cannot recover from, so it says so plainly when it
          happens and stays out of the way when it does not. */}
      {status.available && lost > 0 && (
        <p className="text-xs text-danger leading-snug">
          {lost} event{lost === 1 ? '' : 's'} were discarded before review. The AI has an
          incomplete picture of that period; game state and the client are unaffected.
        </p>
      )}

      {/* A refused prompt is a working privacy gate, not a broken worker, so
          it is named rather than left to read as a generic failure. */}
      {status.lastFailure?.startsWith('privacy_gate') && (
        <p className="text-xs text-ink-muted leading-snug">
          Sensitive input withheld: the review was refused before it reached the model.
        </p>
      )}

      {/* What is actually true today. tools/ai-worker-host-test.mjs holds this
          sentence to whether aiWorkerHost.ts can build a local provider at
          all, so the promise and the code cannot drift apart. */}
      <div className="space-y-1 rounded border border-border bg-surface px-2 py-1.5">
        <label className="block text-xs text-ink-faint" htmlFor="ai-provider-url">
          Model server
        </label>
        <div className="flex gap-1.5">
          <input
            id="ai-provider-url"
            type="text"
            className="min-w-0 flex-1 rounded border border-border bg-canvas px-1.5 py-1 text-xs text-ink"
            placeholder="http://127.0.0.1:11434"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-ink"
            onClick={() => void connect()}
            disabled={testing}
          >
            {testing ? 'Testing' : 'Test'}
          </button>
        </div>
        <p className="text-xs text-ink-faint leading-snug">
          Optional. Point this at a model server running on this machine - Ollama on
          11434, LM Studio on 1234, llama.cpp on 8080. An address anywhere else is
          refused and nothing is sent to it. Leave it empty and the client works
          exactly as it does now.
        </p>
      </div>

      {/* One sentence per failure kind, from aiModelProvider.ts. A single
          "the model failed" would leave a person with no idea whether to
          install something, choose a smaller model, or simply wait. */}
      {status.lastFailureKind && status.lastFailureKind !== 'privacy_gate' && (
        <p className="text-xs text-ink-muted leading-snug">
          {failureSentence(status.lastFailureKind)}
        </p>
      )}

      {/* The last thing the model actually said. Held between turns rather
          than blanked on every idle tick, which at one tick a second would be
          a flicker nobody could read. */}
      {status.lastReview && (
        <div className="rounded border border-border bg-surface px-2 py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-ink-faint">Last review</span>
            <span className="text-xs tabular-nums text-ink-faint">
              {new Date(status.lastReview.at).toLocaleTimeString()}
            </span>
          </div>
          {status.lastReview.notable.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {status.lastReview.notable.map((note, i) => (
                <li key={`${i}-${note}`} className="text-xs text-ink leading-snug">
                  {note}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-faint leading-snug">Nothing notable.</p>
          )}
          {status.lastReview.question && (
            <p className="mt-1 text-xs text-ink-muted leading-snug">
              {status.lastReview.question}
            </p>
          )}
        </div>
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
