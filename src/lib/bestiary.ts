/**
 * What we know about a creature, looked up from the scraped bestiary.
 *
 * Built by tools/bestiary-index.mjs from data/elanthipedia/bestiary.json.
 * 15 KB gzipped, so it ships with the app rather than being fetched: this data
 * is useful in the middle of a fight and a network round trip is not.
 *
 * Two indexes and a deliberate gap between them. 773 creatures share only 408
 * nouns, so `troll` alone cannot say which of fourteen trolls this is. The
 * by-noun index therefore carries only the fields every candidate agrees on:
 * all fourteen trolls have boxes, so that shows; they disagree on level, so
 * the level is absent rather than guessed. A card that says nothing is
 * recoverable. A card that confidently says the wrong level gets someone
 * killed.
 */
import data from '../data/bestiary.json' with { type: 'json' }
import type { RoomCard } from './cards'

type Lore = NonNullable<RoomCard['lore']>

const byName = data.byName as Record<string, Lore>
const byNoun = data.byNoun as Record<string, Lore>

const normalise = (s: string) =>
  s.toLowerCase().replace(/^(a|an|the|some)\s+/, '').replace(/[^a-z\s'-]/g, '').trim()

/**
 * Look up a creature by its display name, falling back to its noun.
 *
 * The game writes `a snarling goblin`; the wiki may have that exact creature,
 * or only `goblin`. Exact first, because it is the only one that can carry a
 * level safely.
 */
export function loreFor(name: string, noun: string): Lore | undefined {
  const exact = byName[normalise(name)]
  if (exact) return exact

  // Some names carry a state the wiki does not, such as a corpse line.
  const trimmed = normalise(name).replace(/\s+which appears dead$/, '')
  const near = byName[trimmed]
  if (near) return near

  return byNoun[noun]
}

/** True when the lookup could only answer from the ambiguous noun index. */
export function isApproximate(name: string, noun: string): boolean {
  const trimmed = normalise(name).replace(/\s+which appears dead$/, '')
  return !byName[normalise(name)] && !byName[trimmed] && byNoun[noun] !== undefined
}
