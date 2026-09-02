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
 * unclaimed width is shared by the two visual surfaces rather than making an
 * ultrawide Room column while Battle remains cramped.
 *
 *   node tools/columns-test.mjs
 */
import { readFileSync } from 'node:fs'
import {
  combatBattleWant,
  combatRoomWant,
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
  pixelsForSizeShare,
  sizeShareForPixels,
  storedSizeShare,
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

console.log('-- proportional persistence remains proportional during live resize --')
{
  const saved = storedSizeShare('0.25', 1440, DEFAULT_ROOM_W)
  ok('a stored share remains a share', saved === 0.25, String(saved))
  ok('the share resolves at laptop width', pixelsForSizeShare(saved, 1440) === 360, String(pixelsForSizeShare(saved, 1440)))
  ok('the same live state resolves again at ultrawide width', pixelsForSizeShare(saved, 2880) === 720, String(pixelsForSizeShare(saved, 2880)))
  ok('a dragged width becomes a share', sizeShareForPixels(720, 2880) === 0.25, String(sizeShareForPixels(720, 2880)))
  ok('invalid stored data falls back to the requested pixel default', storedSizeShare('460', 1440, DEFAULT_ROOM_W) === DEFAULT_ROOM_W / 1440)

  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  ok(
    'App keeps every adjustable dimension as live share state',
    ['roomShare', 'battleShare', 'experienceShare', 'mapHShare'].every((name) =>
      appSource.includes(`const [${name}, set`),
    ),
  )
  ok(
    'App resolves live shares against the current host dimensions',
    appSource.includes('pixelsForSizeShare(roomShare, widthReference') &&
      appSource.includes('pixelsForSizeShare(mapHShare, heightReference'),
  )
}

const SPLIT = 8

console.log('-- the control: when it all fits, nothing is scaled --')
{
  const f = fitColumns({
    hostW: 2000, roomWant: 460, mapWant: 500, dashWant: 450, mapDocked: true, splitW: SPLIT,
  })
  const surplus = 2000 - SPLIT * 2 - 460 - 500 - 450
  ok('battle receives half the surplus', f.map === 500 + Math.floor(surplus / 2), String(f.map))
  ok('dash honoured exactly', f.dash === 450, String(f.dash))
  ok('not marked squeezed', f.squeezed === false, String(f.squeezed))
  ok(
    "room receives the other half of the surplus",
    f.room === 460 + Math.ceil(surplus / 2),
    `${f.room} === ${460 + Math.ceil(surplus / 2)}`
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

console.log('\n-- automatic Battle growth stops where a square scene can use it --')
{
  const f = fitColumns({
    hostW: 2400, roomWant: 460, mapWant: 600, dashWant: 168,
    mapDocked: true, splitW: SPLIT, mapGrowthMax: 880,
  })
  ok('Battle grows only to the useful ceiling', f.map === 880, String(f.map))
  ok('the unused surplus returns to Room', f.room === 2400 - SPLIT * 2 - 880 - 168, String(f.room))
  ok('the ceiling does not mark a healthy layout squeezed', f.squeezed === false, String(f.squeezed))
}

console.log('\n-- combat can reclaim an oversized Experience rail without rewriting it --')
{
  const f = fitColumns({
    hostW: 1756, roomWant: 700, mapWant: 760, dashWant: 510,
    mapDocked: true, splitW: SPLIT, dashGrowthMax: 220,
  })
  ok('Experience is capped at its useful combat width', f.dash === 220, String(f.dash))
  ok('Battle keeps at least its requested width', f.map >= 760, String(f.map))
  ok('the combat layout no longer reports a squeeze', f.squeezed === false, String(f.squeezed))
}

console.log('\n-- combat makes the battlespace the primary visual surface --')
{
  ok('ordinary room width is unchanged outside combat', combatRoomWant(900, 1412, false) === 900, String(combatRoomWant(900, 1412, false)))
  ok('combat caps an oversized left workspace contextually', combatRoomWant(900, 1412, true) === 508, String(combatRoomWant(900, 1412, true)))
  ok('combat preserves a deliberately narrow left workspace', combatRoomWant(430, 1412, true) === 430, String(combatRoomWant(430, 1412, true)))
  ok('first paint does not invent a width before measurement', combatRoomWant(900, 0, true) === 900, String(combatRoomWant(900, 0, true)))
  ok('ordinary Battle width is unchanged outside combat', combatBattleWant(502, 1412, false) === 502, String(combatBattleWant(502, 1412, false)))
  ok('combat expands a stale narrow Battle preference contextually', combatBattleWant(502, 1412, true) === 691, String(combatBattleWant(502, 1412, true)))
  ok('combat preserves an already generous Battle preference', combatBattleWant(820, 1412, true) === 820, String(combatBattleWant(820, 1412, true)))

  const roomWant = combatRoomWant(900, 1412, true)
  const battleWant = combatBattleWant(502, 1412, true)
  const f = fitColumns({
    hostW: 1412, roomWant, mapWant: battleWant, dashWant: 510,
    mapDocked: true, splitW: SPLIT, dashGrowthMax: 220,
  })
  ok('Battle is wider than the left workspace in the laptop combat layout', f.map > f.room, `${f.map} > ${f.room}`)
  ok('Battle receives a materially useful landscape width', f.map >= 650, `${f.map} >= 650`)
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

console.log('\n-- pickReset: issue #63 exact scenario - cascades to the second-biggest overshoot --')
{
  // Dan's own live measurement: 1518px window, stored map 1728.8px, stored
  // dash 510px, room at its own default.
  //
  // Used to need only one reset: DEFAULT_MAP_W was 300 then, and
  // 300 + DEFAULT_ROOM_W + 510 fit inside 1518px on its own. DEFAULT_MAP_W
  // is now 620 (see its own doc comment - the old 300/420 pair had drifted
  // from what a fresh install actually opened with), and 620 no longer
  // leaves room for a stored 510px dash alongside it at this exact window
  // width. Dash was never "the offender" - map's 1728.8px overshoot is
  // still the only stored width that didn't fit its own ask - but with the
  // bigger default, resetting map alone isn't enough to fit anymore, so the
  // cascade (biggest overshoot, then the next, per this function's own doc
  // comment) correctly reaches for dash too. Room, which asked for exactly
  // its own default and never overshot anything, is still left alone -
  // that half of the original regression this test protects still holds.
  const plan = pickReset({
    hostW: 1518, mapDocked: true, roomWant: DEFAULT_ROOM_W, mapWant: 1728.8, dashWant: 510, splitW: SPLIT,
  })
  ok('map resets to default', plan.map === DEFAULT_MAP_W, String(plan.map))
  ok('dash also resets - one reset alone no longer fits at the bigger default', plan.dash === DEFAULT_DASH_W, String(plan.dash))
  ok("room is left alone - it never overshot anything", plan.room === null, String(plan.room))
}

console.log('\n-- pickReset: only the offender resets, at a window wide enough that one reset is still enough --')
{
  // Same shape as the historical case above, on a window wide enough that
  // resetting just the offender (map) is enough to fit - demonstrating the
  // "only the offender resets" principle still holds, now calibrated to the
  // current defaults rather than the old ones that case was pinned to.
  const plan = pickReset({
    hostW: 2200, mapDocked: true, roomWant: DEFAULT_ROOM_W, mapWant: 1728.8, dashWant: 510, splitW: SPLIT,
  })
  ok('map resets to default', plan.map === DEFAULT_MAP_W, String(plan.map))
  ok("dash is left alone - it wasn't the offender, and one reset already fits", plan.dash === null, String(plan.dash))
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

/*
 * And the floor, derived rather than typed.
 *
 * This was `if (pass < 20)`, written when the suite had 22 checks. It has 63
 * now, so two thirds of it could have been deleted and the run would still
 * have reported clean - a guard against an empty run that had quietly stopped
 * guarding against most of one. A hand-written floor only tracks the suite on
 * the day it is written, and nothing makes anyone revisit it.
 *
 * So count the assertions in this file and require that every one of them
 * actually ran. That number cannot go stale, because adding a check raises the
 * bar in the same edit. It also catches more than a truncated file: an early
 * return, a `throw` halfway down, or a scenario block that exits before its
 * assertions all leave `pass + fail` short of the source count, and all three
 * otherwise look exactly like a clean pass.
 */
const source = readFileSync(new URL(import.meta.url), 'utf8')
const declared = [...source.matchAll(/^\s+ok\(/gm)].length
const ran = pass + fail
if (ran !== declared) {
  console.log(
    `FAIL ${ran} of ${declared} assertions in this file ran - the rest never ` +
      `executed, which is not a pass`
  )
  process.exit(1)
}
console.log(`   all ${declared} assertions in the file ran`)
process.exit(fail === 0 ? 0 : 1)
