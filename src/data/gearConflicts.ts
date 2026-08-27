/**
 * Worn gear that quietly charges you for something unrelated.
 *
 * The case this file was built from, observed verbatim in play on a Circle 1
 * Bard:
 *
 *   The armor on your head makes playing your cocobolo txistu more difficult.
 *
 * That line appears once, when you play. There is no message when the helm
 * comes off, nothing on the character sheet, nothing in PLAY USAGE, and no
 * wiki page carries it. A new Bard wearing the helm they started with trains
 * more slowly than they should, indefinitely, and never learns why.
 *
 * This is the clearest thing the companion is actually for. Everything else it
 * does, a player could do by reading a window. This is a cross-check between
 * two facts that are never on screen together, and the answer is a sentence
 * nobody would otherwise get.
 *
 * ## Why each rule carries the line that proves it
 *
 * A rule here is a claim about the game. Written as bare code it rots the
 * moment the game changes and reads as authoritative forever - and worse, the
 * next person cannot tell an observed rule from one somebody reasoned their way
 * to. So `evidence` is the game's own words and `seen` is when, and a rule
 * with neither has no business being in the list.
 *
 * The reasoning that gets a rule wrong is always available and always
 * plausible. "A helm probably interferes with a lute too" is a decent guess
 * and it is not a fact, and one confident wrong warning costs more than ten
 * missing ones: a player who is told to take off a hat for no benefit stops
 * reading the advice. So the list stays short and observed, and grows when
 * somebody sees a line rather than when somebody has an idea.
 */

export interface GearConflict {
  id: string
  /** Substrings that identify the held item, lowercased. */
  held: string[]
  /** Substrings that identify the worn item, lowercased. */
  worn: string[]
  /** What it costs, in the player's terms. One sentence. */
  cost: string
  /** What to do about it. */
  fix: string
  /** The game's own line. Not a paraphrase. */
  evidence: string
  /** When it was seen, so a stale rule is visible as stale. */
  seen: string
}

/**
 * Wind instruments, which are the ones played with the mouth.
 *
 * A txistu is the observed one. The others are DragonRealms wind instruments
 * and are here because the penalty is plainly about the head rather than about
 * that particular flute - but they have not been confirmed one at a time, and
 * `evidence` says so. If somebody plays a flute in a helm and sees nothing,
 * this list is what to cut.
 */
const WIND = ['txistu', 'flute', 'fife', 'pipes', 'horn', 'whistle', 'ocarina', 'recorder']

/**
 * Worn on the head.
 *
 * Matched by name because that is all the bridge has: `GameObj.inv` gives
 * names, not slots. So this is a word list and it will miss a helm with an
 * unusual name, which is the right way round to be wrong - a missed warning is
 * a warning you never had, and a false one teaches people to ignore the rest.
 */
const HEADGEAR = [
  'helm',
  'helmet',
  'coif',
  'cap',
  'circlet',
  'hood',
  'headband',
  'bandana',
  'crown',
  'mask',
]

export const GEAR_CONFLICTS: GearConflict[] = [
  {
    id: 'headgear-vs-wind',
    held: WIND,
    worn: HEADGEAR,
    cost: 'Playing is harder than it should be, so Performance trains slower.',
    fix: 'Stow what is on your head before you play.',
    evidence:
      'The armor on your head makes playing your cocobolo txistu more difficult.',
    seen: '27 Aug 2026, Phemius, Circle 1 Bard',
  },
]

/**
 * Whole words, not substrings.
 *
 * The first version used `includes`, and its own test caught it inside a
 * minute: "an embroidered caparison" contains "cap", so a horse blanket was
 * classified as headgear and a player would have been told to take off their
 * hat while wearing no hat. That is exactly the false warning this file's
 * header argues is more expensive than a missed one, written by the same hand
 * that argued it.
 *
 * Word sets rather than a regular expression, deliberately. A `\b`-anchored
 * pattern would work and is one backslash away from silently matching nothing
 * - on this machine that escape has been mangled in transit more than once,
 * and a regex that compiles and matches nothing looks exactly like a rule that
 * never applies. There is nothing to escape here.
 *
 * The cost is compounds: "bagpipes" is one word and will not match "pipes". So
 * this errs toward missing a warning rather than inventing one, which is the
 * right side to be wrong on, and the fix when somebody sees the line in play
 * is to add the word they actually saw.
 */
const wordsOf = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter(Boolean))

const hit = (needles: string[], hay: string) => {
  const words = wordsOf(hay)
  return needles.find((n) => words.has(n))
}

/**
 * Which rules apply right now.
 *
 * Both sides have to be present. Holding a flute with nothing on your head is
 * fine, and a helm with empty hands is fine, and saying anything in either case
 * would be the app talking for the sake of it.
 *
 * Hands and worn come from different payloads and either can be absent - the
 * bridge sends worn names only from a version that has them, and an older
 * bridge sends none at all. Absent is not empty: with no worn list there is
 * nothing to check and nothing is claimed, rather than a cheerful all-clear.
 */
export function gearConflicts(
  hands: { left?: string | null; right?: string | null } | null | undefined,
  worn: string[] | null | undefined
): GearConflict[] {
  if (!hands || !worn || worn.length === 0) return []

  const held = [hands.left, hands.right].filter(Boolean).join(' ').toLowerCase()
  if (!held) return []
  const wornText = worn.join(' ').toLowerCase()

  return GEAR_CONFLICTS.filter((c) => hit(c.held, held) && hit(c.worn, wornText))
}

/**
 * The offending pair, for a message that names things rather than categories.
 *
 * "Something on your head is slowing your playing" is a worse sentence than
 * "your coarse onyx-hide helm is slowing your cocobolo txistu", and the second
 * one is available: the words are already in the payload.
 */
export function conflictSubjects(
  c: GearConflict,
  hands: { left?: string | null; right?: string | null },
  worn: string[]
): { held: string | null; worn: string | null } {
  const heldItem =
    [hands.right, hands.left].find(
      (h) => h && hit(c.held, h.toLowerCase())
    ) ?? null
  const wornItem = worn.find((w) => hit(c.worn, w.toLowerCase())) ?? null
  return { held: heldItem, worn: wornItem }
}
