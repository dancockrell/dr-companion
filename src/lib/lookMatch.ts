/**
 * Reading a character's LOOK, so a portrait can be suggested rather than picked.
 *
 * DragonRealms prints a character as a fixed sentence pattern, and that pattern
 * is parseable:
 *
 *   "You see High Priest Aetherie Daan'sawil, Reborn in Flames, an Elothean.
 *    Aetherie has an angular face with frown lines around his mouth and tilted
 *    almond-shaped red eyes. His grey hair is short and wavy, and is worn
 *    tangled. He has fair skin and a lean build."
 *
 * Race, sex, eyes, hair, skin and build are all in there. The vocabulary comes
 * from 391 player descriptions mined off Elanthipedia, which is how we know
 * "tilted almond-shaped" is an Elothean marker at 56% against 3-13% elsewhere
 * rather than an author's flourish.
 *
 * The point is a suggestion, never a decision. A player uploads their own
 * portrait if they have one; this is for the other case, where a new character
 * would otherwise be handed an empty rectangle or a menu of 22 faces.
 */

export interface LookFeatures {
  race?: string
  sex?: 'male' | 'female'
  hairColour?: string
  hairLength?: string
  eyeColour?: string
  eyeShape?: string
  skin?: string
  build?: string
}

const RACES = [
  'Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', "Gor'Tog",
  "S'Kra Mur", 'Prydaen', 'Rakash', 'Kaldar', 'Elothean',
]

const COLOURS =
  'black|white|grey|gray|silver|blonde|blond|brown|auburn|red|russet|chestnut|golden|amber|hazel|green|blue|violet|azure|copper|sable|ivory|ebony'

const pick = (text: string, re: RegExp) => re.exec(text)?.[1]?.toLowerCase()

/**
 * Pull what we can out of a LOOK. Everything is optional: descriptions are
 * player-written and many leave fields out entirely.
 */
export function parseLook(look: string): LookFeatures {
  const t = look.replace(/\s+/g, ' ')

  const race = RACES.find((r) => new RegExp(`\\b${r.replace(/'/g, "'?")}\\b`, 'i').test(t))

  // Pronouns are more reliable than any title: "His grey hair" appears in
  // almost every male description and titles vary by guild and rank.
  const male = /\b(his|he|him)\b/i.test(t)
  const female = /\b(her|she|hers)\b/i.test(t)

  return {
    race,
    sex: male && !female ? 'male' : female && !male ? 'female' : undefined,
    hairColour: pick(t, new RegExp(`(${COLOURS})\\s+hair`, 'i')),
    hairLength: pick(t, /hair is (\w+)/i),
    eyeColour: pick(t, new RegExp(`(${COLOURS})\\s+eyes`, 'i')),
    // The whole modifier phrase, not one word of it. Elothean eyes are
    // "tilted almond-shaped", and either half alone loses the marker: almond
    // runs at 56% in Elothean descriptions against 3-13% elsewhere and tilted
    // at 53%, but it is the pair that identifies the race.
    eyeShape: pick(
      t,
      // The leading \b matters more than it looks: without it "round" matches
      // inside "around his mouth", which is in a great many descriptions, and
      // every one of them would have been tagged round-eyed.
      /\b((?:almond-shaped|tilted|slitted|round|narrow|deep-set|wide)(?:[\s-](?:almond-shaped|tilted|slitted|round|narrow|deep-set|wide))*)[\w\s-]*?eyes/i
    ),
    skin: pick(t, /has (\w+(?:\s\w+)?) skin/i),
    build: pick(t, /a (\w+(?:\s\w+)?) build/i),
  }
}

export interface PortraitMeta {
  key: string
  race: string
  sex: 'male' | 'female'
  hairColour?: string
  eyeColour?: string
  skin?: string
  build?: string
}

/**
 * How well a portrait matches a LOOK.
 *
 * Race and sex dominate deliberately. Getting those wrong is a different kind
 * of error from a hair colour being off: a Prydaen handed a human face is
 * wrong in a way a player will not forgive, while brown hair against auburn is
 * a shrug. So they are weighted an order of magnitude above the rest, and a
 * race mismatch disqualifies rather than scores low.
 */
export function scorePortrait(want: LookFeatures, p: PortraitMeta): number {
  if (want.race && p.race.toLowerCase() !== want.race.toLowerCase()) return -1

  let score = 0
  if (want.race) score += 100
  if (want.sex && want.sex === p.sex) score += 50

  const soft: Array<[string | undefined, string | undefined]> = [
    [want.hairColour, p.hairColour],
    [want.eyeColour, p.eyeColour],
    [want.skin, p.skin],
    [want.build, p.build],
  ]
  for (const [a, b] of soft) {
    if (!a || !b) continue
    if (a === b) score += 10
    else if (a.includes(b) || b.includes(a)) score += 5
  }
  return score
}

/** The best few portraits for a LOOK, best first. Never an automatic choice. */
export function suggestPortraits(
  look: string,
  portraits: PortraitMeta[],
  limit = 5
): Array<{ portrait: PortraitMeta; score: number }> {
  const want = parseLook(look)
  return portraits
    .map((portrait) => ({ portrait, score: scorePortrait(want, portrait) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
