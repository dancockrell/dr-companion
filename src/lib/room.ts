/**
 * Turning what the bridge reports into cards.
 *
 * The deck a thing belongs to is decided here and nowhere else, because it is
 * the one judgement in the card system that can be wrong in a way that costs
 * the player something: a hostile rendered as allied is worse than no card at
 * all. See DESIGN.md S6.
 */
import type { CharacterStatus } from '../types'
import type { Deck, RoomCard } from './cards'

/**
 * The bare noun out of a display name.
 *
 * `a snarling goblin` becomes `goblin`. Articles and adjectives are dropped
 * from the front; the noun is the last word, which holds for the way the game
 * writes creature names. Used for art and bestiary lookup, never for display.
 */
export function nounOf(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/^(a|an|the|some)\s+/, '')
    .replace(/[^a-z\s'-]/g, '')
    .trim()
  const words = cleaned.split(/\s+/)
  return words[words.length - 1] || cleaned
}

function card(
  deck: Deck,
  name: string,
  status: RoomCard['status'],
  index: number
): RoomCard {
  return {
    id: `${deck}:${index}:${name}`,
    deck,
    name,
    noun: nounOf(name),
    status,
    count: 1,
  }
}

/**
 * Build the three decks from a character status.
 *
 * Group members are people rather than allies: the Allied deck is for things
 * fighting on your side that are not players, and a grouped player is someone
 * you can talk to. Conflating them would put your friends in the same visual
 * bucket as a summoned animal.
 */
export function fromRoom(character: CharacterStatus | null | undefined): RoomCard[] {
  if (!character) return []

  const cards: RoomCard[] = []
  let i = 0

  for (const name of character.roomCreatures ?? []) {
    cards.push(card('hostile', name, 'alive', i++))
  }
  for (const name of character.roomDeadCreatures ?? []) {
    cards.push(card('hostile', name, 'dead', i++))
  }
  for (const name of character.roomAllies ?? []) {
    cards.push(card('allied', name, 'alive', i++))
  }

  const group = new Set(character.groupMembers ?? [])
  for (const name of character.roomPlayers ?? []) {
    cards.push(card('people', name, 'alive', i++))
  }
  // Group members who are not in the room still matter: knowing your healer
  // is not here is the point of having a group list at all.
  for (const name of group) {
    if (!(character.roomPlayers ?? []).includes(name)) {
      cards.push(card('people', name, 'alive', i++))
    }
  }

  return cards
}
