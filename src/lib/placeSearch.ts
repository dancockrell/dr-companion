/**
 * Finding a place by name, across every zone.
 *
 * This is the thing the companion can do that Genie's map cannot. Genie draws
 * the same 3,174 labels and leaves you to find the Bathhouse with your eyes;
 * here you type "bath" and it tells you where it is, in which zone, and how
 * the cartographer spelled it.
 *
 * Aliases matter more than they look. The map notes carry 1,860 of them —
 * "Town Green|TGN|Wanted Board" — which are the names players actually use in
 * conversation. Searching only the primary name would miss every one.
 */

export interface Place {
  /** Zone id and room id, the key the map draws by. */
  zone: string
  zoneName: string
  room: number
  label: string
  aliases?: string[]
}

export interface PlaceHit extends Place {
  /** Higher is better. Exact beats prefix beats contains beats alias. */
  score: number
  /** Which spelling matched, when it was not the primary name. */
  matched: string
}

const norm = (s: string) => s.toLowerCase().trim()

/**
 * Rank one place against a query.
 *
 * Exact and prefix matches are separated by a wide margin because a player
 * typing "bank" wants the bank, not Bankside Alley, and a search that buries
 * the obvious answer under near-misses is worse than no search.
 */
function scoreOne(place: Place, q: string): PlaceHit | null {
  const names = [place.label, ...(place.aliases ?? [])]
  let best: PlaceHit | null = null

  for (const name of names) {
    const n = norm(name)
    const primary = name === place.label
    let score = -1

    if (n === q) score = primary ? 100 : 90
    else if (n.startsWith(q)) score = primary ? 70 : 60
    else if (n.includes(q)) score = primary ? 40 : 30
    // A query of several words matches a name containing all of them, so
    // "provincial bank" finds "First Provincial Bank".
    else if (q.split(/\s+/).every((w) => n.includes(w))) score = primary ? 25 : 20

    if (score > (best?.score ?? -1)) best = { ...place, score, matched: name }
  }

  return best && best.score >= 0 ? best : null
}

/**
 * Search every place. Shorter names win ties, because "Bank" is a better
 * answer than "Bank Street Tannery" for the query "bank".
 */
export function searchPlaces(query: string, places: Place[], limit = 12): PlaceHit[] {
  const q = norm(query)
  if (q.length < 2) return []

  return places
    .map((p) => scoreOne(p, q))
    .filter((h): h is PlaceHit => h !== null)
    .sort((a, b) => b.score - a.score || a.label.length - b.label.length)
    .slice(0, limit)
}
