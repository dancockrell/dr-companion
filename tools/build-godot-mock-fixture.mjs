// Generates godot/mock/crossing_mock_world.json, the fixture the Godot viewer
// loads when it is started without --live-presentation.
//
// The fixture used to be a checked-in file with no generator, which meant the
// only way to change it was to hand-edit a projection of the world manifest —
// and nothing could tell whether it still matched the manifest it claimed to
// come from. It is a derived artefact now: this tool is the source, the file is
// the output, and --check fails the build when the two disagree.
//
// The projection is deliberately lossy, because mock mode exists to exercise
// the viewer's loader and intent path, not to be a second world:
//   - Town Green North (1-14) plus everything within two moves of it;
//   - board layout and asset candidates dropped, since a mock scene composes
//     its own and Codex owns that side;
//   - an exit whose target is outside the selection keeps its targetRoomId but
//     is marked targetCellId: null, external: true, so the viewer can render it
//     as a real exit it cannot follow rather than pretending it does not exist.
//
// Usage:
//   node tools/build-godot-mock-fixture.mjs           write the fixture
//   node tools/build-godot-mock-fixture.mjs --check   exit 1 on drift

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const zone = '1'
const rootCellId = '1-14'
const neighbourhoodDepth = 2
const manifestPath = `data/world/out/${zone}-primitive-world.json`
const fixturePath = 'godot/mock/crossing_mock_world.json'
const checkOnly = process.argv.includes('--check')

// data/world/out is generated and gitignored, so a fresh worktree has none of
// it. The manifest builder is cheap and idempotent; run it rather than failing
// with a missing-file error nobody can act on.
execFileSync(process.execPath, ['tools/build-primitive-world-manifest.mjs', zone], { stdio: 'inherit' })

const world = JSON.parse(readFileSync(manifestPath, 'utf8'))
const cellsById = new Map(world.cells.map((cell) => [cell.id, cell]))
if (!cellsById.has(rootCellId)) throw new Error(`${manifestPath} has no cell ${rootCellId} to build the mock around`)

const selected = new Set([rootCellId])
let frontier = [rootCellId]
for (let depth = 0; depth < neighbourhoodDepth; depth += 1) {
  const next = []
  for (const id of frontier) {
    for (const exit of cellsById.get(id)?.exits ?? []) {
      if (!exit.targetCellId || selected.has(exit.targetCellId) || !cellsById.has(exit.targetCellId)) continue
      selected.add(exit.targetCellId)
      next.push(exit.targetCellId)
    }
  }
  frontier = next
}

const projectExit = (exit) => {
  const inside = Boolean(exit.targetCellId) && selected.has(exit.targetCellId)
  const projected = {
    move: exit.move,
    direction: exit.direction,
    targetRoomId: exit.targetRoomId,
    targetCellId: inside ? exit.targetCellId : null,
  }
  if (!inside) projected.external = true
  return projected
}

const projectCell = (cell) => {
  const { board, primitives, exits, ...rest } = cell
  return {
    ...rest,
    primitives: primitives.map((primitive) => ({ kind: primitive.kind, role: primitive.role })),
    exits: exits.map(projectExit),
  }
}

// The order the file was originally written in could not be reproduced from any
// property of the data, so it was an accident of whatever wrote it. This one is
// stated instead: the focused room first, then room number ascending.
const orderedIds = [rootCellId, ...[...selected].filter((id) => id !== rootCellId).sort((a, b) => cellsById.get(a).roomId - cellsById.get(b).roomId)]

const fixture = {
  schemaVersion: world.schemaVersion,
  protocol: 1,
  sequence: 1,
  worldId: 'crossing-mock',
  currentRoomId: rootCellId,
  generatedFrom: {
    source: manifestPath,
    generator: 'tools/build-godot-mock-fixture.mjs',
    note: `Slice 0 mock fixture: ${cellsById.get(rootCellId).title} plus a depth-${neighbourhoodDepth} neighborhood, for the checked-in Godot mock mode. Not the full Crossing manifest.`,
  },
  cells: orderedIds.map((id) => projectCell(cellsById.get(id))),
}

const generated = JSON.stringify(fixture, null, 2) + '\n'

if (checkOnly) {
  // The checkout may hold CRLF (core.autocrlf is true on this machine), so
  // compare the text with endings normalised: a line ending is not drift.
  const onDisk = readFileSync(fixturePath, 'utf8').replaceAll('\r\n', '\n')
  if (onDisk === generated) {
    console.log(`OK   ${fixturePath} matches a fresh generation (${fixture.cells.length} cells, root ${rootCellId})`)
  } else {
    console.error(`FAIL ${fixturePath} has drifted from tools/build-godot-mock-fixture.mjs.`)
    console.error('     It is a derived artefact: change the generator and re-run it, do not edit the JSON.')
    const a = onDisk.split('\n')
    const b = generated.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] === b[i]) continue
      console.error(`     first difference at line ${i + 1}:`)
      console.error(`       on disk:   ${a[i] ?? '<end of file>'}`)
      console.error(`       generated: ${b[i] ?? '<end of file>'}`)
      break
    }
    process.exit(1)
  }
} else {
  writeFileSync(fixturePath, generated)
  const external = fixture.cells.flatMap((cell) => cell.exits).filter((exit) => exit.external).length
  console.log(`wrote ${fixturePath}: ${fixture.cells.length} cells, ${external} exits leaving the slice`)
}
