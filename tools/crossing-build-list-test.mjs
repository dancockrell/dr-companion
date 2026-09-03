/**
 * The Crossing build list is generated so its figures cannot drift from the
 * briefs. This checks that they actually haven't - by re-deriving the counts
 * from the source independently and finding them in the committed document.
 *
 * A generated doc nobody re-generates is just a stale doc with a comment on
 * top claiming otherwise, so this fails when the two disagree rather than
 * waiting for a reader to notice.
 */
import { readFileSync, existsSync } from 'node:fs'

const BRIEFS = 'data/art/out/geometric-room-briefs.json'
const DOC = 'docs/CROSSING_BUILD_LIST.md'

let pass = 0
let fail = 0
const ok = (what, cond, detail = '') => {
  if (cond) {
    pass++
    console.log(`OK   ${what.padEnd(66)} ${detail}`)
  } else {
    fail++
    console.log(`FAIL ${what.padEnd(66)} ${detail}`)
  }
}

ok('the generated build list is committed', existsSync(DOC))
if (!existsSync(DOC)) {
  console.error('FAILED: run `node tools/build-crossing-build-list.mjs`')
  process.exit(1)
}
const doc = readFileSync(DOC, 'utf8')

// The briefs are ~60MB, so this suite is skipped rather than failed when they
// have not been built locally. Skipping is announced: a silent skip that ends
// in "all passed" is the failure this codebase keeps finding.
if (!existsSync(BRIEFS)) {
  console.log(`\nNOT CHECKED: ${BRIEFS} is not present, so the document's figures were not`)
  console.log('re-derived. Run `node tools/build-geometric-room-briefs.mjs` to check them.')
  console.log(`\n${pass} checked, ${fail} failed, 1 not checked`)
  process.exit(fail > 0 ? 1 : 0)
}

const rooms = JSON.parse(readFileSync(BRIEFS, 'utf8')).roomBriefs.filter((r) => r.zone === '1')
const described = rooms.filter((r) => r.briefStatus === 'described').length
const undescribed = rooms.filter((r) => r.briefStatus === 'missing-description').length
const mapped = rooms.filter((r) => r.map)
const minX = Math.min(...mapped.map((r) => r.map.x))
const maxX = Math.max(...mapped.map((r) => r.map.x))
const minY = Math.min(...mapped.map((r) => r.map.y))
const maxY = Math.max(...mapped.map((r) => r.map.y))
const cols = Math.floor((maxX - minX) / 20) + 1
const rowsN = Math.floor((maxY - minY) / 20) + 1

console.log('\n-- the figures in the doc match the briefs it was generated from --')
ok('room count', doc.includes(`| Rooms | ${rooms.length} |`), String(rooms.length))
ok('described count', doc.includes(`| With an authored description | ${described} |`), String(described))
ok('undescribed count', doc.includes(`| No description on file | ${undescribed} |`), String(undescribed))
ok('x range', doc.includes(`| X range | ${minX} … ${maxX} |`), `${minX}..${maxX}`)
ok('y range', doc.includes(`| Y range | ${minY} … ${maxY} |`), `${minY}..${maxY}`)
ok('grid dimensions', doc.includes(`| Grid | ${cols} × ${rowsN} cells of 5 m |`), `${cols}x${rowsN}`)

console.log('\n-- the worked example is real, not typed from memory --')
{
  // The one number most likely to be wrong in a hand-written spec, and the
  // one a builder would follow literally.
  const room = mapped.find((r) => r.id === '1-4')
  const col = Math.floor((room.map.x - minX) / 20)
  const row = Math.floor((room.map.y - minY) / 20)
  const letter = col < 26 ? String.fromCharCode(65 + col) : 'A' + String.fromCharCode(65 + col - 26)
  const cell = `${room.map.z ?? 0}/${letter}${String(row).padStart(2, '0')}`
  ok('the example room\'s real coordinates appear', doc.includes(`x ${room.map.x}, y ${room.map.y}`), `${room.map.x},${room.map.y}`)
  // Matched on the same line rather than as one literal string: the template's
  // spacing around the arrow is formatting, and a test that breaks when a
  // space changes would get "fixed" by loosening it until it checks nothing.
  const line = doc.split('\n').find((l) => l.includes(`x ${room.map.x}, y ${room.map.y}`)) ?? ''
  ok('and resolves to the cell the doc claims', line.includes(cell), `${cell} in: ${line.trim()}`)
}

console.log('\n-- the sections a builder needs are present --')
for (const heading of [
  'Where everything goes',
  'The ground and the streets',
  'The river, the quays and the bridges',
  'The wall, the gates and the battlements',
  'Interiors',
  'The guilds',
  'Landmarks',
  'Coverage',
  'Suggested order',
]) {
  ok(`section: ${heading}`, doc.includes(heading))
}

console.log('\n-- honesty clauses that must not be edited out --')
ok('it still says the undescribed rooms stay plain',
  /guessed description becomes indistinguishable/.test(doc))
ok('it still says the room text outranks the tag',
  /room description is the authority/.test(doc))

console.log('')
const total = pass + fail
const MIN_EXPECTED = 15
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${pass} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED - re-run `node tools/build-crossing-build-list.mjs`')
  process.exit(1)
}
console.log('all passed')
