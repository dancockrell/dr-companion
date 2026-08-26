/**
 * The card model: three decks, five compression tiers.
 *
 * Design in docs/DESIGN.md S6. The short version is that a card must never
 * lose its deck or its count, however little room there is, and the exposed
 * sliver of a fanned card carries status before it carries anything else.
 */

/** Which deck a card belongs to. Never inferred, always set by the source. */
export type Deck = 'hostile' | 'allied' | 'people'

export const DECKS: Deck[] = ['hostile', 'allied', 'people']

export const DECK_LABEL: Record<Deck, string> = {
  hostile: 'Hostile',
  allied: 'Allied',
  people: 'People',
}

/**
 * Colour and silhouette together, never colour alone: roughly one man in
 * twelve has a colour vision deficiency and this audience skews male and over
 * forty. The corner shape carries the same information as the band.
 */
export const DECK_STYLE: Record<Deck, { band: string; corner: string; text: string }> = {
  hostile: { band: 'bg-danger', corner: 'rounded-none', text: 'text-danger' },
  allied: { band: 'bg-good', corner: 'rounded-tl-lg rounded-br-lg', text: 'text-good' },
  people: { band: 'bg-info', corner: 'rounded-xl', text: 'text-info' },
}

export type CardStatus = 'alive' | 'dead' | 'stunned'

/**
 * What the app actually knows about one thing in the room.
 *
 * `name` and `dead` come from DRRoom, `noun` from the matching GameObj, and
 * everything under `lore` is looked up from the bestiary by noun. There is no
 * health field because Lich has no health to give (S1).
 */
export interface RoomCard {
  id: string
  deck: Deck
  /** Display name, as the game wrote it. */
  name: string
  /** The bare noun, for art and bestiary lookup. */
  noun: string
  status: CardStatus
  /** Several identical nouns collapse into one card with a multiplier. */
  count: number
  /**
   * The lore came from the ambiguous noun index rather than an exact match,
   * so it is what every candidate agreed on and nothing more. The card marks
   * it, because "some troll" and "this troll" are different claims.
   */
  loreApproximate?: boolean
  lore?: {
    level?: number
    minCap?: number
    maxCap?: number
    bodyType?: string
    bodySize?: string
    attackRange?: string
    castsSpells?: boolean
    stealthy?: boolean
    skinnable?: boolean
    hasBoxes?: boolean
    hasCoins?: boolean
    hasGems?: boolean
  }
}

/** Widest first: the first tier that fits is the one used. */
export type Tier = 'full' | 'compact' | 'row' | 'fan' | 'count'

/** Card width in px at each tier. Row spans the container; count has no card. */
export const TIER_WIDTH: Record<Tier, number> = {
  full: 132,
  compact: 76,
  row: 0,
  fan: 22,
  count: 0,
}

/** Gap between cards when they are not overlapping. */
const GAP = 8
/** Below this width a deck gives up on cards and shows its count chip. */
const MIN_USEFUL = 96
/**
 * Rows stop being worth their vertical cost past this many cards.
 *
 * Raised from eight after seeing the fan tier in a real panel: six creatures
 * in a narrow column fanned down to 22px slivers showing one letter each,
 * which is not information. A row carries the whole name and its status in
 * 32px of height. Fanning is for when there are more cards than rows can hold,
 * not for when the panel is merely narrow.
 */
const MAX_ROWS = 14
/** A fan never squeezes tighter than this, it scrolls instead. */
export const MIN_SLIVER = 10

/**
 * Choose a tier from the space available and the number of cards in it.
 *
 * Deliberately not a media query. The panel is resizable and can be torn into
 * its own window, so the viewport says nothing about how much room this deck
 * actually has.
 *
 * `count` is a **width** floor, never a card-count one. An earlier version
 * dropped to `count` when there were too many cards to fan at full sliver
 * width, which had it exactly backwards: a fan is how you show more in less
 * room, so more cards should tighten the fan rather than abandon it. A real
 * hand of cards does not give up and turn into a number.
 */
export function tierFor(width: number, cards: number): Tier {
  if (cards === 0) return 'count'
  if (width < MIN_USEFUL) return 'count'

  const fits = (w: number) => cards * w + (cards - 1) * GAP <= width

  if (fits(TIER_WIDTH.full)) return 'full'
  if (fits(TIER_WIDTH.compact)) return 'compact'
  if (cards <= MAX_ROWS && width >= 130) return 'row'
  return 'fan'
}

/**
 * How much of each fanned card is left showing.
 *
 * Shrinks to fit and stops at MIN_SLIVER, past which the deck scrolls
 * sideways rather than compressing into unreadability.
 */
export function fanSliver(width: number, cards: number): number {
  if (cards <= 1) return TIER_WIDTH.fan
  const room = (width - TIER_WIDTH.compact) / (cards - 1)
  return Math.max(MIN_SLIVER, Math.min(TIER_WIDTH.fan, Math.floor(room)))
}

/**
 * Dead things sort to the back, then stunned to the front of the living,
 * then by name so the order does not jitter between updates.
 */
export function sortCards(cards: RoomCard[]): RoomCard[] {
  const rank = (c: RoomCard) => (c.status === 'dead' ? 2 : c.status === 'stunned' ? 0 : 1)
  return [...cards].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
  )
}

/** Collapse identical nouns into one card carrying a multiplier. */
export function collapse(cards: RoomCard[]): RoomCard[] {
  const by = new Map<string, RoomCard>()
  for (const c of cards) {
    const key = `${c.deck}:${c.noun}:${c.status}`
    const seen = by.get(key)
    if (seen) seen.count += c.count
    else by.set(key, { ...c })
  }
  return [...by.values()]
}
