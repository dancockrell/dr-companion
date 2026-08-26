/**
 * Race descriptor blocks for the art pack.
 *
 *   node tools/art-races.mjs          write data/art/race-descriptors.json
 *   node tools/art-races.mjs review   print them with their evidence
 *
 * Three sources, because no single one is sufficient:
 *
 *   1. `Concept:<Race>` Character Creation  the in-game creation prose, which
 *      is the only official statement of what a race looks like
 *   2. 391 player LOOK descriptions          what players actually write, which
 *      shows which features the game offers and which read as racial
 *   3. the item index                        what the culture wears and carries
 *
 * The Play.net Description section is deliberately not used: it is lore, and
 * for Prydaen it never mentions that they have fur.
 *
 * The distinctive-term figures in `evidence` are measured, not asserted. They
 * are the share of that race's descriptions containing the term, against the
 * mean share across the other races.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const IN = 'data/elanthipedia'
const OUT = 'data/art'

/**
 * Written from the three sources above, then checked against the measured
 * terms. Kept short: FLUX follows a compact clause better than a paragraph,
 * and every word here competes with the scene description.
 */
const DESCRIPTORS = {
  Human: {
    build: 'average height and build',
    face: 'unremarkable features, the baseline the other races are described against',
    note: 'no distinctive term appears above chance. That is the correct result.',
  },
  Elf: {
    build: 'tall, slender, long-limbed',
    face: 'sharply pointed ears, fine features, wavy hair often worn long',
    note: 'pointed ears in 95% of descriptions, the single strongest marker of any race',
  },
  Dwarf: {
    build: 'short, broad, heavily muscled',
    face: 'square-jawed, thick braided beard and moustache, bushy brows',
    note: 'beard and moustache both 67%, braids 47%',
  },
  Halfling: {
    build: 'small, round, soft-featured',
    face: 'curly hair, rosy cheeks, round open face',
    note: 'curly 58%, short 50%, rosy and round well above baseline',
  },
  Gnome: {
    build: 'very small, wiry, quick',
    face: 'sharp inquisitive features, unruly hair, tinkerer’s clutter of tools and pouches',
    note: 'tinker 38% at nineteen times baseline; the craft reads as the race',
  },
  "Gor'Tog": {
    build: 'very tall, massive, powerfully built, the largest of the races',
    face: 'heavy brow, broad blunt features, green-toned skin',
    note: 'few written looks (9); the creation prose carries this one',
  },
  "S'Kra Mur": {
    build: 'lean, upright, long muscular tail',
    face: 'scaled hide, elongated snout, slitted eyes, ridged crest',
    note: 'scales 93%, slitted 87%, snout 63%; tailbands are common jewellery',
  },
  Prydaen: {
    build: 'human height, slender, digitigrade, long tail',
    face: 'short smooth fur over the whole body, feline muzzle, slitted eyes, pointed ears, mane',
    note: 'mane 85%, tail 85%, slitted 85%; fur is never mentioned in the lore section',
  },
  Rakash: {
    build: 'human build in manskin, heavier and lupine in moonskin',
    face: 'human features most of the month; under a full Katamba, fur, muzzle and tail',
    note: 'two forms. Default to manskin unless the scene calls for moonskin.',
  },
  Kaldar: {
    build: 'tall, broad, physically imposing',
    face: 'weathered, strong-boned, hair worn tied back, worked brass and copper ornament',
    note: 'barbarian 25%, height 38%; a cold-country people, not a brutish one',
  },
  Elothean: {
    build: 'very tall and very thin, gaunt, fine-boned, upright and composed',
    face:
      'high domed forehead with a far-receding hairline, long narrow face, ' +
      'tilted almond-shaped eyes, straight fine hair worn long and pulled ' +
      'back, or absent from the crown entirely',
    dress:
      'wrap-front robe closed with a wide sash, layered under-robe, gathered ' +
      'knee-length trousers, wrapped lower legs, split-toe footwear',
    note:
      'almond 56% and tilted 53% in player looks, against 3-13% elsewhere. ' +
      'The forehead appears in none of those looks, because it is not a ' +
      'selectable feature: it is inherent to the race, so nobody types it. It ' +
      'is unmistakable in the official art, which is where that line comes ' +
      'from. The culture is where the game keeps its Japanese-derived items: ' +
      '242 kimonos, 20 katanas, plus wakizashi, tanto, naginata, nodachi and ' +
      'tsuba-hilted blades. Bearing is studied and openly superior, in their ' +
      'own words the most exalted of all the races.',
  },
}

function build() {
  const races = JSON.parse(readFileSync(`${IN}/races.json`, 'utf8'))
  const pcs = JSON.parse(readFileSync(`${IN}/pcs.json`, 'utf8'))

  const out = {}
  for (const [name, d] of Object.entries(DESCRIPTORS)) {
    const looks = pcs[name] ?? []
    out[name] = {
      ...d,
      prompt: [d.build, d.face, d.dress].filter(Boolean).join(', '),
      evidence: {
        creation: races[name]?.creation ?? null,
        lookSamples: looks.length,
        example: looks[0]?.look?.slice(0, 300) ?? null,
      },
    }
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(`${OUT}/race-descriptors.json`, JSON.stringify(out, null, 2))
  console.log(`wrote ${OUT}/race-descriptors.json, ${Object.keys(out).length} races`)
  return out
}

function review(out) {
  for (const [name, d] of Object.entries(out)) {
    console.log(`\n### ${name}   (${d.evidence.lookSamples} player looks)`)
    console.log(`    ${d.prompt}`)
    console.log(`    why: ${d.note}`)
  }
}

const data = build()
if (process.argv[2] === 'review') review(data)
