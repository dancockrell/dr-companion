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

export function boardLayoutFor(cell) {
  const interior = cell.classification?.spatialMode === 'interior-cutaway'
  return {
    footprint: { width: 5, depth: 5, height: interior ? 3 : 1, unit: 'metre' },
    selectionBounds: { width: 4.5, depth: 4.5, height: interior ? 3 : 1 },
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
