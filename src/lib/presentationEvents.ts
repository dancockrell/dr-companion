import type { Sourced, StreamIndicators } from '../types/stream.ts'
import type { PresentationEvent } from './viewerClient.ts'

export type NormalizedPresentationEvent = Omit<PresentationEvent, 'protocol' | 'sequence'>
export interface IndicatorEventCursor {
  context: string
  at: number
  indicators: StreamIndicators
}

/** Confirmed DR indicator transitions only. Initial state, unknown values and
 * reconnect snapshots are observations, never fabricated action outcomes.
 * Wire shapes are capture-checked in tools/stream-state-test.mjs. */
export function normalizeIndicatorEvents(
  previous: IndicatorEventCursor | null,
  observation: { roomId: string; generation: number; ready: boolean; indicators: Sourced<StreamIndicators> }
): { cursor: IndicatorEventCursor | null; events: NormalizedPresentationEvent[] } {
  if (!observation.ready || !observation.roomId || observation.indicators.from !== 'stream') {
    return { cursor: null, events: [] }
  }
  const context = `${observation.generation}:${observation.roomId}`
  const cursor = { context, at: observation.indicators.at, indicators: { ...observation.indicators.value } }
  if (!previous || previous.context !== context || cursor.at < previous.at) {
    return { cursor: previous?.context === context ? previous : cursor, events: [] }
  }
  const events: NormalizedPresentationEvent[] = []
  for (const flag of ['stunned', 'webbed', 'immobilized']) {
    const before = previous.indicators[flag]
    const after = cursor.indicators[flag]
    if ((before === 'on' || before === 'off') && (after === 'on' || after === 'off') && before !== after) {
      events.push({ kind: 'status-change', roomId: observation.roomId,
        authoritativeText: `DragonRealms indicator ${flag}: ${after === 'on' ? 'active' : 'cleared'}` })
    }
  }
  return { cursor, events }
}
