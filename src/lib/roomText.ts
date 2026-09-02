import { grokRoomScene } from '../data/grokRoomScenes.ts'
import { roomScenePattern } from '../data/roomScenePatterns.ts'
import { DEMO_INVASION_ROOM, DEMO_INVASION_ROOM_TEXT } from '../data/demoInvasionRoom.ts'

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

/** Live game presentation wins as one coherent source; static text is fallback. */
export function resolveRoomPresentation(
  live: RoomText | null | undefined,
  mappedTitle: string | null | undefined,
  fallback: RoomText | null | undefined
): RoomText {
  if (live) return { title: live.title ?? mappedTitle ?? fallback?.title ?? null, text: live.text }
  return { title: mappedTitle ?? fallback?.title ?? null, text: fallback?.text ?? null }
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
  return all[`${zone}-${room}`]
    ?? (zone === '1' && room === DEMO_INVASION_ROOM ? DEMO_INVASION_ROOM_TEXT : null)
}

/** Synchronous read, for a zone already fetched. Null means "not yet". */
export function cachedRoomText(zone: string, room: number): RoomText | null {
  return cache.get(zone)?.[`${zone}-${room}`]
    ?? (zone === '1' && room === DEMO_INVASION_ROOM ? DEMO_INVASION_ROOM_TEXT : null)
}

/**
 * Where the rendered scene lives, if it has been rendered.
 *
 * Selection follows the current production art contract: every literal scene
 * must come from the reviewed Grok pack. Location-aware place families go
 * first, then the conservative live-text selector. Either layer may decline
 * to answer; the backdrop's neutral fingerprint is the final honest fallback.
 *
 * The old per-room and local archetype renders are intentionally absent here.
 * Keeping them as "temporary" filler made them effectively permanent and put
 * visibly soft 336x192 images back into the full battle canvas. A missing
 * scene is now represented honestly instead of by art we already rejected.
 */
export type RoomArtLayer = 'grok-place-pattern' | 'grok-text' | 'fingerprint'

export function roomArtSelection(zone: string, room: number, title?: string | null, text?: string | null): {
  url: string | null
  layer: RoomArtLayer
} {
  const patterned = roomScenePattern(zone, room)
  if (patterned) return { url: patterned, layer: 'grok-place-pattern' }
  const textFallback = grokRoomScene(zone, room, title, text)
  if (textFallback) return { url: textFallback, layer: 'grok-text' }
  return { url: null, layer: 'fingerprint' }
}

export const roomArtUrl = (zone: string, room: number, title?: string | null, text?: string | null) =>
  roomArtSelection(zone, room, title, text).url
