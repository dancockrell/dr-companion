/**
 * What never appears in generated art, and what always does.
 *
 * The art pack ships with the app. Every render here is a default that a
 * player meets before they have chosen anything, which makes this a shipping
 * standard rather than a preference: portraits, creatures and rooms are all
 * held to it.
 *
 * The reason this file exists rather than a line in each generator is that the
 * first version had the same negative prompt copied into three files, none of
 * which mentioned nudity, and the female portraits came back topless. Three
 * copies means three places to forget.
 */

/**
 * The negative clause.
 *
 * At cfg 1.0 this has a real but weak effect — rendering with and against it
 * gives different images, which was checked rather than assumed — so it is the
 * backstop, never the whole guard. Anything that must not appear also needs
 * stating positively in the prompt.
 */
export const NEGATIVE =
  'nude, nudity, naked, topless, bare chest, bare breasts, exposed skin, ' +
  'cleavage, lingerie, underwear, suggestive, sexualised, ' +
  'text, watermark, signature, logo, frame, border, multiple views, ' +
  'photorealistic, cartoon, anime, cute, chibi'

/**
 * Clothing, stated positively, for anything with a humanoid figure.
 *
 * This is the half that actually works. "Head and shoulders portrait"
 * describes the crop and not the subject, and the model will happily fill an
 * unclothed torso into it. Saying what the figure is wearing removes the
 * question instead of cropping around it.
 */
export const CLOTHED =
  'fully clothed in layered travelling garb, high collar, tunic and cloak ' +
  'covering the chest and shoulders'

/**
 * Clothing for a creature rather than a person.
 *
 * Shorter and less specific than CLOTHED, because a creature prompt is already
 * long and every word here competes with the lore that makes the creature
 * itself. It only has to close the one gap.
 */
export const CLOTHED_CREATURE = 'fully clothed, torso covered, no bare chest'

/**
 * Extra negative terms for the playable races.
 *
 * None of the eleven has horns, antlers or wings. That is obvious to a player
 * and not at all obvious to the model: the Gor'Tog descriptor said
 * "green-toned skin" and the render came back as a tiefling, with ram horns
 * and pointed ears, because green skin in a fantasy portrait summons every
 * horned thing in the training set.
 *
 * Tails are deliberately absent from this list. Prydaen, S'Kra Mur and Rakash
 * in moonskin all have one, and it is a defining feature rather than a
 * mistake. So is a certain orcishness about the Gor'Tog, which is why "orc" is
 * not here either: negating it would fight the right answer rather than the
 * wrong one.
 *
 * Portraits only. Plenty of creatures are supposed to be horned, so this
 * cannot go in the shared negative.
 */
export const NOT_A_RACE = 'horns, antlers, wings, demon, tiefling, devil, fangs, face paint'

/**
 * Lowercase words of a string, so membership can be tested without regex.
 *
 * "humanoid size" is removed first. Several spider entries read "the wolf
 * spider is humanoid size", which is a statement about scale and not about
 * body plan, and it was enough to put clothes on a spider.
 */
const words = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/humanoid[\s-]*siz\w*/g, ' ')
    .split(/[^a-z]+/)
    .filter(Boolean)

const has = (set, text) => words(text).some((w) => set.has(w))

/**
 * Names that imply a humanoid figure.
 *
 * Word sets rather than a regex alternation, because the alternation needed
 * word boundaries and a `\b` written through a shell heredoc arrives as an
 * actual backspace character. That happened three times while this file was
 * being written: the regex still compiled, matched nothing, and the failure
 * looked like empty data rather than a broken pattern. A set has nothing to
 * escape.
 */
const HUMANOID_NAMES = new Set([
  'man', 'woman', 'men', 'women', 'maiden', 'lady', 'priest', 'priestess',
  'acolyte', 'cultist', 'bandit', 'brigand', 'thug', 'ruffian', 'guard',
  'soldier', 'warrior', 'witch', 'hag', 'siren', 'nymph', 'dryad', 'fendryad',
  'nereid', 'sylph', 'spirit', 'apparition', 'shade', 'wraith', 'ghost',
  'ghoul', 'ghoulish', 'human', 'elf', 'elven', 'dwarf', 'halfling', 'gnome',
  'urchin', 'beggar', 'pirate', 'smuggler', 'sorcerer', 'sorceress', 'mage',
  'shaman', 'monk', 'dancer', 'villager', 'cutthroat', 'graverobber',
  'assassin', 'zealot', 'sentinel', 'crone', 'freebooter', 'goblin', 'troll',
  'orc', 'kobold', 'giant', 'zombie', 'skeleton', 'matriarch', 'nightblade',
  'avenger', 'fanatic', 'purifier', 'intercessor', 'warden', 'juggernaut',
])

/**
 * Animal names, which override a humanoid word elsewhere in the name.
 *
 * "giant" and "zombie" belong on the humanoid list — a giant and a zombie both
 * wear clothes — but they also open "Giant wolf spider" and "Zombie boar",
 * which do not. The animal wins unless the lore itself says the thing wears or
 * wields something, so a genuinely humanoid creature with an animal in its
 * name is still caught by its description.
 */
const ANIMAL_NAMES = new Set([
  'spider', 'boar', 'sow', 'wolf', 'bear', 'rat', 'snake', 'viper', 'serpent',
  'moth', 'fish', 'shark', 'eel', 'crocodile', 'armadillo', 'bull', 'peccary',
  'antelope', 'gryphon', 'drake', 'hound', 'dog', 'cat', 'horse', 'stag',
  'deer', 'bat', 'crab', 'beetle', 'worm', 'slug', 'toad', 'frog', 'bird',
  'hawk', 'owl', 'leucro', 'prereni', 'celpeze', 'tusk', 'razortusk',
])

/**
 * Lore words that describe a body with a torso.
 *
 * Bare pronouns were tried and dropped. The wiki writes "she" about a
 * razortusk sow, so she/her/his/him pulled in livestock and would have put a
 * tunic on a boar. What survives is clothing, wielded weapons, and an
 * explicit humanoid frame.
 */
const LORE_WORDS = new Set([
  'humanoid', 'upright', 'torso', 'wears', 'wearing', 'robe', 'robes',
  'armour', 'armor', 'tunic', 'cloak', 'clad', 'garb', 'wields', 'wielding',
])

/** The stronger subset, which is what it takes to overrule an animal name. */
const LORE_STRONG = new Set([
  'humanoid', 'upright', 'wears', 'wearing', 'wields', 'wielding', 'clad',
])

/**
 * Whether a creature has a humanoid figure, and so needs the clothing clause.
 *
 * A name test alone is not enough. "Fire maiden" is obviously humanoid and
 * rendered topless; so is "Adan'f spirit dancer", which no wordlist would
 * catch on its own. The lore is the better signal.
 *
 * Deliberately generous. A wolf that wrongly picks up the clause is a slightly
 * odd wolf; a topless dryad is a thing that cannot ship, and the two costs are
 * not remotely symmetric.
 */
export function isHumanoid(name, lore) {
  if (has(ANIMAL_NAMES, name)) return has(LORE_STRONG, lore)
  return has(HUMANOID_NAMES, name) || has(LORE_WORDS, lore)
}
