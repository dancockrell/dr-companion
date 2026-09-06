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
//   - asset candidates dropped, since a mock scene composes its own and Codex
//     owns that side;
//   - an exit whose target is outside the selection keeps its targetRoomId but
//     is given targetCellId: null, so the viewer can render it as a real exit
//     it cannot follow rather than pretending it does not exist. That null is
//     the whole signal: it is what every .gd consumer branches on, and it is
//     also what the live compiler (src/lib/presentationBridge.ts::exitsFor)
//     emits for a zone-leaving exit, so mock and live carry the same shape.
//
// `board` used to be dropped here too, on the same "a mock scene composes its
// own" reasoning. It does not: `godot/scripts/world_root.gd` hangs the cell's
// `board` on the holder as metadata, `content_registry.gd` sizes a placeholder
// block from `board.footprint`, and `entity_projection_layer.gd` places tokens
// on `board.spawnPoints`. Dropping it meant the only checked-in world the
// viewer loads took the no-board branch of all three, in 19 of 19 cells - so
// what content_registry.gd documented as a fallback for a manifest predating
// the field was in fact the entire mock path, and the size it guessed with was
// a hand-typed copy of CELL_PITCH_METRES - CELL_GAP_METRES with nothing tying
// it to that source (issue #345). The board is carried through verbatim now,
// as the manifest published it and as `compileWorldSnapshot()` publishes it on
// the live side, and `tools/godot-fixture-contract-test.mjs` asserts every
// cell carries the footprint `src/lib/isometric-board-layout.mjs` states.
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

/**
 * The slice has to be able to reach the branches the viewer's tests aim at.
 *
 * Three GDScript cases pair an ordinary cell against an interior cutaway -
 * `content_registry_test`, `cell_click_target_test`, `cell_detail_window_test`
 * - because one cell alone cannot show that a height on screen came from the
 * cell rather than from a constant that happens to agree with it. They named
 * `1-16` for the tall one, which was an interior under the lore classification
 * and is Town Green South, a park, under the batch. All three went red on a
 * pair that had become 1 m against 1 m: the pair was still there, and had
 * stopped being a pair.
 *
 * A hardcoded id in a test is a claim about a fixture that nothing keeps true.
 * So the requirement is stated here instead, the neighbourhood is grown until
 * it is met, and the ids are *published* in the fixture for the tests to read.
 * A slice that cannot satisfy it aborts rather than shipping a fixture whose
 * cases silently stop testing anything.
 */
const REQUIREMENTS = [
  {
    key: 'tallCellId',
    what: 'an interior cutaway, so a height on screen can be shown to come from the cell',
    holds: (cell) => cell.board?.footprint?.height > 1,
  },
  {
    key: 'unregisteredPrimitiveCellId',
    what: 'a cell asking for kinds no content pack has registered, so the placeholder path is reachable',
    holds: (cell) => cell.primitives.filter((primitive) => !REGISTERED_KINDS.has(primitive.kind)).length >= 4,
  },
]

/** Read out of the content pack, not typed here: the same derivation
 * `tools/world-content-test.mjs` uses, for the same reason. */
const REGISTERED_KINDS = new Set(
  [...readFileSync('godot/scripts/shared_asset_content.gd', 'utf8').matchAll(/ContentRegistry\.register\(\s*"([^"]+)"/g)].map((match) => match[1])
)

/**
 * The nearest cell satisfying each requirement, added one at a time.
 *
 * Deliberately *not* "grow the neighbourhood until it qualifies": the first
 * version of this did that and the slice went from 19 cells to 575, because the
 * nearest cell asking for four unregistered kinds is the Clerics' Guild chapel
 * and everything between here and there came with it. The mock exists to
 * exercise the loader on a small readable town square, so it takes exactly the
 * two cells it is short of and nothing else. Their exits out of the slice
 * become `targetCellId: null`, which is the case this fixture already carries
 * thirteen of.
 *
 * Breadth-first from the existing selection, ties broken on room number, so the
 * choice is stated rather than an accident of iteration order.
 */
const addNearestSatisfying = () => {
  const guarantees = {}
  for (const requirement of REQUIREMENTS) {
    const already = [...selected]
      .sort((a, b) => cellsById.get(a).roomId - cellsById.get(b).roomId)
      .find((id) => requirement.holds(cellsById.get(id)))
    if (already) {
      guarantees[requirement.key] = already
      continue
    }
    const seen = new Set(selected)
    let ring = [...selected].sort((a, b) => cellsById.get(a).roomId - cellsById.get(b).roomId)
    let found = null
    for (let hop = 0; hop < 12 && !found; hop += 1) {
      const next = []
      for (const id of ring) {
        for (const exit of cellsById.get(id)?.exits ?? []) {
          const target = exit.targetCellId
          if (!target || seen.has(target) || !cellsById.has(target)) continue
          seen.add(target)
          next.push(target)
        }
      }
      if (!next.length) break
      next.sort((a, b) => cellsById.get(a).roomId - cellsById.get(b).roomId)
      found = next.find((id) => requirement.holds(cellsById.get(id))) ?? null
      ring = next
    }
    if (!found) {
      throw new Error(
        `no cell within 12 hops of the ${selected.size}-cell slice satisfies ${requirement.key} (${requirement.what}); the Godot cases that read it would pass while testing nothing`
      )
    }
    selected.add(found)
    guarantees[requirement.key] = found
  }
  return guarantees
}

const guarantees = addNearestSatisfying()

const projectExit = (exit) => {
  const inside = Boolean(exit.targetCellId) && selected.has(exit.targetCellId)
  return {
    move: exit.move,
    direction: exit.direction,
    targetRoomId: exit.targetRoomId,
    targetCellId: inside ? exit.targetCellId : null,
  }
}

const projectCell = (cell) => {
  // `board` stays in `rest` on purpose - see the note at the top of this file.
  const { primitives, exits, ...rest } = cell
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
  // The cells this slice was grown to contain, for the GDScript cases that need
  // one of each rather than one in particular. See REQUIREMENTS above.
  guarantees,
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
  const leaving = fixture.cells.flatMap((cell) => cell.exits).filter((exit) => exit.targetCellId === null).length
  console.log(`wrote ${fixturePath}: ${fixture.cells.length} cells, ${leaving} exits leaving the slice`)
}
