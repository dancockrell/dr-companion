/**
 * Getting the place list in front of the search.
 *
 * Kept out of placeSearch.ts on purpose. tools/place-test.mjs transpiles that
 * file and runs it under plain Node, where `import.meta.glob` is not a
 * function and the module would fail to evaluate. The ranking stays testable
 * without a bundler standing behind it, and the bundler-only part lives here.
 *
 * Fetched when someone reaches for the box, not at startup. The index is
 * 106 KB against 3.7 MB of zone files, and most sessions never search at all,
 * so this is a chunk of its own rather than weight every launch pays for.
 */
import type { Place } from './placeSearch'

/**
 * What tools/build-places.mjs writes.
 *
 * Rows are positional, `[zone, room, label, aliases?]`, and zone names are
 * held once in a lookup. Spelling out five keys and "Northern Trade Road" on
 * every one of 3,174 rows more than doubled the file for nothing the search
 * reads differently.
 */
interface PackedIndex {
  zones: Record<string, string>
  places: [string, number, string, string[]?][]
}

/** Vite resolves this at build time and fetches it only when asked. */
const INDEX = import.meta.glob<{ default: PackedIndex }>('../data/places.json')

let cached: Place[] | null = null
let inFlight: Promise<Place[]> | null = null

async function fetchPlaces(): Promise<Place[]> {
  const load = INDEX['../data/places.json']
  // An index that was never built gives an empty list rather than an
  // exception. The box then says nothing matches, which is wrong but visible,
  // where a throw under a keystroke would take the whole map panel down.
  if (!load) return []

  const { zones, places } = (await load()).default
  return places.map(([zone, room, label, aliases]) => ({
    zone,
    zoneName: zones[zone] ?? zone,
    room,
    label,
    aliases,
  }))
}

/**
 * The whole searchable list, loaded once.
 *
 * Both the promise and the result are held, because focus and the first
 * keystroke can arrive in the same frame and two fetches of the same 106 KB
 * is a bug nobody would ever see and everybody would pay for.
 */
export function loadPlaces(): Promise<Place[]> {
  if (cached) return Promise.resolve(cached)
  if (!inFlight) inFlight = fetchPlaces().then((p) => (cached = p))
  return inFlight
}
