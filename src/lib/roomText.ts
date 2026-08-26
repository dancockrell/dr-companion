/**
 * The description of the room you are standing in.
 *
 * Loaded per zone and cached, the same way the map is, because 17,736 room
 * descriptions are 5.1 MB of prose and the column needs one of them at a time.
 *
 * Where the text comes from is worth stating plainly: it is mined from
 * Elanthipedia, not from the game. The game prints its own description on
 * arrival and that one is better — it knows the weather, the hour, and what is
 * currently on fire. When the bridge starts forwarding it, live text should
 * win. What this provides is a description for every room in Elanthia,
 * including the ones the character has never walked into, so the column has
 * something to say while you are reading the map rather than walking it.
 */

export interface RoomText {
  title: string | null
  text: string | null
}

const cache = new Map<string, Record<string, RoomText>>()
const pending = new Map<string, Promise<Record<string, RoomText>>>()

/**
 * One zone's descriptions.
 *
 * Concurrent calls for the same zone share a request. Without that, walking
 * quickly through a gate fires the same 413 KB fetch several times before the
 * first lands.
 */
async function loadZoneText(zone: string): Promise<Record<string, RoomText>> {
  const hit = cache.get(zone)
  if (hit) return hit

  const inflight = pending.get(zone)
  if (inflight) return inflight

  const p = fetch(`/roomtext/${zone}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, RoomText>>) : {}))
    .catch(() => ({}) as Record<string, RoomText>)
    .then((data) => {
      cache.set(zone, data)
      pending.delete(zone)
      return data
    })

  pending.set(zone, p)
  return p
}

/** The description for one room, or null while it loads or if there is none. */
export async function roomTextFor(zone: string, room: number): Promise<RoomText | null> {
  const all = await loadZoneText(zone)
  return all[`${zone}-${room}`] ?? null
}

/** Synchronous read, for a zone already fetched. Null means "not yet". */
export function cachedRoomText(zone: string, room: number): RoomText | null {
  return cache.get(zone)?.[`${zone}-${room}`] ?? null
}

/**
 * Where the rendered scene lives, if it has been rendered.
 *
 * The daemon slugs "1-11" to "1-11", so the key and the filename are the same
 * string. Kept as a function anyway because that is a coincidence of the
 * naming rather than a guarantee.
 */
export const roomArtUrl = (zone: string, room: number) => `/rooms/${zone}-${room}.webp`
