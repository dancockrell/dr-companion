import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
const fixture = read('godot/mock/crossing_mock_world.json')
const ledger = read('data/art/room-prompts-priority.json')
const map = read('src/data/map/1.json')
let checks = 0
const check = (label, value) => { assert.ok(value, label); checks++; console.log(`OK   ${label}`) }
const records = new Map(Object.entries(ledger).filter(([, value]) => value.source === 'description' && value.lore).map(([key, value]) => [`${value.zone}-${value.room}`, { key, ...value }]))
let described = 0
for (const cell of fixture.cells) {
  const reference = records.get(cell.id)
  if (!reference) { check(`${cell.id} has no invented missing reference prose`, !cell.description); continue }
  described++
  check(`${cell.id} description is exact DragonRealms reference lore`, cell.description === reference.lore)
  check(`${cell.id} records reference provenance rather than live-capture claim`, cell.descriptionSource?.kind === 'reference' && cell.descriptionSource.sourceId === reference.key && cell.descriptionSource.sha256 === createHash('sha256').update(reference.lore).digest('hex'))
}
check('room fixture has substantial matched reference coverage', described >= 10)
const green = fixture.cells.find((cell) => cell.id === '1-14')
const actual = map.rooms.find((room) => room.id === 14)
check('Town Green North preserves every actual exit command', JSON.stringify(green.exits.map((exit) => exit.move).sort()) === JSON.stringify(actual.exits.map((exit) => exit.move).sort()))
check('actual north exit reaches room13, never synthetic south', green.exits.some((exit) => exit.move === 'north' && exit.targetCellId === '1-13') && actual.exits.some((exit) => exit.move === 'north' && exit.to === 13))
check('Town Green description names its actual landmarks', /bent grass/.test(green.description) && /cobblestones/.test(green.description) && /privet hedge/.test(green.description) && /Milgrym/.test(green.description))
const scene = readFileSync(new URL('../godot/scripts/tabletop.gd', import.meta.url), 'utf8')
check('standalone default does not opt into invented sample state', scene.includes('BridgeClient.start_mock("crossing", "1-14")') && !scene.includes('BridgeClient.start_mock("crossing", "1-14", true)'))
console.log(`DR reference rooms: ${checks} checks passed`)
