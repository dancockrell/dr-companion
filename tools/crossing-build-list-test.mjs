/**
 * The Crossing build list is generated so its figures cannot drift from the
 * briefs. This checks that they actually haven't - by re-deriving the counts
 * from the source independently and finding them in the committed document.
 *
 * A generated doc nobody re-generates is just a stale doc with a comment on
 * top claiming otherwise, so this fails when the two disagree rather than
 * waiting for a reader to notice.
 */
import { execFileSync } from 'node:child_process'
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

// The briefs are ~60MB and gitignored, so a fresh worktree does not have them.
// This used to skip in that case. The skip announced itself, which reads as
// careful, and it exited *before* the MIN_EXPECTED floor at the bottom of this
// file - so the one guard written to catch a collapsed denominator was the one
// thing the collapse stepped over. On main it ran 1 check instead of 20 and the
// full run still ended "all passed", which is precisely what the announcement
// was meant to prevent. A skip printed inside a suite is invisible: the runner
// reads OK and FAIL lines, so a suite that quietly stops after one of them is a
// passing suite with a small number beside it.
//
// Nothing environmental is missing here - the builder reads tracked inputs only
// and takes under two seconds - so build them rather than skip.
if (!existsSync(BRIEFS)) {
  console.log(`building ${BRIEFS} (gitignored, absent in a fresh worktree, ~60MB)`)
  execFileSync(process.execPath, ['tools/build-geometric-room-briefs.mjs'], { stdio: 'inherit' })
}
ok('the briefs the figures are derived from are available', existsSync(BRIEFS))
if (!existsSync(BRIEFS)) {
  console.error('FAILED: `node tools/build-geometric-room-briefs.mjs` produced no briefs')
  process.exit(1)
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
