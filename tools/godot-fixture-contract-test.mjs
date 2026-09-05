/**
 * The data contract between the app and the Godot viewer, checked from the
 * Node side.
 *
 * These are properties of any manifest handed to the viewer, mock or live: the
 * viewer builds clickable exits straight out of them, so a manifest that
 * breaks one of these produces a button that either goes nowhere or shadows
 * another. godot/tests/foundation_test.gd checks the viewer's behaviour given
 * a good manifest; this checks that the manifest is good. Neither substitutes
 * for the other.
 *
 * # Two subjects, because "mock or live" was a claim and not a check
 *
 * Until issue #342 this file ran every rule against the committed fixture
 * alone, and one rule was written to a shape only the mock generator produced
 * (a flag on null-targeted exits which the live compiler has never emitted and
 * no `.gd` has ever read). A live snapshot would have failed the contract it
 * was said to satisfy, and nothing here could see it.
 *
 * So there are two subjects now. The mock fixture, read off disk, and a live
 * snapshot compiled in-process by the real `compileWorldSnapshot()` over the
 * zone in `tools/live-zone-fixture.mjs` - the same zone
 * `tools/presentation-bridge-test.mjs` uses, imported rather than copied.
 * Every rule runs against both, each subject prints its own denominators, and
 * a rule that cannot apply to a subject says NOT CHECKED with the reason
 * rather than quietly not running.
 *
 * # The rules are shown able to fire
 *
 * contractViolations() is run against manifests deliberately built to break
 * one rule, per subject, where the answer must be that exact rule. Without
 * that half a green run here would be indistinguishable from a checker that
 * inspects nothing.
 *
 * # board-footprint
 *
 * The viewer sizes a placeholder block from `board.footprint` and places tokens
 * on `board.spawnPoints`. The mock generator used to strip `board` from every
 * cell, so the no-board branch of both was the whole of mock mode, and the size
 * came from a hand-typed 4.4 in `godot/scripts/content_registry.gd` that
 * nothing tied to `src/lib/isometric-board-layout.mjs` (issue #345). Asserting
 * the footprint against CELL_BLOCK_METRES, imported rather than retyped, is
 * what makes the board's geometry one value: change CELL_GAP_METRES and this
 * goes red naming the number it now expects. Both subjects carry it - the live
 * compiler publishes the same `boardLayoutFor()` output - so both are checked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { compileWorldSnapshot } from '../src/lib/presentationBridge.ts'
import { CELL_BLOCK_METRES } from '../src/lib/isometric-board-layout.mjs'
import { LIVE_HERE, LIVE_ZONE } from './live-zone-fixture.mjs'

const FIXTURE = 'godot/mock/crossing_mock_world.json'

let pass = 0
let fail = 0
const skipped = []

const ok = (what, cond, detail = '') => {
  if (cond) {
    pass += 1
    console.log(`OK   ${what.padEnd(72)} ${detail}`)
  } else {
    fail += 1
    console.log(`FAIL ${what.padEnd(72)} ${detail}`)
  }
}

/**
 * The third state. A rule that cannot apply to a subject must say so and say
 * why; folding it into a pass is how a suite comes to report a contract it
 * never checked, which is the defect this file was rewritten for. The runner
 * (`tools/run-tests.mjs`) picks these lines up and refuses to print
 * "all passed" over them.
 */
const notChecked = (what, why) => {
  skipped.push(`${what}: ${why}`)
  console.log(`NOT CHECKED ${what.padEnd(65)} ${why}`)
}

/**
 * Returns one string per violation, tagged with the rule that caught it.
 * Empty means the manifest satisfies the contract.
 */
const contractViolations = (manifest) => {
  const violations = []
  const cellIds = new Set(manifest.cells.map((cell) => cell.id))

  if (!cellIds.has(manifest.currentRoomId)) {
    violations.push(`current-room-present: currentRoomId ${manifest.currentRoomId} is not among the ${cellIds.size} cells`)
  }

  for (const cell of manifest.cells) {
    // The viewer draws a block this wide. A cell that does not publish one
    // leaves it guessing, which is the whole of issue #345.
    const footprint = cell.board?.footprint
    if (!footprint || typeof footprint.width !== 'number' || typeof footprint.depth !== 'number') {
      violations.push(`board-footprint: ${cell.id} carries no board.footprint with a numeric width and depth`)
    } else if (footprint.width !== CELL_BLOCK_METRES || footprint.depth !== CELL_BLOCK_METRES) {
      violations.push(`board-footprint: ${cell.id} is ${footprint.width}x${footprint.depth}, not the ${CELL_BLOCK_METRES} m block src/lib/isometric-board-layout.mjs publishes`)
    }

    // And the box a click has to land in, which `world_root.gd` sizes one
    // BoxShape3D per cell from. It typed `Vector3(4.5, 1.0, 4.5)` instead until
    // issue #366, while this field sat published on every cell and read by
    // nothing. All three parts are required, height included: a click box that
    // does not know how tall the block is left two thirds of an interior
    // cutaway unclickable.
    const selection = cell.board?.selectionBounds
    if (!selection || ['width', 'depth', 'height'].some((field) => typeof selection[field] !== 'number')) {
      violations.push(`board-selection: ${cell.id} carries no board.selectionBounds with a numeric width, depth and height`)
    }

    // And the ground the cell owns - the third box `boardLayoutFor()` publishes,
    // and the one the largest surface on screen is sized from:
    // `shared_asset_content.gd` draws every terrain, floor and water plane at
    // `ContentRegistry.ground_size_metres(cell)`, and a cell that publishes none
    // gets the 1 m marker, so a whole board would come up as postage stamps.
    //
    // It was the only one of the three with no rule here. The mock fixture's
    // ground is covered twice over - by the drift comparison further down, and
    // by `godot/tests/content_registry_test.gd`, which reads a real cell out of
    // the loaded world - and neither of those can see the live subject: Godot
    // never loads a live snapshot, and a snapshot compiled in-process has no
    // committed artefact to have drifted from. So `compileWorldSnapshot` could
    // stop emitting `ground` with every Node suite green, which is #345's shape
    // exactly: the mock exercising one branch and the live path the other.
    //
    // Width and depth only. `ground` is a plane and `boardLayoutFor()` publishes
    // no height for it, so requiring one would be this file inventing a field
    // rather than checking one.
    const ground = cell.board?.ground
    if (!ground || ['width', 'depth'].some((field) => typeof ground[field] !== 'number')) {
      violations.push(`board-ground: ${cell.id} carries no board.ground with a numeric width and depth`)
    } else if (ground.width <= CELL_BLOCK_METRES || ground.depth <= CELL_BLOCK_METRES) {
      // Strictly larger than the block, because the difference *is* the gutter a
      // player sees - the ground showing round the block's edge is what draws a
      // room's outline (docs/verification/terrain-gutter-2026-09-05.md). Ground
      // cut down to the block leaves neighbouring rooms merged into one unbroken
      // mass, which is the state that measurement was taken to settle.
      violations.push(`board-ground: ${cell.id} publishes ${ground.width}x${ground.depth} m of ground, which is not larger than its ${CELL_BLOCK_METRES} m block, so there is no gutter to draw a room's outline`)
    }

    // And where things stand on that block.
    //
    // `entity_projection_layer.gd` places every token at
    // `ContentRegistry.block_top_y(cell)` plus its spawn point's `anchor.y`, so
    // an anchor y is a lift above the block's top face and a negative one puts
    // a token inside the solid the cell drew. That is issue #373 in its
    // published form: the anchors used to be measured from the cell origin, and
    // when #365 gave the placeholder block the cell's full footprint they
    // stayed where they were - 117 of 133 anchors below the top face they were
    // meant to stand on, and all 21 on the three interior cutaways more than a
    // metre inside it.
    //
    // Written as the viewer's own arithmetic rather than as `anchor.y >= 0`,
    // though the two are the same test today: what has to be true is that a
    // token ends up at or above the top of its own cell's block, and saying it
    // that way keeps this rule pointed at the right thing if the frame moves
    // again.
    const spawnPoints = cell.board?.spawnPoints
    if (!Array.isArray(spawnPoints) || spawnPoints.length === 0) {
      violations.push(`board-spawn: ${cell.id} carries no board.spawnPoints for the viewer to place tokens on`)
    } else if (typeof footprint?.height === 'number') {
      const blockTop = footprint.height / 2
      for (const point of spawnPoints) {
        const anchor = point?.anchor
        if (!anchor || ['x', 'y', 'z'].some((axis) => typeof anchor[axis] !== 'number')) {
          violations.push(`board-spawn: ${cell.id} spawn point "${point?.id}" has no complete numeric anchor`)
        } else if (blockTop + anchor.y < blockTop) {
          violations.push(
            `board-spawn: ${cell.id} spawn point "${point.id}" stands at ${(blockTop + anchor.y).toFixed(2)} m, ${(-anchor.y).toFixed(2)} m inside the top of its own ${footprint.height} m block`,
          )
        }
      }
    }

    const seenMoves = new Map()
    for (const exit of cell.exits) {
      // A null target is the honest form and the whole signal: the room is
      // real, its cell is outside this manifest. `world_manifest_loader.gd`
      // branches on exactly this, and `exitsFor()` emits exactly this for a
      // zone-leaving exit, so it is true of the mock and of a live snapshot
      // alike. Only a target naming a cell nobody carries is a defect - that
      // is a button the viewer would draw and then fail to follow.
      if (exit.targetCellId !== null && !cellIds.has(exit.targetCellId)) {
        violations.push(`exit-resolves: ${cell.id} exit "${exit.move}" targets ${exit.targetCellId}, which is not a cell in this manifest`)
      }

      const previous = seenMoves.get(exit.move)
      if (previous !== undefined) violations.push(`unique-move: ${cell.id} has two exits with move "${exit.move}" (targets ${previous} and ${exit.targetCellId})`)
      else seenMoves.set(exit.move, exit.targetCellId)
    }
  }

  return violations
}

// A fixture that has drifted from its generator is not a fixture, so settle
// that before reading anything out of it.
try {
  execFileSync(process.execPath, ['tools/build-godot-mock-fixture.mjs', '--check'], { stdio: 'inherit' })
  ok('the committed fixture matches a fresh generation', true)
} catch {
  ok('the committed fixture matches a fresh generation', false, 'run node tools/build-godot-mock-fixture.mjs')
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const live = compileWorldSnapshot({ zone: LIVE_ZONE, here: LIVE_HERE, character: null, sequence: 1 })

// The live subject has to exist before anything is concluded from it. A null
// here means the compiler declined to publish, and every rule below would then
// be checking nothing while looking identical to a clean run.
ok('the live compiler produced a snapshot to check at all', live !== null, live === null ? 'compileWorldSnapshot returned null' : `${live.cells.length} cells`)
if (live === null) process.exit(1)

/**
 * Each subject with the floors that make its own denominators fragile: the
 * number that goes to zero when the mechanism breaks. The mock's floors catch
 * an emptied or truncated generator; the live subject's catch a compiler that
 * stopped emitting exits, and in particular one that stopped emitting the
 * null-targeted exit - the exact shape the old, mock-only rule got wrong.
 */
const subjects = [
  { name: 'mock fixture', manifest: fixture, minCells: 15, minExits: 40, minNullTargeted: 5, minAnchors: 100, derived: true },
  { name: 'live snapshot', manifest: live, minCells: 2, minExits: 3, minNullTargeted: 1, minAnchors: 14, derived: false },
]

for (const subject of subjects) {
  const { name, manifest } = subject
  const exits = manifest.cells.flatMap((cell) => cell.exits)
  const nullTargeted = exits.filter((exit) => exit.targetCellId === null)

  console.log(`\n-- ${name}: ${manifest.cells.length} cells, ${exits.length} exits, ${nullTargeted.length} null-targeted --`)

  // Assert the denominator before the verdict: a subject emptied by a broken
  // generator or by a compiler that returned early would satisfy every rule
  // below by having nothing to check.
  ok(`${name}: enough cells to be worth checking`, manifest.cells.length >= subject.minCells, `${manifest.cells.length} cells, floor ${subject.minCells}`)
  ok(`${name}: enough exits to be worth checking`, exits.length >= subject.minExits, `${exits.length} exits, floor ${subject.minExits}`)
  ok(`${name}: carries the null-targeted exits the rule turns on`, nullTargeted.length >= subject.minNullTargeted, `${nullTargeted.length} null-targeted, floor ${subject.minNullTargeted}`)

  // Stated as N of N rather than as "no violations", because "no cell breaks
  // the footprint rule" is also what a manifest with no cells says. This is the
  // count that was 0 of 19 when issue #345 was found.
  const withFootprint = manifest.cells.filter((cell) => typeof cell.board?.footprint?.width === 'number').length
  ok(`${name}: every cell carries the footprint the viewer sizes its block from`, withFootprint === manifest.cells.length, `${withFootprint} of ${manifest.cells.length} cells`)

  // The same count for the other box, and for the same reason: it was 19 of 19
  // when issue #366 was found, and the viewer read none of them.
  const withSelection = manifest.cells.filter((cell) => typeof cell.board?.selectionBounds?.height === 'number').length
  ok(`${name}: every cell carries the selection box the viewer sizes its click target from`, withSelection === manifest.cells.length, `${withSelection} of ${manifest.cells.length} cells`)

  // And the third box. The count that would have been 0 of 19 had the generator
  // stripped `ground` the way it once stripped the whole board - and, on the
  // live subject, the only thing that can see it at all.
  const withGround = manifest.cells.filter((cell) => typeof cell.board?.ground?.width === 'number').length
  ok(`${name}: every cell carries the ground the viewer sizes its terrain from`, withGround === manifest.cells.length, `${withGround} of ${manifest.cells.length} cells`)

  // And the anchors, counted rather than summarised. Two denominators, because
  // "no anchor is inside a block" is also what a manifest with no anchors says,
  // and because the count that was 117 of 133 when issue #373 was found is the
  // one worth printing every run.
  const allAnchors = manifest.cells.flatMap((cell) =>
    (cell.board?.spawnPoints ?? []).map((point) => ({ cell, y: point?.anchor?.y })),
  )
  const clearAnchors = allAnchors.filter(
    ({ cell, y }) => typeof y === 'number' && typeof cell.board?.footprint?.height === 'number' && cell.board.footprint.height / 2 + y >= cell.board.footprint.height / 2,
  ).length
  ok(`${name}: carries the spawn anchors the token-height rule turns on`, allAnchors.length >= subject.minAnchors, `${allAnchors.length} anchors, floor ${subject.minAnchors}`)
  ok(`${name}: every spawn anchor stands at or above its own cell's block top`, clearAnchors === allAnchors.length, `${clearAnchors} of ${allAnchors.length} anchors`)

  const violations = contractViolations(manifest)
  const of = (rule) => violations.filter((v) => v.startsWith(`${rule}:`))
  ok(`${name}: every exit targets a cell here, or is null-targeted`, of('exit-resolves').length === 0, of('exit-resolves')[0] ?? `${exits.length} exits checked, ${nullTargeted.length} of them null-targeted`)
  ok(`${name}: no cell has two exits with the same move`, of('unique-move').length === 0, of('unique-move')[0] ?? `${manifest.cells.length} cells checked`)
  ok(`${name}: the current room is one of the cells`, of('current-room-present').length === 0, of('current-room-present')[0] ?? manifest.currentRoomId)
  ok(`${name}: every cell publishes the block size the board layout states`, of('board-footprint').length === 0, of('board-footprint')[0] ?? `${manifest.cells.length} cells at ${CELL_BLOCK_METRES} m`)
  ok(`${name}: every cell publishes a complete selection box`, of('board-selection').length === 0, of('board-selection')[0] ?? `${manifest.cells.length} cells`)
  ok(`${name}: every cell publishes ground wider than its block, which is the gutter`, of('board-ground').length === 0, of('board-ground')[0] ?? `${manifest.cells.length} cells, each larger than ${CELL_BLOCK_METRES} m`)
  ok(`${name}: no cell places a token inside the block it publishes`, of('board-spawn').length === 0, of('board-spawn')[0] ?? `${allAnchors.length} anchors across ${manifest.cells.length} cells`)
  ok(`${name}: satisfies the whole contract`, violations.length === 0, violations.length ? `${violations.length} violations` : 'no violations')

  // Each rule, shown able to fire against THIS subject. The broken manifests
  // are built from the real one so they differ from it in exactly one way.
  const clone = () => JSON.parse(JSON.stringify(manifest))
  const firesOn = (label, rule, mutate) => {
    const broken = clone()
    mutate(broken)
    const found = contractViolations(broken).filter((v) => v.startsWith(`${rule}:`))
    ok(`${name}: ${label} is caught`, found.length > 0, found[0] ?? 'the rule did not fire')
  }

  firesOn('an exit pointing at a cell that is not here', 'exit-resolves', (m) => {
    m.cells[0].exits[0].targetCellId = '1-999999'
  })
  firesOn('a duplicated move within one cell', 'unique-move', (m) => {
    m.cells[0].exits.push(JSON.parse(JSON.stringify(m.cells[0].exits[0])))
  })
  firesOn('a current room that is not in the manifest', 'current-room-present', (m) => {
    m.currentRoomId = '1-999999'
  })
  firesOn('a cell whose board was stripped, as the mock generator once stripped it', 'board-footprint', (m) => {
    delete m.cells[0].board
  })
  firesOn('a footprint that has drifted from the published block size', 'board-footprint', (m) => {
    m.cells[0].board.footprint.width = CELL_BLOCK_METRES + 1
  })
  firesOn('a selection box with no height, which is what made #366 invisible', 'board-selection', (m) => {
    delete m.cells[0].board.selectionBounds.height
  })
  firesOn('a cell with no ground, which draws the terrain as a 1 m marker', 'board-ground', (m) => {
    delete m.cells[0].board.ground
  })
  firesOn('an anchor published below the top of its own block, which is #373', 'board-spawn', (m) => {
    // Exactly the frame the anchors were in before this rule existed: a height
    // measured from the cell origin rather than from the block's top face, so
    // on a 1 m block the old 0.42 lands 0.08 m inside it.
    m.cells[0].board.spawnPoints[0].anchor.y = 0.42 - m.cells[0].board.footprint.height / 2
  })
  firesOn('a cell that publishes no spawn points at all', 'board-spawn', (m) => {
    m.cells[0].board.spawnPoints = []
  })
  firesOn('an anchor with no y, which the viewer would have to invent one for', 'board-spawn', (m) => {
    delete m.cells[0].board.spawnPoints[0].anchor.y
  })
  firesOn('ground shrunk to the block, which leaves the board with no gutter', 'board-ground', (m) => {
    m.cells[0].board.ground.width = CELL_BLOCK_METRES
    m.cells[0].board.ground.depth = CELL_BLOCK_METRES
  })

  if (subject.derived) {
    ok(`${name}: is a derived artefact whose drift check ran`, true, 'checked above, against its own generator')
  } else {
    notChecked(
      `${name}: matches a fresh generation`,
      'compiled in-process from src/lib/presentationBridge.ts, so there is no committed artefact it could have drifted from',
    )
  }
}

/**
 * The dropped flag must not come back.
 *
 * It had one producer (the mock generator) and one reader (this file), which
 * makes it an absence with more steps: `targetCellId === null` already carries
 * the same fact, is what every `.gd` consumer branches on, and is what the
 * live compiler emits. Issue #342 removed it. A grep is the cheap way to keep
 * it removed, because the failure it guards against is somebody adding a
 * producer again with no reader - which no other check here can see.
 *
 * The needle is assembled at runtime so this file is not its own hit, and the
 * shapes are the key forms only: a property access, an object-literal key, a
 * JSON key. Prose uses of the word (`externalMedia.ts`, "an external edit", "a
 * directionless external exit") are unrelated and must not match, which is
 * what the negative control below establishes.
 */
const DROPPED = 'exter' + 'nal'
const KEY_SHAPES = [
  new RegExp(`\\.${DROPPED}\\b`),
  new RegExp(`\\b${DROPPED}\\s*:`),
  new RegExp(`"${DROPPED}"`),
  new RegExp(`'${DROPPED}'`),
]
const SCAN_ROOTS = ['godot', 'tools', 'src', 'src-tauri']
const SCAN_EXT = /\.(gd|ts|tsx|mjs|js|json|rs)$/
const SCAN_SKIP = new Set(['node_modules', 'target', '.godot', 'dist', 'build', 'vendor'])
/** A floor on the walk, well under the real count, so an empty or truncated
 * scan reports itself instead of reporting a clean tree. */
const MIN_SCANNED = 200

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SCAN_SKIP.has(entry)) continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (SCAN_EXT.test(entry)) out.push(p.replaceAll('\\', '/'))
  }
  return out
}

const hitsIn = (text) => {
  const lines = []
  text.split(/\r?\n/).forEach((line, i) => {
    if (KEY_SHAPES.some((shape) => shape.test(line))) lines.push(`${i + 1}: ${line.trim().slice(0, 100)}`)
  })
  return lines
}

// Controls first: a matcher that cannot fire, and one that fires on the prose
// this tree is full of, are worthless in opposite directions.
const POSITIVE_SAMPLE = `{ "move": "north", "${DROPPED}": true }`
const NEGATIVE_SAMPLE = `import { ${DROPPED}MediaAvailable } from '../../lib/${DROPPED}Media.ts' // an ${DROPPED} edit`
ok('the dropped-key matcher fires on the key itself (positive control)', hitsIn(POSITIVE_SAMPLE).length === 1, POSITIVE_SAMPLE)
ok('...and not on this tree\'s unrelated prose and identifiers (negative control)', hitsIn(NEGATIVE_SAMPLE).length === 0, NEGATIVE_SAMPLE)

const scanned = SCAN_ROOTS.flatMap((root) => walk(root))
ok('the dropped-key scan examined a believable number of files', scanned.length >= MIN_SCANNED, `${scanned.length} files under ${SCAN_ROOTS.join(', ')}, floor ${MIN_SCANNED}`)

const reintroduced = scanned
  .map((file) => ({ file, lines: hitsIn(readFileSync(file, 'utf8')) }))
  .filter((row) => row.lines.length > 0)
ok(
  'the dropped null-targeted flag has not come back as a manifest key',
  reintroduced.length === 0,
  reintroduced.length ? `${reintroduced[0].file}:${reintroduced[0].lines[0]}` : `${scanned.length} files clean`,
)

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
if (skipped.length) {
  // Deliberately does not repeat the marker token: `run-tests.mjs` collects
  // every line carrying it, so a summary that echoed it would report one skip
  // as two and inflate the count it exists to make honest.
  console.log(`no failures, but ${skipped.length} rule(s) went unchecked: ${skipped.join('; ')}`)
  process.exit(0)
}
console.log('all passed')
