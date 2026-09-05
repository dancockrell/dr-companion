#!/usr/bin/env node
/**
 * A mock world whose rooms sit at the board's *minimum* pitch, for looking at
 * the gutter.
 *
 * `godot/mock/crossing_mock_world.json` is a real Crossing extract, and its
 * closest two rooms are 12.5 m apart - two and a half times CELL_PITCH_METRES.
 * So no capture of that fixture can show what happens where two rooms are as
 * close as the compiler ever puts them, which is the only place the gutter
 * between blocks is decidable by eye. Issue #362's own caveat: "the mock's
 * neighbours sit further apart than the minimum, so the current capture shows
 * clear gaps. The claim here is about the code, not about a screenshot."
 *
 * This makes the screenshot possible. It rewrites every cell's position onto a
 * CELL_PITCH_METRES grid in the order the manifest lists them, changing nothing
 * else: the same cells, boards, footprints, primitives, exits and current room.
 * Everything the viewer draws is the real fixture's; only the spacing is the
 * worst case.
 *
 *   node tools/make-min-pitch-fixture.mjs <out.json> [columns]
 *
 * It is a verification instrument, not part of the build: nothing imports it
 * and no suite runs it. It exists so the two captures in
 * docs/verification/terrain-gutter-2026-09-05.md can be taken again by anyone
 * who doubts them, which a saved PNG on its own does not allow.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { CELL_PITCH_METRES } from '../src/lib/isometric-board-layout.mjs'

const SOURCE = 'godot/mock/crossing_mock_world.json'
const out = process.argv[2]
const columns = Number(process.argv[3] ?? 4)
if (!out) {
  console.error('usage: node tools/make-min-pitch-fixture.mjs <out.json> [columns]')
  process.exit(2)
}

const world = JSON.parse(readFileSync(SOURCE, 'utf8'))
if (!Array.isArray(world.cells) || world.cells.length === 0) {
  console.error(`FAILED: ${SOURCE} carries no cells, so there is nothing to space out.`)
  process.exit(1)
}

world.cells.forEach((cell, index) => {
  cell.position = {
    x: (index % columns) * CELL_PITCH_METRES,
    y: 0,
    z: Math.floor(index / columns) * CELL_PITCH_METRES,
  }
})

// The exits' compiled board anchors are relative to the cell, so they survive
// the move; a `targetCellId` is a name, not a coordinate, so it does too.

let closest = Infinity
for (let i = 0; i < world.cells.length; i += 1) {
  for (let j = i + 1; j < world.cells.length; j += 1) {
    const a = world.cells[i].position
    const b = world.cells[j].position
    closest = Math.min(closest, Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)))
  }
}
if (closest !== CELL_PITCH_METRES) {
  console.error(`FAILED: the closest pair came out ${closest} m apart, not the ${CELL_PITCH_METRES} m this fixture exists to produce.`)
  process.exit(1)
}

writeFileSync(out, `${JSON.stringify(world, null, 2)}\n`)
console.log(`${out}: ${world.cells.length} cells, ${columns} columns, closest pair ${closest} m (CELL_PITCH_METRES)`)
