/**
 * Character portraits, one per playable race and gender.
 *
 * The dashboard has a portrait slot and nothing has ever gone in it. These are
 * the default faces: a player uploads their own if they want, but a new
 * character should not meet an empty grey rectangle.
 *
 * Built from data/art/race-descriptors.json, which was written from the
 * Character Creation prose on each Concept: page and checked against 391
 * player LOOK descriptions. The descriptors are the whole point — S'Kra Mur
 * are reptilian and tailed, Prydaen feline and furred, Elothean gaunt with a
 * high domed brow. Rendering them as generic fantasy people is the failure
 * this file exists to avoid.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { CLOTHED, NEGATIVE, NOT_A_RACE } from './art-safety.mjs'

/**
 * Adulthood and the crop, in the positive prompt where they work.
 *
 * The first clothed set had three failures the negative prompt did not catch,
 * which is the same lesson the creature prompts hit with "kobold": at cfg 1.0
 * the negative is far too weak to fight what the subject summons.
 *
 * Halfling and Gnome came back as anime children. Their own descriptors are
 * the cause — "small, round, soft-featured", "rosy cheeks", "round open face",
 * "very small, wiry" — which is an accurate reading of the race and also a
 * precise description of chibi. The word "cute" sat in the negative the whole
 * time and did nothing.
 *
 * Elothean came back as a full-length figure a few hundred pixels tall,
 * because "head and shoulders portrait" was buried at the end of a long style
 * clause and read as a genre rather than a crop.
 */
const FRAME =
  'an adult with adult facial proportions, normal human eye size, ' +
  'closely cropped bust, the head and shoulders filling the frame, ' +
  'cut off at the chest'

const STYLE =
  'painterly digital illustration, muted naturalistic palette, soft directional ' +
  'light, atmospheric depth, painted texture, head and shoulders portrait, ' +
  'plain dark background, no text, no watermark, consistent fantasy realism'


/**
 * Subjects whose first draw was wrong, and which attempt to use instead.
 *
 * Elothean rendered as a full-length figure a few hundred pixels tall and
 * Halfling and Gnome as anime children. Both survived a rewritten prompt
 * unchanged, because the seed is the name and the same seed returns the same
 * composition however the words around it move. The prompt was not the whole
 * problem; the draw was.
 */
const REROLL = JSON.parse(readFileSync('data/art/reroll.json', 'utf8'))

function seedOf(name) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Clauses that cannot appear in a bust, and so must not be asked for.
 *
 * The Elothean descriptor ends "gathered knee-length trousers, wrapped lower
 * legs, split-toe footwear". Those are correct — it is what the culture wears
 * — and they are also impossible to show in a head-and-shoulders crop, so the
 * model widened the shot to full length to satisfy them and rendered a figure
 * a few hundred pixels tall. It survived a rewritten crop clause and a reroll,
 * because neither was the cause: the prompt was asking for shoes.
 *
 * Only Elothean trips this today. The descriptors are shared with the scene
 * and creature art, where legs and footwear are wanted, so the filter lives
 * here on the portrait side rather than being cut from the source.
 */
const BELOW_THE_CHEST =
  /trouser|legging|boot|footwear|shoe|sandal|leg|knee|skirt|hem|feet|breeches|kilt/i

const bustOnly = (prompt) =>
  prompt
    .split(/,\s*/)
    .filter((clause) => !BELOW_THE_CHEST.test(clause))
    .join(', ')

const races = JSON.parse(readFileSync('data/art/race-descriptors.json', 'utf8'))
const out = {}

for (const [race, d] of Object.entries(races)) {
  for (const sex of ['male', 'female']) {
    const key = `${race} ${sex}`
    out[key] = {
      source: 'race-descriptor',
      race,
      sex,
      // The descriptor leads. The race name comes after it, because the name
      // alone summons a generic fantasy prior that overwhelms the text — the
      // same failure the creature prompts hit with "kobold".
      prompt: [`A ${sex} ${race.toLowerCase()} of Elanthia.`, bustOnly(d.prompt), CLOTHED, FRAME, STYLE]
        .filter(Boolean)
        .join(', '),
      // A race may carry its own negative. Pointed ears are right for an Elf
      // and wrong for a Gor'Tog, so this cannot be one shared clause.
      negative: [NEGATIVE, NOT_A_RACE, d.negative].filter(Boolean).join(', '),
      // Still derived from the name, so it reproduces. The attempt number is
      // part of the input rather than a random jump, which means a reroll is
      // as repeatable as the draw it replaces.
      seed: seedOf(REROLL[key] ? `${key}#${REROLL[key]}` : key),
      width: 832,
      height: 1216,
    }
  }
}

mkdirSync('data/art', { recursive: true })
writeFileSync('data/art/portrait-prompts.json', JSON.stringify(out, null, 1))
console.log(`${Object.keys(out).length} portraits across ${Object.keys(races).length} races`)
