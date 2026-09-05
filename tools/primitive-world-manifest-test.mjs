import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
// The block size is one constant, imported rather than retyped: a test that
// hardcodes the number it is checking only ever proves somebody edited both.
import { CELL_BLOCK_METRES } from '../src/lib/isometric-board-layout.mjs'

const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1 }
const pass = (message) => console.log(`OK   ${message}`)

/**
 * Room pairs the Crossing mapdb genuinely records twice, at identical map
 * coordinates, under two node ids.
 *
 * Verified in `data/art/out/geometric-room-briefs.json`, which is where these
 * coordinates come from: 804 and 866 are both "Paladins' Guild, Sentinel's
 * Way" at (347, -586), and 805 and 867 are both "Paladins' Guild, Sentinel's
 * Rest" at (367, -586). Each twin differs only in the wording of one `go` exit
 * ("go path" against "go pebbled path") and in which twin it links onward to,
 * which is the signature of a room re-surveyed under a new node rather than of
 * anything this repository generates. No scale separates two rooms at one
 * coordinate, so the gutter check above cannot speak to them and does not try.
 *
 * This list may only shrink. Removing a pair means the mapdb was fixed
 * upstream; adding one means somebody decided a *new* overlap is acceptable,
 * which needs the same evidence this comment carries.
 */
const KNOWN_COINCIDENT = [
  ['1-804', '1-866'],
  ['1-805', '1-867'],
]

execFileSync(process.execPath, ['tools/build-primitive-world-manifest.mjs', '1'], { stdio: 'inherit' })
const outputPath = 'data/world/out/1-primitive-world.json'
if (!existsSync(outputPath)) fail('primitive world manifest is generated')
else {
  const world = JSON.parse(readFileSync(outputPath, 'utf8'))
  const townGreenNorth = world.cells.find((cell) => cell.id === '1-14')
  const guild = world.cells.find((cell) => cell.tags.includes('guild'))
  const water = world.cells.find((cell) => cell.tags.includes('water'))
  if (world.cells.length >= 1000) pass(`Crossing contains a full room-cell world (${world.cells.length})`)
  else fail('Crossing room cells are incomplete')
  if (world.routes.length >= 1500) pass(`legal local routes are retained (${world.routes.length})`)
  else fail('world does not retain enough local route truth')
  if (townGreenNorth?.exits.some((exit) => exit.move === 'north' && exit.targetCellId === '1-13')) pass('Town Green North keeps its exact legal north exit')
  else fail('Town Green North lost a legal route')
  if (townGreenNorth?.primitives.some((primitive) => primitive.kind === 'terrain-cell-5m')) pass('ordinary rooms begin as editable primitive terrain')
  else fail('ordinary rooms are not primitive-first')
  if (townGreenNorth?.primitives.every((primitive) => primitive.assetCandidates?.length && primitive.assetCandidates.every((assetId) => /^[GPHTBERS]\d{2}$/.test(assetId)))) pass('every world primitive resolves to approved-kit candidate IDs')
  else fail('world primitive candidates do not resolve to the kit registry')
  if (guild?.primitives.some((primitive) => primitive.kind === 'guild-threshold-kit')) pass('guilds are explicitly represented as special primitive sets')
  else fail('guilds have no special primitive treatment')
  if (water?.primitives.some((primitive) => primitive.kind === 'water-ribbon-5m')) pass('water rooms receive water primitives')
  else fail('water has no primitive treatment')
  if (world.queues.unresolvedCellIds.every((id) => world.cells.find((cell) => cell.id === id)?.status === 'missing-description')) pass('unresolved cells remain explicit')
  else fail('unresolved cells are not honest')
  if (world.cells.every((cell) => cell.board?.footprint?.width === CELL_BLOCK_METRES && cell.board?.selectionBounds?.width === CELL_BLOCK_METRES && cell.board?.spawnPoints?.some((point) => point.role === 'player' && point.rigSocket === 'humanoid-root'))) pass('every room cell has a stable isometric footprint and rig-ready player formation')
  else fail('isometric cell footprints or rig-ready formations are missing')

  // The invariant Dan's feedback is really about: no block may reach its
  // neighbour. Measured against the manifest rather than assumed from the
  // constants, because the pitch comes from map coordinates and the block
  // comes from the layout module - two different files that could drift into
  // agreement-by-accident or, worse, into overlap.
  {
    const positioned = world.cells.filter((c) => c.position && c.board?.footprint)
    let closest = Infinity
    const coincident = []
    for (let i = 0; i < positioned.length; i++) {
      for (let j = i + 1; j < positioned.length; j++) {
        const a = positioned[i].position
        const b = positioned[j].position
        if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > 0.01) continue // different storey
        const d = Math.hypot(a.x - b.x, a.z - b.z)
        // Two rooms at identical coordinates are a *data* defect: no scale
        // separates them, so counting them here would make this check
        // permanently red about something it cannot measure. Reported below on
        // its own terms instead.
        if (d === 0) coincident.push([positioned[i].id, positioned[j].id])
        else if (d < closest) closest = d
      }
    }
    const block = CELL_BLOCK_METRES
    if (positioned.length < 50) fail(`only ${positioned.length} positioned cells to measure; the manifest looks truncated`)
    else if (closest > block) pass(`every block leaves a gutter: closest neighbours are ${closest.toFixed(2)}m apart, blocks are ${block}m`)
    else fail(`blocks touch or overlap: closest neighbours are ${closest.toFixed(2)}m apart but blocks are ${block}m wide`)

    // Named, counted, and judged against a written-down list. This printed
    // `NOT CHECKED  2 pair(s) of rooms share exact map coordinates` and left
    // it there, which is the worst of the three states: the pairs *were*
    // found, so nothing went unchecked - what the suite declined to do was
    // decide whether two was the right number. An open-ended skip cannot tell
    // the two known pairs from a third that appears tomorrow, and a third
    // would print in the same shape and read as harmlessly.
    //
    // So the two are accepted debt, named with their cause, and anything else
    // fails. The list is diffed both ways: a pair that stops being coincident
    // fails too, because an allowlist that outlives its reason hides the next
    // real one.
    const key = ([a, b]) => [a, b].sort().join('/')
    const found = new Set(coincident.map(key))
    const allowed = new Set(KNOWN_COINCIDENT.map(key))
    const unexpected = [...found].filter((p) => !allowed.has(p))
    const stale = [...allowed].filter((p) => !found.has(p))

    const comparisons = (positioned.length * (positioned.length - 1)) / 2
    console.log(`   ${comparisons} same-storey room pairs compared for coincidence; ${found.size} coincident`)
    if (unexpected.length === 0)
      pass(`no room pair shares a map coordinate except the ${allowed.size} known duplicate mapdb nodes (${[...allowed].join(', ')})`)
    else
      fail(
        `${unexpected.length} NEW pair(s) of rooms share exact map coordinates and will always overlap: ` +
          `${unexpected.join(', ')}. Either the mapdb gained another duplicate node or the manifest ` +
          `dropped a coordinate; neither is a scale problem and neither may be waved through.`
      )
    if (stale.length === 0)
      pass(`every allowlisted duplicate pair is still coincident, so the list has not gone stale (${allowed.size} entries)`)
    else
      fail(
        `KNOWN_COINCIDENT lists ${stale.join(', ')}, which no longer share a coordinate. ` +
          `Remove the entry - a stale allowlist is a hole nobody sees.`
      )
  }
  if (townGreenNorth?.exits.every((exit) => typeof exit.tetherKind === 'string') && townGreenNorth?.exits.find((exit) => exit.direction === 'north')?.boardAnchor?.z === -2.5) pass('true exits carry typed tethers and camera-stable edge anchors')
  else fail('typed tether or board-edge anchor metadata is missing')
}
