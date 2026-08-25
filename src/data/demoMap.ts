/**
 * A small invented map, for the demo only.
 *
 * **None of this is Elanthia.** The room ids, coordinates and names are made
 * up, and deliberately so: the real map belongs to Lich, keyed to Lich's own
 * room ids, and a hand-written copy of real geography here would be a second
 * source of truth that could disagree with the one `#goto` uses. The names are
 * generic on purpose so nobody mistakes this for the Crossing.
 *
 * It exists because the demo is what people see first. A map panel that sits
 * empty until a bridge is connected teaches the wrong lesson about whether the
 * feature works — and the demo is also the only place this panel can be
 * exercised without a character logged in.
 *
 * Shape matches what the bridge sends for a real zone, so the panel has no
 * demo-specific branch: same fields, same two id systems, same zone-local
 * coordinates.
 */
import type { MapZone } from '../bridge/types'

/**
 * Laid out as a small town: a square with roads off it, a bank and a healer
 * flanking, and a short stair up to an upper floor so the level switcher has
 * something to switch between.
 */
export const DEMO_ZONE: MapZone = {
  ok: true,
  zone: 'demo',
  name: 'Demo Town',
  here: 101,
  total: 12,
  truncated: false,
  rooms: [
    // Ground floor. x grows east, y grows south, matching the source layout.
    { id: 101, uid: 9101, title: 'Town Square', x: 0, y: 0, z: 0, tags: [], to: [102, 104, 106] },
    { id: 102, uid: 9102, title: 'North Road', x: 0, y: -30, z: 0, tags: [], to: [101, 103] },
    { id: 103, uid: 9103, title: 'North Gate', x: 0, y: -60, z: 0, tags: ['gate'], to: [102] },
    { id: 104, uid: 9104, title: 'East Road', x: 30, y: 0, z: 0, tags: [], to: [101, 105, 108] },
    { id: 105, uid: 9105, title: 'Bank Lobby', x: 60, y: 0, z: 0, tags: ['bank'], to: [104] },
    { id: 106, uid: 9106, title: 'West Road', x: -30, y: 0, z: 0, tags: [], to: [101, 107] },
    { id: 107, uid: 9107, title: 'Healer', x: -60, y: 0, z: 0, tags: ['healer'], to: [106] },
    { id: 108, uid: 9108, title: 'South Lane', x: 30, y: 30, z: 0, tags: [], to: [104, 109] },
    { id: 109, uid: 9109, title: 'Stair Foot', x: 30, y: 60, z: 0, tags: [], to: [108, 110] },

    // Upstairs. Shares x/y with the floor below, which is exactly why levels
    // are drawn separately rather than all at once.
    { id: 110, uid: 9110, title: 'Stair Head', x: 30, y: 60, z: 1, tags: [], to: [109, 111] },
    { id: 111, uid: 9111, title: 'Upper Hall', x: 30, y: 30, z: 1, tags: [], to: [110, 112] },
    { id: 112, uid: 9112, title: 'Guild Office', x: 30, y: 0, z: 1, tags: ['guildleader'], to: [111] },
  ],
}

/** Rooms reachable from `from`, breadth-first — the demo's stand-in for Lich's Dijkstra. */
export function demoPath(from: number, to: number): number[] | null {
  const byId = new Map(DEMO_ZONE.rooms!.map((r) => [r.id as number, r]))
  if (!byId.has(from) || !byId.has(to)) return null
  if (from === to) return []

  const prev = new Map<number, number>()
  const seen = new Set([from])
  const queue = [from]

  while (queue.length) {
    const at = queue.shift() as number
    for (const next of byId.get(at)?.to ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, at)
      if (next === to) {
        const path = [to]
        let step = to
        while (prev.get(step) !== from) {
          step = prev.get(step) as number
          path.push(step)
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}
