/**
 * The cartography that ships with the app.
 *
 * 90 zones, 18,490 rooms, 44,864 exits, built by tools/build-map.mjs from the
 * map files already on disk. Real coordinates and real connections, not a
 * placeholder diagram.
 *
 * This is the fallback, not the primary. When Lich is connected its own zone
 * data wins, because it is authoritative about where the character actually is
 * and it carries tags this does not. But a map that is blank until you connect
 * is a map nobody can evaluate, and the demo is how most people will first see
 * this.
 *
 * Loaded a zone at a time. Crossing alone is 1,060 rooms and a character is
 * only ever in one zone, so pulling all 18,490 to draw thirty of them would be
 * waste with no upside.
 */
import type { MapZone, MapZoneRoom } from '../bridge/types'

interface BuiltRoom {
  id: number
  name: string
  /**
   * The cartographer's label for this room, drawn on the map.
   *
   * From the note attribute in the source: "Town Green", "Oxenwaithe Bridge",
   * "Apostle Headquarters". 3,174 of them across the game. This replaced a
   * regex that guessed venues from room titles and found 31.
   */
  label?: string
  gateway?: { zone: string; name: string }
  leaves?: string[]
  /** Other names the same place goes by, for search rather than drawing. */
  aliases?: string[]
  /** The cartographer's own colour for this room. */
  color?: string
  /** The street or place: what a player says when asked where they are. */
  place?: string
  x: number
  y: number
  z: number
  exits: { dir: string; move: string; to: number }[]
}
interface BuiltZone {
  /**
   * A string, not a number.
   *
   * Sub-maps carry ids like 1a, 1j, 107a and TF1 — the interiors and passages
   * hanging off a main zone. Treating ids as integers dropped 36 of 85 zones
   * without a word, including Crossing Temple and the Seacaves.
   */
  id: string
  name: string
  rooms: BuiltRoom[]
}

/** Vite resolves these at build time; only the requested zone is fetched. */
const ZONES = import.meta.glob<{ default: BuiltZone }>('../data/map/*.json')

const cache = new Map<string, MapZone>()

/** The Crossing. Where new characters start, and the busiest zone in the game. */
export const DEFAULT_ZONE = '1'

/**
 * Exits are directional and the drawing is not: a one-way arc still needs a
 * line, and drawing it twice from both ends is the same line.
 */
/**
 * How an exit is taken, which decides how it is drawn.
 *
 * The distinction that matters is walking versus entering: a line between two
 * street rooms is a road, and a line into a shop is a door. Genie draws both
 * the same and players learn the difference by memory.
 */
function kindOfExit(dir: string): 'walk' | 'enter' | 'climb' | 'vertical' {
  if (dir === 'go' || dir === 'out') return 'enter'
  if (dir === 'climb') return 'climb'
  if (dir === 'up' || dir === 'down') return 'vertical'
  return 'walk'
}

function toZoneRoom(r: BuiltRoom): MapZoneRoom {
  return {
    id: r.id,
    uid: null,
    title: r.name,
    x: r.x,
    y: r.y,
    z: r.z,
    // The label travels as the first tag, which is the channel the canvas
    // already draws from.
    tags: r.label ? [r.label] : [],
    to: r.exits.map((e) => e.to),
    mapColour: r.color,
    gateway: r.gateway,
    leaves: r.leaves,
    links: r.exits.map((e) => ({ to: e.to, kind: kindOfExit(e.dir) })),
  }
}

export async function loadZone(id: string): Promise<MapZone | null> {
  const hit = cache.get(id)
  if (hit) return hit

  const load = ZONES[`../data/map/${id}.json`]
  if (!load) return null

  const zone = (await load()).default
  const built: MapZone = {
    ok: true,
    zone: zone.id,
    name: zone.name,
    here: null,
    total: zone.rooms.length,
    truncated: false,
    rooms: zone.rooms.map(toZoneRoom),
  }
  cache.set(id, built)
  return built
}
