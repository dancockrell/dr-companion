/**
 * A small, strategic set of room scenes, reused across many rooms instead of
 * one render per room. Requested 28 Aug 2026 after the 17,750-unique-render
 * plan was abandoned (too slow, too much iteration risk) — "quality over
 * quantity," roughly 500 total, chosen by hand rather than raw keyword
 * frequency (which is dominated by structural nouns like "wall"/"wood" that
 * appear in nearly every room regardless of what kind of room it is).
 *
 *   node tools/art-archetypes.mjs
 *
 * Matching each of the 17,750 rooms to one of these happens separately, in
 * tools/art-match-rooms.mjs, once these are rendered and reviewed.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { NEGATIVE } from './art-safety.mjs'

const STYLE =
  'a scene from a medieval fantasy world, painterly digital illustration, ' +
  'muted naturalistic palette, atmospheric depth, wide establishing shot, ' +
  'consistent fantasy realism, no photorealism, no text, no watermark, ' +
  'no signature, no modern technology, vehicles, contemporary clothing, or signage'

/**
 * Scene archetypes. `tags` are the keywords tools/art-match-rooms.mjs scores
 * room lore text against — chosen from what actually shows up in DR room
 * descriptions (Crossing, Ratha, Riverhaven, Shard and similar), not
 * generic fantasy vocabulary.
 */
const ARCHETYPES = [
  // --- Streets & town exteriors ---
  { tag: 'market-street', text: 'a bustling market street lined with vendor stalls and awnings', tags: ['market', 'bazaar', 'stall', 'vendor', 'monger'] },
  { tag: 'city-street', text: 'a cobbled city street between timber-framed buildings', tags: ['street', 'road', 'lane', 'avenue'] },
  { tag: 'alley', text: 'a narrow shadowed alley between close-set buildings', tags: ['alley', 'alleyway', 'passage'] },
  { tag: 'town-square', text: 'an open town square with a central fountain or statue', tags: ['square', 'plaza', 'green', 'commons'] },
  { tag: 'city-gate', text: 'a fortified stone city gate with a raised portcullis', tags: ['gate', 'gatehouse', 'portcullis', 'wall'] },
  { tag: 'docks', text: 'a wooden dock lined with moored ships and coiled rope', tags: ['dock', 'pier', 'harbor', 'wharf', 'quay'] },
  { tag: 'bridge', text: 'a stone bridge crossing a river into town', tags: ['bridge', 'span', 'crossing'] },
  { tag: 'courtyard', text: 'an enclosed courtyard with a well and potted plants', tags: ['courtyard', 'yard', 'quad'] },
  { tag: 'watchtower', text: 'a stone watchtower overlooking the town walls', tags: ['tower', 'watchtower', 'battlement', 'parapet'] },
  { tag: 'garden', text: 'a formal garden with hedges, flowerbeds, and gravel paths', tags: ['garden', 'arboretum', 'grove', 'orchard'] },

  // --- Interiors: commerce & craft ---
  { tag: 'shop-interior', text: 'the cluttered interior of a small shop, shelves of goods', tags: ['shop', 'store', 'goods', 'emporium', 'boutique'] },
  { tag: 'tavern', text: 'a warm tavern common room, a hearth and long wooden tables', tags: ['tavern', 'inn', 'ale', 'common room'] },
  { tag: 'inn-room', text: 'a modest inn bedroom with a bed, washstand, and small window', tags: ['bedroom', 'inn room', 'lodging'] },
  { tag: 'forge', text: 'a blacksmith forge with anvil, bellows, and glowing coals', tags: ['forge', 'smith', 'anvil', 'foundry'] },
  { tag: 'weaponsmith', text: 'a weaponsmith workshop, blades and armor on racks', tags: ['weapon', 'armory', 'blade'] },
  { tag: 'alchemy-shop', text: 'an alchemist workshop, bottles, vials, and dried herbs', tags: ['alchemy', 'apothecary', 'herbalist', 'potion'] },
  { tag: 'tailor', text: 'a tailor shop with bolts of cloth and half-finished garments', tags: ['tailor', 'seamstress', 'stitchery', 'cloth'] },
  { tag: 'bank', text: 'a formal stone bank hall with counters and ledgers', tags: ['bank', 'provincial', 'vault', 'ledger'] },
  { tag: 'warehouse', text: 'a dim warehouse stacked with crates and barrels', tags: ['warehouse', 'storeroom', 'cargo'] },
  { tag: 'jeweler', text: 'a jeweler shop, glittering gems in glass cases', tags: ['jewel', 'gem', 'goldsmith'] },

  // --- Interiors: institutions ---
  { tag: 'guild-hall', text: 'a formal guild hall with banners and a long table', tags: ['guild', 'hall', 'order', 'society'] },
  { tag: 'temple', text: 'a quiet stone temple interior, candlelight and an altar', tags: ['temple', 'shrine', 'chapel', 'altar', 'sanctuary'] },
  { tag: 'library', text: 'a tall library lined with shelves of old books and scrolls', tags: ['library', 'archive', 'study', 'scholar'] },
  { tag: 'town-hall', text: 'an official town hall meeting chamber', tags: ['town hall', 'records', 'office', 'headquarters'] },
  { tag: 'academy', text: 'a scholarly academy classroom or lecture hall', tags: ['academy', 'college', 'school', 'collegium'] },
  { tag: 'meeting-room', text: 'a formal wood-paneled meeting room with a long table', tags: ['meeting room', 'chamber', 'council'] },
  { tag: 'barracks', text: 'a spare military barracks room with cots and weapon racks', tags: ['barracks', 'guard house', 'garrison'] },
  { tag: 'prison-cell', text: 'a bare stone prison cell with iron bars', tags: ['cell', 'prison', 'dungeon', 'jail'] },
  { tag: 'bathhouse', text: 'a steamy stone bathhouse with pools and tiled floors', tags: ['bath', 'bathhouse'] },
  { tag: 'theater', text: 'an amphitheater or performance hall with tiered seating', tags: ['amphitheater', 'theater', 'stage', 'recitation'] },

  // --- Domestic ---
  { tag: 'cottage-exterior', text: 'a small thatched-roof cottage with a garden path', tags: ['cottage', 'hovel', 'cabin'] },
  { tag: 'manor-hall', text: 'the entry hall of a modest manor house, tapestries on the walls', tags: ['manor', 'estate', 'apartments'] },
  { tag: 'kitchen', text: 'a busy kitchen with a hearth, hanging pots, and a wooden table', tags: ['kitchen', 'pantry'] },
  { tag: 'study', text: 'a private study with a writing desk and shelves', tags: ['study', 'office', 'den'] },
  { tag: 'stable', text: 'a wooden stable with horse stalls and hay bales', tags: ['stable', 'barn', 'paddock'] },
  { tag: 'cellar', text: 'a stone cellar with barrels and cobwebbed shelves', tags: ['cellar', 'basement', 'undercroft'] },

  // --- Wilderness: land ---
  { tag: 'forest-path', text: 'a dirt path through a dense green forest', tags: ['forest', 'wood', 'wooded', 'trees'] },
  { tag: 'deep-forest', text: 'a dark, dense forest interior with thick canopy', tags: ['deep forest', 'thicket', 'undergrowth'] },
  { tag: 'meadow', text: 'an open sunlit meadow of tall grass and wildflowers', tags: ['meadow', 'field', 'pasture', 'plain'] },
  { tag: 'farmland', text: 'tilled farmland with rows of crops under open sky', tags: ['farm', 'field', 'crop', 'harvest'] },
  { tag: 'mountain-pass', text: 'a rocky mountain pass between steep cliffs', tags: ['mountain', 'pass', 'peak', 'summit'] },
  { tag: 'cliff-overlook', text: 'a cliff edge overlooking a wide valley below', tags: ['cliff', 'overlook', 'precipice', 'bluff'] },
  { tag: 'hilltop', text: 'a grassy hilltop with a view of rolling countryside', tags: ['hill', 'hilltop', 'ridge'] },
  { tag: 'swamp', text: 'a murky swamp with twisted trees and standing water', tags: ['swamp', 'marsh', 'bog', 'wetland'] },
  { tag: 'desert', text: 'a sun-scorched desert of sand dunes and sparse scrub', tags: ['desert', 'dune', 'sand', 'arid'] },
  { tag: 'snowy-peak', text: 'a snow-covered mountainside under a pale winter sky', tags: ['snow', 'winter', 'frost', 'tundra', 'ice'] },
  { tag: 'jungle', text: 'a dense tropical jungle with thick vines and undergrowth', tags: ['jungle', 'tropical', 'vine'] },
  { tag: 'ruins', text: 'crumbling ancient stone ruins overtaken by moss and vine', tags: ['ruin', 'ruined', 'crumbling', 'abandoned'] },
  { tag: 'graveyard', text: 'an old graveyard with weathered headstones and bare trees', tags: ['graveyard', 'cemetery', 'crypt', 'tomb', 'grave'] },
  { tag: 'battlefield', text: 'a scarred battlefield with broken banners and debris', tags: ['battlefield', 'battleground'] },
  { tag: 'campsite', text: 'a travelers camp with a fire, tents, and bedrolls', tags: ['camp', 'campsite', 'tent', 'bedroll'] },

  // --- Wilderness: water ---
  { tag: 'riverside', text: 'a riverbank with reeds and slow-moving water', tags: ['river', 'stream', 'creek', 'bank'] },
  { tag: 'lake-shore', text: 'a calm lake shore with still water and reflections', tags: ['lake', 'pond', 'reflection'] },
  { tag: 'beach', text: 'a sandy ocean beach with rolling waves', tags: ['beach', 'shore', 'coast', 'seaside', 'ocean'] },
  { tag: 'waterfall', text: 'a rushing waterfall into a misty pool', tags: ['waterfall', 'falls', 'cascade'] },
  { tag: 'underground-lake', text: 'a still underground lake lit by glowing crystals', tags: ['underground lake', 'grotto'] },
  { tag: 'hot-spring', text: 'a steaming natural hot spring among rocks', tags: ['hot spring', 'spring', 'geyser'] },

  // --- Underground ---
  { tag: 'cave-entrance', text: 'the mouth of a rocky cave entrance', tags: ['cave', 'cavern mouth', 'entrance'] },
  { tag: 'cavern', text: 'a large natural cavern with stalactites and dim light', tags: ['cavern', 'grotto', 'chamber'] },
  { tag: 'mine-tunnel', text: 'a wooden-beamed mine tunnel with support timbers', tags: ['mine', 'tunnel', 'shaft', 'quarry'] },
  { tag: 'sewer', text: 'a dank stone sewer tunnel with shallow water', tags: ['sewer', 'drain', 'culvert'] },
  { tag: 'crystal-cave', text: 'a cavern glittering with embedded crystals', tags: ['crystal cave', 'gem cave'] },
  { tag: 'underground-hall', text: 'a vast carved underground hall with stone pillars', tags: ['underground hall', 'delve', 'depths'] },

  // --- Cultural / racial settlements ---
  { tag: 'elven-grove', text: 'an elegant elven dwelling built into living trees', tags: ['elven', 'elf settlement'] },
  { tag: 'dwarven-hall', text: 'a grand dwarven hall carved from solid rock', tags: ['dwarven', 'dwarf hall'] },
  { tag: 'orc-camp', text: 'a rough orc encampment of hide tents and bone totems', tags: ['orc camp', 'orcish'] },
  { tag: 'gnomish-workshop', text: 'a cluttered gnomish workshop full of small mechanisms', tags: ['gnomish', 'tinker', 'mechanism'] },
  { tag: 'fishing-village', text: 'a small coastal fishing village of weathered huts', tags: ['fishing village', 'fisherman'] },
  { tag: 'nomad-camp', text: 'a nomad encampment of wagons and canvas tents', tags: ['nomad', 'wagon', 'caravan'] },
]

/**
 * One distinctive establishing image per major named zone (town, city, or
 * major landmark region), added 28 Aug 2026 — "named things on the map
 * should have their own images, helps navigation." Every unlabeled room
 * inside that zone can share it, so at minimum "which town am I in" is
 * visually answerable, on top of the generic scene-type pool above. Chosen
 * from the top ~25 zones by room count, which is most of where players
 * actually stand (per DESIGN.md S4) — the long tail of 85 zones is covered
 * by the generic archetypes.
 */
const ZONES = [
  { tag: 'crossing', name: 'Crossing', desc: 'a large bustling trade town of timber and stone buildings, market stalls, and busy streets' },
  { tag: 'ratha', name: 'Ratha', desc: 'a fortified war-town, dark stone architecture and disciplined barracks' },
  { tag: 'shard', name: 'Shard', desc: 'a mountain trade town built into rocky terraces, stone buildings on rising ground' },
  { tag: 'riverhaven', name: 'Riverhaven', desc: 'a riverside town with docks, boats, and stone bridges over the water' },
  { tag: 'muspar-i', name: "Muspar'i", desc: 'an exotic desert-adjacent town of sandstone buildings and domed roofs' },
  { tag: 'boar-clan', name: 'Boar Clan', desc: 'a rugged frontier trade post surrounded by wilderness' },
  { tag: 'hibarnhvidar', name: 'Hibarnhvidar', desc: 'a dwarven mountain settlement of carved stone halls' },
  { tag: 'aesry-surlaenis-a', name: "Aesry Surlaenis'a", desc: 'an elven forest settlement built among living trees' },
  { tag: 'm-riss', name: "M'Riss", desc: "an exotic feline S'Kra Mur/Prydaen coastal settlement, ornate and warm-toned" },
  { tag: 'therenborough', name: 'Therenborough', desc: 'a modest keep-town with a central fortified keep' },
  { tag: 'mer-kresh', name: "Mer'Kresh", desc: 'a remote frontier trade outpost, weathered and sparse' },
  { tag: 'pokekehekepi', name: 'Pokekehekepi', desc: 'a jungle river settlement of raised wooden buildings' },
  { tag: 'leth-deriel', name: 'Leth Deriel', desc: 'an elegant elven forest city, refined architecture among trees' },
  { tag: 'fang-cove', name: 'Fang Cove', desc: 'a rough pirate-adjacent coastal cove settlement' },
  { tag: 'dirge', name: 'Dirge', desc: 'a grim, fog-shrouded town of dark stone' },
  { tag: 'hara-jaal', name: "Hara'jaal", desc: 'a desert nomad trade settlement of tents and sandstone' },
]

/**
 * Town-flavored locations, added 28 Aug 2026: "different towns are
 * different... type of shop and location, generally try to give flavor."
 * Each is the same location type as an ARCHETYPES entry, but described
 * with that specific town's character woven in, so a Ratha forge and a
 * Crossing forge don't look interchangeable. Kept to the location types
 * that actually vary by town culture — not every archetype needs a
 * per-town version, and skipping the ones that wouldn't (a cave doesn't
 * care which town it's near) is what keeps this from exploding past a
 * couple thousand.
 */
const TOWN_LOCATIONS = [
  { tag: 'shop-interior', text: 'the interior of a small shop, shelves of goods' },
  { tag: 'tavern', text: 'a tavern common room, a hearth and long wooden tables' },
  { tag: 'forge', text: 'a blacksmith forge with anvil, bellows, and glowing coals' },
  { tag: 'market-street', text: 'a bustling market street lined with vendor stalls and awnings' },
  { tag: 'temple', text: 'a quiet temple interior, candlelight and an altar' },
  { tag: 'guild-hall', text: 'a formal guild hall with banners and a long table' },
  { tag: 'bank', text: 'a formal bank hall with counters and ledgers' },
  { tag: 'alchemy-shop', text: 'an alchemist workshop, bottles, vials, and dried herbs' },
  { tag: 'inn-room', text: 'a modest inn bedroom with a bed and washstand' },
  { tag: 'city-street', text: 'a cobbled street between buildings' },
  { tag: 'city-gate', text: 'a fortified city gate' },
  { tag: 'town-square', text: 'an open town square with a central fountain or statue' },
]

const out = {}
for (const z of ZONES) {
  for (let i = 0; i < 5; i++) {
    const key = `zone-${z.tag}-${i}`
    out[key] = {
      archetype: `zone-${z.tag}`,
      matchTags: [z.name],
      matchZone: z.name,
      prompt: [`${z.name}, ${z.desc}`, STYLE].join(', '),
      negative: NEGATIVE,
      seed: seedOf(key),
      width: 336,
      height: 192,
    }
  }
}

for (const z of ZONES) {
  for (const loc of TOWN_LOCATIONS) {
    for (let i = 0; i < 3; i++) {
      const key = `town-${z.tag}-${loc.tag}-${i}`
      out[key] = {
        archetype: `zone-${z.tag}-${loc.tag}`,
        matchTags: [z.name, ...ARCHETYPES.find((a) => a.tag === loc.tag)?.tags ?? []],
        matchZone: z.name,
        prompt: [`${loc.text} in ${z.name}, ${z.desc}`, STYLE].join(', '),
        negative: NEGATIVE,
        seed: seedOf(key),
        width: 336,
        height: 192,
      }
    }
  }
}

for (const a of ARCHETYPES) {
  for (let i = 0; i < 9; i++) {
    const key = `archetype-${a.tag}-${i}`
    out[key] = {
      archetype: a.tag,
      matchTags: a.tags,
      prompt: [a.text, STYLE].join(', '),
      negative: NEGATIVE,
      seed: seedOf(key),
      width: 336,
      height: 192,
    }
  }
}

function seedOf(key) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

mkdirSync('data/art', { recursive: true })
writeFileSync('data/art/archetype-prompts.json', JSON.stringify(out, null, 1))
console.log(`${Object.keys(out).length} candidates across ${ARCHETYPES.length} archetypes (9 each)`)
