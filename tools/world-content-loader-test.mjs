#!/usr/bin/env node
/**
 * The batch's content reaches a live cell, and reaches the one place it changes
 * what a player sees.
 *
 * `compileWorldSnapshot` published `board: boardLayoutFor({})` for every cell
 * in every zone. That is an empty classification, so `boardLayoutFor`'s
 * `interior-cutaway` branch — a 3 m block instead of a 1 m one, and a floor
 * plane instead of terrain — was unreachable on the live path. Nothing could
 * see it: an empty classification is a valid argument, the function returns a
 * complete layout, and every existing check on that layout passed.
 *
 * So the property here is not "the snapshot carries a content field". It is
 * **the block a live interior publishes is taller than the block a live street
 * publishes**, which is false the moment the classification stops arriving,
 * whatever else is still in the payload.
 *
 * Every case runs against the committed content for the Crossing, not a
 * fixture: the rooms below were chosen by asking `src/data/world/1.json` which
 * ones the batch actually classified each way, so a case cannot go on passing
 * against a room the pipeline has stopped classifying — it goes red for want of
 * a subject instead.
 *
 *   node --experimental-strip-types tools/world-content-loader-test.mjs
 */
import { readFileSync } from 'node:fs'
import { compileWorldSnapshot } from '../src/lib/presentationBridge.ts'
import { primitivesFor } from '../src/lib/world-content-rules.mjs'

const ZONE = '1'
const MIN_ROOMS = 900
const MIN_OF_EACH_KIND = 20

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass += 1
    console.log(`OK   ${what.padEnd(70)} ${detail}`)
  } else {
    fail += 1
    console.log(`FAIL ${what.padEnd(70)} ${detail}`)
  }
}

const map = JSON.parse(readFileSync(`src/data/map/${ZONE}.json`, 'utf8'))
const content = JSON.parse(readFileSync(`src/data/world/${ZONE}.json`, 'utf8'))
const contentByRoom = new Map(content.rooms.map((room) => [room.id, room]))

/** The same shape `mapData.ts::toZoneRoom` publishes, which is what the
 * compiler actually receives. Built from the real map rather than typed, so a
 * change to the room shape reaches this test. */
const zone = {
  ok: true,
  zone: ZONE,
  name: map.name,
  here: null,
  total: map.rooms.length,
  truncated: false,
  rooms: map.rooms.map((room) => ({
    id: room.id,
    uid: null,
    title: room.name,
    x: room.x,
    y: room.y,
    z: room.z,
    tags: room.label ? [room.label] : [],
    to: (room.exits ?? []).map((exit) => exit.to),
    mapColour: room.color,
    moves: (room.exits ?? []).map((exit) => exit.move.trim()).filter(Boolean),
    links: (room.exits ?? []).map((exit) => ({ to: exit.to, kind: 'walk' })),
  })),
}

const here = { id: map.rooms[0].id }
const compile = (withContent) =>
  compileWorldSnapshot({
    zone,
    here,
    character: null,
    content: withContent ? contentByRoom : null,
    sequence: 1,
  })

const withContent = compile(true)
const without = compile(false)

ok(
  'a zone this size compiles at all, so the counts below mean something',
  withContent != null && without != null && withContent.cells.length >= MIN_ROOMS,
  `${withContent?.cells.length ?? 0} cells, floor ${MIN_ROOMS}`
)

// ------------------------------------------- the thing a player can see

const cellsById = new Map(withContent.cells.map((cell) => [cell.id, cell]))
const interiors = content.rooms.filter((room) => room.block === 'building-interior')
const outdoors = content.rooms.filter((room) => room.block === 'outdoor-open')
ok(
  'the committed content still has both kinds of room to compare',
  interiors.length >= MIN_OF_EACH_KIND && outdoors.length >= MIN_OF_EACH_KIND,
  `${interiors.length} interiors, ${outdoors.length} outdoor, floor ${MIN_OF_EACH_KIND} each`
)

const heightOf = (room) => cellsById.get(`${ZONE}-${room.id}`)?.board.footprint.height
const interiorHeights = new Set(interiors.map(heightOf))
const outdoorHeights = new Set(outdoors.map(heightOf))
ok(
  'a live interior publishes a taller block than a live outdoor room',
  interiorHeights.size === 1 &&
    outdoorHeights.size === 1 &&
    [...interiorHeights][0] > [...outdoorHeights][0],
  `interior ${[...interiorHeights].join('/')} m, outdoor ${[...outdoorHeights].join('/')} m across ${interiors.length + outdoors.length} rooms`
)
ok(
  'and without the content every cell is the short block again, as it was',
  new Set(without.cells.map((cell) => cell.board.footprint.height)).size === 1 &&
    without.cells[0].board.footprint.height === [...outdoorHeights][0],
  `${without.cells.length} cells, all ${without.cells[0].board.footprint.height} m — the state this replaced`
)

// ------------------------------------------------ what travels on the cell

const carried = withContent.cells.filter((cell) => cell.content)
ok(
  'every cell carries the content the batch derived for it',
  carried.length === withContent.cells.length,
  `${carried.length} of ${withContent.cells.length}`
)
ok(
  'and no cell carries any when the zone has none, rather than an empty shape',
  without.cells.every((cell) => cell.content === undefined),
  `${without.cells.length} cells, none with a content key`
)

const sample = cellsById.get(`${ZONE}-${interiors[0].id}`)
ok(
  'the fields are the batch’s own answers, not a re-derivation',
  sample.content.groundKind === interiors[0].ground &&
    sample.content.blockKind === interiors[0].block &&
    sample.content.landmark === interiors[0].landmark &&
    sample.content.boundaryEdges.join() === interiors[0].boundaryEdges.join(),
  `${sample.id}: ${sample.content.groundKind}/${sample.content.blockKind}, ${sample.content.boundaryEdges.length} boundary edges`
)

let primitivesAgree = 0
let primitivesAsked = 0
for (const cell of withContent.cells) {
  const room = contentByRoom.get(Number(cell.id.slice(ZONE.length + 1)))
  const expected = primitivesFor({
    blockKind: room.block,
    tags: room.classification.tags,
    boundaryEdges: room.boundaryEdges,
  })
  primitivesAsked += expected.length
  if (JSON.stringify(cell.content.primitives) === JSON.stringify(expected)) primitivesAgree += 1
}
ok(
  'the primitive slots are what primitivesFor says, computed rather than stored',
  primitivesAgree === withContent.cells.length && primitivesAsked >= MIN_ROOMS,
  `${primitivesAgree} of ${withContent.cells.length} cells, ${primitivesAsked} slots`
)

// ------------------------------------------- the loader is pointed at real files

const loader = readFileSync('src/lib/worldContent.ts', 'utf8')
const globbed = [...loader.matchAll(/'(!?\.\.\/data\/world\/[^']+)'/g)].map((m) => m[1])
ok(
  'the loader globs a path that resolves to the committed content',
  globbed.includes('../data/world/*.json') &&
    globbed.some((path) => path.includes('index.json')) &&
    /import\('\.\/worldContent\.ts'\)/.test(readFileSync('src/lib/presentationBridge.ts', 'utf8')),
  `${globbed.join(' ')}; the bridge reaches it through a lazy import so the pure half stays runnable outside Vite`
)

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
