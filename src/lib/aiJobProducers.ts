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
  /** The job that now covers this room, whether this call made it or an
   * earlier one did. Null when there was nothing to reconcile. */
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
