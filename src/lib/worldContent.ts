/**
 * The batch-derived board content for one zone, loaded the way the map is.
 *
 * `tools/build-world-content.mjs` derives a ground kind, a block kind, a
 * landmark and the boundary edges for every one of the game's 17,750 rooms and
 * commits the result under `src/data/world/`, one file per zone. This is the
 * app's reader for it.
 *
 * Loaded a zone at a time, and for the same reason `mapData.ts` gives for the
 * map: a character is only ever in one zone, and the whole set is 4.6 MB.
 * `import.meta.glob` lets Vite resolve the per-zone modules at build time and
 * fetch only the one asked for.
 *
 * `null` is a real answer and is not an error. A zone id the map does not carry
 * — a sub-map that has appeared in Lich but not in this app's cartography — has
 * no content file, and the caller's job is then to publish a snapshot with no
 * content rather than to invent one. That is the same contract
 * `mapData.ts::loadZone` already has.
 */

/** One room's content, as `tools/build-world-content.mjs` writes it. */
export interface RoomContent {
  id: number
  /** street, path, interior, cave, water, snow, swamp, sand, forest, farmland, grass, rock, unknown. */
  ground: string
  /** Which rule decided `ground`: colour, title, label, zone, neighbour, unknown. */
  rule: string
  /** outdoor-open, building-interior, cave, water. */
  block: string
  /** A `LandmarkKind` from `mapLandmarks.ts`, or null. Not a second opinion: the
   * batch calls `landmarkFor` and carries its answer. */
  landmark: string | null
  classification: {
    tags: string[]
    specialKinds: string[]
    spatialMode: string
    tier: string
  }
  /** Compass sides with nothing walkable on the other side, where the
   * rough-edge boundary kit goes. */
  boundaryEdges: string[]
}

interface ZoneContent {
  schemaVersion: number
  zone: string
  name: string
  counts: { rooms: number; unknown: number }
  rooms: RoomContent[]
}

/** Vite resolves these at build time; only the requested zone is fetched. */
const ZONES = import.meta.glob<{ default: ZoneContent }>([
  '../data/world/*.json',
  '!../data/world/index.json',
])

const cache = new Map<string, Map<number, RoomContent>>()

export async function loadWorldContent(
  zoneId: string | null | undefined
): Promise<Map<number, RoomContent> | null> {
  if (!zoneId) return null
  const hit = cache.get(zoneId)
  if (hit) return hit

  const load = ZONES[`../data/world/${zoneId}.json`]
  if (!load) return null

  const zone = (await load()).default
  const byRoom = new Map(zone.rooms.map((room) => [room.id, room]))
  cache.set(zoneId, byRoom)
  return byRoom
}

/** Test-only: forget what has been loaded, so a case can load a zone twice. */
export function resetWorldContentCache(): void {
  cache.clear()
}
