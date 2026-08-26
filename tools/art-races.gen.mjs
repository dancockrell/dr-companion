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

const STYLE =
  'painterly digital illustration, muted naturalistic palette, soft directional ' +
  'light, atmospheric depth, painted texture, head and shoulders portrait, ' +
  'plain dark background, no text, no watermark, consistent fantasy realism'

const NEGATIVE =
  'text, watermark, signature, logo, frame, border, multiple views, ' +
  'photorealistic, cartoon, anime, cute, chibi'

function seedOf(name) {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

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
      prompt: [`A ${sex} ${race.toLowerCase()} of Elanthia.`, d.prompt, STYLE]
        .filter(Boolean)
        .join(', '),
      negative: NEGATIVE,
      seed: seedOf(key),
      width: 832,
      height: 1216,
    }
  }
}

mkdirSync('data/art', { recursive: true })
writeFileSync('data/art/portrait-prompts.json', JSON.stringify(out, null, 1))
console.log(`${Object.keys(out).length} portraits across ${Object.keys(races).length} races`)
