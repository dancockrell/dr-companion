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
    hostW: 2000, mapWant: 500, dashWant: 450, mapDocked: true, splitW: SPLIT,
  })
  ok('map honoured exactly', f.map === 500, String(f.map))
  ok('dash honoured exactly', f.dash === 450, String(f.dash))
  ok('not marked squeezed', f.squeezed === false, String(f.squeezed))
  ok('room gets the rest', f.room === 2000 - SPLIT * 2 - 500 - 450, String(f.room))
}

console.log('\n-- the regression: a squeeze must not hide the dashboard --')
{
  // The real case. 1180px window, a map width somebody dragged wide.
  const f = fitColumns({
    hostW: 1180, mapWant: 825, dashWant: 300, mapDocked: true, splitW: SPLIT,
  })
  ok('it is a squeeze', f.squeezed === true, String(f.squeezed))
  ok('dash never below DASH_MIN', f.dash >= DASH_MIN, `${f.dash} >= ${DASH_MIN}`)
  ok('map absorbed it instead', f.map < 825, `${f.map} < 825`)
  ok('map still grabbable', f.map >= COL_MIN, `${f.map} >= ${COL_MIN}`)
  ok('room keeps its floor', f.room >= ROOM_MIN - 1, `${f.room} >= ${ROOM_MIN}`)
  ok(
    'the three columns and dividers fill the window',
    Math.abs(f.map + f.dash + f.room + SPLIT * 2 - 1180) <= 1,
    `${f.map} + ${f.dash} + ${f.room} + ${SPLIT * 2}`
  )
}

console.log('\n-- a dash request under the floor is raised to it, not honoured --')
{
  // Below DASH_MIN and above COL_MIN, so this genuinely exercises "under
  // the floor" rather than happening to land exactly on it.
  const f = fitColumns({
    hostW: 2000, mapWant: 400, dashWant: 90, mapDocked: true, splitW: SPLIT,
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
    hostW: 600, mapWant: 825, dashWant: 300, mapDocked: true, splitW: SPLIT,
    dashEmpty: true,
  })
  ok('may go under DASH_MIN when empty', f.dash < DASH_MIN, `${f.dash} < ${DASH_MIN}`)
  ok('still at least a grabbable sliver', f.dash >= COL_MIN, `${f.dash} >= ${COL_MIN}`)
  ok('capped by DASH_EMPTY_WANT', f.dash <= DASH_EMPTY_WANT, `${f.dash} <= ${DASH_EMPTY_WANT}`)
}

console.log('\n-- an empty map is capped the same way --')
{
  const f = fitColumns({
    hostW: 2000, mapWant: 825, dashWant: 400, mapDocked: true, splitW: SPLIT,
    mapEmpty: true,
  })
  ok('capped by MAP_EMPTY_WANT', f.map <= MAP_EMPTY_WANT, `${f.map} <= ${MAP_EMPTY_WANT}`)
}

console.log('\n-- before the layout has measured itself --')
{
  const f = fitColumns({
    hostW: 0, mapWant: 500, dashWant: 450, mapDocked: true, splitW: SPLIT,
  })
  ok('requests returned unchanged', f.map === 500, String(f.map))
  ok('not claimed as a squeeze', f.squeezed === false, String(f.squeezed))
}

console.log('\n-- undocked map: the dashboard floor still holds --')
{
  const f = fitColumns({
    hostW: 900, mapWant: 500, dashWant: 600, mapDocked: false, splitW: SPLIT,
  })
  ok('no map column', f.map === 0, String(f.map))
  ok('dash never below DASH_MIN', f.dash >= DASH_MIN, `${f.dash} >= ${DASH_MIN}`)
}

console.log('\n-- a window too narrow for anything still returns sane numbers --')
{
  const f = fitColumns({
    hostW: 400, mapWant: 500, dashWant: 500, mapDocked: true, splitW: SPLIT,
  })
  ok('room never negative', f.room >= 0, String(f.room))
  ok('map never negative', f.map >= 0, String(f.map))
  ok('dash never negative', f.dash >= 0, String(f.dash))
}

console.log('\n-- pickReset: issue #63 exact scenario - only the offender resets --')
{
  // Dan's own live measurement: 1518px window, stored map 1728.8px, stored
  // dash 510px. Room floor leaves 1138px for the pair; the dashboard's 510
  // fits inside that on its own, only the map does not.
  const plan = pickReset({ hostW: 1518, mapDocked: true, mapWant: 1728.8, dashWant: 510, splitW: SPLIT })
  ok('map resets to default', plan.map === DEFAULT_MAP_W, String(plan.map))
  ok("dash is left alone - it wasn't the offender", plan.dash === null, String(plan.dash))
}

console.log('\n-- pickReset: the mirror case - dashboard is the offender --')
{
  const plan = pickReset({ hostW: 1518, mapDocked: true, mapWant: 300, dashWant: 900, splitW: SPLIT })
  ok("map is left alone - it wasn't the offender", plan.map === null, String(plan.map))
  ok('dash resets to default', plan.dash === DEFAULT_DASH_W, String(plan.dash))
}

console.log('\n-- pickReset: neither alone is enough, so both reset --')
{
  const plan = pickReset({ hostW: 700, mapDocked: true, mapWant: 900, dashWant: 900, splitW: SPLIT })
  ok('map resets', plan.map === DEFAULT_MAP_W, String(plan.map))
  ok('dash resets too', plan.dash === DEFAULT_DASH_W, String(plan.dash))
}

console.log('\n-- pickReset: an input the real UI never sends, checked anyway --')
{
  // The "Reset widths" button only shows when fitColumns reports squeezed,
  // which requires at least one column to actually be over budget - so both
  // comfortably fitting (as here) never reaches this function through the
  // real UI. Checked anyway because a pure function's contract shouldn't
  // depend on a caller behaving: it still has to return *something* sane
  // rather than crash. It compares raw overshoot (mapOver -50 vs dashOver
  // -40) and, mapOver being the smaller of two negatives, takes the dash
  // branch - documenting the actual tie-break, not a claim that this input
  // is meaningful to reach for.
  const plan = pickReset({ hostW: 2000, mapDocked: true, mapWant: 250, dashWant: 380, splitW: SPLIT })
  ok('map left alone', plan.map === null, String(plan.map))
  ok('dash resets to its own default', plan.dash === DEFAULT_DASH_W, String(plan.dash))
}

console.log('\n-- pickReset: map not docked, it cannot be blamed for anything --')
{
  const plan = pickReset({ hostW: 900, mapDocked: false, mapWant: 9999, dashWant: 900, splitW: SPLIT })
  ok('map is not touched even though mapWant is huge', plan.map === null, String(plan.map))
  ok('dash still resets', plan.dash === DEFAULT_DASH_W, String(plan.dash))
}

console.log('\n-- pickReset: window too narrow even for both defaults - still returns a plan, not a crash --')
{
  const plan = pickReset({ hostW: 200, mapDocked: true, mapWant: 900, dashWant: 900, splitW: SPLIT })
  ok('falls through to resetting both', plan.map === DEFAULT_MAP_W && plan.dash === DEFAULT_DASH_W, JSON.stringify(plan))
}

// The denominator, printed whether or not anything failed: a suite that
// asserted nothing would otherwise read exactly like a clean run.
console.log(`\n${pass} checks passed, ${fail} failed`)
if (pass < 20) {
  console.log(`FAIL only ${pass} checks ran; this suite should assert at least 20`)
  process.exit(1)
}
process.exit(fail === 0 ? 0 : 1)
