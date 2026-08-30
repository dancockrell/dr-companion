/**
 * A real player's own submitted portrait, keyed by character name.
 *
 * Deliberately separate from creatureArt.ts even though the shape is
 * identical, because the two answer different questions and must never be
 * allowed to collide: creatureArt is "does the bestiary have art for this
 * noun", playerArt is "did this specific person submit their own picture".
 * A player named after a creature (or a creature sharing a player's name,
 * which DragonRealms does not prevent) must never accidentally borrow the
 * other's art — separate manifests, separate folders, separate lookup.
 *
 * The game's own `room players` stream gives a name and nothing else — see
 * RoomPlayer in types/stream.ts, which has no gender or guild field at all.
 * So there is no "default by gender and class" for a real player the way
 * there can be for a researched NPC: the only honest states are "this exact
 * person submitted art" and "unknown", never a guess dressed as a default.
 * See docs/PLAYER-ART.md for how a player actually gets their own picture in.
 */

const BASE = '/player-art/'

const slug = (s: string) =>
  s.toLowerCase().replace(/^(a|an|the)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export function playerArtFile(name: string): string {
  return slug(name)
}

export function playerArtUrl(name: string): string {
  return `${BASE}${playerArtFile(name)}.webp`
}

const known = new Map<string, boolean>()

export function registerPlayerArtManifest(names: Iterable<string>): void {
  for (const n of names) known.set(playerArtFile(n.replace(/\.webp$/i, '')), true)
}

/** Same absent-is-normal shape as loadArtManifest — most players never submit one. */
export async function loadPlayerArtManifest(url = `${BASE}manifest.json`): Promise<number> {
  try {
    const res = await fetch(url)
    if (!res.ok) return 0
    const body: unknown = await res.json()
    if (!Array.isArray(body)) return 0
    const clean = body.filter((k): k is string => typeof k === 'string')
    registerPlayerArtManifest(clean)
    return clean.length
  } catch {
    return 0
  }
}

export function notePlayerArtLoaded(name: string): void {
  known.set(playerArtFile(name), true)
}

export function notePlayerArtMissing(name: string): void {
  known.set(playerArtFile(name), false)
}

/** Test seam. Nothing in the app calls this. */
export function resetPlayerArtCache(): void {
  known.clear()
}

export interface PlayerArtSource {
  name: string
  url: string
}

/** The picture to draw for this exact person, or nothing. See artFor's own doc comment. */
export function playerArtFor(name: string): PlayerArtSource | undefined {
  return known.get(playerArtFile(name)) === true ? { name, url: playerArtUrl(name) } : undefined
}
