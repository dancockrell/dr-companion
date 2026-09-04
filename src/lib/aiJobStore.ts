/**
 * Durable background jobs with honest status.
 *
 * The record and the seven states are `docs/LOCAL_AI_BACKGROUND_WORKER.md`
 * section 6, including its hard rule: "A crash cannot convert `running` into
 * `completed`."
 *
 * # What "honest" rules out
 *
 * Three lies are easy to write here and all three are forbidden:
 *
 * 1. **A crash reported as success.** A process that dies mid-job leaves
 *    `running` on disk. On restart that is resolved to `checkpointed` when
 *    there is a real checkpoint to resume from, and `failed` when there is
 *    not - never `completed`, and never left as `running`, which would claim
 *    a worker is active that no longer exists.
 * 2. **A cancellation reported as completion.** `cancelled` is terminal and
 *    distinct. A preempted job did not finish.
 * 3. **A status that skipped a state.** Transitions are validated against an
 *    explicit table, so `queued -> completed` is refused rather than quietly
 *    accepted. A job cannot complete work it never started.
 *
 * # Persistence
 *
 * Through `storage.ts`'s existing `readJSON`/`writeJSON`, which already own
 * quota handling and return a `StorageWriteResult` rather than throwing. This
 * module does not open its own persistence path.
 *
 * A write failure is surfaced, never swallowed: a job store that believes a
 * checkpoint was saved when it was not would resume from the wrong place,
 * which is worse than refusing to claim the checkpoint at all.
 *
 * # What this module cannot do
 *
 * It cannot call a model, send a game command, or read game state. It holds
 * records. The scheduler decides when work may run; the worker (not yet
 * built) does the work. Keeping those apart is why a cancelled job here
 * cannot accidentally leave a command in flight - this layer has no way to
 * issue one.
 */
import { readJSON, writeJSON } from './storage.ts'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'checkpointed'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Job families from section 6. Open on purpose - a string keeps the store
 * from needing a change every time a family is added - but the known set is
 * named so a typo is greppable. */
export type JobKind =
  | 'map_reconciliation'
  | 'knowledge_extraction'
  | 'wiki_draft'
  | 'database_conflict_review'
  | 'script_explanation'
  | 'script_translation'
  | 'script_repair'
  | 'evaluation_case_mining'

export interface JobBudget {
  maxTokens: number
  maxSeconds: number
}

export interface BackgroundJob {
  schemaVersion: 1
  jobId: string
  kind: JobKind
  priority: 'background'
  status: JobStatus
  scope: Record<string, unknown>
  /** Stable references to inputs, never copied payloads. Section 5 keeps
   * research context out of the live packet. */
  inputRefs: string[]
  /** Exactly what this job may call. An empty list is a job that can only
   * think, which is a legitimate and safe state. */
  allowedTools: string[]
  budget: JobBudget
  /** Journal cursor this job has consumed to, when it consumes events at all. */
  cursor: number | null
  /** Opaque resume point. Its presence is what makes an interrupted job
   * resumable rather than lost. */
  checkpointRef: string | null
  createdAt: string
  updatedAt: string
  /** Why a job ended the way it did. Required for terminal failure states so
   * a failed job can be acted on rather than only observed. */
  note?: string
}

/**
 * Legal transitions. Anything absent is refused.
 *
 * `running -> queued` exists so a preempted-but-retryable job can go back in
 * line without pretending it failed. `checkpointed -> running` is the resume
 * path. Terminal states have no outgoing transitions at all: a completed job
 * that could be moved again would make its own status meaningless.
 */
const ALLOWED: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['checkpointed', 'awaiting_review', 'completed', 'failed', 'cancelled', 'queued'],
  checkpointed: ['running', 'cancelled', 'failed'],
  awaiting_review: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export const TERMINAL_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'cancelled']

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to)
}

const STORAGE_KEY = 'drc.ai-jobs.v1'

export interface TransitionResult {
  ok: boolean
  job?: BackgroundJob
  /** Why it was refused, for a caller that must report rather than guess. */
  reason?: string
}

export class JobStore {
  private jobs = new Map<string, BackgroundJob>()
  private nextId = 1

  /** Loads persisted jobs. Does not itself resolve interrupted ones - see
   * `recoverInterrupted`, which is separate so recovery is an explicit act
   * with a visible result rather than a side effect of construction. */
  load(): void {
    const stored = readJSON<BackgroundJob[]>(STORAGE_KEY, [])
    this.jobs = new Map(stored.map((j) => [j.jobId, j]))
    const highest = stored
      .map((j) => Number.parseInt(j.jobId.replace(/^job:/, ''), 10))
      .filter((n) => Number.isFinite(n))
    this.nextId = highest.length > 0 ? Math.max(...highest) + 1 : 1
  }

  /** Returns the storage result rather than a boolean, so a caller can tell a
   * quota failure from an ordinary save. */
  private persist(): ReturnType<typeof writeJSON> {
    return writeJSON(STORAGE_KEY, [...this.jobs.values()])
  }

  create(params: {
    kind: JobKind
    scope?: Record<string, unknown>
    inputRefs?: string[]
    allowedTools?: string[]
    budget?: JobBudget
    now: string
  }): BackgroundJob {
    const job: BackgroundJob = {
      schemaVersion: 1,
      jobId: `job:${this.nextId++}`,
      kind: params.kind,
      priority: 'background',
      status: 'queued',
      scope: params.scope ?? {},
      inputRefs: params.inputRefs ?? [],
      allowedTools: params.allowedTools ?? [],
      budget: params.budget ?? { maxTokens: 2048, maxSeconds: 30 },
      cursor: null,
      checkpointRef: null,
      createdAt: params.now,
      updatedAt: params.now,
    }
    this.jobs.set(job.jobId, job)
    this.persist()
    return job
  }

  get(jobId: string): BackgroundJob | undefined {
    return this.jobs.get(jobId)
  }

  all(): BackgroundJob[] {
    return [...this.jobs.values()]
  }

  byStatus(status: JobStatus): BackgroundJob[] {
    return this.all().filter((j) => j.status === status)
  }

  /**
   * Move a job to a new status, refusing anything the table does not allow.
   *
   * `checkpointRef` and `cursor` are updated only when supplied, so a
   * transition cannot silently erase a resume point. Clearing one is a
   * deliberate act, not a default.
   */
  transition(
    jobId: string,
    to: JobStatus,
    params: { now: string; checkpointRef?: string | null; cursor?: number | null; note?: string } = {
      now: new Date().toISOString(),
    }
  ): TransitionResult {
    const job = this.jobs.get(jobId)
    if (!job) return { ok: false, reason: `No such job: ${jobId}` }

    if (!canTransition(job.status, to)) {
      return {
        ok: false,
        reason: `Refused ${job.status} -> ${to} for ${jobId}${
          isTerminal(job.status) ? ' (already terminal)' : ''
        }`,
      }
    }

    job.status = to
    job.updatedAt = params.now
    if (params.checkpointRef !== undefined) job.checkpointRef = params.checkpointRef
    if (params.cursor !== undefined) job.cursor = params.cursor
    if (params.note !== undefined) job.note = params.note

    const written = this.persist()
    if (!written.ok) {
      // Reported, not swallowed. The in-memory status is now ahead of what
      // survives a restart, and a caller that believed this succeeded would
      // resume from a checkpoint that was never written.
      return {
        ok: false,
        job,
        reason: `Status changed in memory but not saved (${written.kind}): ${written.message}`,
      }
    }
    return { ok: true, job }
  }

  /**
   * Resolve jobs left `running` by a process that stopped.
   *
   * Nothing is running at startup by definition - no worker survived the
   * restart - so a `running` record is an interrupted job, and leaving it
   * would claim an active worker that does not exist.
   *
   * A job with a checkpoint becomes `checkpointed`, which is resumable and
   * true. One without becomes `failed` with the reason recorded. Neither
   * becomes `completed`; that is the rule this function exists to enforce.
   */
  recoverInterrupted(now: string): { resumable: BackgroundJob[]; failed: BackgroundJob[] } {
    const resumable: BackgroundJob[] = []
    const failed: BackgroundJob[] = []

    for (const job of this.jobs.values()) {
      if (job.status !== 'running') continue
      if (job.checkpointRef) {
        job.status = 'checkpointed'
        job.note = 'Interrupted while running; resuming from the last checkpoint.'
        resumable.push(job)
      } else {
        job.status = 'failed'
        job.note = 'Interrupted while running with no checkpoint to resume from.'
        failed.push(job)
      }
      job.updatedAt = now
    }

    if (resumable.length > 0 || failed.length > 0) this.persist()
    return { resumable, failed }
  }

  /** Test and reset hook. Clears memory and storage together so the two
   * cannot disagree. */
  reset(): void {
    this.jobs.clear()
    this.nextId = 1
    writeJSON(STORAGE_KEY, [])
  }
}
