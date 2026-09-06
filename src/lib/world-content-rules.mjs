/**
 * What a room looks like on the isometric board, derived from the cartography
 * the app already ships.
 *
 * Dan, 6 Sep 2026, on the hand-built Crossing slice: "wow are you going to do
 * this for 17000 rooms? how many years? figure out how to batch." This module
 * is the answer's rule half. `tools/build-world-content.mjs` is the batch that
 * runs it over all 85 zones and writes `src/data/world/`.
 *
 * # Why the existing classifier could not be pointed at the whole game
 *
 * `tools/build-geometric-room-briefs.mjs` already classifies rooms, and it is
 * good — it is the source of the 1,060-cell Crossing classification the viewer
 * renders today. But it reads `data/art/room-prompts-priority.json`, which is
 * *authored prose*: a human-written description per place. There are 1,067 of
 * those and 17,750 rooms, so it can only ever cover the fraction somebody has
 * written about. This module reads what every room already carries — its title,
 * the cartographer's `label` and `color`, the zone's name, and the exit graph —
 * so it has an answer for all of them on the first run.
 *
 * A `place` rule stood in `GROUND_RULES` between `title` and `label` and was
 * removed after one run: it decided 0 rooms of 17,750, because the map's
 * `place` field is the same words as the title's own context half ("The
 * Crossing, Magen Road" has `place: "Magen Road"`). A rule that cannot fire is
 * dead code with a name in the coverage report, which is worse than absent — a
 * reader counts it as a signal the pipeline has and is not using.
 *
 * The two are not two classifiers. This one publishes the *same* shape the
 * brief classifier does (`{ tags, specialKinds, spatialMode, tier }`), because
 * `src/lib/isometric-board-layout.mjs::boardLayoutFor` and
 * `tools/build-primitive-world-manifest.mjs::primitiveRecipe` read that shape
 * and there must not be two vocabularies for one board. The lore classifier is
 * the *positive control*: `tools/build-world-content.mjs` prints how far the
 * two agree over the Crossing, and a rules change that drops that agreement is
 * a rules change that got worse.
 *
 * # Landmarks are not derived here
 *
 * `src/lib/mapLandmarks.ts` already owns "what kind of venue is this room",
 * with 32 categories, the mapper's "venue, street" title convention, and a
 * scoring pass that prefers a deliberate tag over a title noun. The batch
 * imports `landmarkFor` from it rather than restating any of it. A second
 * opinion about whether a room is a bank would drift from the one players
 * already see on the 2D map.
 *
 * # A rule is named, and the name is reported
 *
 * Every room records which rule decided it (`GROUND_RULES` below, in order).
 * The builder counts them, so "the colour table decided 3,000 rooms" is a
 * number rather than a belief, and a rule that stops firing shows up as a zero
 * instead of being silently covered by the one after it.
 */

/**
 * The ground a cell stands on.
 *
 * Deliberately richer than the five primitive kinds the Godot content pack can
 * draw today (`godot/scripts/shared_asset_content.gd::ensure_registration`).
 * `primitivesFor()` at the bottom of this file is the one place that narrows
 * this vocabulary down to kinds the registry actually has a factory for; a
 * ground kind is content, a primitive kind is a drawing instruction, and
 * collapsing the two would mean losing the distinction between a meadow and a
 * mountainside the day someone models one.
 */
export const GROUND_KINDS = [
  'street',
  'path',
  'interior',
  'cave',
  'water',
  'snow',
  'swamp',
  'sand',
  'forest',
  'farmland',
  'grass',
  'rock',
  'unknown',
]

/**
 * What the cell is drawn as: an open square, a walled interior, a cave, or
 * water. This is the decision the viewer branches on (a placeholder block and
 * a terrain plane, or a floor plane and a cutaway shell), which is why it is
 * four values and not thirteen.
 */
export const BLOCK_KINDS = ['outdoor-open', 'building-interior', 'cave', 'water']

/** Ground kind -> block kind. Total over GROUND_KINDS, asserted by the test. */
const BLOCK_FOR_GROUND = {
  street: 'outdoor-open',
  path: 'outdoor-open',
  interior: 'building-interior',
  cave: 'cave',
  water: 'water',
  snow: 'outdoor-open',
  swamp: 'outdoor-open',
  sand: 'outdoor-open',
  forest: 'outdoor-open',
  farmland: 'outdoor-open',
  grass: 'outdoor-open',
  rock: 'outdoor-open',
  unknown: 'outdoor-open',
}

export function blockKindFor(groundKind) {
  return BLOCK_FOR_GROUND[groundKind] ?? 'outdoor-open'
}

/**
 * The title vocabulary, in decision order.
 *
 * Measured before it was written: `tools/build-world-content.mjs --measure`
 * counts every word in all 17,750 room names, and the words below are the ones
 * that actually occur (road 1,349 · forest 623 · path 591 · room 539 · guild
 * 529 · hall 477 · temple 420 · trail 387 · cavern 312 · hallway 299 · river
 * 248 · tunnel 214 · street 184 …). A keyword nobody's map uses is a rule that
 * cannot fire, and the builder prints per-rule counts so one becoming dead is
 * visible.
 *
 * Order is the whole design. `street` comes before `interior` because
 * DragonRealms titles are compounds — "Tower Road", "Temple Street", "Bank
 * Street" are all roads, and a classifier that saw "tower" first would put a
 * player indoors on a public street. `water` comes after both because "River
 * Road" is a road; a room that is *in* the water says so with no street word
 * in it ("In the Water", "Underwater", "Liirewsag River").
 *
 * Every pattern is word-bounded. Unbounded fragments matched "hallway" for
 * "hall", "courtyard" for "rt", and "brambles" for "bram" — the same defect
 * `src/lib/mapData.ts` records for its own `\brt\b`.
 */
const GROUND_PATTERNS = [
  ['water', /\b(water|underwater|river|riverbank|stream|creek|brook|lake|pond|pool|sea|ocean|bay|lagoon|falls|cascade|rapids|ford|shoals|wharf|wharfs|dock|docks|pier|quay|jetty|harbor|harbour|moat|canal|cistern|well|spring|springs|shallows|deeps?|shipyard|slipway|boathouse|waterway|weir|sluice|estuary|delta|inlet|strait)\b/i],
  ['cave', /\b(cave|caves|cavern|caverns|grotto|tunnel|tunnels|catacomb|catacombs|crypt|mine|mines|shaft|burrow|warren|undercity|underground|subterranean|hollow|lair|den|pith|depths|labyrinth|sewer|sewers|drain|culvert|undercroft|delve|excavation|adit)\b/i],
  ['street', /\b(street|road|roads|avenue|lane|alley|boulevard|wynd|close|highway|causeway|bridge|plaza|square|courtyard|court|promenade|esplanade|market|bazaar|gate|gates|gatehouse|walk|walkway|thoroughfare|crossroads|junction|roundabout|terrace|quarter|district)\b/i],
  ['path', /\b(path|pathway|footpath|trail|trails|track|route|towpath|game trail|byway|steps|stair|stairs|stairway|ramp|ladder|gangway)\b/i],
  ['interior', /\b(room|rooms|hall|halls|hallway|hallways|chamber|chambers|office|offices|shop|store|salesroom|showroom|workroom|workshop|guild|guildhall|temple|shrine|chapel|sanctuary|sanctum|tabernacle|altar|monastery|abbey|inn|tavern|taproom|alehouse|house|manor|mansion|villa|cottage|hut|cabin|shack|shed|barn|stable|stables|tower|keep|castle|palace|fort|fortress|garrison|library|archive|museum|gallery|studio|forge|smithy|foundry|mill|bakery|kitchen|cellar|basement|attic|loft|foyer|lobby|vestibule|antechamber|parlor|parlour|bedroom|study|infirmary|triage|bank|teller|vault|treasury|mint|warehouse|storeroom|storage|locker|barracks|dormitory|refectory|floor|balcony|landing|stairwell|corridor|passage|passageway|interior|inside|booth|stall|kiosk|counter|desk|lift|deck|cabin|hold|galley|laboratory|lab|refectory|pantry|pantries|scullery|larder|buttery|nave|cloister|rotunda|atrium|arena|amphitheater|amphitheatre|stadium|ward|clinic|surgery|longhouse|guildhall|academy|school|college|university|observatory|apothecary|tannery|brewery|distillery|dairy|smokehouse|icehouse|granary|armory|armoury|arsenal|treasury|pawnshop|teahouse|dining|servants)\b/i],
  ['snow', /\b(snow|snowy|snowfield|ice|icy|iceberg|glacier|glacial|frozen|frost|frostbound|tundra|permafrost|drift|drifts)\b/i],
  ['swamp', /\b(swamp|marsh|marshes|marshland|bog|fen|mire|quagmire|morass|slough|wetland|wetlands|peat|fens|swale|muskeg|quicksand)\b/i],
  ['sand', /\b(sand|sands|sandy|desert|dune|dunes|beach|shore|shoreline|strand|oasis|wastes|badlands|dust|dustbowl)\b/i],
  ['forest', /\b(forest|forests|wood|woods|woodland|woodlands|grove|groves|thicket|thickets|copse|brambles|bramble|understory|jungle|canopy|timber|orchard|glade|glades|arbor|arbour|treeline|pines|pinewood|birchwood|oakwood)\b/i],
  ['farmland', /\b(farm|farms|farmland|farmlands|farmstead|croft|paddock|vineyard|garden|gardens|nursery|greenhouse|allotment|pasture|pastures)\b/i],
  ['grass', /\b(grass|grasses|grassland|grasslands|meadow|meadows|field|fields|green|lawn|plain|plains|prairie|savanna|savannah|steppe|moor|moors|heath|downs|common|commons|clearing|clearings|park|parkland|wilderness|wilds|wildland|scrub|scrubland|brush|bracken|weald|glen|dell|vale|camp|encampment|village|hamlet|settlement|clan|outpost)\b/i],
  ['rock', /\b(mountain|mountains|mountainside|mount|hill|hills|hillside|cliff|cliffs|crag|crags|bluff|ridge|ridgeline|peak|peaks|summit|slope|slopes|scree|boulder|boulders|rocky|rock|rocks|stone|stony|quarry|canyon|gorge|ravine|gully|chasm|plateau|mesa|butte|outcrop|ledge|terracing|volcano|lava|caldera)\b/i],
]

/**
 * Zone-name fallback.
 *
 * Weaker than a title and stronger than nothing: a room called "Second Bend"
 * in "Darkling Wood" is in a wood, and a room called "The Pith" in "Seacaves"
 * is in a cave. Only kinds a zone name can honestly assert are here — no zone
 * is called "Street", and inferring an interior from a zone name would put a
 * roof over open country.
 */
const ZONE_PATTERNS = [
  ['cave', /\b(cave|caves|caverns?|seacaves|catacombs?|mine|mines|undershard|underground|tunnels?|depths|crypt|sewers?|labyrinth|abyss)\b/i],
  ['forest', /\b(forest|wood|woods|woodland|grove|thicket|jungle)\b/i],
  ['water', /\b(river|lake|sea|bay|harbou?r|marsh|ford|falls|isle|island|cove|reef)\b/i],
  ['snow', /\b(ice|icy|frozen|glacier|snow|tundra)\b/i],
  ['sand', /\b(desert|dunes?|sands?|wastes)\b/i],
  ['rock', /\b(mountains?|peaks?|canyon|cliffs?|crags?|volcano)\b/i],
  ['grass', /\b(plains?|grasslands?|steppe|moors?|meadows?|wilds?|wilderness|fields?|clan|village)\b/i],
]

/**
 * The order rules are tried in, and the names the coverage report counts by.
 *
 * `colour` is first, per the brief — but only for colours the builder has
 * *measured* as coherent (see `deriveColourTable` in
 * `tools/build-world-content.mjs`). The cartographer colours 4,395 of 17,750
 * rooms and only some of those colours mean one thing: `#0000FF` is water in
 * 783 rooms and means it, while `#00FFFF` covers hallways, garden paths and
 * town squares alike. Admitting the coherent ones and demoting the rest is
 * what makes "colour first" true rather than merely stated.
 */
export const GROUND_RULES = ['colour', 'title', 'label', 'zone', 'neighbour', 'unknown']

/** First matching pattern in a list, or null. */
function firstMatch(patterns, text) {
  if (!text) return null
  for (const [kind, pattern] of patterns) if (pattern.test(text)) return kind
  return null
}

/** The ground kind a room title, place or label states outright, or null. */
export function groundKindFromText(text) {
  return firstMatch(GROUND_PATTERNS, text)
}

/** The ground kind a zone name states outright, or null. */
export function groundKindFromZoneName(name) {
  return firstMatch(ZONE_PATTERNS, name)
}

/**
 * The room's own subject, the way `src/lib/mapLandmarks.ts::subjectOf` reads
 * it: the mapper writes "venue, street or district" and only the first half
 * says what the room is.
 *
 * Restated here rather than imported because that function is module-private
 * to a `.ts` file and exporting it would widen a public surface for one
 * caller. What is *not* restated is the landmark taxonomy itself — that is
 * imported whole. If `subjectOf` ever becomes exported, this should call it.
 */
export function titleSubject(title) {
  const text = String(title ?? '')
  const comma = text.indexOf(',')
  if (comma < 0) return text
  const subject = text.slice(0, comma).trim()
  const context = text.slice(comma + 1).trim()
  return context.toLocaleLowerCase().startsWith(subject.toLocaleLowerCase()) ? '' : subject
}

/**
 * The part of the title after the comma: the street or district.
 *
 * "The Crossing, Magen Road" is a road, and the word that says so is on the
 * far side of the comma. Both halves are asked, subject first, because "Half
 * Pint Inn, Clanthew Boulevard" is an inn on a boulevard and the inn is the
 * room.
 */
export function titleContext(title) {
  const text = String(title ?? '')
  const comma = text.indexOf(',')
  return comma < 0 ? '' : text.slice(comma + 1).trim()
}

/**
 * The tag vocabulary `boardLayoutFor` and `primitiveRecipe` already read.
 *
 * Word for word the tags `tools/build-geometric-room-briefs.mjs::classify`
 * emits, because those two consumers branch on these exact strings and a
 * second vocabulary for one board is the drift this module exists inside a
 * shared file to avoid.
 */
export function tagsFor({ groundKind, landmarkKind, subject, context }) {
  const tags = []
  const text = `${subject} ${context}`.toLowerCase()
  if (landmarkKind === 'guild' || /\bguild\b/.test(text)) tags.push('guild')
  if (landmarkKind === 'temple' || /\b(temple|shrine|sanctuary|chapel|church|altar)\b/.test(text)) tags.push('sacred')
  if (landmarkKind === 'bank' || /\b(bank|teller|treasury|mint|vault)\b/.test(text)) tags.push('banking')
  if (landmarkKind === 'shop' || /\b(market|bazaar|mongers?|merchant)\b/.test(text)) tags.push('market')
  if (/\b(gate|gates|gatehouse|customs|portcullis|town wall)\b/.test(text)) tags.push('gate')
  if (/\b(bridge|causeway|trollferry)\b/.test(text)) tags.push('bridge')
  if (groundKind === 'water') tags.push('water')
  if (groundKind === 'interior' || groundKind === 'cave') tags.push('interior')
  if (!tags.length) tags.push('ordinary')
  return [...new Set(tags)]
}

/** The special-set kinds, same vocabulary and same source as `tagsFor`. */
export function specialKindsFor(tags) {
  return tags.filter((tag) => ['guild', 'sacred', 'banking', 'market', 'gate'].includes(tag))
}

/**
 * The four spatial modes `boardLayoutFor` and `primitiveRecipe` branch on.
 *
 * `interior-cutaway` is the one with a visible consequence today: it is what
 * makes a cell 3 m tall instead of 1 and draws a floor plane instead of
 * terrain. A cave is a cutaway too — you are inside something with a roof —
 * which is a claim this file makes and the Crossing agreement number checks.
 */
export function spatialModeFor(blockKind, tags) {
  if (blockKind === 'building-interior' || blockKind === 'cave') return 'interior-cutaway'
  if (tags.includes('water') && tags.includes('bridge')) return 'bridge-water'
  if (tags.includes('water')) return 'waterfront'
  return 'exterior-cell'
}

/** Same three tiers, same meaning, as the lore classifier's. */
export function tierFor(specialKinds, tags) {
  if (specialKinds.length) return 'special'
  if (tags.includes('bridge') || tags.includes('water') || tags.includes('interior')) return 'feature'
  return 'ordinary'
}

/** The eight compass sides a cell has, in the order `COMPASS_ANCHORS` lists them. */
export const COMPASS_SIDES = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
]

/**
 * Which of a cell's eight sides the rough-edge boundary kit belongs on.
 *
 * A side is a boundary when nothing walkable is on the other side of it:
 * either no exit leaves this room that way at all, or the exit leads to water
 * from dry land. The second half matters — a quay with a river to its east has
 * a real edge there even though a swimmer could cross it, and drawing rocks
 * along it is exactly what the kit is for.
 *
 * Vertical and `go`-through-a-door exits are not compass bearings and never
 * clear a side; `expandCompassDirection` returns null for them on purpose (see
 * its own comment in `isometric-board-layout.mjs`).
 */
export function boundaryEdgesFor({ exits, expandDirection, blockKindOf, ownBlockKind }) {
  const cleared = new Set()
  for (const exit of exits ?? []) {
    const side = expandDirection(exit.dir)
    if (!side) continue
    const neighbour = blockKindOf(exit.to)
    if (neighbour == null) continue
    if (neighbour === 'water' && ownBlockKind !== 'water') continue
    cleared.add(side)
  }
  return COMPASS_SIDES.filter((side) => !cleared.has(side))
}

/**
 * The primitive kinds the viewer is asked to draw for this cell.
 *
 * Narrowed to what a factory is registered for. `content_registry.gd` falls
 * back to a magenta placeholder box for an unregistered kind, which is honest
 * and is not content — asking for `special-landmark-silhouette` in 3,000 rooms
 * would fill the board with placeholder boxes and call it a world. The
 * Crossing art path (`tools/build-primitive-world-manifest.mjs`) asks for the
 * richer set because it has an asset ledger behind it; this is the set that
 * has a mesh.
 *
 * `tools/world-content-test.mjs` derives the registered set from
 * `godot/scripts/shared_asset_content.gd` and fails if anything here is not in
 * it, so a kind renamed in GDScript takes this file red rather than quietly
 * becoming a placeholder.
 */
export function primitivesFor({ blockKind, tags, boundaryEdges }) {
  const items = [
    blockKind === 'building-interior' || blockKind === 'cave'
      ? { kind: 'interior-floor-5m', role: 'base' }
      : { kind: 'terrain-cell-5m', role: 'base' },
  ]
  if (blockKind === 'water' || tags.includes('water')) items.push({ kind: 'water-ribbon-5m', role: 'landform' })
  if (tags.includes('bridge')) items.push({ kind: 'bridge-span-5m', role: 'landform' })
  if (boundaryEdges.length) items.push({ kind: 'rough-edge-boundary-kit', role: 'boundary' })
  return items
}
