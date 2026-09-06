const COMPASS_ANCHORS = {
  north: { x: 0, y: 0, z: -2.5, yawDeg: 0 },
  northeast: { x: 2.5, y: 0, z: -2.5, yawDeg: 45 },
  east: { x: 2.5, y: 0, z: 0, yawDeg: 90 },
  southeast: { x: 2.5, y: 0, z: 2.5, yawDeg: 135 },
  south: { x: 0, y: 0, z: 2.5, yawDeg: 180 },
  southwest: { x: -2.5, y: 0, z: 2.5, yawDeg: 225 },
  west: { x: -2.5, y: 0, z: 0, yawDeg: 270 },
  northwest: { x: -2.5, y: 0, z: -2.5, yawDeg: 315 },
}

export function classifyTether(command, direction) {
  const text = `${command} ${direction}`.toLowerCase()
  if (/\b(portal|moongate|rift|vortex)\b/.test(text)) return 'portal'
  if (/\b(warp|teleport|nexus)\b/.test(text)) return 'warp'
  if (/\b(ferry|boat|ship|barge|raft)\b/.test(text)) return 'ferry'
  if (/\b(ladder|rope|vine|branch|drain pipe)\b/.test(text)) return 'ladder'
  if (/\b(stair|steps|up|down)\b/.test(text)) return 'stairs'
  if (/\b(door|gate|arch|curtain|threshold|opening|entrance|exit|out)\b/.test(text)) return 'threshold'
  if (/\b(path|trail|track)\b/.test(text)) return 'path'
  if (/^(north|northeast|east|southeast|south|southwest|west|northwest)\b/.test(text)) return 'road'
  return 'other'
}

export function tetherAnchorFor(direction) {
  const anchor = COMPASS_ANCHORS[String(direction).toLowerCase()]
  return anchor ? { ...anchor } : null
}

/**
 * The game's own abbreviations for the directions above.
 *
 * DragonRealms' compass tag sends `<dir value='ne'/>`; the cartographer's
 * moves are written out in full ("northeast"). Anything comparing the two has
 * to agree on one vocabulary, and this file is where the compass vocabulary
 * already lives - a second copy of it beside a consumer would be free to drift
 * from the anchors, which is the failure `streamLabels.ts` was split out of a
 * component to avoid.
 *
 * `up`, `down` and `out` are deliberately absent: the anchors have no place
 * for them, they are not compass bearings, and giving them one would be a
 * claim about compass placement the graph never made.
 */
const COMPASS_ABBREVIATIONS = {
  n: 'north',
  ne: 'northeast',
  e: 'east',
  se: 'southeast',
  s: 'south',
  sw: 'southwest',
  w: 'west',
  nw: 'northwest',
}

/**
 * One direction word, or null when the value is not a compass bearing at all.
 *
 * Null rather than the input, so a caller can tell "this is northeast written
 * differently" from "this is `go gate`, which the compass will never report" -
 * and those two must stay different, because comparing a doorway against a
 * compass that cannot mention doorways would report a divergence in every room
 * that has one.
 */
export function expandCompassDirection(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (COMPASS_ABBREVIATIONS[text]) return COMPASS_ABBREVIATIONS[text]
  return COMPASS_ANCHORS[text] ? text : null
}

/**
 * How far apart adjacent rooms sit, in metres.
 *
 * `tools/build-primitive-world-manifest.mjs` multiplies map units by 0.25, and
 * neighbouring rooms in the Crossing manifest measure exactly 5.00 apart -
 * measured, not assumed. This is that number, named, so the block size below
 * can be stated as a relation to it rather than as a second constant that
 * happens to agree.
 */
export const CELL_PITCH_METRES = 5

/**
 * The gutter left between one room's block and the next.
 *
 * A board whose tiles exactly meet is one continuous surface, and a player
 * cannot see where a room ends - which is the same thing as not being able to
 * find the exits, because an exit lives at the edge. Dan, playing the viewer:
 * "the exits are sometimes hard to find... you should put a little bit of a
 * gap between each block, good idea anyways actually, prevents clipping."
 *
 * Both halves of that are right. The seam is what makes each room read as a
 * place, and a gutter also means neighbouring geometry cannot intersect, so a
 * block with any thickness or overhang at its edge has somewhere to be.
 *
 * Tether anchors stay at the pitch's half-width, not the block's, so a typed
 * connection is drawn *in* the gutter, spanning one tile to the next. That is
 * where a road or a doorway between two rooms belongs, and it puts the thing
 * the player is hunting for into the empty space that now separates the two
 * blocks rather than into a seam where two surfaces touch.
 */
export const CELL_GAP_METRES = 0.6

/** The drawn block: the pitch, less the gutter. */
export const CELL_BLOCK_METRES = CELL_PITCH_METRES - CELL_GAP_METRES

/**
 * Each token kind's own mesh, in metres. One owner for "how tall is a token".
 *
 * The viewer used to hold these: a capsule 0.94 tall for the player, a cylinder
 * 0.8 for an occupant, a sphere 0.68 for a hostile and a 0.12 box for a ground
 * item, all typed into `godot/scripts/entity_projection_layer.gd`, while this
 * module published each token's lift as half the same height. Two statements of
 * one rule in two languages, tied by nothing but a comment - and issue #385
 * demonstrated the drift with `sphere.height = 0.68` changed to `1.60`, which
 * left the hostile token 0.46 m inside its block with every guard in the
 * repository green.
 *
 * So the dimensions live here, the manifest carries them on each spawn point,
 * and the viewer builds the mesh out of what the cell published - the same
 * shape the block size, the ground and the selection box already have. The lift
 * is then not a second fact: `tokenLiftFor()` is the only place that says a
 * token is centred on its anchor, and there is no number left in GDScript for
 * it to disagree with.
 *
 * `shape` names the primitive rather than a height alone, because a viewer that
 * knew how tall a thing is and not what it is would be back to typing the other
 * half. A shape this module does not publish is not a token the viewer can
 * size, and it draws the deliberately implausible marker instead.
 */
export const TOKEN_MESHES = {
  player: { shape: 'capsule', height: 0.94, radius: 0.28 },
  occupant: { shape: 'cylinder', height: 0.8, topRadius: 0.18, bottomRadius: 0.38 },
  hostile: { shape: 'sphere', height: 0.68, radius: 0.34 },
  item: { shape: 'box', height: 0.12, width: 0.28, depth: 0.28 },
}

/** The mesh published for `role`, or null for a role that has no token. */
export function tokenMeshFor(role) {
  const mesh = TOKEN_MESHES[role]
  return mesh ? { ...mesh } : null
}

/**
 * How far above the block's top face a token of this role stands.
 *
 * The whole of the rule, stated once: a token is centred on its anchor, so its
 * lift is half its own height and its bottom face lands exactly on the surface.
 * Every published `anchor.y` comes from here,
 * `tools/godot-fixture-contract-test.mjs` checks the property that produces -
 * the bottom of the token is at or above the block top - on both subjects, and
 * `godot/tests/entity_projection_test.gd` measures the drawn mesh's bottom
 * against the block it stands on.
 */
export function tokenLiftFor(role) {
  const mesh = TOKEN_MESHES[role]
  return mesh ? mesh.height / 2 : 0
}

/** One published spawn point: where a thing of this role stands, and how big it is. */
function spawnPoint(id, role, x, z, yawDeg, rigSocket) {
  return { id, role, anchor: { x, y: tokenLiftFor(role), z }, yawDeg, rigSocket, token: tokenMeshFor(role) }
}

export function boardLayoutFor(cell) {
  const interior = cell.classification?.spatialMode === 'interior-cutaway'
  return {
    footprint: { width: CELL_BLOCK_METRES, depth: CELL_BLOCK_METRES, height: interior ? 3 : 1, unit: 'metre' },
    // The ground this cell owns: a full pitch square, so one room's ground meets
    // the next room's and the board has no holes in it. Deliberately larger than
    // the block above, and that difference is the gutter - seen from the fixed
    // isometric camera it is the ground showing round the block's edge, which is
    // what draws a room's outline.
    //
    // Measured, because the opposite is the obvious guess and it is wrong. The
    // Godot viewer drew this at a hand-typed 5.0 with the cell discarded, and
    // issue #362 read that as the ground ignoring CELL_GAP_METRES. Two captures
    // of a board at the minimum pitch settled it
    // (docs/verification/terrain-gutter-2026-09-05.md): with the ground shrunk
    // to the block, neighbouring blocks have nothing between them but their own
    // unshaded risers and merge into one mass with no room boundaries at all,
    // while the pitch-sized ground keeps every room outlined. The gutter is a
    // gap between *blocks*; it was never meant to be a hole in the world.
    //
    // Published rather than typed into the viewer so the number has one source,
    // which is the whole of #345 and the other half of #362.
    ground: { width: CELL_PITCH_METRES, depth: CELL_PITCH_METRES, unit: 'metre' },
    // The click target is the block, not the pitch. A selection box larger than
    // the thing drawn means clicking the gap between two rooms silently picks
    // one of them, which makes an exit hard to hit as well as hard to see.
    selectionBounds: { width: CELL_BLOCK_METRES, depth: CELL_BLOCK_METRES, height: interior ? 3 : 1 },
    // Where a thing stands on this cell. `anchor.y` is measured from the block's
    // top face, not from the cell's origin.
    //
    // It used to be measured from the origin - 0.52, 0.42 and 0.08 were the only
    // three heights across all 133 anchors in the checked-in world - and those
    // were right when they were written, against a placeholder block that was a
    // 0.3 m slab with its top face at 0.15. #365 gave the placeholder the full
    // published footprint, so the top face moved to 0.5 for a room and 1.5 for
    // an `interior-cutaway`, and every one of those anchors stayed where it was.
    // Measured on the committed fixture before this change: 117 of 133 anchors
    // sat below the top of the block their own cell publishes - 93 of the 105
    // belonging to a cell that actually draws one, which is the count issue #373
    // reported - and on the three cutaway cells all 21 were 1.0 to 1.4 m inside
    // it.
    //
    // Relative rather than absolute, which is the decision #373 left open. The
    // viewer has a placement path the board cannot reach: a tactical entity is
    // staged on the range band its assessed range names, so its x and z come
    // from a ring and never from a spawn point, and no absolute anchor published
    // here could give it a height. The rule "a token stands on the block's top
    // face" therefore has to exist in the viewer whatever this module publishes.
    // Publishing absolute anchors would state the same rule here as well, and
    // two statements of one rule drift - which is precisely how these numbers
    // came to disagree with the block. So the viewer adds
    // `ContentRegistry.block_top_y(cell)` once, in the single function every
    // token's position goes through, and this module says only how far above
    // that surface each kind of thing stands.
    //
    // A token is centred on its anchor, so each lift is half that token's own
    // height - and the token's dimensions are published here beside the lift
    // rather than typed into the viewer, which is issue #385. `tokenLiftFor()`
    // above is the only statement of the relation; no lift is written out on
    // these lines, so there is nothing here for a mesh to drift from.
    spawnPoints: [
      spawnPoint('player', 'player', 0, 0, 0, 'humanoid-root'),
      spawnPoint('occupant-left', 'occupant', -1.15, 0.75, 45, 'humanoid-root'),
      spawnPoint('occupant-right', 'occupant', 1.15, 0.75, -45, 'humanoid-root'),
      spawnPoint('hostile-left', 'hostile', -1.35, -1.15, 135, 'creature-root'),
      spawnPoint('hostile-right', 'hostile', 1.35, -1.15, -135, 'creature-root'),
      spawnPoint('item-left', 'item', -1.55, 1.55, 0, 'item-root'),
      spawnPoint('item-right', 'item', 1.55, 1.55, 0, 'item-root'),
    ],
  }
}
