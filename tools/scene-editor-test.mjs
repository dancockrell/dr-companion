#!/usr/bin/env node
/**
 * The scene editor's properties, not its mechanisms.
 *
 * The one that matters and the one everything else supports: **a room a person
 * has edited compiles to a cell that says what they said**, through the live
 * `compileWorldSnapshot`, against the committed map and the committed batch
 * content, not against a fixture built to agree. A resolver that returns the
 * right object while nothing carries it to Godot is the same defect as no
 * resolver at all, and it looks identical from inside the resolver's own tests.
 *
 * The option lists are checked by deriving them twice from two different
 * statements in `godot/scripts/shared_asset_content.gd`: the builder reads the
 * `ContentRegistry.register()` calls, and this file reads the `registeredKinds`
 * list that `shared_asset_status()` hands out. Those are two sentences in one
 * file and they are allowed to disagree; that is why both are read.
 *
 *   node --experimental-strip-types tools/scene-editor-test.mjs
 */
import { readFileSync } from 'node:fs'

// Before anything touches the store. `storage.ts` catches a missing
// localStorage and returns its fallback, which would make every override in
// this file silently vanish and every "the guess stands" case pass for the
// wrong reason.
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const { compileWorldSnapshot } = await import('../src/lib/presentationBridge.ts')
const {
  SCENE_STORAGE_KEY,
  PLACEMENT_HALF_EXTENT,
  sceneOptions,
  loadSceneOverrides,
  saveSceneOverrides,
  setSceneField,
  resetSceneField,
  resolveScene,
  resetSceneOverridesCache,
  exportSceneOverrides,
  importSceneOverrides,
} = await import('../src/lib/sceneOverrides.ts')
const { GROUND_KINDS, BLOCK_KINDS, blockKindFor, primitivesFor } = await import(
  '../src/lib/world-content-rules.mjs'
)
const { CELL_BLOCK_METRES } = await import('../src/lib/isometric-board-layout.mjs')
const { LANDMARK_KINDS } = await import('../src/lib/mapLandmarks.ts')

const CONTENT_PACK = 'godot/scripts/shared_asset_content.gd'
const ZONE = '1'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass += 1
    console.log(`OK   ${what.padEnd(72)} ${detail}`)
  } else {
    fail += 1
    console.log(`FAIL ${what.padEnd(72)} ${detail}`)
  }
}

// Both halves, and the second is the one that bites: `loadSceneOverrides`
// holds the parsed object so a React subscription has a stable identity, so
// emptying the backing store alone would leave every case below reading the
// previous case's overrides.
const reset = () => {
  store.clear()
  resetSceneOverridesCache()
}

// ---------------------------------------------------------------------------
// 1. The option lists are the registry's, derived independently of the builder.
// ---------------------------------------------------------------------------

const pack = readFileSync(CONTENT_PACK, 'utf8')
const advertised = [...(/"registeredKinds"\s*:\s*\[([^\]]*)\]/.exec(pack)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map(
  (m) => m[1]
)

ok(
  'the content pack advertises kinds at all',
  advertised.length >= 3,
  `${advertised.length} from ${CONTENT_PACK}; a zero here would make every list below trivially equal`
)

const baseFor = (blockKind) => primitivesFor({ blockKind, tags: [], boundaryEdges: [] })[0].kind
const expectedGround = GROUND_KINDS.filter((g) => advertised.includes(baseFor(blockKindFor(g))))
const expectedBlock = BLOCK_KINDS.filter((b) => advertised.includes(baseFor(b)))
const expectedPlaceable = advertised.filter((kind) => {
  // Every role this kind is ever emitted under, over the whole input space.
  const roles = new Set()
  for (const blockKind of BLOCK_KINDS)
    for (const tags of [[], ['water'], ['bridge'], ['water', 'bridge']])
      for (const boundaryEdges of [[], ['north']])
        for (const p of primitivesFor({ blockKind, tags, boundaryEdges }))
          if (p.kind === kind) roles.add(p.role)
  return roles.size === 1 && roles.has('landform')
})

const options = sceneOptions()
ok(
  'the ground list is every ground kind whose cell the registry can draw',
  options.ground.join(',') === expectedGround.join(','),
  `${options.ground.length} of ${GROUND_KINDS.length}`
)
ok(
  'the block list is every block kind whose cell the registry can draw',
  options.block.join(',') === expectedBlock.join(','),
  `${options.block.length} of ${BLOCK_KINDS.length}`
)
ok(
  'the placeable list is exactly the registry kinds that are scenery',
  options.placeable.join(',') === expectedPlaceable.join(','),
  `${options.placeable.join(', ') || '(none)'}`
)
ok(
  'the landmark list is the vocabulary mapLandmarks can actually decide',
  options.landmark.join(',') === [...LANDMARK_KINDS].join(','),
  `${options.landmark.length} kinds`
)
ok(
  'the backdrop list is not empty',
  options.art.length >= 5,
  `${options.art.length} reviewed images`
)
ok(
  'a placement is held to half the block the layout publishes',
  PLACEMENT_HALF_EXTENT === CELL_BLOCK_METRES / 2,
  `${PLACEMENT_HALF_EXTENT} against ${CELL_BLOCK_METRES} / 2`
)

// ---------------------------------------------------------------------------
// 2. The resolver: override wins, guess is the fallback, neither is null.
// ---------------------------------------------------------------------------

const guess = {
  id: 42,
  ground: 'street',
  rule: 'title',
  block: 'outdoor-open',
  landmark: 'bank',
  classification: { tags: [], specialKinds: [], spatialMode: 'exterior-cell', tier: 'ordinary' },
  boundaryEdges: ['north'],
}

reset()
ok(
  'with no override the batch answer stands',
  resolveScene('1-42', guess)?.ground === 'street' && resolveScene('1-42', guess)?.sources.ground === 'guess'
)
ok('with neither an override nor a guess there is no scene', resolveScene('1-42', null) === null)

setSceneField('1-42', 'ground', 'forest')
const overridden = resolveScene('1-42', guess)
ok('an override wins over the batch', overridden.ground === 'forest' && overridden.sources.ground === 'override')
ok('an untouched field still comes from the batch', overridden.landmark === 'bank' && overridden.sources.landmark === 'guess')

reset()
setSceneField('1-42', 'block', 'building-interior')
const interior = resolveScene('1-42', guess)
ok(
  'a block-kind override moves the spatial mode with it',
  interior.classification.spatialMode === 'interior-cutaway',
  'so boardLayoutFor publishes a 3 m block rather than a relabelled 1 m one'
)

reset()
ok(
  'an override with no batch answer is still a scene',
  (setSceneField('9999-1', 'ground', 'cave'), resolveScene('9999-1', null)?.ground === 'cave')
)

// ---------------------------------------------------------------------------
// 3. Refusal. An undrawable value is rejected and named.
// ---------------------------------------------------------------------------

reset()
const refusedGround = setSceneField('1-42', 'ground', 'lava')
ok('an undrawable ground kind is refused', refusedGround.ok === false)
ok(
  'the refusal names the value it refused',
  refusedGround.ok === false && refusedGround.reason.includes('lava'),
  refusedGround.ok === false ? refusedGround.reason.slice(0, 60) : ''
)
ok('a refused write stores nothing', Object.keys(loadSceneOverrides()).length === 0)

const refusedKind = setSceneField('1-42', 'primitives', [{ kind: 'guild-threshold-kit', x: 0, z: 0 }])
ok(
  'a primitive kind the registry has no factory for is refused and named',
  refusedKind.ok === false && refusedKind.reason.includes('guild-threshold-kit')
)
const outOfCell = setSceneField('1-42', 'primitives', [
  { kind: options.placeable[0], x: PLACEMENT_HALF_EXTENT + 0.1, z: 0 },
])
ok('a placement outside the cell is refused', outOfCell.ok === false)

// ---------------------------------------------------------------------------
// 4. Reset removes exactly one field.
// ---------------------------------------------------------------------------

reset()
setSceneField('1-42', 'ground', 'forest')
setSceneField('1-42', 'landmark', 'inn')
resetSceneField('1-42', 'ground')
const afterReset = loadSceneOverrides()['1-42']
ok('reset removes the field it names', afterReset?.ground === undefined)
ok('reset leaves the other fields alone', afterReset?.landmark === 'inn')
ok('the reset field falls back to the batch', resolveScene('1-42', guess).ground === 'street')

resetSceneField('1-42', 'landmark')
ok(
  'a room with nothing left overridden is dropped from the store',
  loadSceneOverrides()['1-42'] === undefined,
  'so an export is the set of rooms somebody actually decided something about'
)

// ---------------------------------------------------------------------------
// 5. Export and import round-trip.
// ---------------------------------------------------------------------------

reset()
setSceneField('1-97', 'ground', 'water')
setSceneField('1-42', 'ground', 'forest')
setSceneField('1-42', 'landmark', null)
setSceneField('1-42', 'primitives', [{ kind: options.placeable[0], x: 1.5, z: -0.5 }])
const exported = JSON.stringify(exportSceneOverrides(), null, 2)

reset()
const { merged } = importSceneOverrides(JSON.parse(exported))
saveSceneOverrides(merged)
ok(
  'export then import into an empty store round-trips byte-identical',
  JSON.stringify(exportSceneOverrides(), null, 2) === exported,
  `${exported.length} bytes`
)
ok(
  'a landmark override of null survives the round trip',
  loadSceneOverrides()['1-42'].landmark === null,
  'null is "this room has no landmark", not "no opinion"'
)

const mine = { '1-42': { ground: 'cave' } }
const conflicted = importSceneOverrides(JSON.parse(exported), mine)
ok(
  'an import never overwrites a local choice',
  conflicted.merged['1-42'].ground === 'cave' && conflicted.result.conflicts.some((c) => c.field === 'ground')
)
ok(
  'an import counts what this build cannot draw rather than dropping it silently',
  importSceneOverrides({ version: 1, overrides: { '1-1': { ground: 'lava' } } }, {}).result.undrawable === 1
)

// ---------------------------------------------------------------------------
// 6. The override reaches the live compiler's cell.
// ---------------------------------------------------------------------------

const map = JSON.parse(readFileSync(`src/data/map/${ZONE}.json`, 'utf8'))
const content = JSON.parse(readFileSync(`src/data/world/${ZONE}.json`, 'utf8'))
const contentByRoom = new Map(content.rooms.map((room) => [room.id, room]))

/** The same shape `mapData.ts::toZoneRoom` publishes, built from the committed
 * map rather than typed, so a change to the room shape reaches this test. */
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

/** A room the batch calls an ordinary outdoor street, chosen by asking the
 * committed content rather than typed, so this cannot go on passing against a
 * room the pipeline has stopped classifying that way. */
const subject = content.rooms.find(
  (room) => room.block === 'outdoor-open' && map.rooms.some((r) => r.id === room.id)
)
ok('there is a street room in the committed Crossing content to edit', subject != null, `room ${subject?.id}`)

const compile = () =>
  compileWorldSnapshot({
    zone,
    here: { id: map.rooms[0].id },
    character: null,
    content: contentByRoom,
    sequence: 1,
  })

reset()
const before = compile().cells.find((c) => c.id === `${ZONE}-${subject.id}`)
ok('unedited, the cell publishes the batch answer', before.content.blockKind === 'outdoor-open')
ok('unedited, the cell is one metre tall', before.board.footprint.height === 1)

setSceneField(`${ZONE}-${subject.id}`, 'block', 'building-interior')
const after = compile().cells.find((c) => c.id === `${ZONE}-${subject.id}`)
ok(
  'the override reaches the live compiler',
  after.content.blockKind === 'building-interior',
  `${ZONE}-${subject.id} was ${before.content.blockKind}`
)
ok(
  'and reaches the one thing a player can see: the block gets taller',
  after.board.footprint.height === 3,
  `${before.board.footprint.height} m to ${after.board.footprint.height} m`
)
ok(
  'and the cell asks for a floor rather than terrain',
  after.content.primitives.some((p) => p.kind === 'interior-floor-5m'),
  after.content.primitives.map((p) => p.kind).join(', ')
)
ok(
  'no other cell moved',
  compile().cells.filter((c) => c.board.footprint.height === 3).length ===
    content.rooms.filter((r) => r.classification.spatialMode === 'interior-cutaway' && map.rooms.some((m) => m.id === r.id)).length + 1,
  'one more cutaway than the batch produced, and exactly one'
)

reset()
setSceneField(`${ZONE}-${subject.id}`, 'primitives', [{ kind: options.placeable[0], x: 1.25, z: -2 }])
const placed = compile().cells.find((c) => c.id === `${ZONE}-${subject.id}`)
const mine2 = placed.content.primitives.filter((p) => p.offset)
ok('a placed primitive reaches the cell', mine2.length === 1, JSON.stringify(mine2))
ok(
  'it carries the offset it was placed at',
  mine2[0]?.offset.x === 1.25 && mine2[0]?.offset.z === -2,
  'metres from the cell origin, x east and z south'
)
ok(
  'the rule-derived primitives are still there beside it',
  placed.content.primitives.some((p) => !p.offset && p.kind === 'terrain-cell-5m')
)

reset()
console.log(`\n${pass} passed, ${fail} failed (store key ${SCENE_STORAGE_KEY})`)
process.exit(fail === 0 ? 0 : 1)
