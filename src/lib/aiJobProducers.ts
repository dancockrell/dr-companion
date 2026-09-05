/**
 * What gives the background worker something to do.
 *
 * A job store with no producer is a queue nobody fills, and `aiWorker.ts` has
 * been reading an empty one since it was written. This is the first producer:
 * it notices that the map and the game disagree about a room's exits, and asks
 * for that to be reconciled.
 *
 * # It parses nothing
 *
 * Both sides of the comparison are already parsed by their own owners. The
 * snapshot side is `presentationBridge.ts`'s `WorldExit.move`, built from the
 * cartographer's own moves; the stream side is `gameStream.ts`'s compass tag,
 * which is the game telling a frontend that declared the `xml` capability
 * which directions exist. Nothing here reads a line of game text, and adding
 * anything that did would be a second parser for a fact the app already has.
 *
 * # Only bearings are compared, and that is the whole subtlety
 *
 * The compass reports directions. It does not report `go gate`, `climb
 * ladder` or `out`, so a comparison that included them would find a
 * divergence in every room with a door - a check that always fires, which
 * carries exactly as much information as one that never does. So both sides
 * are reduced to compass bearings through `expandCompassDirection`, and an
 * exit that is not a bearing is not evidence of anything either way.
 */
import { expandCompassDirection } from './isometric-board-layout.mjs'
import { eventRef } from './aiEvidenceStore.ts'
import { isTerminal, type BackgroundJob, type JobStore } from './aiJobStore.ts'

/**
 * One direction the two sources disagree about.
 *
 * Both booleans are carried rather than a single "which side" enum, because a
 * consumer that only knows "they differ" cannot tell a stale map from a room
 * whose exit is closed today, and those need different fixes.
 */
export interface ExitDivergence {
  /** The bearing, written out in full. */
  move: string
  inSnapshot: boolean
  inStream: boolean
}

/** The part of a compiled cell this needs. Structural, so nothing has to build
 * a whole `WorldCell` - board layout, position and title are irrelevant to
 * whether two lists of directions agree. */
export interface SnapshotExits {
  exits: ReadonlyArray<{ move: string }>
}

/**
 * Which bearings appear on one side and not the other.
 *
 * Sorted, so two runs over the same room produce the same list and a job's
 * scope can be compared without worrying about iteration order.
 */
export function detectExitDivergence(
  snapshotCell: SnapshotExits | null | undefined,
  parsedExits: readonly string[] | null | undefined
): ExitDivergence[] {
  // A room the snapshot does not describe, or a compass the game has not sent
  // yet, is missing knowledge rather than a disagreement. Reporting every exit
  // as divergent on arrival - before the compass tag lands - would fill the
  // queue with jobs about nothing.
  if (!snapshotCell || !parsedExits) return []

  const inSnapshot = new Set<string>()
  for (const exit of snapshotCell.exits) {
    const bearing = expandCompassDirection(exit.move)
    if (bearing) inSnapshot.add(bearing)
  }

  const inStream = new Set<string>()
  for (const raw of parsedExits) {
    const bearing = expandCompassDirection(raw)
    if (bearing) inStream.add(bearing)
  }

  const out: ExitDivergence[] = []
  for (const move of [...new Set([...inSnapshot, ...inStream])].sort()) {
    const a = inSnapshot.has(move)
    const b = inStream.has(move)
    if (a !== b) out.push({ move, inSnapshot: a, inStream: b })
  }
  return out
}

export interface ProposeParams {
  jobs: JobStore
  /** The room the disagreement is about, as the snapshot names it. */
  roomId: string
  divergence: readonly ExitDivergence[]
  /** Journal sequences that witness this state. Turned into `event:<seq>`
   * refs here so the vocabulary has one owner. */
  evidenceSeqs: readonly number[]
  now: string
}

export interface ProposeResult {
  /** The job that now covers this subject, whether this call made it or an
   * earlier one did. Null when there was nothing to propose. */
  job: BackgroundJob | null
  created: boolean
  reason: string
}

/**
 * The only tool this job may use.
 *
 * A reconciliation job flags a conflict; it does not propose a node, write a
 * tether, or move anything. Section 6's `allowedTools` is the list of what a
 * job may call, and a short one is the point rather than a limitation.
 */
const RECONCILIATION_TOOLS = ['flag_conflict']

/**
 * Ask for a room's exits to be reconciled, unless something already has.
 *
 * The dedupe is on `scope.roomId` against every non-terminal job, and it is
 * the load-bearing part: the host ticks about once a second, and a divergence
 * persists until somebody resolves it, so without this one stale map row
 * would produce a job per second forever. A queue that grows without bound is
 * a queue nobody can review, which is the same as no queue at all.
 */
export function proposeMapReconciliation(params: ProposeParams): ProposeResult {
  if (params.divergence.length === 0) {
    return { job: null, created: false, reason: 'the map and the game agree about this room' }
  }

  const existing = params.jobs
    .all()
    .find((job) => job.kind === 'map_reconciliation' && !isTerminal(job.status) && job.scope.roomId === params.roomId)
  if (existing) {
    return { job: existing, created: false, reason: `already covered by ${existing.jobId}` }
  }

  const job = params.jobs.create({
    kind: 'map_reconciliation',
    scope: { roomId: params.roomId, divergence: [...params.divergence] },
    inputRefs: params.evidenceSeqs.map(eventRef),
    allowedTools: RECONCILIATION_TOOLS,
    now: params.now,
  })
  return { job, created: true, reason: `${params.divergence.length} direction(s) disagree` }
}

/**
 * A tether the model proposes, before anything has agreed it is real.
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 17. Structural, and
 * deliberately not `WorldExit`: a candidate is a *proposal* about the graph,
 * and giving it the same type as a compiled exit is how a proposal ends up
 * being drawn.
 */
export interface TetherCandidate {
  fromRoomId: string
  /** Null when the proposer does not claim to know where it goes, which is a
   * legitimate and useful thing to say. */
  toRoomId: string | null
  kind: string
  /** The command, when one was proposed. Decides whether this is a bearing. */
  move?: string
  boardAnchor?: unknown
  evidenceRefs: string[]
  /**
   * How the proposer says it knows.
   *
   * Present so `portal` and `warp` can be refused when the only thing behind
   * them is that two cells look close together on the board. Without a stated
   * basis a proposal cannot be checked against section 17's proximity rule at
   * all, so an absent basis is treated as unstated rather than as clean.
   */
  basis?: string[]
}

export interface TetherValidationDeps {
  /** Evidence store, or anything that resolves refs the same way. */
  evidence: {
    resolve(refs: readonly string[]): {
      resolved: Array<{ ref: string; kind: string; payload: unknown }>
      missing: string[]
    }
  } | null
  /** Whether the map knows this room. A predicate rather than a store, so the
   * validator cannot read anything else out of the map. */
  knownRoom(roomId: string): boolean
}

export type TetherValidation =
  | { ok: true; candidate: TetherCandidate & { boardAnchor: unknown; status: 'candidate' } }
  | { ok: false; reason: string }

/** Bases that are about how a board is drawn rather than about movement. */
const PROXIMITY_BASES = ['board-proximity', 'visual-proximity', 'adjacent-on-board', 'proximity']

/**
 * Refuse a plausible-looking tether before it is even allowed to be a
 * candidate.
 *
 * Every clause is a specific way a map that looks right is wrong:
 *
 * - **An invented destination** is the commonest. A model that has read a room
 *   description can name an exit's far side without anything having gone
 *   through it, and only the authoritative-snapshot requirement separates an
 *   observed tether from a guessed one. Note what that means in practice
 *   today: the journal carries `line` events, so a proposal with a
 *   non-null destination is refused until something journals a snapshot. That
 *   is the safe direction to be wrong in, and it is why the rule is a
 *   requirement on the evidence rather than on the proposal.
 * - **A directionless exit** must not be given a board anchor. An anchor is a
 *   claim about compass placement and the graph did not make one; null is the
 *   honest value, which is what `WorldExit.boardAnchor` already documents.
 * - **A portal looks adjacent and is not.** Proximity in a presentation layout
 *   is never evidence about movement.
 * - **A ferry needs a crossing.** A route that exists on a timetable is not a
 *   route the character has taken.
 */
export function validateTetherCandidate(
  candidate: TetherCandidate,
  deps: TetherValidationDeps
): TetherValidation {
  if (!deps.knownRoom(candidate.fromRoomId)) {
    return { ok: false, reason: `fromRoomId ${candidate.fromRoomId} is not a room the map knows` }
  }
  if (!candidate.evidenceRefs || candidate.evidenceRefs.length === 0) {
    return { ok: false, reason: 'a tether candidate must cite evidence' }
  }
  if (!deps.evidence) {
    return { ok: false, reason: 'no evidence store is attached, so this proposal cannot be checked' }
  }

  const { resolved, missing } = deps.evidence.resolve(candidate.evidenceRefs)
  if (missing.length > 0) {
    return { ok: false, reason: `evidence does not resolve: ${missing.join(', ')}` }
  }

  const kind = String(candidate.kind ?? '').toLowerCase()
  const basis = (candidate.basis ?? []).map((b) => String(b).toLowerCase())

  if ((kind === 'portal' || kind === 'warp') && basis.some((b) => PROXIMITY_BASES.includes(b))) {
    return {
      ok: false,
      reason: `a ${kind} may not be inferred from board proximity (${basis.join(', ')})`,
    }
  }

  if (candidate.toRoomId !== null && candidate.toRoomId !== undefined) {
    const witnessed = resolved.some(
      (item) =>
        item.kind === 'snapshot' &&
        item.payload !== null &&
        typeof item.payload === 'object' &&
        (item.payload as { currentRoomId?: unknown }).currentRoomId === candidate.toRoomId
    )
    if (!witnessed) {
      return {
        ok: false,
        reason: `destination ${candidate.toRoomId} appears in no cited authoritative snapshot`,
      }
    }
  }

  if (kind === 'ferry') {
    const crossed = resolved.some(
      (item) =>
        item.kind === 'transport' ||
        item.kind === 'crossing' ||
        (item.payload !== null &&
          typeof item.payload === 'object' &&
          (item.payload as { transport?: unknown }).transport === true)
    )
    if (!crossed) {
      return { ok: false, reason: 'a ferry needs a transport entry or a successful crossing in evidence' }
    }
  }

  // A directionless exit gets a null anchor, never a guessed one - and never
  // the one the proposal arrived carrying, which is the case that matters,
  // because a model that supplies an anchor is exactly the thing this clause
  // is defending against.
  const bearing = candidate.move ? expandCompassDirection(candidate.move) : null
  const boardAnchor = bearing ? (candidate.boardAnchor ?? null) : null

  return { ok: true, candidate: { ...candidate, boardAnchor, status: 'candidate' } }
}

/* ------------------------------------------------------------------------- *
 * Script repair
 *
 * `docs/LOCAL_AI_BACKGROUND_WORKER.md` section 10. The producer below is the
 * "observe repeated failure" step and nothing further; the draft, the checks
 * and the review gate belong to `aiWorker.ts`, and activation belongs to
 * nobody yet, deliberately.
 * ------------------------------------------------------------------------- */

/** One observed failure of one script. */
export interface ScriptFailure {
  /** `<lang>:<name>`, the same id `read_script` takes. */
  scriptId: string
  /** What the runner reported, verbatim. Normalised only for comparison. */
  error: string
  at: string
}

/**
 * Two error strings are "the same error" when this says so.
 *
 * Whitespace only. It is tempting to strip line numbers and paths so a fault
 * that moved still counts, and that is exactly the change that would make a
 * script fail twice for two different reasons and be repaired as though it
 * had failed twice for one - a producer firing on a pattern that is not
 * there. Under-matching costs a repair job nobody asked for; over-matching
 * costs a patch aimed at the wrong fault, so the conservative direction is
 * the right one to be wrong in.
 */
export function normalizeScriptError(error: string): string {
  return String(error ?? '').trim().replace(/\s+/g, ' ')
}

/** How many of these failures are this script failing this way. */
export function countRepeatedFailures(
  failures: readonly ScriptFailure[],
  scriptId: string,
  error: string
): number {
  const wanted = normalizeScriptError(error)
  if (wanted.length === 0) return 0
  return failures.filter((f) => f.scriptId === scriptId && normalizeScriptError(f.error) === wanted).length
}

export interface ScriptRepairParams {
  jobs: JobStore
  /** `<lang>:<name>`. */
  scriptId: string
  /** Every failure the caller has kept, this one included. */
  failures: readonly ScriptFailure[]
  /** The failure just observed. */
  error: string
  evidenceSeqs: readonly number[]
  now: string
}

/**
 * The only tool a repair job may use.
 *
 * One entry, and it is read-only. A job that could call anything able to
 * write would be one Accept click away from editing a script that is running,
 * which section 10's "never edits a running script" forbids; the allowlist is
 * where that stops being a promise about care and becomes a fact about what
 * the job can express.
 */
const SCRIPT_REPAIR_TOOLS = ['read_script']

/** Below this, a failure is an incident rather than a pattern. Section 10
 * says "observe repeated failure", and one is not repeated. */
const REPAIR_THRESHOLD = 2

/**
 * Ask for a repair to be drafted, once a script has failed the same way twice.
 *
 * Two guards, and both are the same guard the map producer needed. A single
 * failure is noise - a closed door, a moved creature, a disconnect - and
 * drafting a patch for it would put the model to work on a script that is
 * fine. And a job already open on this script covers the next failure too:
 * without the dedupe a script failing in a loop would produce a job per
 * failure, which is a review queue nobody can read.
 */
export function proposeScriptRepair(params: ScriptRepairParams): ProposeResult {
  const count = countRepeatedFailures(params.failures, params.scriptId, params.error)
  if (count < REPAIR_THRESHOLD) {
    return {
      job: null,
      created: false,
      reason: `${params.scriptId} has failed this way ${count} time(s); ${REPAIR_THRESHOLD} are needed before a repair is drafted`,
    }
  }

  const existing = params.jobs
    .all()
    .find((job) => job.kind === 'script_repair' && !isTerminal(job.status) && job.scope.scriptId === params.scriptId)
  if (existing) {
    return { job: existing, created: false, reason: `already covered by ${existing.jobId}` }
  }

  const job = params.jobs.create({
    kind: 'script_repair',
    scope: {
      scriptId: params.scriptId,
      error: normalizeScriptError(params.error),
      failureCount: count,
    },
    inputRefs: params.evidenceSeqs.map(eventRef),
    allowedTools: SCRIPT_REPAIR_TOOLS,
    now: params.now,
  })
  return { job, created: true, reason: `${params.scriptId} failed the same way ${count} times` }
}

export type PatchApplication = { ok: true; text: string } | { ok: false; reason: string }

/** Line endings, read off the file rather than assumed. A patched copy that
 * silently converted CRLF to LF would report a diff of every line to anybody
 * who looked at it afterwards. */
function dominantEnding(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? '\r\n' : '\n'
}

/**
 * Apply a unified diff, or refuse and say which line disagreed.
 *
 * Strict on purpose, and the strictness is the feature. Every context and
 * removed line must match the original exactly at the position the hunk
 * header names; a fuzzy applier would produce a plausible file from a patch
 * written against something else, which is the one outcome worse than
 * refusing - `applyUnifiedDiff` returning a *wrong* file would be checked,
 * pass, and reach a reviewer looking correct.
 *
 * Note what it does not do: it never touches a file. It takes text and
 * returns text, so the only thing that can write anything is the caller that
 * was given somewhere to write.
 */
export function applyUnifiedDiff(original: string, diff: string): PatchApplication {
  if (typeof diff !== 'string' || diff.trim().length === 0) {
    return { ok: false, reason: 'the patch was empty' }
  }

  const ending = dominantEnding(original)
  const src = original.split(/\r?\n/)
  const patch = diff.split(/\r?\n/)

  const out: string[] = []
  let cursor = 0
  let hunks = 0

  for (let i = 0; i < patch.length; i++) {
    const line = patch[i]
    if (line === undefined) continue
    if (!line.startsWith('@@')) continue

    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!header) return { ok: false, reason: `unreadable hunk header: ${line.slice(0, 60)}` }

    // Unified diffs are 1-based and a hunk that removes nothing starts at 0.
    const start = Math.max(0, Number(header[1]) - 1)
    if (start < cursor) {
      return { ok: false, reason: `hunk at line ${start + 1} overlaps or precedes the previous one` }
    }
    if (start > src.length) {
      return { ok: false, reason: `hunk starts at line ${start + 1}, past the end of a ${src.length}-line file` }
    }
    for (; cursor < start; cursor++) out.push(src[cursor] as string)

    hunks++
    for (i++; i < patch.length; i++) {
      const body = patch[i] as string
      if (body === undefined) break
      if (body.startsWith('@@')) {
        i--
        break
      }
      // A diff's trailing "\ No newline at end of file" is a note about the
      // file, not a line of it.
      if (body.startsWith('\\')) continue

      const mark = body.length === 0 ? ' ' : body[0]
      const content = body.length === 0 ? '' : body.slice(1)

      if (mark === '+') {
        out.push(content)
        continue
      }
      if (mark === ' ' || mark === '-') {
        if (cursor >= src.length) {
          return { ok: false, reason: `the patch expects a line ${cursor + 1} the file does not have` }
        }
        if (src[cursor] !== content) {
          return {
            ok: false,
            reason: `line ${cursor + 1} does not match the patch: the file has "${(src[cursor] as string).slice(0, 40)}", the patch expects "${content.slice(0, 40)}"`,
          }
        }
        cursor++
        if (mark === ' ') out.push(content)
        continue
      }
      return { ok: false, reason: `unreadable patch line ${i + 1}: ${body.slice(0, 60)}` }
    }
  }

  if (hunks === 0) return { ok: false, reason: 'the patch contained no hunks' }
  for (; cursor < src.length; cursor++) out.push(src[cursor] as string)
  return { ok: true, text: out.join(ending) }
}

export type TargetVerdict = { ok: true } | { ok: false; reason: string }

/** Windows gives the same file two spellings and a case-insensitive
 * filesystem gives it several more, so comparison happens on one form. */
function normalizePath(path: string): string {
  return String(path ?? '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * Where a patched copy is allowed to go, which is nowhere near the original.
 *
 * This is the invariant the whole increment exists for, written as a function
 * so it can be called rather than remembered. Three refusals:
 *
 * - the candidate is the original, which is the failure by its true name;
 * - the candidate is anywhere in the original's directory, which is how a
 *   `.patched` sibling ends up being picked up by a runner that globs a
 *   directory - `python/runner.py` discovers `tasks/user/*` on every call;
 * - the candidate is outside the app data directory, so a workspace with no
 *   configured home cannot fall back to writing beside the thing it copied.
 */
export function validatePatchTarget(params: {
  originalPath: string
  candidatePath: string
  appDataDir: string
}): TargetVerdict {
  const original = normalizePath(params.originalPath)
  const candidate = normalizePath(params.candidatePath)
  const home = normalizePath(params.appDataDir)

  if (home.length === 0) return { ok: false, reason: 'no app data directory is configured to write a candidate into' }
  if (candidate.length === 0) return { ok: false, reason: 'the candidate has no path' }
  if (candidate === original) {
    return { ok: false, reason: 'the candidate path is the script itself; a patch is never written over the original' }
  }
  if (!candidate.startsWith(`${home}/`)) {
    return { ok: false, reason: `the candidate ${params.candidatePath} is outside the app data directory ${params.appDataDir}` }
  }
  const originalDir = original.slice(0, original.lastIndexOf('/'))
  if (originalDir.length > 0 && candidate.startsWith(`${originalDir}/`)) {
    return { ok: false, reason: 'the candidate is in the script directory, where a runner would discover it' }
  }
  return { ok: true }
}
