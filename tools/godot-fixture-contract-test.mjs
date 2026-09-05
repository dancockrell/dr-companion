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
 * The rules live in contractViolations() and are run twice: once against the
 * committed fixture, where the answer must be none, and once each against
 * manifests deliberately built to break one rule, where the answer must be
 * that exact rule. Without the second half a green run here would be
 * indistinguishable from a checker that inspects nothing.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const FIXTURE = 'godot/mock/crossing_mock_world.json'
const MINIMUM_CELLS = 15
const MINIMUM_EXITS = 40

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass += 1
    console.log(`OK   ${what.padEnd(66)} ${detail}`)
  } else {
    fail += 1
    console.log(`FAIL ${what.padEnd(66)} ${detail}`)
  }
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
    const seenMoves = new Map()
    for (const exit of cell.exits) {
      if (exit.targetCellId === null) {
        // A null target is the honest form: the room is real, the cell is
        // outside this manifest. It must say so rather than be omitted.
        if (exit.external !== true) violations.push(`exit-resolves: ${cell.id} exit "${exit.move}" is null-targeted but not marked external`)
      } else if (!cellIds.has(exit.targetCellId)) {
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
const exitCount = fixture.cells.reduce((total, cell) => total + cell.exits.length, 0)

// Assert the denominator before the verdict: a fixture emptied by a broken
// generator would satisfy every rule below by having nothing to check.
ok('the fixture carries enough cells to be worth checking', fixture.cells.length >= MINIMUM_CELLS, `${fixture.cells.length} cells, floor ${MINIMUM_CELLS}`)
ok('the fixture carries enough exits to be worth checking', exitCount >= MINIMUM_EXITS, `${exitCount} exits, floor ${MINIMUM_EXITS}`)

const violations = contractViolations(fixture)
ok('every exit resolves to a cell or is explicitly null-targeted', !violations.some((v) => v.startsWith('exit-resolves:')), violations.filter((v) => v.startsWith('exit-resolves:'))[0] ?? `${exitCount} exits checked`)
ok('no cell has two exits with the same move', !violations.some((v) => v.startsWith('unique-move:')), violations.filter((v) => v.startsWith('unique-move:'))[0] ?? `${fixture.cells.length} cells checked`)
ok('the current room is one of the cells', !violations.some((v) => v.startsWith('current-room-present:')), violations.filter((v) => v.startsWith('current-room-present:'))[0] ?? fixture.currentRoomId)
ok('the fixture satisfies the whole contract', violations.length === 0, violations.length ? `${violations.length} violations` : 'no violations')

// Each rule, shown able to fire. The broken manifests are built from the real
// one so they differ from it in exactly one way.
const clone = () => JSON.parse(JSON.stringify(fixture))
const firesOn = (label, rule, mutate) => {
  const broken = clone()
  mutate(broken)
  const found = contractViolations(broken).filter((v) => v.startsWith(`${rule}:`))
  ok(`${label} is caught`, found.length > 0, found[0] ?? 'the rule did not fire')
}

firesOn('an exit pointing at a cell that is not here', 'exit-resolves', (m) => {
  m.cells[0].exits[0].targetCellId = '1-999999'
  delete m.cells[0].exits[0].external
})
firesOn('a null-targeted exit that does not admit it is external', 'exit-resolves', (m) => {
  const cell = m.cells.find((c) => c.exits.some((e) => e.external))
  const exit = cell.exits.find((e) => e.external)
  delete exit.external
})
firesOn('a duplicated move within one cell', 'unique-move', (m) => {
  m.cells[0].exits.push(JSON.parse(JSON.stringify(m.cells[0].exits[0])))
})
firesOn('a current room that is not in the manifest', 'current-room-present', (m) => {
  m.currentRoomId = '1-999999'
})

console.log(`\n${pass + fail} checked, ${fail} failed`)
if (fail) process.exit(1)
console.log('all passed')
