import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { AiWorkerStatus } from '../../lib/aiWorkerHost.ts'
import {
  getAiStatus,
  readProviderUrl,
  subscribeAiStatus,
  testProviderConnection,
  writeProviderUrl,
} from '../../lib/aiWorkerHost.ts'
import { failureSentence } from '../../lib/aiModelProvider.ts'
import { suggestionStore } from '../../lib/aiSuggestions.ts'
import { suggestionCardView, type KeyedRefusal } from '../../lib/suggestionCardView.ts'

/**
 * The one card a proposed command is offered on.
 *
 * Three rules, and each of them is the reason this is a component rather than
 * a line of text:
 *
 * **The command is shown exactly as it will be sent.** Monospace, unwrapped,
 * no ellipsis, no title-casing, no tidying of the double spaces a model may
 * have left in. What Confirm hands back is read from the record - not from
 * this element, and not retyped - so the string the player is looking at and
 * the string the gate compares are the same object.
 *
 * **The expiry is visible and it is real.** The countdown is not decoration:
 * `store.live()` sweeps expiry every time it is called, and this re-renders
 * once a second, so a card that has run out stops being offered on screen at
 * the moment the gate would refuse it. If the timer were removed the card
 * would linger and Confirm would still refuse, which is safe and confusing;
 * both halves are here so those cannot disagree.
 *
 * **Confirm is not the check.** Every refusal a player can trigger here is
 * decided in `aiSuggestions.ts` and reported back as a sentence. This
 * component has no opinion about whether a command may run, which is why
 * `tools/ai-suggestions-test.mjs` can exercise the whole boundary without
 * rendering anything at all.
 *
 * **A refusal belongs to a suggestion, and is shown with it.** The store
 * settles a suggestion on expiry and on a state version that moved, so the two
 * refusals a player most needs explained arrive at the moment `live()` starts
 * returning null. The card therefore keeps drawing the settled record until
 * the sentence has been read - and refuses to draw the sentence next to
 * anything else, because a refusal that survives onto the next proposal is
 * worse than no refusal at all. `suggestionCardView` decides which of those
 * this is, so the rule can be tested without a DOM.
 */
function SuggestionCard() {
  const store = useMemo(() => suggestionStore(), [])
  const subscribe = useMemo(() => store.subscribe.bind(store), [store])
  const revision = useMemo(() => store.currentRevision.bind(store), [store])
  useSyncExternalStore(subscribe, revision, revision)

  // A second hand, so the countdown moves and the sweep inside `live()` runs
  // on a client where nothing else is happening. An expired card must leave
  // the screen because it expired, not because something else re-rendered.
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // The refusal carries the id it belongs to. A bare string could not be
  // checked against anything, which is how one card's red line ended up under
  // another card's command; `suggestionCardView` refuses to draw it beside a
  // suggestion it does not name.
  const [refusal, setRefusal] = useState<KeyedRefusal | null>(null)
  const view = suggestionCardView({
    live: store.live(),
    lastSettled: store.lastSettled(),
    refusal,
  })
  const suggestion = view.kind === 'none' ? null : view.suggestion

  const confirm = useCallback(() => {
    if (!suggestion) return
    // The text comes from the record, never from the DOM and never retyped:
    // if those two could differ, the confirmation would be of something other
    // than what the player read.
    const result = store.requestExecution(suggestion.id, {
      suggestionId: suggestion.id,
      commandText: suggestion.exactCommand,
    })
    setRefusal(
      result.ok ? null : { suggestionId: suggestion.id, reason: result.reason ?? 'it was refused' }
    )
  }, [store, suggestion])

  const dismiss = useCallback(() => {
    if (!suggestion) return
    store.dismiss(suggestion.id, 'dismissed by the player')
    setRefusal(null)
  }, [store, suggestion])

  // A settled card has nothing left in the store to dismiss - it is already
  // terminal, and no status leaves a terminal one. All that is left is the
  // sentence, and the player saying they have read it.
  const acknowledge = useCallback(() => setRefusal(null), [])

  if (view.kind === 'none' || !suggestion) return null

  const settled = view.kind === 'settled'
  const secondsLeft = Math.max(0, Math.ceil((suggestion.expiresAt - Date.now()) / 1000))
  const awaiting = suggestion.status === 'awaiting_result'

  return (
    <div className="space-y-1.5 rounded border border-border bg-surface px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink-faint">Suggested command</span>
        <span className="text-xs tabular-nums text-ink-faint">
          {settled ? 'not sent' : awaiting ? 'sent' : `${secondsLeft}s`}
        </span>
      </div>

      {/* Wrapped in its own scroller rather than truncated: a command a player
          cannot read in full is a command they cannot judge, and the whole
          point of this card is that they are confirming a literal string. */}
      <div className="overflow-x-auto">
        <code className="block whitespace-pre font-mono text-xs text-ink">
          {suggestion.exactCommand}
        </code>
      </div>

      {settled ? (
        // No Confirm: there is nothing left to confirm, and offering a button
        // that could only refuse again is the confusing half of the pair this
        // card is here to keep honest.
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
            onClick={acknowledge}
          >
            Dismiss
          </button>
        </div>
      ) : awaiting ? (
        <p className="text-xs text-ink-muted leading-snug">
          Sent. It is resolved by what the game says next, not by the model.
        </p>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-ink hover:border-accent hover:text-accent"
            onClick={confirm}
          >
            Confirm
          </button>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink"
            onClick={dismiss}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* `view.refusal` and not the raw state: the view has already checked
          that this sentence names the suggestion above it. */}
      {view.refusal && (
        <p className="text-xs text-danger leading-snug">Not sent: {view.refusal}</p>
      )}

      <p className="text-xs text-ink-faint leading-snug">
        Nothing is sent unless you confirm this exact text, and only while the game state
        it was based on is still current.
      </p>
    </div>
  )
}

/**
 * What the assistant is doing, said to the person playing.
 *
 * # The instance this came from
 *
 * On 9 September 2026 this panel, on a machine with no model installed, filled
 * two thirds of the right rail with: a counter reading "Unreviewed events
 * 1200", a paragraph explaining that the counter did not matter, a text field
 * prefilled with a loopback address, three port numbers, a red-adjacent "No
 * model server answered", a "Background jobs - queued 3" row, "Last attempt:
 * absent: No local model is installed.", and two more paragraphs about the
 * worker. Every one of those is an instrument. None of them is a thing a
 * player can do anything about, and the state they were describing is the
 * ordinary one: no model, nothing wrong.
 *
 * # The rule applied, which is not "show less"
 *
 * Nothing here was deleted. The counters, the queue depth, the last attempt
 * and the internal failure kind all still exist and are all still on this
 * panel - inside a `<details>` that is closed by default, and repeated in the
 * Diagnostics panel's bug bundle so a report still carries them. What changed
 * is rank and place: the top of the panel holds only what a player can act on,
 * and the instruments are one click away instead of in front.
 *
 * # Why it stays mounted with no model
 *
 * The panel is two lines in that state - a sentence and a button - so it is no
 * longer a tenant worth evicting, and it is the only route to setting a model
 * up. Unmounting it would mean the one affordance for turning the feature on
 * exists nowhere in the app, which is a worse defect than the one being fixed.
 * When the layout lane's bottom bar lands, this component moves behind a bar
 * item unchanged: it takes no position of its own and reads no layout state.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 14 requires that "model
 * failure, absence, timeout, and out-of-memory state are visible and do not
 * impair ordinary client use". Visible is satisfied by the disclosure - the
 * section asks that the state be discoverable, not that it be unavoidable.
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
  // The setup form is revealed by the affordance rather than always drawn: an
  // address field with three port numbers under it is the single largest piece
  // of developer furniture on this panel, and it is useful only to somebody
  // who has just decided to install a model.
  const [setupOpen, setSetupOpen] = useState(false)

  // One number rather than two on screen: a player choosing between "the
  // journal lost some" and "the display buffer dropped some" is choosing
  // between two internals, and the fact that matters is the same either way.
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

  const setup = (
    <div className="space-y-1 rounded border border-border bg-surface px-2 py-1.5">
      <label className="block text-xs text-ink-faint" htmlFor="ai-provider-url">
        Model address
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
      {/* The three addresses are the one place a port number belongs on this
          panel: the player has been asked to type one, so it is an
          instruction rather than an instrument. */}
      <p className="text-xs text-ink-faint leading-snug">
        Type the address of a model server running on this machine. Ollama uses
        http://127.0.0.1:11434, LM Studio http://127.0.0.1:1234, llama.cpp
        http://127.0.0.1:8080. An address anywhere else is refused and nothing is sent
        to it.
      </p>
      {/* One sentence per failure kind, from aiModelProvider.ts, and only
          where somebody is looking at it because they just pressed Test. A
          single "the model failed" would leave a person with no idea whether
          to install something, choose a smaller model, or simply wait. */}
      {status.lastFailureKind && status.lastFailureKind !== 'privacy_gate' && (
        <p className="text-xs text-ink-muted leading-snug">
          {failureSentence(status.lastFailureKind)}
        </p>
      )}
    </div>
  )

  return (
    <div className="space-y-1.5">
      {status.available ? (
        <>
          <div className="flex items-center justify-between gap-2 rounded border border-border bg-surface px-2 py-1.5">
            <span className="text-xs text-ink">The assistant is watching the game.</span>
            {status.lastReview && (
              <span className="text-xs tabular-nums text-ink-faint">
                {new Date(status.lastReview.at).toLocaleTimeString()}
              </span>
            )}
          </div>

          {/* Above everything else on purpose: it is the only thing on this
              panel a player is asked to act on, and it expires. */}
          <SuggestionCard />

          {/* In the slot a card would have used, because it is the answer to
              the question an empty slot raises. */}
          {status.suggestionRefused && (
            <p className="text-xs text-ink-muted leading-snug">
              A suggested command was not offered to you: {status.suggestionRefused}
            </p>
          )}

          {/* A refused prompt is a working privacy gate, not a broken worker,
              so it is named rather than left to read as a generic failure. */}
          {status.lastFailureKind === 'privacy_gate' && (
            <p className="text-xs text-ink-muted leading-snug">
              Sensitive input withheld: the review was refused before it reached the model.
            </p>
          )}

          {/* Never folded into a general health indicator, and never moved
              behind the disclosure: loss is the one failure this design cannot
              recover from, and it changes what the assistant can be trusted to
              have seen. */}
          {status.available && lost > 0 && (
            <p className="text-xs text-danger leading-snug">
              The assistant missed part of what happened, so it has an incomplete picture
              of that period. Your game and this client are unaffected.
            </p>
          )}

          {status.lastReview && status.lastReview.notable.length > 0 && (
            <ul className="space-y-0.5 rounded border border-border bg-surface px-2 py-1.5">
              {status.lastReview.notable.map((note, i) => (
                <li key={`${i}-${note}`} className="text-xs text-ink leading-snug">
                  {note}
                </li>
              ))}
            </ul>
          )}

          {status.lastReview?.question && (
            <p className="text-xs text-ink-muted leading-snug">{status.lastReview.question}</p>
          )}

          <button
            type="button"
            className="text-left text-xs text-ink-faint underline decoration-dotted hover:text-ink"
            onClick={() => setSetupOpen((open) => !open)}
          >
            {setupOpen ? 'Hide the model address' : 'Change the model address'}
          </button>
          {setupOpen && setup}
        </>
      ) : (
        <>
          <p className="text-xs text-ink-muted leading-snug">
            The assistant is off. It needs a model running on this computer.
          </p>
          {setupOpen ? (
            setup
          ) : (
            <button
              type="button"
              className="rounded border border-border px-2 py-1 text-xs text-ink hover:border-accent hover:text-accent"
              onClick={() => setSetupOpen(true)}
            >
              Set one up
            </button>
          )}
        </>
      )}

      <AiWorkerDetails status={status} lost={lost} />
    </div>
  )
}

/**
 * Every number the panel used to show, kept, and closed.
 *
 * This is the "behind details" half of the rule. It exists so that fixing the
 * panel is not a deletion: a player filing a bug can open one disclosure and
 * read the same counters that used to be in front of them, and the Diagnostics
 * panel's bug bundle carries them too, so a report is no poorer than before.
 *
 * `tools/dev-jank-test.mjs` reads the `<details>` element, not a comment or a
 * class name: the exemption it grants is to text physically inside a closed
 * disclosure, so moving any of this back out of the element makes that check
 * go red naming this file.
 */
function AiWorkerDetails({ status, lost }: { status: AiWorkerStatus; lost: number }) {
  const jobRows = Object.entries(status.jobs).filter(([, n]) => n > 0)
  return (
    <details className="rounded border border-border bg-surface px-2 py-1.5">
      <summary className="cursor-pointer text-xs text-ink-faint">
        Details for a bug report
      </summary>
      <div className="mt-1 space-y-0.5">
        <p className="text-xs text-ink-faint">Unreviewed events: {status.journalPending}</p>
        <p className="text-xs text-ink-faint">Alerts awaiting review: {status.pendingAlerts}</p>
        <p className="text-xs text-ink-faint">Events lost before review: {lost}</p>
        <p className="text-xs text-ink-faint">Worker turns: {status.ticks}</p>
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
        {jobRows.length > 0 && (
          <p className="text-xs text-ink-faint">
            Background jobs:{' '}
            {jobRows.map(([state, n]) => `${state.replace('_', ' ')} ${n}`).join(', ')}
          </p>
        )}
        {status.providerReason && (
          <p className="text-xs text-ink-faint">Model: {status.providerReason}</p>
        )}
        {status.lastFailure && (
          <p className="text-xs text-ink-faint">Last attempt: {status.lastFailure}</p>
        )}
        <p className="text-xs text-ink-faint leading-snug">
          The assistant reviews changed state and does background research when idle. It
          never sends a game command itself: a suggestion is text until you confirm the
          exact line, and nothing is written to your maps or notes without review.
        </p>
      </div>
    </details>
  )
}
