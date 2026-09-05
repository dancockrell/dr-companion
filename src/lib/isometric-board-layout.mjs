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
    spawnPoints: [
      { id: 'player', role: 'player', anchor: { x: 0, y: 0.52, z: 0 }, yawDeg: 0, rigSocket: 'humanoid-root' },
      { id: 'occupant-left', role: 'occupant', anchor: { x: -1.15, y: 0.42, z: 0.75 }, yawDeg: 45, rigSocket: 'humanoid-root' },
      { id: 'occupant-right', role: 'occupant', anchor: { x: 1.15, y: 0.42, z: 0.75 }, yawDeg: -45, rigSocket: 'humanoid-root' },
      { id: 'hostile-left', role: 'hostile', anchor: { x: -1.35, y: 0.42, z: -1.15 }, yawDeg: 135, rigSocket: 'creature-root' },
      { id: 'hostile-right', role: 'hostile', anchor: { x: 1.35, y: 0.42, z: -1.15 }, yawDeg: -135, rigSocket: 'creature-root' },
      { id: 'item-left', role: 'item', anchor: { x: -1.55, y: 0.08, z: 1.55 }, yawDeg: 0, rigSocket: 'item-root' },
      { id: 'item-right', role: 'item', anchor: { x: 1.55, y: 0.08, z: 1.55 }, yawDeg: 0, rigSocket: 'item-root' },
    ],
  }
}
