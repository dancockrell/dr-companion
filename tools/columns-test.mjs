/**
 * fitColumns had no test.
 *
 * It carries three constants, a documented fairness rule, and a `squeezed`
 * flag that the banner in App.tsx reads, and nothing anywhere asserted any of
 * it. The bug that prompted this is the kind that costs a player rather than a
 * build: at an 1180px window the dashboard was fitted to 209px around content
 * that lays out to 382px, so four macro buttons and several panel headers sat
 * off-view behind a scrollbar Windows only draws on hover. Measured on the
 * real app through app-eyes, not in a browser standing in for it.
 *
 * The rule that was wrong is worth stating, because it was a good rule applied
 * one step too widely: both columns were scaled toward COL_MIN by the same
 * factor, "because a player who set both did not implicitly rank them". Equal
 * scaling is right. Equal *floors* are not - the map degrades into less map,
 * the dashboard degrades into hidden controls.
 *
 * Room (map + chat/functions) joined map and dash as a third real preference
 * rather than a pure leftover when "one column for map, one for battle, one
 * for skills" asked for three peer columns instead of two plus a remainder -
 * every scenario below now passes a `roomWant`, and the fits-case checks that
 * an unclaimed leftover still lands on room by default (see fitColumns' own
 * doc comment on why).
 *
 *   node tools/columns-test.mjs
 */
import {
  fitColumns,
  pickReset,
  ROOM_MIN,
  COL_MIN,
  DASH_MIN,
  MAP_EMPTY_WANT,
  DASH_EMPTY_WANT,
  DEFAULT_ROOM_W,
  DEFAULT_MAP_W,
  DEFAULT_DASH_W,
} from '../src/lib/columns.ts'

let pass = 0
let fail = 0

function ok(label, cond, detail) {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(52)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(52)} ${detail ?? ''}`)
  }
}

const SPLIT = 8

console.log('-- the control: when it all fits, nothing is scaled --')
{
  const f = fitColumns({
    hostW: 2000, roomWant: 460, mapWant: 500, dashWant: 450, mapDocked: true, splitW: SPLIT,
  })
  ok('map honoured exactly', f.map === 500, String(f.map))
  ok('dash honoured exactly', f.dash === 450, String(f.dash))
  ok('not marked squeezed', f.squeezed === false, String(f.squeezed))
  ok(
    "room gets its own ask plus whatever nobody else asked for",
    f.room === 2000 - SPLIT * 2 - 500 - 450,
    `${f.room} === ${2000 - SPLIT * 2 - 500 - 450}`
  )
  ok('room is at least what it asked for', f.room >= 460, `${f.room} >= 460`)
}

console.log('\n-- room asked for exactly the leftover: no surplus, no squeeze --')
{
  const forColumns = 2000 - SPLIT * 2
  const f = fitColumns({
    hostW: 2000, roomWant: forColumns - 500 - 450, mapWant: 500, dashWant: 450, mapDocked: true, splitW: SPLIT,
  })
  ok('room honoured exactly, nothing left unclaimed', f.room === forColumns - 500 - 450, String(f.room))
  ok('still not a squeeze', f.squeezed === false, String(f.squeezed))
}

console.log('\n-- the regression: a squeeze must not hide the dashboard --')
{
  // The real case. 1180px window, a map width somebody dragged wide.
  const f = fitColumns({
    hostW: 1180, roomWant: 460, mapWant: 825, dashWant: 300, mapDocked: true, splitW: SPLIT,
  })
  ok('it is a squeeze', f.squeezed === true, String(f.squeezed))
  ok('dash never below DASH_MIN', f.dash >= DASH_MIN, `${f.dash} >= ${DASH_MIN}`)
  ok('map absorbed it instead', f.map < 825, `${f.map} < 825`)
  ok('map still grabbable', f.map >= COL_MIN, `${f.map} >= ${COL_MIN}`)
  ok('room keeps its floor', f.room >= ROOM_MIN - 1, `${f.room} >= ${ROOM_MIN}`)
  ok('room also absorbed some of the squeeze, not just map', f.room < 460, `${f.room} < 460`)
  ok(
    'the three columns and dividers fill the window',
    Math.abs(f.map + f.dash + f.room + SPLIT * 2 - 1180) <= 1,
    `${f.map} + ${f.dash} + ${f.room} + ${SPLIT * 2}`
  )
}

console.log('\n-- a squeeze severe enough to reach room\'s own floor --')
{
  // Room used to be an unconditional guarantee - ROOM_MIN no matter what.
  // Now it is a real third participant in the same floor-scaling as map and
  // dash, so a squeeze can legitimately press it down to ROOM_MIN too. hostW
  // chosen so the window has room for exactly the three floors summed
  // (splitW*2 + ROOM_MIN + COL_MIN + DASH_MIN) and not a pixel more - below
  // this, none of the three floors can be honoured at once, which is a
  // different, already-covered case ("a window too narrow for anything").
  const hostW = SPLIT * 2 + ROOM_MIN + COL_MIN + DASH_MIN
  const f = fitColumns({
    hostW, roomWant: 460, mapWant: 900, dashWant: 900, mapDocked: true, splitW: SPLIT,
  })
  ok('room pressed to its own floor', f.room === ROOM_MIN, `${f.room} === ${ROOM_MIN}`)
  ok('map at its floor too', f.map === COL_MIN, `${f.map} === ${COL_MIN}`)
  ok('dash at its floor too', f.dash === DASH_MIN, `${f.dash} === ${DASH_MIN}`)
}

console.log('\n-- a dash request under the floor is raised to it, not honoured --')
{
  // Below DASH_MIN and above COL_MIN, so this genuinely exercises "under
  // the floor" rather than happening to land exactly on it.
  const f = fitColumns({
    hostW: 2000, roomWant: 460, mapWant: 400, dashWant: 90, mapDocked: true, splitW: SPLIT,
  })
  ok('raised to DASH_MIN', f.dash === DASH_MIN, `${f.dash} === ${DASH_MIN}`)
}

console.log('\n-- the deliberate exception: an empty dashboard hides nothing --')
{
  // hostW tight enough that even the smaller DASH_MIN floor gets squeezed
  // past - the point of this case is that an empty dash's floor is COL_MIN,
  // not DASH_MIN, and a scenario where the squeeze never reaches DASH_MIN in
  // the first place cannot demonstrate that.
  const f = fitColumns({
    hostW: 600, roomWant: 460, mapWant: 825, dashWant: 300, mapDocked: true, splitW: SPLIT,
    dashEmpty: true,
  })
  ok('may go under DASH_MIN when empty', f.dash < DASH_MIN, `${f.dash} < ${DASH_MIN}`)
  ok('still at least a grabbable sliver', f.dash >= COL_MIN, `${f.dash} >= ${COL_MIN}`)
  ok('capped by DASH_EMPTY_WANT', f.dash <= DASH_EMPTY_WANT, `${f.dash} <= ${DASH_EMPTY_WANT}`)
}

console.log('\n-- an empty map is capped the same way --')
{
  const f = fitColumns({
    hostW: 2000, roomWant: 460, mapWant: 825, dashWant: 400, mapDocked: true, splitW: SPLIT,
    mapEmpty: true,
  })
  ok('capped by MAP_EMPTY_WANT', f.map <= MAP_EMPTY_WANT, `${f.map} <= ${MAP_EMPTY_WANT}`)
}

console.log('\n-- before the layout has measured itself --')
{
  const f = fitColumns({
    hostW: 0, roomWant: 460, mapWant: 500, dashWant: 450, mapDocked: true, splitW: SPLIT,
  })
  ok('requests returned unchanged', f.map === 500, String(f.map))
  ok('room returned unchanged too', f.room === 460, String(f.room))
  ok('not claimed as a squeeze', f.squeezed === false, String(f.squeezed))
}

console.log('\n-- undocked map: the dashboard floor still holds --')
{
  const f = fitColumns({
    hostW: 900, roomWant: 460, mapWant: 500, dashWant: 600, mapDocked: false, splitW: SPLIT,
  })
  ok('no map column', f.map === 0, String(f.map))
  ok('dash never below DASH_MIN', f.dash >= DASH_MIN, `${f.dash} >= ${DASH_MIN}`)
}

console.log('\n-- a window too narrow for anything still returns sane numbers --')
{
  const f = fitColumns({
    hostW: 400, roomWant: 460, mapWant: 500, dashWant: 500, mapDocked: true, splitW: SPLIT,
  })
  ok('room never negative', f.room >= 0, String(f.room))
  ok('map never negative', f.map >= 0, String(f.map))
  ok('dash never negative', f.dash >= 0, String(f.dash))
}

console.log('\n-- pickReset: issue #63 exact scenario - only the offender resets --')
{
  // Dan's own live measurement: 1518px window, stored map 1728.8px, stored
  // dash 510px, room at its own default. Room + dash comfortably fit their
  // own asks; only the map does not.
  const plan = pickReset({
    hostW: 1518, mapDocked: true, roomWant: DEFAULT_ROOM_W, mapWant: 1728.8, dashWant: 510, splitW: SPLIT,
  })
  ok('map resets to default', plan.map === DEFAULT_MAP_W, String(plan.map))
  ok("dash is left alone - it wasn't the offender", plan.dash === null, String(plan.dash))
  ok("room is left alone - it wasn't the offender", plan.room === null, String(plan.room))
}

console.log('\n-- pickReset: the mirror case - dashboard is the offender --')
{
  const plan = pickReset({
    hostW: 1518, mapDocked: true, roomWant: DEFAULT_ROOM_W, mapWant: 300, dashWant: 900, splitW: SPLIT,
  })
  ok("map is left alone - it wasn't the offender", plan.map === null, String(plan.map))
  ok('dash resets to default', plan.dash === DEFAULT_DASH_W, String(plan.dash))
  ok("room is left alone - it wasn't the offender", plan.room === null, String(plan.room))
}

console.log('\n-- pickReset: room can be the offender too --')
{
  const plan = pickReset({
    hostW: 1518, mapDocked: true, roomWant: 1800, mapWant: DEFAULT_MAP_W, dashWant: DEFAULT_DASH_W, splitW: SPLIT,
  })
  ok('room resets to default', plan.room === DEFAULT_ROOM_W, String(plan.room))
  ok("map is left alone - it wasn't the offender", plan.map === null, String(plan.map))
  ok("dash is left alone - it wasn't the offender", plan.dash === null, String(plan.dash))
}

console.log('\n-- pickReset: no single column alone is enough, so two reset --')
{
  // hostW chosen so resetting the single biggest overshoot (map) still
  // does not fit, but map + dash together does - room's own overshoot
  // (500 vs its 460 default) is the smallest of the three, so it should
  // stay at its own stored 500 rather than being swept in too.
  const plan = pickReset({
    hostW: 1300, mapDocked: true, roomWant: 500, mapWant: 900, dashWant: 900, splitW: SPLIT,
  })
  ok('map resets', plan.map === DEFAULT_MAP_W, String(plan.map))
  ok('dash resets too', plan.dash === DEFAULT_DASH_W, String(plan.dash))
  ok("room, the smallest overshoot, is left alone", plan.room === null, String(plan.room))
}

console.log('\n-- pickReset: nothing needs resetting when it already fits --')
{
  // The "Reset widths" button only shows when fitColumns reports squeezed,
  // so this input never actually reaches pickReset through the real UI -
  // checked anyway because a pure function's contract shouldn't depend on a
  // caller behaving. All three comfortably fit, so the plan should touch
  // none of them rather than resetting one out of habit.
  const plan = pickReset({
    hostW: 2000, mapDocked: true, roomWant: DEFAULT_ROOM_W, mapWant: 250, dashWant: 380, splitW: SPLIT,
  })
  ok('room left alone', plan.room === null, String(plan.room))
  ok('map left alone', plan.map === null, String(plan.map))
  ok('dash left alone', plan.dash === null, String(plan.dash))
}

console.log('\n-- pickReset: map not docked, it cannot be blamed for anything --')
{
  const plan = pickReset({
    hostW: 900, mapDocked: false, roomWant: DEFAULT_ROOM_W, mapWant: 9999, dashWant: 900, splitW: SPLIT,
  })
  ok('map is not touched even though mapWant is huge', plan.map === null, String(plan.map))
  ok('dash resets when room + dash do not fit alone', plan.dash === DEFAULT_DASH_W, String(plan.dash))
}

console.log('\n-- pickReset: window too narrow even for all three defaults - still returns a plan, not a crash --')
{
  const plan = pickReset({
    hostW: 200, mapDocked: true, roomWant: 900, mapWant: 900, dashWant: 900, splitW: SPLIT,
  })
  ok(
    'falls through to resetting all three',
    plan.room === DEFAULT_ROOM_W && plan.map === DEFAULT_MAP_W && plan.dash === DEFAULT_DASH_W,
    JSON.stringify(plan)
  )
}

// The denominator, printed whether or not anything failed: a suite that
// asserted nothing would otherwise read exactly like a clean run.
console.log(`\n${pass} checks passed, ${fail} failed`)
if (pass < 20) {
  console.log(`FAIL only ${pass} checks ran; this suite should assert at least 20`)
  process.exit(1)
}
process.exit(fail === 0 ? 0 : 1)
