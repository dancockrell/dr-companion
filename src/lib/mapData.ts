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
  /** bank, healer, guild and so on, read off the name at build time. */
  kind?: string
  /** The street or place: what a player says when asked where they are. */
  place?: string
  x: number
  y: number
  z: number
  exits: { dir: string; move: string; to: number }[]
}
interface BuiltZone {
  id: number
  name: string
  rooms: BuiltRoom[]
}

export interface ZoneSummary {
  id: number
  name: string
  rooms: number
}

/** Vite resolves these at build time; only the requested zone is fetched. */
const ZONES = import.meta.glob<{ default: BuiltZone }>('../data/map/*.json')

const cache = new Map<number, MapZone>()

/** The Crossing. Where new characters start, and the busiest zone in the game. */
export const DEFAULT_ZONE = 1

export async function zoneIndex(): Promise<ZoneSummary[]> {
  const load = ZONES['../data/map/index.json']
  if (!load) return []
  const mod = (await load()) as unknown as { default: ZoneSummary[] }
  return mod.default
}

/**
 * Exits are directional and the drawing is not: a one-way arc still needs a
 * line, and drawing it twice from both ends is the same line.
 */
function toZoneRoom(r: BuiltRoom): MapZoneRoom {
  return {
    id: r.id,
    uid: null,
    title: r.name,
    x: r.x,
    y: r.y,
    z: r.z,
    // 1,863 rooms across the game say what kind of place they are, and the
    // canvas already colours by tag, so the classification travels as one.
    tags: r.kind ? [r.kind] : [],
    to: r.exits.map((e) => e.to),
  }
}

export async function loadZone(id: number): Promise<MapZone | null> {
  const hit = cache.get(id)
  if (hit) return hit

  const load = ZONES[`../data/map/${id}.json`]
  if (!load) return null

  const zone = (await load()).default
  const built: MapZone = {
    ok: true,
    zone: String(zone.id),
    name: zone.name,
    here: null,
    total: zone.rooms.length,
    truncated: false,
    rooms: zone.rooms.map(toZoneRoom),
  }
  cache.set(id, built)
  return built
}

/** The movement command for one step, so a route can be walked rather than read. */
export async function moveBetween(
  zoneId: number,
  from: number,
  to: number
): Promise<string | null> {
  const load = ZONES[`../data/map/${zoneId}.json`]
  if (!load) return null
  const zone = (await load()).default
  const room = zone.rooms.find((r) => r.id === from)
  return room?.exits.find((e) => e.to === to)?.move ?? null
}
