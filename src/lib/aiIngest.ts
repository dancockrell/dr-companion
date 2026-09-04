/**
 * Turning the app's own already-parsed state into journal events and alerts.
 *
 * Split from `aiWorkerHost.ts` so it can be tested without React, without a
 * socket, and without dragging the Tauri client chain into a unit test - the
 * same reason `shouldPublish` sits apart from the hook that calls it.
 *
 * Both decisions here fail silently when wrong. Ingesting from the wrong
 * offset duplicates every line or skips a batch with nothing thrown, and a
 * disconnect alert that fires at startup teaches a player to ignore the one
 * priority that must never be ignored.
 */
import type { EventJournal } from './aiEventJournal.ts'

/** Situation flags that mean something is wrong right now. Taken from the
 * game's own already-parsed indicator set, not inferred from text. */
const URGENT_SITUATIONS = ['stunned', 'webbed', 'immobilized', 'dying'] as const

export interface IngestResult {
  appended: number
  /** Lines the display buffer discarded before this host could journal them.
   * Reported rather than absorbed: a silent gap here is indistinguishable
   * from a quiet game. */
  missed: number
  ingested: number
}

/**
 * Append whatever is new since `alreadyIngested`.
 *
 * Pure enough to test directly, which is the point: the subtle part is not
 * the React wiring but deciding which lines are new, and getting that wrong
 * either duplicates events or loses them silently.
 */
export function ingestLines(
  journal: EventJournal,
  lines: ReadonlyArray<{ text: string; stream: string; at?: number }>,
  alreadyIngested: number,
  dropped = 0,
  droppedAlreadySeen = 0
): IngestResult {
  const missed = Math.max(0, dropped - droppedAlreadySeen)
  const start = Math.max(0, Math.min(alreadyIngested, lines.length))
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    journal.append('line', { text: line.text, stream: line.stream }, line.at ?? 0)
  }
  return { appended: lines.length - start, missed, ingested: lines.length }
}

/**
 * Turn already-parsed state into alerts.
 *
 * Returns what should be raised rather than raising it, so the mapping can be
 * tested without a broker and so the caller keeps control of ordering.
 */
export function deriveAlerts(state: {
  situation: readonly string[] | undefined
  bridgeConnected: boolean
  everConnected: boolean
}): Array<{ priority: 'critical' | 'urgent'; key: string; detail: unknown }> {
  const out: Array<{ priority: 'critical' | 'urgent'; key: string; detail: unknown }> = []

  // Only after a connection has existed. A client that has not connected yet
  // is not disconnected, and starting up in a permanent critical alert would
  // train a player to ignore the one state that must never be ignored.
  if (state.everConnected && !state.bridgeConnected) {
    out.push({ priority: 'critical', key: 'bridge-disconnected', detail: {} })
  }

  for (const flag of state.situation ?? []) {
    if ((URGENT_SITUATIONS as readonly string[]).includes(flag)) {
      out.push({ priority: 'urgent', key: `situation:${flag}`, detail: { flag } })
    }
  }
  return out
}
