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
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const { compileWorldSnapshot, projectionKey } = await import('../src/lib/presentationBridge.ts')
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
  parseSceneOverrideSet,
  sceneOverrideDiagnostics,
  sceneStoreRefusals,
  SCENE_LIMITS,
  clampToCell,
  isDrawable,
} = await import('../src/lib/sceneOverrides.ts')
const { storageHealth } = await import('../src/lib/storage.ts')
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
const roundTrip = importSceneOverrides(JSON.parse(exported))
ok(
  "this build's own export is accepted by this build",
  roundTrip.ok === true,
  roundTrip.ok ? '' : roundTrip.reason
)
saveSceneOverrides(roundTrip.ok ? roundTrip.merged : {})
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
  conflicted.ok && conflicted.merged['1-42'].ground === 'cave' && conflicted.result.conflicts.some((c) => c.field === 'ground')
)
const withLava = importSceneOverrides(
  { version: 1, provenance: 'player', overrides: { '1-1': { ground: 'lava' } } },
  {}
)
ok(
  'an import counts what this build cannot draw rather than dropping it silently',
  withLava.ok && withLava.result.undrawable === 1
)
ok(
  'and names the room and the value rather than only counting them',
  withLava.ok &&
    withLava.result.refusals.length === 1 &&
    withLava.result.refusals[0].roomId === '1-1' &&
    withLava.result.refusals[0].field === 'ground' &&
    withLava.result.refusals[0].reason.includes('lava'),
  withLava.ok ? withLava.result.refusals[0]?.reason.slice(0, 70) : ''
)

// ---------------------------------------------------------------------------
// 5b. The import schema, one refusal case at a time (#461).
// ---------------------------------------------------------------------------
// Every case here was accepted before this schema existed, and each was
// measured on the real module rather than argued: `version: 99` imported as
// version 1, `isDrawable('primitives')` admitted arbitrary nested payloads, a
// 1 MB string was a usable room-id key, a room that does not exist was stored
// and then dropped at compile without a word, and the whole blob had no bound
// against a 5 MiB origin quota.
//
// The control goes first. Every case below asserts a *refusal*, and a parser
// that refused everything - including its own export - would satisfy all of
// them while being useless, which is the same defect as a check that cannot
// fail wearing the opposite coat.

const good = { version: 1, provenance: 'player', overrides: { '1-42': { ground: 'forest' } } }
const knownRooms = new Set(['1-42', '1-97'])
ok(
  'CONTROL a well-formed file with a real room is accepted',
  importSceneOverrides(good, {}, { knownRooms }).ok === true,
  'without this, every refusal below is satisfied by a parser that refuses everything'
)

const refusal = (what, file, needle, options = {}) => {
  const outcome = importSceneOverrides(file, {}, options)
  ok(
    what,
    outcome.ok === false && outcome.reason.includes(needle),
    outcome.ok === false ? outcome.reason.slice(0, 90) : 'accepted'
  )
}
refusal('a file with no version at all is refused', { provenance: 'player', overrides: good.overrides }, 'no version')
refusal('a future version is refused and named', { ...good, version: 99 }, '99')
refusal('a file with no provenance is refused', { version: 1, overrides: good.overrides }, 'provenance')
refusal('a file that is not an object is refused', [good], 'not a scene export')

/** Each of these is refused per room rather than per file: the rest of the
 * import is still worth taking, and a person needs to know which room. */
const perRoom = (what, overrides, needle, options = { knownRooms }) => {
  const outcome = importSceneOverrides({ version: 1, provenance: 'player', overrides }, {}, options)
  const reasons = outcome.ok ? outcome.result.refusals.map((r) => r.reason) : [outcome.reason]
  ok(
    what,
    outcome.ok === true &&
      Object.keys(outcome.merged).length === 0 &&
      reasons.some((reason) => reason.includes(needle)),
    reasons.join(' | ').slice(0, 100)
  )
}
perRoom('a room-id key that is not a room id is refused and named', { 'not a room': { ground: 'forest' } }, 'not a room id')
perRoom(
  'a megabyte-long room-id key is refused without quoting a megabyte back',
  { ['z'.repeat(1024 * 1024)]: { ground: 'forest' } },
  'not a room id'
)
// Through `JSON.parse`, which is how an import actually arrives: as an object
// literal `__proto__` sets the prototype and there is no key to refuse, so a
// case written that way would pass against a parser that does nothing.
perRoom('__proto__ as a room-id key is refused', JSON.parse('{"__proto__":{"ground":"forest"}}'), 'not a room id')
perRoom('a room this map does not have is refused and named', { '1-99999': { ground: 'forest' } }, '1-99999')
perRoom('an unknown kind is refused and named', { '1-42': { ground: 'lava' } }, 'lava')
perRoom(
  'a primitive carrying anything but kind, x and z is refused naming the extra key',
  { '1-42': { primitives: [{ kind: options.placeable[0], x: 0, z: 0, payload: { a: { b: 'x'.repeat(64) } } }] } },
  'payload'
)
perRoom(
  'more primitives in one room than the cap is refused naming the count',
  {
    '1-42': {
      primitives: Array.from({ length: SCENE_LIMITS.primitivesPerRoom + 1 }, () => ({
        kind: options.placeable[0],
        x: 0,
        z: 0,
      })),
    },
  },
  `${SCENE_LIMITS.primitivesPerRoom}`
)
perRoom(
  'a string value longer than a registry value can be is refused',
  { '1-42': { art: `${options.art[0]}${'x'.repeat(SCENE_LIMITS.valueChars)}` } },
  'not a art'
)

// The per-room cap is only reachable where kinds are not held to the registry -
// which is the store's own load path, since every registry kind is short. So it
// is asked of the schema directly rather than through an import that cannot
// build a room that large.
const fatRoom = parseSceneOverrideSet(
  {
    '1-42': {
      primitives: Array.from({ length: SCENE_LIMITS.primitivesPerRoom }, () => ({
        kind: 'k'.repeat(SCENE_LIMITS.kindChars),
        x: 1.2345678901234,
        z: -2.1098765432109,
      })),
    },
  },
  { requireDrawable: false }
)
ok(
  'a room past the per-room cap is refused naming the room and its size',
  Object.keys(fatRoom.overrides).length === 0 &&
    fatRoom.refusals.some((r) => r.roomId === '1-42' && r.reason.includes(`${SCENE_LIMITS.roomChars}`)),
  fatRoom.refusals[0]?.reason.slice(0, 90) ?? '(accepted)'
)
ok(
  'CONTROL every value the registry offers passes the schema',
  (() => {
    const one = (field, value) =>
      Object.keys(
        parseSceneOverrideSet({ '1-42': { [field]: value } }, { requireDrawable: true }).overrides
      ).length === 1
    return (
      options.ground.every((v) => one('ground', v)) &&
      options.block.every((v) => one('block', v)) &&
      options.landmark.every((v) => one('landmark', v)) &&
      options.art.every((v) => one('art', v)) &&
      options.placeable.every((v) => one('primitives', [{ kind: v, x: 0, z: 0 }]))
    )
  })(),
  `${options.ground.length + options.block.length + options.landmark.length + options.art.length + options.placeable.length} values, longest art ${Math.max(...options.art.map((a) => a.length))} against a bound of ${SCENE_LIMITS.valueChars}`
)

// The total cap, over real room ids so nothing else can be doing the refusing.
const many = {}
for (let id = 1; id <= 1060; id += 1)
  many[`1-${id}`] = {
    ground: 'water',
    block: 'outdoor-open',
    landmark: null,
    art: options.art[0],
    primitives: Array.from({ length: 24 }, () => ({ kind: options.placeable[0], x: 1.25, z: -2 })),
  }
const everyRoom = new Set(Object.keys(many))
const oversize = importSceneOverrides({ version: 1, provenance: 'player', overrides: many }, {}, { knownRooms: everyRoom })
const overflowed = oversize.ok ? oversize.result.refusals.filter((r) => r.reason.includes('did not fit')) : []
ok(
  'a set past the total cap keeps what fits and names every room it refused',
  oversize.ok === true && overflowed.length > 0 && Object.keys(oversize.merged).length > 0,
  `${oversize.ok ? Object.keys(oversize.merged).length : 0} rooms kept, ${overflowed.length} refused, cap ${SCENE_LIMITS.totalChars} characters`
)
ok(
  'and what it kept is inside the cap it published',
  oversize.ok === true && JSON.stringify(oversize.merged).length <= SCENE_LIMITS.totalChars,
  `${oversize.ok ? JSON.stringify(oversize.merged).length : 0} of ${SCENE_LIMITS.totalChars}`
)
ok(
  'the caps are stated as one exported object rather than typed where they are used',
  SCENE_LIMITS.roomChars > 0 && SCENE_LIMITS.totalChars > SCENE_LIMITS.roomChars && SCENE_LIMITS.formatVersion === 1,
  `${SCENE_LIMITS.roomChars} per room, ${SCENE_LIMITS.totalChars} in total, format ${SCENE_LIMITS.formatVersion}`
)
ok(
  'rooms not checked is its own answer rather than a quiet pass',
  (() => {
    const unchecked = importSceneOverrides(good, {})
    return unchecked.ok && unchecked.result.roomsChecked === false
  })() &&
    (() => {
      const checked = importSceneOverrides(good, {}, { knownRooms })
      return checked.ok && checked.result.roomsChecked === true
    })(),
  'an importer with no room list has not proved the rooms are real'
)

// ---------------------------------------------------------------------------
// 5c. The store's own load path, which is the same schema with kinds left be.
// ---------------------------------------------------------------------------

reset()
store.set(
  SCENE_STORAGE_KEY,
  JSON.stringify({ '1-42': { ground: 'forest' }, 'not a room': { ground: 'forest' }, '1-43': { ground: 'lava' } })
)
const loaded = loadSceneOverrides()
ok(
  'the store drops a key that is not a room id',
  loaded['not a room'] === undefined && sceneStoreRefusals().some((r) => r.reason.includes('not a room id')),
  sceneStoreRefusals()[0]?.reason.slice(0, 70) ?? '(no refusal recorded)'
)
ok(
  'and keeps a kind this build cannot draw rather than deleting somebody’s work',
  loaded['1-43']?.ground === 'lava',
  'resolveScene ignores it; a content pack that re-registers the kind brings it back'
)
ok('and keeps the rooms that are fine', loaded['1-42']?.ground === 'forest')

// ---------------------------------------------------------------------------
// 5d. A write that does not land is not a write (#461 finding 4).
// ---------------------------------------------------------------------------

reset()
const control = setSceneField('1-42', 'ground', 'street')
ok('CONTROL an ordinary write succeeds and is on disk', control.ok === true && store.has(SCENE_STORAGE_KEY))
const onDisk = store.get(SCENE_STORAGE_KEY)

const realSetItem = globalThis.localStorage.setItem
globalThis.localStorage.setItem = () => {
  throw new DOMException('exceeded the quota', 'QuotaExceededError')
}
const atQuota = setSceneField('1-97', 'ground', 'water')
ok(
  'a write the store refuses is reported as a failure, not as ok',
  atQuota.ok === false,
  atQuota.ok ? 'setSceneField said ok while the write was lost' : atQuota.reason.slice(0, 80)
)
ok(
  'and the refusal says the change will not survive a reload',
  atQuota.ok === false && /reload/.test(atQuota.reason),
  atQuota.ok ? '' : atQuota.reason.slice(0, 90)
)
ok('and nothing reached the store', store.get(SCENE_STORAGE_KEY) === onDisk)

// A store that keeps nothing and says nothing: `setItem` returns cleanly and
// the value is not there afterwards. This is the case the read-back exists for
// and the only one that can tell it apart from a healthy write.
globalThis.localStorage.setItem = () => {}
const silentlyLost = setSceneField('1-97', 'ground', 'water')
ok(
  'a write that is accepted and not kept is reported too',
  silentlyLost.ok === false,
  silentlyLost.ok ? 'setItem returned cleanly and the value was never stored' : silentlyLost.reason.slice(0, 80)
)
globalThis.localStorage.setItem = realSetItem
ok(
  'the failing store is reported to the app-wide banner as well',
  storageHealth().failedWrites > 0,
  JSON.stringify(storageHealth())
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

// ---------------------------------------------------------------------------
// 6b. What the compile could not apply reaches somebody (#461 finding 3).
// ---------------------------------------------------------------------------
// An override naming a room this zone does not have was stored, dropped by the
// compiler and reported nowhere - the snapshot had no field that could carry
// it. The denominator goes first: an ordinary compile must report *nothing*, or
// a diagnostics array that always has something in it says as little as one
// that never does.

reset()
setSceneField(`${ZONE}-${subject.id}`, 'ground', 'water')
const clean = compile()
ok(
  'CONTROL a compile with only real overrides reports no diagnostics',
  Array.isArray(clean.diagnostics) && clean.diagnostics.length === 0,
  JSON.stringify(clean.diagnostics ?? null)
)

// Written straight to the store, because the schema now refuses this room
// through every other door - which is the point: the compile has to be able to
// report what an older build, a hand-edited store or a future format left it.
store.set(SCENE_STORAGE_KEY, JSON.stringify({ '1-99999': { ground: 'water' }, '90-1': { ground: 'water' } }))
resetSceneOverridesCache()
const withGhost = compile()
ok(
  'a compile names an override for a room this zone does not have',
  withGhost.diagnostics.some((d) => d.roomId === '1-99999' && d.reason.includes('1-99999')),
  withGhost.diagnostics.map((d) => d.reason).join(' | ').slice(0, 90)
)
ok(
  'and says nothing about another zone’s rooms, which are not this compile’s business',
  withGhost.diagnostics.every((d) => d.roomId !== '90-1'),
  `${withGhost.diagnostics.length} diagnostics for zone ${ZONE}`
)
ok(
  'diagnostics are not part of what decides a republish',
  !projectionKey(withGhost).includes('diagnostics'),
  'the report is for the panel; a changed report must not cost a native publish'
)

store.set(SCENE_STORAGE_KEY, JSON.stringify({ [`${ZONE}-${subject.id}`]: { ground: 'lava' } }))
resetSceneOverridesCache()
const withUndrawable = compile()
ok(
  'a compile names a stored field this build cannot draw rather than ignoring it in silence',
  withUndrawable.diagnostics.some((d) => d.field === 'ground' && d.reason.includes('lava')),
  withUndrawable.diagnostics.map((d) => d.reason).join(' | ').slice(0, 90)
)
ok(
  'and still publishes the batch answer for that cell',
  withUndrawable.cells.find((c) => c.id === `${ZONE}-${subject.id}`)?.content?.groundKind === subject.ground,
  'resolveScene ignores the value; it is the report that was missing, not the fallback'
)

// ---------------------------------------------------------------------------
// 6. The clamp the picker and the store share.
// ---------------------------------------------------------------------------
// `ScenePrimitivePicker` converts a click to metres and `clampToCell` is the
// only thing standing between that arithmetic and `isDrawable`'s refusal. The
// property is not "the clamp clamps" - it is that **no value the control can
// produce is one the store will refuse**, which is the thing a person would
// experience as the editor being broken. So the last case here asks the store,
// not the clamp.

reset()
ok('a placement inside the cell is left where it was put', clampToCell(1.25) === 1.25)
ok(
  'a placement past the edge is pulled back to the edge, not rejected',
  clampToCell(9) === PLACEMENT_HALF_EXTENT && clampToCell(-9) === -PLACEMENT_HALF_EXTENT,
  `±${PLACEMENT_HALF_EXTENT} m`
)
ok(
  'a placement that is not a finite number becomes the centre',
  [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY].every((v) => clampToCell(v) === 0),
  'the centre and not an edge: an infinity has no nearest edge that is not a guess about which way the person meant'
)
ok(
  'nothing the clamp can produce is refused by the store',
  [-99, -2.2000001, -1, 0, 1, 2.2000001, 99, Number.NaN].every((raw) =>
    isDrawable('primitives', [{ kind: options.placeable[0], x: clampToCell(raw), z: clampToCell(-raw) }])
  ),
  'the one property that makes a click inside the drawn square always storable'
)

// ---------------------------------------------------------------------------
// 7. The coverage list is the residue, in both directions.
// ---------------------------------------------------------------------------
// `ScenePanel`'s `Coverage` selects a zone's unclassified rooms with
// `rule === 'unknown'` off the committed content, and does not read
// `tools/world-content-residue.csv`. Two statements of one fact, which is
// exactly the shape that drifts - so this holds them to each other across
// every zone rather than the one the panel happens to be showing.
//
// Both directions on purpose. "Every row of the CSV is in the list" alone
// would pass a list that named half the world besides; the second direction is
// the one nobody writes and the one that finds things.

const residueRows = readFileSync('tools/world-content-residue.csv', 'utf8')
  .split(/\r?\n/)
  .slice(1)
  .filter((line) => line.trim() !== '')
const fromCsv = new Set(residueRows.map((line) => line.slice(0, line.indexOf(','))))
const worldIndex = JSON.parse(readFileSync('src/data/world/index.json', 'utf8'))
const fromRule = new Set()
for (const zone of worldIndex.zones) {
  const file = JSON.parse(readFileSync(`src/data/world/${zone.id}.json`, 'utf8'))
  for (const room of file.rooms) if (room.rule === 'unknown') fromRule.add(`${zone.id}-${room.id}`)
}

// The denominator, and it goes first. Both sets being empty would satisfy every
// equality below while proving that neither instrument read anything.
ok(
  'there is a residue to compare at all',
  fromCsv.size > 0 && fromRule.size > 0,
  `${fromCsv.size} rows in the CSV, ${fromRule.size} rooms the rule left undecided`
)
const missingFromPanel = [...fromCsv].filter((id) => !fromRule.has(id))
const missingFromCsv = [...fromRule].filter((id) => !fromCsv.has(id))
ok(
  "every row of the residue CSV is a room the panel's coverage list offers",
  missingFromPanel.length === 0,
  missingFromPanel.slice(0, 5).join(', ')
)
ok(
  'and the coverage list names nothing the residue CSV does not',
  missingFromCsv.length === 0,
  missingFromCsv.slice(0, 5).join(', ')
)
ok(
  'the index agrees on how many that is',
  worldIndex.zones.reduce((n, z) => n + z.unknown, 0) === fromRule.size,
  `${fromRule.size} across ${worldIndex.zones.length} zones`
)

// ---------------------------------------------------------------------------
// 8. A correction survives the next build.
// ---------------------------------------------------------------------------
// The real `tools/build-world-content.mjs`, run end to end through its
// `DRC_WORLD_OUT` / `DRC_SCENE_OVERRIDES` seams, against the committed map. Not
// a fixture and not the builder's internals: the claim S4 makes is about what
// `npm run world:build` writes to disk, and only running it says that.
//
// The seams are pointed somewhere the default could not reach - a fresh temp
// directory - so a run that ignored `DRC_WORLD_OUT` would fail for want of the
// file rather than passing against the committed one.

const scratch = mkdtempSync(join(tmpdir(), 'drc-scene-'))
const buildWith = (overrides) => {
  const out = mkdtempSync(join(scratch, 'out-'))
  const env = { ...process.env, DRC_WORLD_OUT: out, DRC_WORLD_RESIDUE: join(out, 'residue.csv') }
  if (overrides === null) delete env.DRC_SCENE_OVERRIDES
  else {
    const path = join(out, 'overrides.json')
    writeFileSync(path, JSON.stringify(overrides))
    env.DRC_SCENE_OVERRIDES = path
  }
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--experimental-strip-types', 'tools/build-world-content.mjs'],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    return { code: 0, stdout, out }
  } catch (error) {
    return { code: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`, out }
  }
}
const roomFrom = (out, zone, id) =>
  JSON.parse(readFileSync(join(out, `${zone}.json`), 'utf8')).rooms.find((r) => r.id === id)

// A room the batch has an opinion about, so "the player won" is a difference
// and not merely an answer. Chosen by asking the committed content rather than
// typed, so a room the pipeline stops classifying this way fails for want of a
// subject instead of passing against a stale id.
const baseline = buildWith(null)
ok('the builder runs with no player file at all', baseline.code === 0)
ok(
  'and says so as its own sentence rather than reporting a zero',
  baseline.stdout.includes('nothing to apply above colour, which is the ordinary state'),
  'so "no file" and "a file that decided nothing" cannot print the same line'
)
ok(
  'the seam is real: the run wrote where it was pointed',
  roomFrom(baseline.out, ZONE, subject.id) !== undefined,
  baseline.out
)

const beforeBuild = roomFrom(baseline.out, ZONE, subject.id)
const otherGround = [...GROUND_KINDS].find((k) => k !== beforeBuild.ground && k !== 'unknown')
const edited = buildWith({
  version: 1,
  provenance: 'tools/scene-editor-test.mjs',
  overrides: {
    [`${ZONE}-${subject.id}`]: { ground: otherGround, landmark: null },
    'this-is-not-a-room': { ground: otherGround },
    [`${ZONE}-${subject.id === 1 ? 2 : 1}`]: { ground: 'lava' },
  },
})
const afterBuild = edited.code === 0 ? roomFrom(edited.out, ZONE, subject.id) : null
ok('the builder runs with a player file', edited.code === 0, edited.code === 0 ? '' : edited.stdout.slice(0, 200))
ok(
  'a room in the imported set comes out of the builder with the imported answer',
  afterBuild?.ground === otherGround,
  `${beforeBuild.ground} -> ${afterBuild?.ground}`
)
ok(
  'and the build records that a person decided it, not colour or title',
  afterBuild?.rule === 'player',
  `was decided by ${beforeBuild.rule}`
)
ok(
  'the block follows the overridden ground rather than staying the batch’s',
  afterBuild?.block === blockKindFor(otherGround),
  `${afterBuild?.block} for ${otherGround}`
)
ok(
  'a landmark override of null reaches the built file',
  afterBuild?.landmark === null,
  '"this room has no landmark" is a correction the batch cannot express'
)
ok(
  'a field this build cannot draw is dropped and counted, never baked in',
  /1 fields dropped as undrawable/.test(edited.stdout) &&
    roomFrom(edited.out, ZONE, subject.id === 1 ? 2 : 1).ground !== 'lava',
  'a ground Godot has no factory for would render as the placeholder box for every player'
)
ok(
  'no other room in the zone moved',
  JSON.parse(readFileSync(join(edited.out, `${ZONE}.json`), 'utf8')).rooms.filter(
    (r) => r.rule === 'player'
  ).length === 1,
  'exactly the one that was overridden'
)

// The state that would otherwise be indistinguishable from having no file.
const foreign = buildWith({
  version: 1,
  overrides: { 'zzz-1': { ground: otherGround }, 'zzz-2': { ground: otherGround } },
})
ok(
  'a file for another cartography is refused rather than silently applying nothing',
  foreign.code === 1,
  'applying none of it would look exactly like having no file'
)
ok(
  'and the refusal says how many rooms it could not place',
  /names 2 rooms and not one of them is a room this map has/.test(foreign.stdout),
  foreign.stdout.split('\n').filter((l) => l.startsWith('FAIL'))[0]?.slice(0, 90) ?? ''
)

rmSync(scratch, { recursive: true, force: true })

reset()

// The floor. Set below the real count and never touched otherwise: a truncated
// run, a module that failed to import, or a section quietly deleted would
// otherwise print "0 failed" and exit 0, which is what a passing run looks like.
const FLOOR = 80
if (pass + fail < FLOOR) {
  console.log(`\nFAIL only ${pass + fail} checks ran, below the floor of ${FLOOR}. The run was truncated.`)
  process.exit(1)
}

console.log(`\n${pass} passed, ${fail} failed (store key ${SCENE_STORAGE_KEY})`)
process.exit(fail === 0 ? 0 : 1)
