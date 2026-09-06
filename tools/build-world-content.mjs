/**
 * Derive board content for every room in the game, from the cartography
 * already on disk.
 *
 * Dan, 6 Sep 2026, looking at the hand-built 19-cell Crossing mock: "wow are
 * you going to do this for 17000 rooms? how many years? figure out how to
 * batch." This is the batch. It reads `src/data/map/*.json` — 85 zones, 17,750
 * rooms, 42,866 exits — and writes one content manifest per zone into
 * `src/data/world/`, in a couple of seconds, deterministically.
 *
 *   node --experimental-strip-types tools/build-world-content.mjs
 *   node --experimental-strip-types tools/build-world-content.mjs --check
 *   node --experimental-strip-types tools/build-world-content.mjs --measure
 *   node --experimental-strip-types tools/build-world-content.mjs --control
 *
 * `--experimental-strip-types` because `src/lib/mapLandmarks.ts` is TypeScript
 * and this tool imports it rather than restating it: that file already owns
 * "what kind of venue is this room" for the 2D map, with 32 categories and the
 * mapper's own "venue, street" title convention. A second opinion about
 * whether a room is a bank would drift from the one players already see.
 *
 * The rules live in `src/lib/world-content-rules.mjs`, not here, because the
 * live compiler (`src/lib/presentationBridge.ts`) and the Godot-side art path
 * both have to agree with them. This file is the run: read, apply, count,
 * report, write.
 *
 * # What the report is for
 *
 * Every run prints which rule decided how many rooms. That is the check, not
 * the decoration. A zero against a rule that used to fire is a rule that has
 * stopped working, and it is invisible in the output files themselves because
 * the rule after it quietly covers the same rooms with a worse answer. The
 * same reasoning gives the run a floor: fewer than MIN_ROOMS rooms read is an
 * abort naming the count, because a builder pointed at an empty or half-copied
 * map directory would otherwise write 85 tiny manifests and report success.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { landmarkFor } from '../src/lib/mapLandmarks.ts'
import { expandCompassDirection } from '../src/lib/isometric-board-layout.mjs'
import {
  GROUND_KINDS,
  GROUND_RULES,
  blockKindFor,
  boundaryEdgesFor,
  groundKindFromText,
  groundKindFromZoneName,
  spatialModeFor,
  specialKindsFor,
  tagsFor,
  tierFor,
  titleContext,
  titleSubject,
} from '../src/lib/world-content-rules.mjs'

const MAP_DIR = 'src/data/map'
const OUT_DIR = 'src/data/world'
const RESIDUE_PATH = 'tools/world-content-residue.csv'
const BRIEFS_PATH = 'data/art/out/geometric-room-briefs.json'

/**
 * A floor, not a comment.
 *
 * `src/lib/mapData.ts`'s own docstring states 17,750 rooms and
 * `tools/map-data-test.mjs` holds it to that. 15,000 is well below it and well
 * above anything a truncated read could produce, so it catches an empty or
 * partial `src/data/map` without needing to be touched when the map is
 * rebuilt. A check that cannot fail is not a check: a run over zero rooms
 * would otherwise report 0.0% unknown, which is the best coverage number this
 * tool can print and means nothing at all.
 */
const MIN_ROOMS = 15000

/**
 * The unknown ceiling. Printed every run and asserted by
 * `tools/world-content-test.mjs`; the brief asked for "well under 5 percent".
 */
export const UNKNOWN_CEILING_PERCENT = 5

/**
 * How coherent a colour has to be before it is allowed to outrank a title.
 *
 * 0.75 rather than a bare majority, and the reason is what the colour is
 * outranking. A colour admitted at 60% is wrong about two rooms in five, and
 * the rule it is displacing — the title keyword that produced the score — was
 * right about those two. A signal has to be *better* than the one it pre-empts,
 * not merely more often right than wrong. Measured at 0.60 the gate admitted
 * `#00FF00` (65%), which is the mapper's marker for a service door as much as
 * for the room behind it, and it put "The Crossing, Hodierna Way" and "The
 * Crossing, Mongers' Square" indoors.
 */
const COLOUR_MIN_SUPPORT = 20
const COLOUR_MIN_PURITY = 0.75

const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')
const measureOnly = args.has('--measure')
const withControl = args.has('--control')

// ---------------------------------------------------------------- read

const zoneFiles = readdirSync(MAP_DIR)
  .filter((name) => name.endsWith('.json') && name !== 'index.json')
  .sort()
const zones = zoneFiles.map((file) => {
  const zone = JSON.parse(readFileSync(join(MAP_DIR, file), 'utf8'))
  return { id: zone.id ?? file.slice(0, -5), name: zone.name ?? '', rooms: zone.rooms ?? [] }
})
const totalRooms = zones.reduce((n, zone) => n + zone.rooms.length, 0)
if (totalRooms < MIN_ROOMS) {
  console.error(`FAIL read ${totalRooms} rooms from ${MAP_DIR} across ${zones.length} zones, which is below the ${MIN_ROOMS} floor.`)
  console.error('     The map directory is empty, truncated, or has changed shape. Refusing to publish a world content manifest derived from it.')
  process.exit(1)
}

/** The room's own words, subject first: "Half Pint Inn, Clanthew Boulevard". */
const textOf = (room) => ({
  subject: titleSubject(room.name ?? ''),
  context: titleContext(room.name ?? ''),
})

// ------------------------------------------------------- colour table

/**
 * The colour→kind table, derived rather than typed.
 *
 * The cartographer colours 4,395 of 17,750 rooms and the colours do not all
 * mean one thing. Measured over the whole game: `#993300` is a cave in 83% of
 * the rooms where a title keyword also has an opinion and `#FF0000` an interior
 * in 85%, while `#0000FF` manages only 64% for water (it covers the Murky
 * Caverns and the Pith as well as the rivers) and `#00FFFF` 34% across
 * hallways, garden paths, town squares and second floors. So each colour is
 * scored against the title rules on the rooms where both fire, and admitted
 * only if it has enough support and enough agreement. The table and the numbers
 * behind it are printed every run.
 *
 * This is what makes "colour first" honest. Applying every colour first would
 * put `#00FFFF`'s 960 rooms on whatever its plurality happened to be that day;
 * applying none would throw away the strongest signal in the data for the
 * quarter of rooms that have one.
 */
function deriveColourTable() {
  const byColour = new Map()
  for (const zone of zones) {
    for (const room of zone.rooms) {
      const colour = room.color
      if (!colour) continue
      const { subject, context } = textOf(room)
      const kind = groundKindFromText(context) ?? groundKindFromText(subject)
      if (!byColour.has(colour)) byColour.set(colour, { total: 0, votes: new Map() })
      const entry = byColour.get(colour)
      entry.total += 1
      if (kind) entry.votes.set(kind, (entry.votes.get(kind) ?? 0) + 1)
    }
  }
  const rows = []
  for (const [colour, entry] of [...byColour].sort((a, b) => b[1].total - a[1].total)) {
    const support = [...entry.votes.values()].reduce((n, v) => n + v, 0)
    const [best, count] = [...entry.votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0]
    const purity = support ? count / support : 0
    const admitted = Boolean(best) && support >= COLOUR_MIN_SUPPORT && purity >= COLOUR_MIN_PURITY
    rows.push({ colour, rooms: entry.total, support, kind: best, purity, admitted })
  }
  return rows
}

const colourRows = deriveColourTable()
const colourKind = new Map(colourRows.filter((row) => row.admitted).map((row) => [row.colour, row.kind]))

// --------------------------------------------------------- classify

const ruleCounts = new Map(GROUND_RULES.map((rule) => [rule, 0]))
const kindCounts = new Map(GROUND_KINDS.map((kind) => [kind, 0]))

/** Everything the direct rules can say, before neighbour propagation. */
function directGround(room, zone) {
  const { subject, context } = textOf(room)
  const byColour = room.color ? colourKind.get(room.color) : null
  if (byColour) return { kind: byColour, rule: 'colour' }
  const byTitle = groundKindFromText(context) ?? groundKindFromText(subject)
  if (byTitle) return { kind: byTitle, rule: 'title' }
  const byLabel = groundKindFromText(room.label)
  if (byLabel) return { kind: byLabel, rule: 'label' }
  const byZone = groundKindFromZoneName(zone.name)
  if (byZone) return { kind: byZone, rule: 'zone' }
  return null
}

/**
 * Rooms nothing said anything about take their neighbours' answer.
 *
 * A room whose exits all lead to street rooms is a street: that is the brief's
 * own example and it is the commonest shape of the residue, because a
 * cartographer names a run of road once and leaves "Second Bend" for the rest.
 *
 * Iterated to a fixed point rather than one pass, so a chain of unnamed rooms
 * inside a named district resolves inward from both ends. Each round reads the
 * *previous* round's answers, so the result does not depend on the order rooms
 * are visited, and ties break on the ground-kind vocabulary's own order — both
 * so a rebuild is byte-identical.
 *
 * A vote does not cross a threshold, and that exclusion is the whole difference
 * between this rule working and it being actively harmful. `dir: 'go'` and
 * `dir: 'out'` are the game's own marker for a doorway — `mapData.ts`'s
 * `kindOfExit` already reads them that way and calls the result `enter` — and a
 * doorway is exactly where the ground changes. A street ringed by shop doors is
 * still a street, and every one of those doors is an interior room one exit
 * away.
 *
 * Measured on the Crossing with thresholds counted from the start: 284 rooms
 * went under a roof that the hand-made classification has out of doors —
 * Hodierna Way, Goodwhate Pike, Varlet's Run, Truffenyi Place, ordinary streets
 * surrounded by shops. Measured with interiors barred from voting at all
 * instead, the opposite failure appeared: 1,024 rooms unknown, because a back
 * room whose only clue is the shop it opens off had nothing left to learn from.
 *
 * So a threshold is the *last* evidence used, not the first, and this runs in
 * two phases. Phase one crosses only non-threshold exits — compass moves,
 * stairs, a climb, all of which stay inside one kind of place and carry their
 * ground with them. Phase two lets what is left cross a doorway. By then every
 * street with a name has been decided by its title and every run of open
 * country by phase one, so the rooms still asking are the isolated ones a
 * doorway is genuinely the only route to.
 */
const THRESHOLD_DIRECTIONS = new Set(['go', 'out'])

function propagate(zone, decided) {
  for (const crossThresholds of [false, true]) propagatePhase(zone, decided, crossThresholds)
}

function propagatePhase(zone, decided, crossThresholds) {
  const usable = (exit) => crossThresholds || !THRESHOLD_DIRECTIONS.has(exit.dir)
  for (let round = 0; round < 12; round += 1) {
    const snapshot = new Map(decided)
    let changed = 0
    for (const room of zone.rooms) {
      if (snapshot.has(room.id)) continue
      const votes = new Map()
      for (const exit of room.exits ?? []) {
        if (!usable(exit)) continue
        const neighbour = snapshot.get(exit.to)
        if (!neighbour) continue
        votes.set(neighbour.kind, (votes.get(neighbour.kind) ?? 0) + 1)
      }
      // Also count rooms that point *at* this one: a dead end reached by a
      // one-way exit has no outgoing evidence of its own.
      for (const other of zone.rooms) {
        if (other.id === room.id) continue
        if (!(other.exits ?? []).some((exit) => exit.to === room.id && usable(exit))) continue
        const neighbour = snapshot.get(other.id)
        if (!neighbour) continue
        votes.set(neighbour.kind, (votes.get(neighbour.kind) ?? 0) + 1)
      }
      if (!votes.size) continue
      const best = [...votes].sort(
        (a, b) => b[1] - a[1] || GROUND_KINDS.indexOf(a[0]) - GROUND_KINDS.indexOf(b[0])
      )[0][0]
      decided.set(room.id, { kind: best, rule: 'neighbour' })
      changed += 1
    }
    if (!changed) break
  }
}

const residue = []
const perZone = []
const zoneOutputs = new Map()
const crossingContent = new Map()

for (const zone of zones) {
  const decided = new Map()
  for (const room of zone.rooms) {
    const direct = directGround(room, zone)
    if (direct) decided.set(room.id, direct)
  }
  propagate(zone, decided)

  // Two passes over the zone: block kinds have to exist for every room before
  // any room's boundary edges can ask what is on the far side of an exit.
  const blockOf = new Map()
  for (const room of zone.rooms) {
    const answer = decided.get(room.id) ?? { kind: 'unknown', rule: 'unknown' }
    blockOf.set(room.id, blockKindFor(answer.kind))
  }

  const rooms = zone.rooms.map((room) => {
    const answer = decided.get(room.id) ?? { kind: 'unknown', rule: 'unknown' }
    ruleCounts.set(answer.rule, ruleCounts.get(answer.rule) + 1)
    kindCounts.set(answer.kind, kindCounts.get(answer.kind) + 1)
    const blockKind = blockOf.get(room.id)
    const { subject, context } = textOf(room)
    // The 2D map's own landmark taxonomy, asked the way the map asks it: the
    // label travels as the first tag (see mapData.ts::toZoneRoom).
    const landmark = landmarkFor({
      id: room.id,
      title: room.name ?? '',
      tags: room.label ? [room.label] : [],
      gateway: room.gateway,
      leaves: room.leaves,
    })
    const landmarkKind = landmark?.kind ?? null
    const tags = tagsFor({ groundKind: answer.kind, landmarkKind, subject, context })
    const specialKinds = specialKindsFor(tags)
    const spatialMode = spatialModeFor(blockKind, tags)
    const boundaryEdges = boundaryEdgesFor({
      exits: room.exits,
      expandDirection: expandCompassDirection,
      blockKindOf: (id) => blockOf.get(id) ?? null,
      ownBlockKind: blockKind,
    })
    if (answer.kind === 'unknown') {
      residue.push([
        `${zone.id}-${room.id}`,
        zone.id,
        zone.name,
        room.name ?? '',
        room.color ?? '',
        room.label ?? '',
        room.place ?? '',
      ])
    }
    const entry = {
      id: room.id,
      ground: answer.kind,
      rule: answer.rule,
      block: blockKind,
      landmark: landmarkKind,
      classification: { tags, specialKinds, spatialMode, tier: tierFor(specialKinds, tags) },
      boundaryEdges,
    }
    if (zone.id === '1') crossingContent.set(room.id, entry)
    return entry
  })

  const unknown = rooms.filter((room) => room.ground === 'unknown').length
  perZone.push({ id: zone.id, name: zone.name, rooms: rooms.length, unknown })
  zoneOutputs.set(zone.id, {
    schemaVersion: 1,
    zone: zone.id,
    name: zone.name,
    generatedBy: 'tools/build-world-content.mjs',
    source: `${MAP_DIR}/${zone.id}.json`,
    counts: { rooms: rooms.length, unknown },
    rooms,
  })
}

// ------------------------------------------------------------ report

const unknownTotal = perZone.reduce((n, zone) => n + zone.unknown, 0)
const unknownPercent = (unknownTotal / totalRooms) * 100

console.log(`read ${totalRooms} rooms in ${zones.length} zones from ${MAP_DIR} (floor ${MIN_ROOMS})`)
console.log('')
console.log('colour table (derived: each colour scored against the title rules on the rooms where both fire)')
console.log('  colour     rooms  scored   kind        purity  admitted')
for (const row of colourRows) {
  console.log(
    `  ${row.colour.padEnd(9)} ${String(row.rooms).padStart(6)}  ${String(row.support).padStart(6)}   ${String(row.kind ?? '-').padEnd(10)} ${(row.purity * 100).toFixed(0).padStart(5)}%  ${row.admitted ? 'yes' : `no (needs ${COLOUR_MIN_SUPPORT} scored and ${COLOUR_MIN_PURITY * 100}%)`}`
  )
}
console.log('')
console.log('rooms decided, by rule (in the order the rules are tried)')
for (const rule of GROUND_RULES) {
  const n = ruleCounts.get(rule)
  console.log(`  ${rule.padEnd(10)} ${String(n).padStart(6)}  ${((n / totalRooms) * 100).toFixed(1).padStart(5)}%`)
}
console.log('')
console.log('ground kinds')
for (const [kind, n] of [...kindCounts].sort((a, b) => b[1] - a[1])) {
  if (!n) continue
  const bar = '#'.repeat(Math.max(1, Math.round((n / totalRooms) * 60)))
  console.log(`  ${kind.padEnd(10)} ${String(n).padStart(6)}  ${bar}`)
}
console.log('')
console.log(`unknown: ${unknownTotal} of ${totalRooms} = ${unknownPercent.toFixed(2)}% (ceiling ${UNKNOWN_CEILING_PERCENT}%)`)
const worst = [...perZone].filter((z) => z.unknown).sort((a, b) => b.unknown - a.unknown).slice(0, 10)
if (worst.length) {
  console.log('zones with the most unknown rooms:')
  for (const zone of worst) {
    console.log(`  ${zone.id.padEnd(6)} ${String(zone.unknown).padStart(5)} of ${String(zone.rooms).padStart(5)}  ${zone.name}`)
  }
} else {
  console.log('no zone has an unknown room.')
}

// ------------------------------------------- positive control: the Crossing

/**
 * The hand-made classification, used as a control rather than replaced.
 *
 * `tools/build-geometric-room-briefs.mjs` classifies 1,060 Crossing rooms from
 * authored prose. This tool classifies the same rooms from map data alone. The
 * two are independent instruments pointed at one town, so the fraction they
 * agree on is the only evidence available that these rules are right rather
 * than merely total — 100% coverage with wrong answers looks identical to 100%
 * coverage with right ones in every other number this file prints.
 *
 * Three states, not two. If the briefs are not on disk (`data/art/out` is
 * generated and gitignored, so a fresh worktree has none of it) this says NOT
 * CHECKED and why, rather than passing quietly.
 */
function reportControl() {
  console.log('')
  if (!existsSync(BRIEFS_PATH)) {
    try {
      execFileSync(process.execPath, ['tools/build-geometric-room-briefs.mjs'], { stdio: 'ignore' })
    } catch {
      /* falls through to NOT CHECKED below */
    }
  }
  if (!existsSync(BRIEFS_PATH)) {
    console.log(`control: NOT CHECKED — ${BRIEFS_PATH} is absent and could not be generated, so the hand-made Crossing classification is unavailable to compare against.`)
    return null
  }
  const catalogue = JSON.parse(readFileSync(BRIEFS_PATH, 'utf8'))
  const described = catalogue.roomBriefs.filter(
    (brief) => brief.zone === '1' && brief.briefStatus === 'described'
  )
  if (!described.length) {
    console.log('control: NOT CHECKED — the brief catalogue holds no described Crossing rooms.')
    return null
  }
  // The two instruments do not have the same unit, and saying so is the whole
  // value of running the control. The lore classifier's unit is a *place*: one
  // authored description covers every room of Asemath Academy, so all 24 of
  // them get one answer. This tool's unit is a room. Over a multi-room place
  // the two cannot agree beyond however uniform that place happens to be, and
  // the residual is not a defect in either.
  //
  // So both numbers are printed. The whole-zone figure is the honest headline;
  // the single-room-place figure is the apples-to-apples one, over exactly the
  // rooms where the lore classifier's unit and this one's are the same thing.
  const roomsPerPlace = new Map()
  for (const brief of described) roomsPerPlace.set(brief.placeId, (roomsPerPlace.get(brief.placeId) ?? 0) + 1)

  const score = (subset) => {
    let modeAgree = 0
    let tierAgree = 0
    let compared = 0
    const disagreements = new Map()
    for (const brief of subset) {
      const mine = crossingContent.get(brief.roomId)
      if (!mine) continue
      compared += 1
      if (mine.classification.spatialMode === brief.classification.spatialMode) modeAgree += 1
      else {
        const key = `${brief.classification.spatialMode} -> ${mine.classification.spatialMode}`
        disagreements.set(key, (disagreements.get(key) ?? 0) + 1)
      }
      if (mine.classification.tier === brief.classification.tier) tierAgree += 1
    }
    return { compared, modeAgree, tierAgree, disagreements, modePercent: compared ? (modeAgree / compared) * 100 : 0 }
  }

  const all = score(described)
  const single = score(described.filter((brief) => roomsPerPlace.get(brief.placeId) === 1))
  const adjudicated = adjudicateWithExitGraph(described)
  console.log(`control: the hand-made Crossing classification, ${all.compared} of ${described.length} described rooms compared`)
  console.log(`  every described room   spatialMode ${all.modeAgree}/${all.compared} = ${all.modePercent.toFixed(1)}%  ·  tier ${all.tierAgree}/${all.compared} = ${((all.tierAgree / all.compared) * 100).toFixed(1)}%`)
  console.log(`  single-room places     spatialMode ${single.modeAgree}/${single.compared} = ${single.modePercent.toFixed(1)}%  ·  tier ${single.tierAgree}/${single.compared} = ${((single.tierAgree / single.compared) * 100).toFixed(1)}%   (same unit on both sides)`)
  console.log('  largest disagreements over every described room:')
  for (const [key, n] of [...all.disagreements].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    console.log(`    ${String(n).padStart(4)}  lore said ${key}`)
  }
  if (adjudicated) {
    console.log('  adjudicated by the exit graph, which neither classifier reads:')
    console.log(`    ${adjudicated.disputed} rooms the lore calls outdoors and this calls indoors; ${adjudicated.behindDoor} of them (${adjudicated.percent.toFixed(1)}%) are behind a door`)
    console.log(`    of this tool's ${adjudicated.mineInterior} Crossing interiors, ${adjudicated.mineBehindDoor} (${((adjudicated.mineBehindDoor / adjudicated.mineInterior) * 100).toFixed(1)}%) are behind a door`)
    console.log(`    of the lore classifier's ${adjudicated.loreInterior}, ${adjudicated.loreBehindDoor} (${((adjudicated.loreBehindDoor / adjudicated.loreInterior) * 100).toFixed(1)}%)`)
  }
  return { all, single, adjudicated }
}

/**
 * A third instrument, for when the first two disagree.
 *
 * The two classifiers above both read words. When they disagree about whether
 * a room is indoors, no amount of comparing them settles which is right, and
 * picking the older one because it is older is not evidence — so this asks
 * something that reads no words at all: the exit graph.
 *
 * In DragonRealms a doorway is `go <something>` (`dir: 'go'` or `'out'`, which
 * `mapData.ts::kindOfExit` already calls `enter`). Delete every threshold from
 * the zone graph and a town falls into one big component — the streets, all
 * walkable to each other without opening anything — plus a few hundred small
 * islands, which are the insides of buildings. A room outside the largest
 * component is behind a door, and that is a fact about the topology rather than
 * about anybody's keyword list.
 */
function adjudicateWithExitGraph(described) {
  const crossing = zones.find((zone) => zone.id === '1')
  if (!crossing) return null
  const adjacency = new Map(crossing.rooms.map((room) => [room.id, []]))
  for (const room of crossing.rooms) {
    for (const exit of room.exits ?? []) {
      if (THRESHOLD_DIRECTIONS.has(exit.dir)) continue
      adjacency.get(room.id)?.push(exit.to)
      adjacency.get(exit.to)?.push(room.id)
    }
  }
  const seen = new Set()
  const components = []
  for (const room of crossing.rooms) {
    if (seen.has(room.id)) continue
    const component = []
    const stack = [room.id]
    seen.add(room.id)
    while (stack.length) {
      const id = stack.pop()
      component.push(id)
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    components.push(component)
  }
  components.sort((a, b) => b.length - a.length)
  const outdoors = new Set(components[0] ?? [])
  let disputed = 0
  let behindDoor = 0
  let mineInterior = 0
  let mineBehindDoor = 0
  let loreInterior = 0
  let loreBehindDoor = 0
  for (const brief of described) {
    const mine = crossingContent.get(brief.roomId)
    if (!mine) continue
    const inside = !outdoors.has(brief.roomId)
    if (mine.classification.spatialMode === 'interior-cutaway') {
      mineInterior += 1
      if (inside) mineBehindDoor += 1
    }
    if (brief.classification.spatialMode === 'interior-cutaway') {
      loreInterior += 1
      if (inside) loreBehindDoor += 1
    }
    if (brief.classification.spatialMode === 'exterior-cell' && mine.classification.spatialMode === 'interior-cutaway') {
      disputed += 1
      if (inside) behindDoor += 1
    }
  }
  return {
    disputed,
    behindDoor,
    percent: disputed ? (behindDoor / disputed) * 100 : 0,
    mineInterior,
    mineBehindDoor,
    loreInterior,
    loreBehindDoor,
  }
}

if (withControl) reportControl()

if (measureOnly) process.exit(0)

// ------------------------------------------------------------- write

/**
 * Compact, not pretty-printed, and it does not carry the primitive list.
 *
 * Measured, one zone at a time over all 85: pretty-printed at a two-space
 * indent the set came to 25 MB against 4.3 MB on one line per zone, and
 * carrying `primitives` cost another 2.5 MB on top. `src/data/map` is 4.0 MB of
 * committed derived JSON and this sits beside it; six times that for whitespace
 * in a file nobody hand-edits is not a trade worth making.
 *
 * `primitives` is left out for a better reason than size. It is a pure function
 * of the block kind, the tags and the boundary edges — `primitivesFor()` in
 * `src/lib/world-content-rules.mjs` — so writing it here would put the same
 * decision in two places, and the copy in 17,750 records is the one that would
 * go stale the day the Godot content pack registers a sixth kind. Every
 * consumer calls the function on what it reads.
 */
const files = new Map()
for (const [id, output] of zoneOutputs) files.set(join(OUT_DIR, `${id}.json`), JSON.stringify(output) + '\n')
files.set(
  join(OUT_DIR, 'index.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      generatedBy: 'tools/build-world-content.mjs',
      unknownCeilingPercent: UNKNOWN_CEILING_PERCENT,
      counts: {
        zones: zones.length,
        rooms: totalRooms,
        unknown: unknownTotal,
        unknownPercent: Number(unknownPercent.toFixed(3)),
      },
      byRule: Object.fromEntries(GROUND_RULES.map((rule) => [rule, ruleCounts.get(rule)])),
      byGround: Object.fromEntries([...kindCounts].filter(([, n]) => n)),
      colourTable: colourRows.map(({ colour, rooms, support, kind, purity, admitted }) => ({
        colour,
        rooms,
        scored: support,
        kind,
        purity: Number(purity.toFixed(3)),
        admitted,
      })),
      zones: perZone.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    },
    null,
    2
  ) + '\n'
)
const residueCsv =
  ['cellId,zone,zoneName,title,colour,label,place']
    .concat(
      residue.map((row) =>
        row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(',')
      )
    )
    .join('\n') + '\n'
files.set(RESIDUE_PATH, residueCsv)

if (checkOnly) {
  let drifted = 0
  for (const [path, generated] of files) {
    // core.autocrlf is true on this machine, so the checkout may hold CRLF. A
    // line ending is not drift.
    const onDisk = existsSync(path) ? readFileSync(path, 'utf8').replaceAll('\r\n', '\n') : null
    if (onDisk === generated) continue
    drifted += 1
    console.error(`FAIL ${path} ${onDisk === null ? 'does not exist' : 'has drifted from a fresh generation'}`)
  }
  if (drifted) {
    console.error(`     ${drifted} of ${files.size} generated files disagree with tools/build-world-content.mjs.`)
    console.error('     They are derived artefacts: change the generator or the rules and re-run it, do not edit the JSON.')
    process.exit(1)
  }
  console.log('')
  console.log(`OK   ${files.size} generated files match a fresh generation`)
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  let changedFiles = 0
  for (const [path, contents] of files) {
    // Repeated Crossing builds must not rewrite 85 unchanged zone files or
    // churn Windows line endings and file watchers on every invocation.
    const existing = existsSync(path) ? readFileSync(path, 'utf8').replaceAll('\r\n', '\n') : null
    if (existing === contents) continue
    writeFileSync(path, contents)
    changedFiles += 1
  }
  const bytes = [...files.values()].reduce((n, text) => n + Buffer.byteLength(text), 0)
  console.log('')
  console.log(`updated ${changedFiles} of ${files.size} files, ${(bytes / 1024 / 1024).toFixed(2)} MB total, in ${OUT_DIR} and ${RESIDUE_PATH}`)
}
