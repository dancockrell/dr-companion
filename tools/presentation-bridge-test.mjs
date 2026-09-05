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
import { cannotAct, compileWorldSnapshot, justReconnected, projectionKey, shouldPublish } from '../src/lib/presentationBridge.ts'
// Imported rather than retyped: a test that hardcodes the number it checks
// only proves somebody remembered to edit two places.
import { CELL_BLOCK_METRES, CELL_GAP_METRES, CELL_PITCH_METRES } from '../src/lib/isometric-board-layout.mjs'
import {
  APPEARANCE_STORAGE_KEY,
  appearanceFor,
  setAppearanceOverride,
  weaponClassFor,
} from '../src/lib/appearance.ts'
import { armorPieceId } from '../src/lib/armorLoadout.ts'
// Same reason: the appearance checks below assert against the compiled table,
// not against the values it happens to hold today. Every class is null now,
// and a hardcoded null would keep passing after a mesh is admitted.
import defaults from '../src/data/appearanceDefaults.json' with { type: 'json' }
// Shared with tools/godot-fixture-contract-test.mjs, which compiles a live
// snapshot from this same zone to check the viewer's manifest contract.
import { LIVE_HERE as HERE, LIVE_ZONE as ZONE } from './live-zone-fixture.mjs'

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

// The zone and current room moved to tools/live-zone-fixture.mjs when
// godot-fixture-contract-test.mjs started compiling a live snapshot to check
// the manifest contract against. One copy, so the two suites cannot end up
// asserting things about different worlds while appearing to agree.

const CHARACTER = {
  // "a wild boar" is an exact bestiary name match; "a savage mage" has no
  // such entry but resolves via the ambiguous byNoun index ("mage") -
  // verified directly against src/data/bestiary.json, not assumed - so the
  // fixture covers both the confident and the approximate lore paths.
  roomCreatures: ['a wild boar', 'a savage mage'],
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
    // The property, not the number: a live cell's block matches the offline
    // compiler's, and both are smaller than the pitch so there is a gutter
    // between neighbouring rooms. Asserting `5` pinned the old value and would
    // have had to be edited to whatever the new one was, which tests nothing.
    ok('live cells carry the same board footprint the offline compiler publishes',
      here?.board.footprint.width === CELL_BLOCK_METRES && here.board.footprint.depth === CELL_BLOCK_METRES)
    ok('and that block leaves a gutter rather than meeting its neighbour',
      CELL_BLOCK_METRES < CELL_PITCH_METRES && CELL_GAP_METRES > 0)
    ok('live cells preserve the rig-ready player spawn socket',
      here?.board.spawnPoints.some((spawn) => spawn.role === 'player' && spawn.rigSocket === 'humanoid-root') ?? false)
    ok('the linked exit resolves to the real target cell', here?.exits.find((e) => e.move === 'south')?.targetCellId === '1-13')
    ok('a compass traversal stays a typed road in the live snapshot',
      here?.exits.find((e) => e.move === 'south')?.tetherKind === 'road')
    ok('a compass traversal carries its local board-edge anchor',
      here?.exits.find((e) => e.move === 'south')?.boardAnchor?.z === 2.5)
    ok('a zone-leaving exit ("go gate") is still a real exit, with no fabricated local target',
      here?.exits.some((e) => e.move === 'go gate' && e.targetCellId === null) ?? false)
    ok('a named gate is a threshold but has no fabricated compass anchor',
      here?.exits.some((e) => e.move === 'go gate' && e.tetherKind === 'threshold' && e.boardAnchor === null) ?? false)
    ok('no exit was invented beyond what moves[] actually listed', here?.exits.length === 2, String(here?.exits.length))

    ok('the hostile creature in the room became an entity, already classified hostile (never inferred by Godot)',
      snap.entities.some((e) => e.name === 'a wild boar' && e.deck === 'hostile'))
    ok('the player in the room became a people-deck entity',
      snap.entities.some((e) => e.name === 'Kestrel' && e.deck === 'people'))
    ok('every entity is tethered to the current room id, never given its own coordinates',
      snap.entities.every((e) => e.roomId === '1-14'))

    const boar = snap.entities.find((e) => e.name === 'a wild boar')
    ok('the boar carries real Elanthipedia (play.net) bestiary lore, not just a bare name',
      boar?.lore != null && typeof boar.lore.attackRange === 'string', JSON.stringify(boar?.lore))
    ok('"a wild boar" is an exact bestiary name match, so it is not flagged approximate',
      !boar?.loreApproximate)

    const mage = snap.entities.find((e) => e.name === 'a savage mage')
    ok('"a savage mage" has no exact bestiary entry but resolves lore via the noun index',
      mage?.lore != null, JSON.stringify(mage?.lore))
    ok('a noun-only match is marked approximate, so a confident-looking card doesn\'t overstate what\'s known',
      mage?.loreApproximate === true)

    const kestrel = snap.entities.find((e) => e.name === 'Kestrel')
    ok('a named player carries no fabricated bestiary lore (Kestrel is not a creature)',
      kestrel?.lore === undefined)

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

console.log('\n-- shouldPublish: every projected fact stays live without duplicate snapshots --')
{
  const base = compileWorldSnapshot({ zone: ZONE, here: HERE, character: CHARACTER, sequence: 1 })
  const same = compileWorldSnapshot({ zone: ZONE, here: HERE, character: { ...CHARACTER }, sequence: 99 })
  const hurt = compileWorldSnapshot({
    zone: ZONE,
    here: HERE,
    sequence: 2,
    character: {
      ...CHARACTER,
      situation: ['in_combat', 'stunned'],
      roundtime: 4,
      vitals: { health: 40, healthMax: 100, spirit: 10, spiritMax: 10, fatigue: 10, fatigueMax: 10 },
    },
  })
  const assessed = compileWorldSnapshot({
    zone: ZONE,
    here: HERE,
    sequence: 3,
    character: {
      ...CHARACTER,
      roomCombatants: [{
        id: 'boar-1', name: 'a wild boar', noun: 'boar', dead: false, hostile: true,
        disengaged: false, range: 'melee', relation: 'in front of you', target: 'you',
        targetNumber: 1, balance: 'solid', offBalance: false, conditions: [],
        statuses: [], enrichedAgeSeconds: 2,
      }],
    },
  })
  const noDagger = compileWorldSnapshot({
    zone: ZONE, here: HERE, sequence: 4,
    character: { ...CHARACTER, roomItems: ['some copper kronars'] },
  })
  const baseKey = projectionKey(base)
  ok('sequence alone does not produce a duplicate snapshot',
    projectionKey(same) === baseKey && !shouldPublish(projectionKey(same), baseKey, false))
  ok('health, action lock, and roundtime changes publish without a room move',
    shouldPublish(projectionKey(hurt), baseKey, false))
  ok('assessed creature state publishes without a room move',
    shouldPublish(projectionKey(assessed), baseKey, false))
  ok('ground-item changes publish without a room move',
    shouldPublish(projectionKey(noDagger), baseKey, false))
  ok('the same projection forced by reconnect publishes anyway',
    shouldPublish(baseKey, baseKey, true))
  ok('no prior projection at all publishes', shouldPublish(baseKey, null, false))
}

console.log('\n-- tactical: what the game already knows, carried without inventing anything --')
{
  // Only the boar is assessed. The mage is in the room and untracked, which
  // is the ordinary case before anyone runs `assess` - the two must stay
  // distinguishable in the snapshot.
  const ASSESSED = {
    ...CHARACTER,
    roomCombatants: [
      {
        id: 'boar-1',
        name: 'a wild boar',
        noun: 'boar',
        dead: false,
        hostile: true,
        disengaged: false,
        range: 'melee',
        relation: 'in front of you',
        target: 'you',
        targetNumber: 1,
        balance: 'off',
        offBalance: true,
        conditions: ['cursed'],
        statuses: ['stunned'],
        enrichedAgeSeconds: 42,
      },
    ],
  }
  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: ASSESSED, sequence: 9 })
  const boar = snap?.entities.find((e) => e.noun === 'boar')
  const mage = snap?.entities.find((e) => e.noun === 'mage')

  ok('the assessed creature carries tactical data', !!boar?.tactical)
  ok('range comes through in DR\'s own bucket', boar?.tactical?.range === 'melee', String(boar?.tactical?.range))
  ok('the positional phrase is passed through verbatim, not turned into an angle',
    boar?.tactical?.relation === 'in front of you', String(boar?.tactical?.relation))
  ok('who it is engaging comes through', boar?.tactical?.target === 'you')
  ok('offBalance comes through (a softer target)', boar?.tactical?.offBalance === true)
  ok('live crtrStatus flags come through', JSON.stringify(boar?.tactical?.statuses) === '["stunned"]')
  ok('assess-only conditions come through', JSON.stringify(boar?.tactical?.conditions) === '["cursed"]')
  ok('staleness travels with the data, so the viewer can decay confidence',
    boar?.tactical?.enrichedAgeSeconds === 42, String(boar?.tactical?.enrichedAgeSeconds))

  // The honest-absence half, and the reason `tactical` is optional rather
  // than null-filled: an unassessed creature must not read as one assessed
  // and found to have nothing.
  ok('an unassessed creature in the same room has no tactical key at all',
    mage !== undefined && !('tactical' in mage))

  // Nothing assessed at all must not fabricate an empty tactical block.
  const plain = compileWorldSnapshot({ zone: ZONE, here: HERE, character: CHARACTER, sequence: 10 })
  ok('with no roomCombatants at all, no entity gets a tactical key',
    plain?.entities.every((e) => !('tactical' in e)) === true)
}

console.log('\n-- cannotAct: the window where a fight is actually lost --')
{
  // A competent player is mostly not hit. The damage lands in the rare
  // windows where the character cannot act, which is why this predicate
  // exists at all rather than an attack feed.
  ok('stunned means you cannot act', cannotAct(['in_combat', 'stunned']) === true)
  ok('webbed means you cannot act', cannotAct(['webbed']) === true)
  ok('immobilized means you cannot act', cannotAct(['immobilized']) === true)
  ok('several at once still just means you cannot act',
    cannotAct(['stunned', 'webbed', 'immobilized']) === true)

  // prone is deliberately NOT in the set: dangerous, but you can still act.
  ok('prone is dangerous but is NOT "cannot act" - vulnerable is not helpless',
    cannotAct(['prone']) === false)
  ok('ordinary combat is not "cannot act"', cannotAct(['in_combat', 'roundtime']) === false)
  ok('no flags at all is not "cannot act"', cannotAct([]) === false)
  ok('absent flags do not throw and do not claim helplessness',
    cannotAct(undefined) === false)
}

console.log('\n-- player: the character\'s own state, carried to the viewer --')
{
  const HURT = {
    ...CHARACTER,
    situation: ['in_combat', 'stunned'],
    roundtime: 9,
    vitals: { health: 43, healthMax: 100, spirit: 10, spiritMax: 10, fatigue: 5, fatigueMax: 10 },
  }
  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: HURT, sequence: 11 })
  ok('the snapshot carries a player block', !!snap?.player)
  ok('every lit flag is carried verbatim, not just the ones this file reads',
    JSON.stringify(snap?.player?.situation) === '["in_combat","stunned"]')
  ok('cannotAct is decided once here, so two renderers cannot drift on it',
    snap?.player?.cannotAct === true)
  ok('roundtime - the one real clock in this snapshot - comes through',
    snap?.player?.roundtime === 9, String(snap?.player?.roundtime))
  ok('health is a 0-1 fraction', snap?.player?.health === 0.43, String(snap?.player?.health))

	const overflow = compileWorldSnapshot({
		zone: ZONE, here: HERE, sequence: 14,
		character: { ...CHARACTER, vitals: { health: 120, healthMax: 100, spirit: 0, spiritMax: 0, fatigue: 0, fatigueMax: 0 } },
	})
	ok('health remains inside its documented 0-1 wire range', overflow?.player?.health === 1, String(overflow?.player?.health))

  // Absent means unknown, never "a healthy character".
  const none = compileWorldSnapshot({ zone: ZONE, here: HERE, character: null, sequence: 12 })
  ok('with no character at all, player is null rather than a healthy-looking default',
    none === null || none.player === null)

  const noMax = compileWorldSnapshot({
    zone: ZONE, here: HERE, sequence: 13,
    character: { ...CHARACTER, situation: [], vitals: { health: 0, healthMax: 0, spirit: 0, spiritMax: 0, fatigue: 0, fatigueMax: 0 } },
  })
  ok('healthMax of zero yields null health, not a divide-by-zero or a fake 0%',
    noMax?.player?.health === null, String(noMax?.player?.health))
  ok('a character with no roundtime reports null, not 0 seconds left',
    noMax?.player?.roundtime === null, String(noMax?.player?.roundtime))
}

console.log('\n-- balance and position: how the fight is actually going --')
{
  const FIGHT = {
    ...CHARACTER,
    situation: ['in_combat'],
    vitals: { health: 86, healthMax: 100, spirit: 10, spiritMax: 10, fatigue: 5, fatigueMax: 10 },
    balance: 9,
    position: 2,
  }
  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: FIGHT, sequence: 20 })
  ok('balance comes through as the ladder index, not a word',
    snap?.player?.balance === 9, String(snap?.player?.balance))
  ok('position comes through on DR\'s own signed scale',
    snap?.player?.position === 2, String(snap?.player?.position))

  // The falsy-zero trap, and the reason these use `?? null` rather than
  // `|| null`. Balance 0 is 'completely' off your feet - the worst rung of
  // the ladder - and position 0 is a dead-even contest. Both are real
  // readings that happen to be falsy.
  const PINNED = { ...FIGHT, balance: 0, position: 0 }
  const pinned = compileWorldSnapshot({ zone: ZONE, here: HERE, character: PINNED, sequence: 21 })
  ok('balance 0 (completely off balance) survives as 0, not null',
    pinned?.player?.balance === 0, String(pinned?.player?.balance))
  ok('position 0 (no advantage) survives as 0, not null',
    pinned?.player?.position === 0, String(pinned?.player?.position))

  // Losing badly: the opponent's side of the same scale.
  const LOSING = { ...FIGHT, position: -7 }
  const losing = compileWorldSnapshot({ zone: ZONE, here: HERE, character: LOSING, sequence: 22 })
  ok('a negative position (opponent in excellent position) is carried signed',
    losing?.player?.position === -7, String(losing?.player?.position))

  // An older installed bridge simply does not send these.
  const OLD = compileWorldSnapshot({ zone: ZONE, here: HERE, character: { ...CHARACTER, situation: [] }, sequence: 23 })
  ok('a bridge too old to send balance reports null, not a fake reading',
    OLD?.player?.balance === null, String(OLD?.player?.balance))
  ok('a bridge too old to send position reports null, not a fake even contest',
    OLD?.player?.position === null, String(OLD?.player?.position))
}

console.log('\n-- justReconnected: the false->true edge that forces a publish past the room-changed gate --')
{
  ok('disconnected -> connected: a real reconnect', justReconnected(true, false) === true)
  ok('already connected, still connected: not a reconnect', justReconnected(true, true) === false)
  ok('still disconnected: not a reconnect', justReconnected(false, false) === false)
  ok('connected -> disconnected: not a reconnect (dropping is not reconnecting)',
    justReconnected(false, true) === false)
}

console.log('\n-- appearance: the class resolves, the mesh is allowed not to exist --')
{
  // Read from the compiled table rather than retyped. Every class is null
  // today, so a hardcoded `=== null` here would pass for the wrong reason and
  // keep passing after Codex admits a weapon mesh, which is the moment this
  // check most needs to be true.
  const LARGE_EDGED = defaults.weapon.classes['Large Edged']
  const SMALL_EDGED = defaults.weapon.classes['Small Edged']

  ok('a bastard sword is Large Edged, not the bare "sword" entry it contains',
    weaponClassFor('a heavy bastard sword') === 'Large Edged', String(weaponClassFor('a heavy bastard sword')))
  ok('a bastard sword resolves to the Large Edged default, whatever that default currently is',
    appearanceFor('weapon', 'a heavy bastard sword')?.modelId === LARGE_EDGED, String(LARGE_EDGED))
  ok('a throwing knife is Light Thrown, not Small Edged (longest phrase wins)',
    weaponClassFor('a slim throwing knife') === 'Light Thrown', String(weaponClassFor('a slim throwing knife')))
  ok('a greatsword is Twohanded Edged, not Large Edged',
    weaponClassFor('a notched greatsword') === 'Twohanded Edged', String(weaponClassFor('a notched greatsword')))

  // The whole point of the table: something nobody has mapped gets nothing.
  ok('a noun nobody has mapped resolves to no class, never the nearest match',
    weaponClassFor('a chthonic warblade of the ninth seal') === null)
  ok('and so resolves to no appearance at all',
    appearanceFor('weapon', 'a chthonic warblade of the ninth seal') === null)

  ok('armour classification is armorLoadout.ts\'s, not a second copy',
    appearanceFor('armor', 'a steel helm')?.class === 'head',
    String(appearanceFor('armor', 'a steel helm')?.class))
  ok('a class with no admitted mesh still reports its class',
    appearanceFor('weapon', 'a rusty dagger')?.class === 'Small Edged')
  ok('...and its modelId is the compiled default for that class',
    appearanceFor('weapon', 'a rusty dagger')?.modelId === SMALL_EDGED, String(SMALL_EDGED))

  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: CHARACTER, sequence: 30 })
  const dagger = snap?.groundItems?.find((i) => i.name === 'a rusty dagger')
  const kronars = snap?.groundItems?.find((i) => i.name === 'some copper kronars')
  ok('a ground item whose name resolves carries appearance',
    dagger?.appearance?.class === 'Small Edged', String(dagger?.appearance?.class))
  ok('a ground item whose name does not resolve has the field ABSENT, not a null string',
    kronars !== undefined && !('appearance' in kronars),
    kronars ? JSON.stringify(Object.keys(kronars)) : 'no such item')
  // A creature noun is neither a weapon nor armour, so it must resolve to
  // nothing. This is the check that would go red if the resolver ever started
  // guessing - "a wild boar" is exactly the kind of name a loose matcher
  // would find a mesh for.
  const boar = snap?.entities?.find((e) => e.name === 'a wild boar')
  ok('a creature carries no appearance rather than an invented one',
    boar !== undefined && !('appearance' in boar),
    boar ? JSON.stringify(Object.keys(boar)) : 'no such entity')
}

console.log('\n-- appearance: the player figure, and an override winning --')
{
  const ARMED = {
    ...CHARACTER,
    hands: { left: null, right: 'a bastard sword' },
    vitals: { health: 100, healthMax: 100 },
  }
  const WORN = { containers: [], worn: ['a steel helm', 'a leather hauberk'], wornCount: 2, looseCount: 0, pressure: 'ok' }

  const snap = compileWorldSnapshot({ zone: ZONE, here: HERE, character: ARMED, inventory: WORN, sequence: 31 })
  ok('the wielded hand becomes the player\'s weapon appearance',
    snap?.player?.appearance?.rightHand?.class === 'Large Edged',
    String(snap?.player?.appearance?.rightHand?.class))
  ok('an empty hand is ABSENT, not an empty-handed claim',
    snap?.player?.appearance !== undefined && !('leftHand' in snap.player.appearance),
    JSON.stringify(Object.keys(snap?.player?.appearance ?? {})))
  ok('worn pieces resolve through inferArmorCoverage, in ARMOR_COVERAGE order',
    JSON.stringify(snap?.player?.appearance?.worn?.map((p) => p.class)) === JSON.stringify(['head', 'chest']),
    JSON.stringify(snap?.player?.appearance?.worn?.map((p) => p.class)))

  const bare = compileWorldSnapshot({ zone: ZONE, here: HERE, character: CHARACTER, sequence: 32 })
  ok('a character with no hands field and no inventory has NO player appearance field',
    bare?.player !== null && !('appearance' in bare.player),
    JSON.stringify(Object.keys(bare?.player ?? {})))

  // localStorage does not exist under Node, so `storage.ts` returns the
  // fallback and every override path above ran with an empty store. That is
  // the store's honest behaviour and it is also a check that never exercises
  // the override branch, so stand one up and drive it.
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v) },
    removeItem: (k) => { store.delete(k) },
  }

  const REAL_ID = defaults.registry.ids[0]
  ok('the registry ids reached the client at all (positive control for the two checks below)',
    typeof REAL_ID === 'string' && REAL_ID.length > 0, String(REAL_ID))

  ok('setting an override with a real registry id succeeds',
    setAppearanceOverride('a bastard sword', REAL_ID) === true)
  ok('the override wins over the compiled default',
    appearanceFor('weapon', 'a bastard sword')?.modelId === REAL_ID,
    String(appearanceFor('weapon', 'a bastard sword')?.modelId))
  ok('and it is marked as the player\'s choice, not derived',
    appearanceFor('weapon', 'a bastard sword')?.provenance === 'player')
  ok('the override reaches the snapshot, not only the resolver',
    compileWorldSnapshot({ zone: ZONE, here: HERE, character: ARMED, inventory: WORN, sequence: 33 })
      ?.player?.appearance?.rightHand?.modelId === REAL_ID)

  ok('an override naming an id the registry never admitted is refused',
    setAppearanceOverride('a bastard sword', 'dr.shared.nothing.at.all') === false)
  // Keyed with armorPieceId rather than a hand-typed string. The first
  // version of this check typed 'bastard sword', the store is keyed
  // 'bastard-sword', so the override never applied and the check passed
  // without ever reaching the line it was written for - it stayed green under
  // a deliberate sabotage of that line, which is how it was caught.
  const BAD_KEY = armorPieceId('a bastard sword')
  ok('the test writes the key the resolver actually reads (control for the check below)',
    BAD_KEY === 'bastard-sword', BAD_KEY)
  store.set(APPEARANCE_STORAGE_KEY, JSON.stringify({ [BAD_KEY]: 'dr.shared.nothing.at.all' }))
  ok('an override already in storage naming an unadmitted id is ignored, not rendered as a mesh that never loads',
    appearanceFor('weapon', 'a bastard sword')?.modelId === defaults.weapon.classes['Large Edged'],
    String(appearanceFor('weapon', 'a bastard sword')?.modelId))
  ok('...and it reports as derived, so the player is not told a refused choice took',
    appearanceFor('weapon', 'a bastard sword')?.provenance === 'derived')

  store.clear()
  ok('resetting returns the item to its compiled default',
    appearanceFor('weapon', 'a bastard sword')?.provenance === 'derived')
  delete globalThis.localStorage
}

console.log('')
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
