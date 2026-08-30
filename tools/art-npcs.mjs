/**
 * Generic in-universe NPC portraits — not specific characters, a pool the
 * game can pull from for anything unnamed: "an unknown merchant," a random
 * townsperson, a placeholder guard. Requested 28 Aug 2026 so an unnamed NPC
 * gets a face instead of nothing.
 *
 *   node tools/art-npcs.mjs
 *
 * Each entry carries tags (role, race, gender) rather than just a name, so
 * the app can match on keywords ("merchant") instead of needing an exact
 * subject. Building the actual match logic is not this file's job — that
 * belongs to whichever session owns NPC/lookup code. This only produces the
 * art and the tag metadata it would need.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { NEGATIVE } from './art-safety.mjs'

// Same style as art-creatures.mjs / art-races.gen.mjs. Kept as its own copy
// rather than a shared import because that is the existing convention in
// this pack — see art-rooms2.mjs's note on why STYLE is never edited to fix
// one subject.
// No "plain dark background" here — unlike the canonical portraits and
// creature cards, these are meant to sit in a real scene (see ROLES.scene),
// which grounds the model in genre and period far better than an adjective
// list does.
// Strengthened 29 Aug 2026: every indoor role (blacksmith, priest, scholar —
// forge, altar, bookshelves in the scene itself) rendered correctly painterly,
// but the open-air roles (wanderer worst of all: 19/19 rendered so far,
// caught by eye on a contact sheet, not by score — they scored fine) drifted
// to outdoor stock-photography, lost the race anchor's own traits entirely
// (an Elothean wanderer with no unnatural height or luminous eyes, just an
// ordinary woman in a field), and collapsed toward one repeated pose across
// nine different seeds. "no photorealism" alone was not a strong enough
// anchor once the scene had no unambiguous period object in it (a forge, an
// altar) to hold the model in illustration-space. Matches room-prompts.json's
// own anchoring, which has never shown this drift across 1,400+ renders.
const STYLE =
  'a scene from a medieval fantasy world, no electricity, no cars, no ' +
  'modern buildings, no contemporary clothing, no photograph, no ' +
  'photojournalism, illustration, hand-painted oil on canvas, 19th-century ' +
  'impressionist style, loose visible brushstrokes, broken color, soft ' +
  'atmospheric light, muted naturalistic palette, full body, no ' +
  'photorealism, no text, no watermark, no signature, consistent fantasy ' +
  'realism'

const CLOTHED =
  'fully clothed in layered travelling garb, high collar, tunic and cloak ' +
  'covering the chest and shoulders'

/** Elanthipedia's Category:Races, same 11 as art-races.gen.mjs. */
const RACES = [
  'Human',
  'Elf',
  'Dwarf',
  'Halfling',
  'Gnome',
  "Gor'Tog",
  "S'Kra Mur",
  'Prydaen',
  'Rakash',
  'Kaldar',
  'Elothean',
]

/**
 * Physical anchors per race, short-form. Not the full descriptor blocks
 * art-races.gen.mjs uses for the official portraits — that level of care is
 * warranted for the 22 canonical faces every player sees; this is filler for
 * an unnamed NPC. Still has to get the shape right: an S'Kra Mur that reads
 * human is worse than no picture, same reasoning as the official set.
 */
const RACE_ANCHOR = {
  Human: 'a human',
  Elf: 'an elf, (slender pointed ears:1.4)',
  Dwarf: 'a dwarf, (short stocky bearded build:1.3)',
  Halfling: 'a halfling, (small child-sized body:1.3), adult face',
  Gnome: 'a gnome, (small body, angular pointed features:1.3)',
  // "hulking" was tried first and rejected 28 Aug 2026 — it invoked The
  // Hulk directly (bare chest, comic-book green, snarling), every single
  // render, across every role. Word choice matters to an image model in a
  // way it doesn't to a reader.
  "Gor'Tog": "a Gor'Tog, (very tall, heavily built, broad and solid " +
    'frame, dark green skin, blunt-featured face:1.3)',
  "S'Kra Mur": "an S'Kra Mur, (reptilian scaled skin, lizard-like snout, " +
    'tail:1.3), not human',
  Prydaen: 'a Prydaen, (feline face covered in fur, cat ears, tail:1.3), ' +
    'not human',
  Rakash: 'a Rakash, human in build with (fox-like ears:1.3)',
  Kaldar: 'a Kaldar, human-statured with an aquiline face',
  // "(luminous glowing eyes:1.3)" was tried first and rejected 28 Aug 2026 —
  // same failure as "hulking" above, different sense: FLUX schnell read the
  // emphasis as "this figure is made of glow" and replaced the whole head
  // with a bare light-orb, every one of 80 renders across three roles. The
  // trait needs to read as a detail on a face, not a dominant light source.
  Elothean: 'an Elothean, (unnaturally tall and slender build:1.3), a ' +
    'humanoid face with pale skin and faintly luminous eyes',
}

/** Races whose defining trait is easy for the model to drop back to human. */
const NOT_HUMAN = new Set(["Gor'Tog", "S'Kra Mur", 'Prydaen', 'Elothean'])

/**
 * Roles a player or the game might need an unnamed face for. Kept broad and
 * mundane on purpose — these are background people, not adventurers.
 *
 * Each carries a `scene`: a real environment for the figure to stand in.
 * Added 28 Aug 2026 — a bare "plain dark background" gives the model no
 * genre or period signal to anchor on, and clothing drifted generic as a
 * result. A market stall or a forge does the work a dozen adjectives on the
 * clothing couldn't: it tells the model what kind of picture this is.
 */
const ROLES = [
  { tag: 'merchant', text: 'a traveling merchant, laden with wares and a coin purse',
    scene: 'standing at a market stall piled with goods, awnings and other stalls behind' },
  { tag: 'blacksmith', text: 'a blacksmith, soot-streaked with a leather apron',
    scene: 'standing at a forge, anvil and tools around, glow of coals nearby' },
  { tag: 'guard', text: 'a town guard in worn livery, spear in hand',
    scene: 'standing watch at a torch-lit town gate, stone walls behind' },
  { tag: 'priest', text: 'a priest of a minor local shrine, plain vestments',
    scene: 'standing inside a small stone shrine, candles and a modest altar behind' },
  { tag: 'scholar', text: 'a traveling scholar, ink-stained fingers and a satchel of books',
    scene: 'standing among shelves of old books and scrolls in a cramped study' },
  { tag: 'thief', text: 'a furtive cutpurse, hooded and watchful',
    scene: 'standing in a narrow shadowed alley between timber buildings' },
  { tag: 'noble', text: 'a minor noble, richly dressed but road-worn',
    scene: 'standing in the entry hall of a modest manor house, tapestries behind' },
  { tag: 'farmer', text: 'a farmer, sun-weathered with rough work clothes',
    scene: 'standing at the edge of a tilled field, a thatched farmhouse behind' },
  { tag: 'sailor', text: 'a sailor, tarred rope-scarred hands and a knit cap',
    scene: 'standing on a wooden dock among rigging and moored ships' },
  { tag: 'innkeeper', text: 'an innkeeper, heavyset and aproned',
    scene: 'standing behind a worn tavern bar, barrels and mugs around' },
  { tag: 'hunter', text: 'a hunter, cloaked in fur and leather, a bow at their back',
    scene: 'standing at the edge of a misty forest' },
  { tag: 'mage', text: 'a hedge mage, robed with a satchel of components',
    scene: 'standing in a cluttered study lined with jars and dried herbs' },
  { tag: 'bard', text: 'a wandering bard with a battered instrument',
    scene: 'standing in the corner of a crowded, lantern-lit tavern room' },
  { tag: 'beggar', text: 'a beggar, threadbare and hollow-cheeked',
    scene: 'sitting against a stone wall on a cobbled street corner' },
  { tag: 'pilgrim', text: 'a pilgrim, dusty from the road, a walking staff',
    scene: 'standing on a dirt road winding toward a distant shrine' },
  { tag: 'mercenary', text: 'a mercenary, scarred and armored in mismatched plate',
    scene: 'standing at a campfire beside a worn tent and travel gear' },
  { tag: 'herbalist', text: 'an herbalist, a basket of dried plants at their hip',
    scene: 'standing in a small garden of herbs and hanging dried plants' },
  { tag: 'fisherman', text: 'a fisherman, oilskin coat and a net over one shoulder',
    scene: 'standing on a riverbank with nets and baskets of fish' },
  { tag: 'stablehand', text: 'a stablehand, straw-dusted and plainly dressed',
    scene: 'standing in a wooden stable among horse stalls and hay' },
  { tag: 'moneylender', text: 'a moneylender, fastidiously dressed, a ledger under one arm',
    scene: 'standing behind a counter stacked with ledgers and coin boxes' },
  { tag: 'alchemist', text: 'an alchemist, apron scorched and stained, vials at the belt',
    scene: 'standing among bubbling vials and alembics in a cramped workshop' },
  { tag: 'tailor', text: 'a tailor, a measuring tape draped over the shoulders',
    scene: 'standing in a shop hung with bolts of cloth and half-finished garments' },
  { tag: 'cook', text: 'a cook, flour-dusted apron and rolled sleeves',
    scene: 'standing in a busy kitchen beside a hearth and hanging pots' },
  { tag: 'guildmaster', text: 'a guild official, official-looking chain of office',
    scene: 'standing in a wood-paneled guild hall office, ledgers and a banner behind' },
  { tag: 'wanderer', text: 'a nameless wanderer, travel-worn cloak and pack',
    scene: 'standing on an open dirt road at dusk, countryside behind' },
]

const GENDERS = ['male', 'female']
const SEEDS_PER_COMBO = 9 // 25 roles * 11 races * 2 genders * 9 = 4,950

function seedOf(key) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const slugPart = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const out = {}
for (const role of ROLES) {
  for (const race of RACES) {
    for (const gender of GENDERS) {
      for (let i = 0; i < SEEDS_PER_COMBO; i++) {
        const key = `npc-${slugPart(role.tag)}-${slugPart(race)}-${gender}-${i}`
        const subject = `${RACE_ANCHOR[race]}, a ${gender}, working as ${role.text}, ${role.scene}`
        const negative = NOT_HUMAN.has(race)
          ? [NEGATIVE, 'human face, human skin, human ears, superhero, ' +
              'comic book, shirtless, bare chest, rage, snarling, ' +
              'glowing orb, floating eye, headless, faceless, no face, ' +
              'light source instead of head'].join(', ')
          : NEGATIVE
        out[key] = {
          tags: [role.tag, slugPart(race), gender],
          role: role.tag,
          race,
          gender,
          prompt: [subject, CLOTHED, STYLE].join(', '),
          negative,
          // Reverted 28 Aug 2026: 128:184 came back low-res and with race
          // features lost (S'Kra Mur/Gor'Tog rendering as plain humans).
          // Same size as the canonical 22 portraits — that is the size
          // that actually held up.
          seed: seedOf(key),
          width: 256,
          height: 376,
        }
      }
    }
  }
}

mkdirSync('data/art', { recursive: true })
writeFileSync('data/art/npc-prompts.json', JSON.stringify(out, null, 1))
console.log(`${Object.keys(out).length} NPC portraits across ${ROLES.length} roles x ${RACES.length} races x 2 genders x ${SEEDS_PER_COMBO} seeds`)
