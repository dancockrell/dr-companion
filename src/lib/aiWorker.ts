/**
 * One turn of the worker: ask the scheduler what should happen, do that, and
 * report honestly what did.
 *
 * This is the first consumer of the event journal. The previous slice left it
 * unwired on purpose rather than shipping a producer with no reader; this is
 * the reader.
 *
 * # The rule the whole file exists to enforce
 *
 * **The cursor advances only after the work actually succeeded.** A model that
 * times out, is cancelled, returns nothing usable, or is not installed at all
 * leaves the cursor exactly where it was, so the next turn sees the same
 * events again. Every failure path below returns without acknowledging, and
 * the tests break each one in turn to prove it.
 *
 * # It cannot reach the game
 *
 * No import from `gameActions.ts`, `gameCommand.ts` or `gameLink.ts`. A model
 * result reaches this module as text and stops here. Section 2's "one command
 * path" is a structural fact about what this file can call, not a promise
 * about how carefully it was written - a future live-suggestion tool (section
 * 13.9) has to go through the existing typed boundary, and it will be visible
 * as a new import when somebody writes it.
 *
 * # It also cannot promote anything
 *
 * A background result is a candidate. This turn records that a job produced
 * output and moves it to `awaiting_review`; it does not write to the map, the
 * knowledge base, or any canonical record. Section 7's promotion lifecycle is
 * a separate slice with its own evidence and review requirements.
 */
import type { AlertBroker } from './aiAlertBroker.ts'
import type { EventJournal } from './aiEventJournal.ts'
import type { BackgroundJob, JobStore } from './aiJobStore.ts'
import type { ModelProvider, ModelRequest, ModelResult } from './aiModelProvider.ts'
import { generateWithinBudget, parseStructured, PrivacyGateError } from './aiModelProvider.ts'
import type { ClaimStore } from './aiClaimStore.ts'
import { validateTetherCandidate, type TetherCandidate } from './aiJobProducers.ts'
import { allowedInPrompt } from './aiIngest.ts'
import type { Activity } from './aiReviewScheduler.ts'
import { decideReview } from './aiReviewScheduler.ts'

/**
 * What a live review is allowed to say.
 *
 * Two fields, both harmless. `notable` is what the model thought worth a
 * person's attention; `question` is the one thing it would like to know. Note
 * what is absent: there is no field for a command, a destination, a target or
 * an action. A model that wants the character to do something has nowhere to
 * put it, which is section 2's "one command path" enforced by the shape of
 * the contract rather than by filtering afterwards.
 */
export interface LiveReview {
  notable: string[]
  question?: string
}

/**
 * Appended to the caller's instructions for a live review.
 *
 * Here rather than in `aiIngest.ts` with the rest of the prompt because the
 * schema and the parser have to agree, and the only way to guarantee that is
 * for one file to own both. A schema in the prompt that has drifted from the
 * validator produces `invalid_output` forever with nothing to indicate why.
 */
const LIVE_REVIEW_SCHEMA = `

Reply with one JSON object and nothing else:
{ "notable": string[], "question"?: string }
"notable" holds short phrases worth a person's attention, and may be empty.
"question" is optional and holds at most one question.`

/** The validator the schema above describes. Deliberately permissive about
 * extra keys - a model that adds "confidence" has still answered, and
 * discarding a usable review over a field nobody reads would be a worse
 * failure than ignoring it. Strict about the two that are read. */
function isLiveReview(value: unknown): value is LiveReview {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { notable?: unknown; question?: unknown }
  if (!Array.isArray(v.notable)) return false
  if (!v.notable.every((n) => typeof n === 'string')) return false
  if (v.question !== undefined && typeof v.question !== 'string') return false
  return true
}

export interface WorkerDeps {
  journal: EventJournal
  alerts: AlertBroker
  jobs: JobStore
  provider: ModelProvider
  activity: Activity
  now: number
  /** ISO timestamp for job records, kept separate from the millisecond clock
   * the scheduler uses so both stay deterministic in tests. */
  nowIso: string
  lastReviewAt: number | null
  stateHash: string
  lastReviewedHash: string | null
  /** Stable instruction prefix. Supplied by the caller so this module does not
   * own prompt content. */
  instructions: string
  /**
   * Where candidate claims go, when there is anywhere.
   *
   * Optional, because a host that has not wired one is a host that produces no
   * claims rather than a host that crashes - and because the whole point of a
   * candidate store is that it is separate from anything canonical, so this
   * module holding a hard reference to one would be the wrong shape.
   */
  claims?: ClaimStore | null
  /** Resolves evidence refs for the tether validator. */
  evidence?: {
    resolve(refs: readonly string[]): {
      resolved: Array<{ ref: string; kind: string; payload: unknown }>
      missing: string[]
    }
  } | null
  /**
   * Stream ids whose private communications the player has opted into
   * sharing with a local model.
   *
   * Empty by default, and per source rather than one switch: "share my
   * whispers" and "share my group chat" are not one decision. Nothing is
   * excluded from *capture* by this - the journal keeps everything, which
   * is what makes an opt-in retroactively meaningful - only from what a
   * request may carry.
   */
  privacyOptIn?: readonly string[]
  /** Whether the map knows a room. Injected so the validator cannot read
   * anything else out of the map. */
  knownRoom?: (roomId: string) => boolean
}

export type WorkerOutcome =
  | { did: 'nothing'; reason: string }
  | { did: 'background-idle'; reason: string }
  /** A live review ran. `acknowledged` says whether the cursor moved, which is
   * the only durable evidence the events were actually consumed. */
  | {
      did: 'review'
      reason: string
      result: ModelResult
      acknowledged: boolean
      cursorAfter: number
      alertKey: string | null
      /** The parsed review, when the model returned one that matched the
       * schema. `null` covers both "no model answered" and "it answered with
       * prose", which are different failures and are told apart by `result`. */
      review: LiveReview | null
    }
  /** A background job was preempted by an alert. */
  | { did: 'preempted'; reason: string; jobId: string; cursorAfter: number }
  | {
      did: 'background-job'
      reason: string
      jobId: string
      result: ModelResult
      status: string
      /** Claims this job produced, if any. Present so a caller can tell a job
       * that reviewed something from one that only ran. */
      claimIds?: string[]
    }

/**
 * Generate, turning a refused prompt into a reportable failure.
 *
 * `assertPromptCarriesNoSecrets` throws, correctly - a leak has to stop the
 * call rather than produce a value somebody might log - and it throws from
 * outside `generateWithinBudget`'s try, so nothing converted it. This module
 * did not catch it and the host's tick had a try/finally with no catch, so
 * the rejection went unhandled and the turn reported nothing at all: the one
 * failure that means the privacy rules are working was also the only one
 * invisible to the player.
 *
 * Unreachable today, because a live request carries only sequence numbers and
 * event kinds. Reachable the moment anything puts game text in a request,
 * which is what the knowledge and evidence slices are for.
 *
 * Only this error is caught. Anything else is a real bug and must keep
 * travelling rather than be relabelled as a privacy refusal.
 */
async function generateOrRefuse(
  provider: ModelProvider,
  request: ModelRequest,
  signal?: AbortSignal
): Promise<ModelResult> {
  try {
    return await generateWithinBudget(provider, request, signal)
  } catch (error) {
    if (error instanceof PrivacyGateError) {
      // Pattern names only. The value that matched never appears here, in a
      // job note, or on screen.
      return {
        ok: false,
        failure: 'privacy_gate',
        message: `withheld: ${error.patterns.join(', ')}`,
      }
    }
    throw error
  }
}

/** What a recorder did, so the job note can say it rather than the caller
 * inferring it from a count. */
interface ClaimRecording {
  claimIds: string[]
  note: string
}

/**
 * The claim a map reconciliation produces without asking anything.
 *
 * `detectExitDivergence` already decided this, deterministically, from two
 * lists the app had parsed - so the job has a reviewable result before a model
 * is involved and whatever the model does. That is the whole point of the
 * increment: an install with no model is not an install with no map work.
 *
 * `confidence: 0.5` is advisory and says what it means - the two sources
 * disagree and this claim does not know which is right. Producer is the parser
 * by name, because `kind: 'parser'` alone cannot tell two parsers apart.
 */
function recordDeterministicDivergence(
  deps: WorkerDeps,
  job: BackgroundJob,
  nowIso: string
): ClaimRecording {
  if (!deps.claims) return { claimIds: [], note: 'no claim store is attached, so nothing was recorded' }

  const roomId = typeof job.scope.roomId === 'string' ? job.scope.roomId : null
  const diff = Array.isArray(job.scope.divergence) ? job.scope.divergence : []
  if (!roomId || diff.length === 0) {
    return { claimIds: [], note: 'the job carries no room or no divergence to claim' }
  }

  // Corroboration first. The same divergence noticed again from a *different*
  // event is a second observation of one fact, not a second fact - and a
  // producer that created a fresh claim each time would fill the review list
  // with copies of one disagreement.
  const corroborated = deps.claims.corroborate({
    subject: roomId,
    predicate: 'exit_divergence',
    value: { diff },
    evidenceRefs: job.inputRefs,
    now: nowIso,
  })
  if (corroborated.ok && corroborated.claim) {
    return {
      claimIds: [corroborated.claim.claimId],
      note: `corroborated ${corroborated.claim.claimId}`,
    }
  }

  const created = deps.claims.create({
    subject: roomId,
    predicate: 'exit_divergence',
    value: { diff },
    evidenceRefs: job.inputRefs,
    producer: { kind: 'parser', identity: 'aiJobProducers.detectExitDivergence' },
    confidence: 0.5,
    now: nowIso,
  })
  if (!created.ok || !created.claim) {
    return { claimIds: [], note: `the parser claim was refused: ${created.reason ?? 'unknown'}` }
  }
  return { claimIds: [created.claim.claimId], note: `parser claim ${created.claim.claimId}` }
}

/**
 * Tethers the model proposed, each one checked before it may become a claim.
 *
 * Three refusals, and every one of them is recorded in the job note rather
 * than as a claim. That distinction is the increment: a proposal that failed
 * validation is *evidence about the model*, not evidence about the map, and
 * storing it as a candidate would put an invented destination one Accept click
 * away from the map.
 *
 * Malformed output is `invalid_output` and changes nothing else. The
 * deterministic claim above still stands, because it never depended on this.
 */
function recordModelTethers(
  deps: WorkerDeps,
  job: BackgroundJob,
  text: string,
  nowIso: string
): ClaimRecording {
  if (!deps.claims) return { claimIds: [], note: 'no claim store is attached, so nothing was recorded' }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { claimIds: [], note: 'invalid_output: the model result was not JSON' }
  }

  const proposals = (parsed as { tethers?: unknown })?.tethers
  if (!Array.isArray(proposals)) {
    return { claimIds: [], note: 'invalid_output: the model result carried no tethers array' }
  }

  const knownRoom = deps.knownRoom ?? (() => false)
  const claimIds: string[] = []
  const refused: string[] = []

  for (const raw of proposals) {
    const candidate = raw as TetherCandidate
    const verdict = validateTetherCandidate(
      { ...candidate, evidenceRefs: candidate?.evidenceRefs ?? job.inputRefs },
      { evidence: deps.evidence ?? null, knownRoom }
    )
    if (!verdict.ok) {
      refused.push(verdict.reason)
      continue
    }
    const created = deps.claims.create({
      subject: verdict.candidate.fromRoomId,
      predicate: 'has_tether',
      value: verdict.candidate,
      evidenceRefs: verdict.candidate.evidenceRefs,
      producer: { kind: 'model', identity: 'local-worker' },
      confidence: null,
      now: nowIso,
    })
    if (created.ok && created.claim) claimIds.push(created.claim.claimId)
    else refused.push(created.reason ?? 'the claim store refused it')
  }

  const parts: string[] = []
  if (claimIds.length > 0) parts.push(`model claims ${claimIds.join(', ')}`)
  if (refused.length > 0) parts.push(`refused ${refused.length}: ${refused.join(' | ')}`)
  if (parts.length === 0) parts.push('the model proposed nothing')
  return { claimIds, note: parts.join('; ') }
}

/**
 * Run one turn. Returns rather than loops: the caller owns the timer, which
 * keeps this testable without one and means a stuck turn cannot wedge a loop
 * nobody can see into.
 */
export async function runWorkerOnce(
  deps: WorkerDeps,
  signal?: AbortSignal
): Promise<WorkerOutcome> {
  const { journal, alerts, jobs, provider, nowIso } = deps

  const decision = decideReview({
    journal,
    alerts,
    activity: deps.activity,
    now: deps.now,
    lastReviewAt: deps.lastReviewAt,
    stateHash: deps.stateHash,
    lastReviewedHash: deps.lastReviewedHash,
    backgroundRunning: jobs.byStatus('running').length > 0,
  })

  if (decision.action === 'idle') return { did: 'nothing', reason: decision.reason }

  if (decision.action === 'review') {
    // Preemption first, and before any model call: a running job is stopped
    // because an alert arrived, not because the model said so.
    if (decision.preempt) {
      const running = jobs.byStatus('running')[0]
      if (running) {
        jobs.transition(running.jobId, 'cancelled', {
          now: nowIso,
          note: `preempted by ${decision.priority ?? 'alert'} ${decision.alertKey ?? ''}`.trim(),
        })
        return {
          did: 'preempted',
          reason: decision.reason,
          jobId: running.jobId,
          // Unchanged, and asserted by the caller's tests: preemption is not
          // consumption.
          cursorAfter: journal.acknowledged(),
        }
      }
    }

    const read = journal.readFrom(decision.fromCursor)
    const generated = await generateOrRefuse(
      provider,
      {
        // The schema travels with the request that has to satisfy it.
        instructions: deps.instructions + LIVE_REVIEW_SCHEMA,
        // Compact suffix, section 5. References and counts, never a transcript.
        // Private communications are journalled and never prompted, by
        // default. The filter drops the whole event rather than its text: a
        // sequence number is a pointer at a whisper, and a model given the
        // pointer plus `observations.read` would have the words.
        state: JSON.stringify({
          events: read.events
            .filter((e) => allowedInPrompt(e, deps.privacyOptIn ?? []))
            .map((e) => ({ seq: e.seq, kind: e.kind })),
          lost: read.lost,
          alert: decision.alertKey,
        }),
        allowedTools: [],
        budget: { maxTokens: 256, maxSeconds: 5 },
      },
      signal
    )

    // A 200 from the model is not an answer. Text that does not carry the
    // agreed object has told us nothing, and treating it as success would
    // acknowledge the events it failed to review - so the cursor would move
    // past a period nothing ever looked at, permanently and silently. It is
    // demoted to `invalid_output` here, before the acknowledge below, which
    // is why that block needs no second condition.
    let review: LiveReview | null = null
    let result: ModelResult = generated
    if (generated.ok) {
      const parsed = parseStructured(generated.text, isLiveReview)
      if (parsed.ok) review = parsed.value
      else result = { ok: false, failure: 'invalid_output', message: parsed.reason }
    }

    // The one place the cursor may move, and only here.
    let acknowledged = false
    if (result.ok && read.events.length > 0) {
      journal.acknowledge(read.nextCursor)
      acknowledged = true
    }

    // An answered alert is retired only on success, for the same reason: a
    // failed review has not dealt with the condition that raised it.
    if (result.ok && decision.alertKey) alerts.acknowledge(decision.alertKey)

    return {
      did: 'review',
      reason: decision.reason,
      result,
      acknowledged,
      cursorAfter: journal.acknowledged(),
      alertKey: decision.alertKey,
      review,
    }
  }

  // Idle capacity: advance one background job, if there is one to advance.
  const next = jobs.byStatus('queued')[0] ?? jobs.byStatus('checkpointed')[0]
  if (!next) return { did: 'background-idle', reason: decision.reason }

  const started = jobs.transition(next.jobId, 'running', { now: nowIso })
  if (!started.ok) {
    return { did: 'background-idle', reason: started.reason ?? 'could not start the job' }
  }

  // A map reconciliation has an answer before any model is asked, so it takes
  // a different path: the deterministic claim is written first and stands
  // whatever the provider does.
  const deterministic =
    next.kind === 'map_reconciliation' ? recordDeterministicDivergence(deps, next, nowIso) : null

  const result = await generateOrRefuse(
    provider,
    {
      instructions: deps.instructions,
      state: JSON.stringify({ jobId: next.jobId, kind: next.kind, scope: next.scope }),
      allowedTools: next.allowedTools,
      budget: next.budget,
    },
    signal
  )

  if (next.kind === 'map_reconciliation') {
    const model = result.ok ? recordModelTethers(deps, next, result.text ?? '', nowIso) : null
    const notes = [deterministic?.note, model?.note].filter(Boolean)
    if (!result.ok && result.failure !== 'cancelled') notes.push(`${result.failure}: ${result.message}`)
    if (!result.ok && result.failure === 'absent') notes.push('no model is installed; the parser claim stands alone')

    // awaiting_review even when the provider failed, because something real
    // was produced: a claim a person can accept or reject. Reporting this as
    // `failed` would hide a finished piece of work behind an absent model.
    const to = !result.ok && result.failure === 'cancelled' ? 'cancelled' : 'awaiting_review'
    jobs.transition(next.jobId, to, { now: nowIso, note: notes.join('; ') })

    return {
      did: 'background-job',
      reason: decision.reason,
      jobId: next.jobId,
      result,
      status: jobs.get(next.jobId)?.status ?? 'unknown',
      claimIds: [...(deterministic?.claimIds ?? []), ...(model?.claimIds ?? [])],
    }
  }

  // Success is a candidate awaiting review, never a completion: nothing here
  // has validated the output or promoted anything.
  //
  // Failure keeps whatever checkpoint the job already had. Cancellation is
  // recorded as cancelled rather than failed, because a preempted job did not
  // go wrong.
  const to = result.ok ? 'awaiting_review' : result.failure === 'cancelled' ? 'cancelled' : 'failed'
  jobs.transition(next.jobId, to, {
    now: nowIso,
    note: result.ok ? 'produced a candidate; not yet reviewed' : `${result.failure}: ${result.message}`,
  })

  return {
    did: 'background-job',
    reason: decision.reason,
    jobId: next.jobId,
    result,
    status: jobs.get(next.jobId)?.status ?? 'unknown',
  }
}
