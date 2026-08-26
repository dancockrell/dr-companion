/**
 * Where you have just been.
 *
 * Genie draws the room you are standing in and nothing else, which is the
 * right answer when you are walking somewhere yourself and a poor one the rest
 * of the time. Scripts run for an hour. You come back to the window and the
 * only question worth asking is what it has been doing, and the current room
 * cannot answer it: a hunting loop and a stuck script look identical when all
 * you can see is one lit square.
 *
 * A trail answers it at a glance. Twelve rooms in a tight circuit is a working
 * loop. One room for the last forty visits is a script wedged against a locked
 * door. Nothing at all is a bridge that has stopped talking.
 *
 * Two separate things are tracked because they answer different questions.
 * The ordered trail is where you went, and fades with age. The tally is where
 * you spend your time, and does not fade — in a training loop the tally is the
 * shape of the loop itself.
 */

/** Rooms kept in the trail. */
const TRAIL = 40

/**
 * Rooms kept in the tally.
 *
 * Larger than the trail because the tally is the long answer. It is still
 * bounded: a session that ran overnight should not carry ten thousand ids
 * through every render.
 */
const TALLY = 400

export interface Trail {
  /** Most recent last. Consecutive duplicates collapsed. */
  recent: number[]
  /** Room id to visit count, across the session. */
  visits: Record<number, number>
}

export const emptyTrail = (): Trail => ({ recent: [], visits: {} })

/**
 * Record arriving somewhere.
 *
 * Standing still does not extend the trail. The bridge re-sends the room on
 * every prompt, so without this a character idling in one room would fill the
 * whole trail with that room inside a minute and erase the route that got them
 * there.
 */
export function visit(trail: Trail, id: number | null | undefined): Trail {
  if (id === null || id === undefined) return trail
  if (trail.recent[trail.recent.length - 1] === id) return trail

  const recent = [...trail.recent, id].slice(-TRAIL)
  const visits = { ...trail.visits, [id]: (trail.visits[id] ?? 0) + 1 }

  // Drop the least-visited once the tally grows past its bound. Least-visited
  // rather than oldest, because the point of the tally is the places you keep
  // returning to and those are exactly the ones an oldest-first rule would
  // discard on a long run.
  const keys = Object.keys(visits)
  if (keys.length > TALLY) {
    const ranked = keys.sort((a, b) => visits[Number(b)] - visits[Number(a)]).slice(0, TALLY)
    const kept: Record<number, number> = {}
    for (const k of ranked) kept[Number(k)] = visits[Number(k)]
    return { recent, visits: kept }
  }

  return { recent, visits }
}

/**
 * How fresh each room in the trail is, from 0 to 1, with 1 being where you are.
 *
 * A room visited more than once in the trail keeps its freshest value, so a
 * circuit does not dim the parts of itself it passed through earlier.
 */
export function recency(trail: Trail): Map<number, number> {
  const out = new Map<number, number>()
  const n = trail.recent.length
  if (n === 0) return out
  trail.recent.forEach((id, i) => {
    const fresh = n === 1 ? 1 : i / (n - 1)
    const prev = out.get(id)
    if (prev === undefined || fresh > prev) out.set(id, fresh)
  })
  return out
}

/**
 * Consecutive pairs, oldest first, for drawing the stroke.
 *
 * Pairs rather than a single polyline because the trail is not always
 * continuous: going up a staircase, through a zone edge or into a building
 * moves you somewhere with no drawable line between the two. The caller drops
 * the pairs it cannot draw and keeps the rest, which leaves a dashed-looking
 * route rather than a line shooting across the chart.
 */
export function segments(trail: Trail): Array<{ from: number; to: number; fresh: number }> {
  const out: Array<{ from: number; to: number; fresh: number }> = []
  const n = trail.recent.length
  for (let i = 1; i < n; i++) {
    out.push({ from: trail.recent[i - 1], to: trail.recent[i], fresh: i / (n - 1) })
  }
  return out
}

/**
 * What the trail says, in one line.
 *
 * This is the whole point of keeping it: a sentence you can read from across
 * the room without counting squares.
 */
export function describeTrail(trail: Trail): string {
  const n = trail.recent.length
  if (n === 0) return 'no movement yet'

  const distinct = new Set(trail.recent).size
  if (distinct === 1) {
    // The trail collapses consecutive repeats, so it always reads 1 here. The
    // tally is the one that knows how long you have been standing there.
    const held = trail.visits[trail.recent[0]] ?? 1
    return held > 1 ? `held in one room, ${held} arrivals` : 'held in one room'
  }

  const top = Object.entries(trail.visits).sort((a, b) => b[1] - a[1])[0]
  const loop = distinct <= 12 && n >= distinct * 2
  if (loop) return `circling ${distinct} rooms, most time in room ${top[0]}`
  return `${distinct} rooms in the last ${n} moves`
}
