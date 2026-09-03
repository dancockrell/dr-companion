/**
 * compileWorldSnapshot has no test.
 *
 * It is the one place this app's own live room state becomes the
 * `WorldSnapshot` the Godot viewer's `world_manifest_loader.gd` and
 * `src-tauri/src/presentation_bridge.rs`'s `validate_walk` both trust
 * without re-deriving. A bug here that fabricates an exit, drops a real
 * one, or lets the current room be missing from its own cell list would be
 * exactly the "Godot decides something it shouldn't" failure the whole
 * bridge exists to prevent - just introduced one layer earlier, in the
 * compiler rather than the renderer.
 *
 *   node --experimental-strip-types tools/presentation-bridge-test.mjs
 */
import { compileWorldSnapshot, shouldPublish } from '../src/lib/presentationBridge.ts'

let pass = 0
let fail = 0

function ok(label, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(64)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(64)} ${detail ?? ''}`)
  }
}

/** A minimal, realistic three-room zone: Town Green North (14), with a real
 * link south to 13 and a zone-leaving exit ("go gate") that has no local
 * target - the exact shape `mapData.ts`'s `toZoneRoom` produces when
 * `moves.length` exceeds `links.length`. */
const ZONE = {
  ok: true,
  zone: '1',
  name: 'The Crossing',
  here: 14,
  rooms: [
    {
      id: 14,
      uid: null,
      title: 'The Crossing, Town Green North',
      x: 100,
      y: -50,
      z: 0,
      moves: ['south', 'go gate'],
      links: [{ to: 13, kind: 'walk' }],
      to: [13],
    },
    {
      id: 13,
      uid: null,
      title: 'The Crossing, Town Green',
      x: 100,
      y: -46,
      z: 0,
      moves: ['north'],
      links: [{ to: 14, kind: 'walk' }],
      to: [14],
    },
  ],
}

const HERE = { id: 14, uid: null, title: null, location: null }

const CHARACTER = {
  roomCreatures: ['a wild boar'],
  roomDeadCreatures: [],
  roomAllies: [],
  roomPlayers: ['Kestrel'],
  groupMembers: [],
  roomItems: ['a rusty dagger', 'some copper kronars'],
}

console.log('-- compileWorldSnapshot: the honest-null cases --')
{
  ok('null zone compiles to null, not a snapshot with invented rooms', compileWorldSnapshot({ zone: null, here: HERE, character: null, sequence: 1 }) === null)
  ok('a zone reporting ok:false compiles to null', compileWorldSnapshot({ zone: { ok: false }, here: HERE, character: null, sequence: 1 }) === null)
  ok('no current room id anywhere compiles to null', compileWorldSnapshot({ zone: { ...ZONE, here: undefined }, here: null, character: null, sequence: 1 }) === null)
  ok('a current room id that is not among the zone\'s own cells compiles to null (not a snapshot claiming a room it cannot find)',
    compileWorldSnapshot({ zone: { ...ZONE, rooms: [ZONE.rooms[1]] }, here: HERE, character: null, sequence: 1 }) === null)
}

console.log('\n-- compileWorldSnapshot: a real snapshot --')
{
  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: CHARACTER, sequence: 5 })
  ok('a valid zone + here compiles to a real snapshot', snap !== null)
  if (snap) {
    ok('protocol is 1', snap.protocol === 1)
    ok('sequence passes through unchanged', snap.sequence === 5)
    ok('worldId is the zone id', snap.worldId === '1')
    ok('currentRoomId is zone-prefixed', snap.currentRoomId === '1-14', snap.currentRoomId)
    ok('both rooms became cells', snap.cells.length === 2, String(snap.cells.length))

    const here = snap.cells.find((c) => c.id === '1-14')
    ok('the current cell carries its real title', here?.title === 'The Crossing, Town Green North')
    ok('the linked exit resolves to the real target cell', here?.exits.find((e) => e.move === 'south')?.targetCellId === '1-13')
    ok('a zone-leaving exit ("go gate") is still a real exit, with no fabricated local target',
      here?.exits.some((e) => e.move === 'go gate' && e.targetCellId === null) ?? false)
    ok('no exit was invented beyond what moves[] actually listed', here?.exits.length === 2, String(here?.exits.length))

    ok('the hostile creature in the room became an entity, already classified hostile (never inferred by Godot)',
      snap.entities.some((e) => e.name === 'a wild boar' && e.deck === 'hostile'))
    ok('the player in the room became a people-deck entity',
      snap.entities.some((e) => e.name === 'Kestrel' && e.deck === 'people'))
    ok('every entity is tethered to the current room id, never given its own coordinates',
      snap.entities.every((e) => e.roomId === '1-14'))

    ok('both room items became ground items', snap.groundItems.length === 2, String(snap.groundItems.length))
    ok('ground items are tethered to the room too', snap.groundItems.every((g) => g.roomId === '1-14'))
  }
}

console.log('\n-- compileWorldSnapshot: world position uses the same scale as the Godot-side manifest compiler --')
{
  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: null, sequence: 1 })
  const here = snap?.cells.find((c) => c.id === '1-14')
  // mapUnitToMetres = 0.25, y inverted to z, level (z) * 5 - see
  // tools/build-primitive-world-manifest.mjs's own worldPosition and this
  // file's own MAP_UNIT_TO_METRES/LEVEL_HEIGHT_METRES.
  ok('x scales by 0.25', here?.position.x === 25, String(here?.position.x))
  ok('map y inverts into world z, scaled by 0.25', here?.position.z === 12.5, String(here?.position.z))
  ok('map level (z) becomes 5m world height steps', here?.position.y === 0, String(here?.position.y))
}

console.log('\n-- shouldPublish: the gate between "state updated" and "Godot gets a new snapshot" --')
{
  ok('the same room, not forced: does not publish (this is the whole point of the gate)',
    shouldPublish('1-14', '1-14', false) === false)
  ok('a different room, not forced: publishes', shouldPublish('1-13', '1-14', false) === true)
  ok('the same room, forced (a reconnect): publishes anyway',
    shouldPublish('1-14', '1-14', true) === true)
  ok('no prior room at all (first publish this session): publishes',
    shouldPublish('1-14', null, false) === true)
}

console.log('')
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
