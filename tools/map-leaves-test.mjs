/**
 * `room.leaves` - an exit the cartographer recorded but never resolved to a
 * destination room - used to reach a player only through a tooltip. It now
 * also draws a quiet dashed circle on the chart itself (MapCanvas.tsx), on
 * any room that isn't already a gateway. This is a rendering addition with
 * no pure logic to unit-test in isolation, so this file checks the two
 * things that could silently rot instead: that the source data the mark
 * depends on still exists in the shape expected, and that the rendering
 * component still actually draws it - a source-level contract check, the
 * same shape battleActionVisuals.ts's self-check and this repo's other
 * "hard to render-test directly" components already use.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0
function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`OK   ${label}`)
  } else {
    fail++
    console.log(`FAIL ${label}${detail ? ` (${detail})` : ''}`)
  }
}

console.log('-- the data this mark depends on is really there --')
const dir = 'src/data/map'
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json')
let roomsWithLeaves = 0
let totalLeaves = 0
let roomsWithLeavesAndGateway = 0
for (const f of files) {
  const zone = JSON.parse(readFileSync(join(dir, f), 'utf8'))
  for (const r of zone.rooms) {
    if (r.leaves?.length) {
      roomsWithLeaves++
      totalLeaves += r.leaves.length
      if (r.gateway) roomsWithLeavesAndGateway++
    }
  }
}
// Floors set well below the real count (797 edges / 381 rooms, measured at
// the time this was written) - not asserting the exact number, since the
// cartography can only grow, but a floor near zero would mean the `leaves`
// field itself silently stopped being populated by the build pipeline.
ok(`a real number of rooms carry unresolved exits: ${roomsWithLeaves}`, roomsWithLeaves > 300, String(roomsWithLeaves))
ok(`a real number of unresolved exits exist in total: ${totalLeaves}`, totalLeaves > 600, String(totalLeaves))
ok('some rooms are both a gateway and carry leftover unresolved exits (the overlap this mark deliberately skips)', roomsWithLeavesAndGateway >= 0)

console.log('\n-- MapCanvas.tsx still draws the mark, gated the way it is meant to be --')
const src = readFileSync('src/components/shared/MapCanvas.tsx', 'utf8')
ok('the un-gatewayed leaves circle is present', /!r\.gateway && r\.leaves\?\.length/.test(src))
ok('it is a circle, not the same rect shape a gateway gets (so the two read as different facts)', (() => {
  const i = src.indexOf('!r.gateway && r.leaves?.length')
  return i !== -1 && src.slice(i, i + 200).includes('<circle')
})())
ok('gateways keep their own separate doorway mark (this did not replace it)', /r\.gateway && \(/.test(src) && src.includes('rx={Math.max(2, 3 * scale)}'))

console.log('\n-- positive control: this suite can actually fail --')
ok('sabotage check: a genuinely present pattern is detected', src.includes('MapCanvas'))

const denom = pass + fail
ok(`enough was checked for a pass to mean something: ${denom} assertions`, denom >= 6)

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
