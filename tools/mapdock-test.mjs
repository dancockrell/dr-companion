/**
 * The columns cannot be given the part of the window the app is in.
 *
 * This test exists because the app was found in that state, not because
 * somebody imagined it. Attaching to the running WebView2 and measuring what
 * had left the window gave:
 *
 *     window 1180x820, document 1180 wide
 *          718px out  Attach
 *          666px out  Clear
 *          490px out  INPUT
 *          500px out  All
 *
 * with a stored map width of 1201.6px. `main` is overflow-hidden, so none of
 * that was reachable by scrolling - the connection controls simply were not on
 * screen, and the app looked broken rather than misconfigured.
 *
 * The first fix bounded the map alone against a fixed "leave 420px for the
 * rest", and the same measurement said it was still wrong, because the
 * dashboard was holding all 420 of them:
 *
 *     276px out  Attach
 *     106px out  Companion
 *
 * So the assertions below are written against `fitColumns`, which does the
 * arithmetic once with all three columns in it. The case that matters is the
 * one where both stored widths are large: bounding either alone passes it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'columns.mjs')
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/columns.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
)
const m = await import(pathToFileURL(out).href)

let fails = 0
let checked = 0
const ok = (label, cond, detail = '') => {
  checked++
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(52)}${detail}`)
}

const { fitColumns, ROOM_MIN, COL_MIN, MAP_EMPTY_WANT, DASH_EMPTY_WANT } = m
const SPLIT = 8

/** What the app actually asks for, so a case is a window size and two wants. */
const fit = (hostW, mapWant, dashWant, mapDocked = true) =>
  fitColumns({ hostW, mapWant, dashWant, mapDocked, splitW: SPLIT })

const fitEmpty = (hostW, mapWant, dashWant, opts = {}) =>
  fitColumns({ hostW, mapWant, dashWant, mapDocked: true, splitW: SPLIT, ...opts })

/** The invariant the whole module exists for. */
const fitsInside = (hostW, f, docked = true) => {
  const splits = docked ? SPLIT * 2 : SPLIT
  return f.map + f.dash + f.room + splits <= hostW + 0.5
}

console.log('-- the exact state the app was found in --')
{
  const f = fit(1180, 1201.5999755859375, 420)
  ok('the columns fit inside the window', fitsInside(1180, f), JSON.stringify(f))
  ok('and the room column keeps its floor', f.room >= ROOM_MIN, `${f.room}px`)
  ok('the squeeze is reported, not hidden', f.squeezed === true)
}

console.log('-- and the state the first fix left it in --')
{
  // Map bounded to 760 by "leave 420 for the rest", dashboard still 420, room
  // column zero. This is the case a per-column ceiling cannot catch, because
  // each column is individually within its own bound.
  const f = fit(1180, 760, 420)
  ok('both large widths are scaled, not just one', f.map < 760 && f.dash < 420, JSON.stringify(f))
  ok('the room column is not zero', f.room >= ROOM_MIN, `${f.room}px`)
}

console.log('\n-- widths that fit are not touched --')
{
  const f = fit(1600, 300, 420)
  ok('300 and 420 in a 1600 window stay put', f.map === 300 && f.dash === 420, JSON.stringify(f))
  ok('nothing is reported as squeezed', f.squeezed === false)
  ok('the room column gets the remainder', f.room === 1600 - 300 - 420 - 16, `${f.room}px`)
}

console.log('\n-- a big map is still allowed, because that was the point --')
{
  // The original reasoning was that a player may want the chart big. They
  // still may. They may not have it instead of the app.
  const f = fit(2560, 99999, 420)
  ok('on a 2560 window the map takes over 1500px', f.map > 1500, `${f.map}px`)
  ok('and the room column still has its floor', f.room >= ROOM_MIN, `${f.room}px`)
}

console.log('\n-- popped out, the map costs nothing --')
{
  const f = fit(1180, 1201.6, 420, false)
  ok('an undocked map takes no width', f.map === 0)
  ok('and the dashboard keeps what it asked for', f.dash === 420, `${f.dash}px`)
  ok('the columns still fit', fitsInside(1180, f, false), JSON.stringify(f))
}

console.log('\n-- neither column is squeezed out of existence --')
{
  const f = fit(600, 99999, 99999)
  ok('the map stays grabbable', f.map >= COL_MIN, `${f.map}px`)
  ok('the dashboard stays grabbable', f.dash >= COL_MIN, `${f.dash}px`)
  ok('and the room column is never negative', f.room >= 0, `${f.room}px`)
}

console.log('\n-- across every window width the engine targets --')
{
  // Deliberately including widths narrower than any of them, because a window
  // is dragged through those on the way down and the layout must not break
  // while passing through.
  let worst = null
  for (const host of [520, 720, 900, 1180, 1280, 1440, 1600, 1920, 2560, 3440, 3840]) {
    for (const [mw, dw] of [
      [300, 420],
      [99999, 99999],
      [1201.6, 420],
      [80, 80],
      [host, host],
    ]) {
      const f = fit(host, mw, dw)
      if (!fitsInside(host, f)) worst = { host, mw, dw, f }
    }
  }
  ok(
    'the columns always fit inside the window',
    worst === null,
    worst ? JSON.stringify(worst) : '55 combinations'
  )
}

console.log('\n-- before it has measured itself, nothing is invented --')
{
  const f = fit(0, 300, 420)
  ok('a host width of 0 returns the requests unchanged', f.map === 300 && f.dash === 420)
}

console.log('\n-- and the check can fail, shown against the version it replaces --')
{
  // Both of the earlier rules, so a reader can see the assertions above are
  // load-bearing. If either of these passes, the case it stands for was never
  // being tested.
  const noCeiling = (w) => Math.max(80, w)
  ok(
    'the unbounded version is caught',
    1180 - noCeiling(1201.6) - 420 - 16 < ROOM_MIN,
    `it left ${Math.round(1180 - noCeiling(1201.6) - 420 - 16)}px for the room column`
  )
  const mapOnly = (w, host) => Math.max(80, Math.min(w, host - 420))
  ok(
    'the map-only ceiling is caught too',
    1180 - mapOnly(1201.6, 1180) - 420 - 16 < ROOM_MIN,
    `it left ${Math.round(1180 - mapOnly(1201.6, 1180) - 420 - 16)}px for the room column`
  )
}

console.log('\n-- an empty map yields space rather than holding its stored width --')
{
  // Dan's own "see a map?" measurement: 495px of nothing at 1180x820, while
  // the game pane sat at its bare 380px floor. mapEmpty makes the map's
  // *effective* ask small until there is something in the column to spend a
  // large one on.
  // A window wide enough to honour 495+315 unsqueezed (784px would not be -
  // 1180 minus splits and ROOM_MIN - so squeeze scaling would shrink the map
  // too, for a reason unrelated to the thing being asserted here). Same width
  // for both calls, so the only variable between them is mapEmpty.
  const idle = fitEmpty(1600, 495, 315, { mapEmpty: true, dashEmpty: false })
  ok('the empty map is capped near MAP_EMPTY_WANT', idle.map <= MAP_EMPTY_WANT, `${idle.map}px`)
  ok('room grows past its bare floor because of it', idle.room > ROOM_MIN, `${idle.room}px`)

  const full = fitEmpty(1600, 495, 315, { mapEmpty: false, dashEmpty: false })
  ok('with content, the same 495px request is honoured', full.map === 495, `${full.map}px`)
  ok('and room shrinks back to make room for it', full.room < idle.room, `${full.room} vs ${idle.room}`)
}

console.log('\n-- the cap is a ceiling, not a rewrite --')
{
  // A player who dragged the map to 150px - narrower than the empty
  // allowance - is still asking for exactly 150px, empty or not.
  const f = fitEmpty(1180, 150, 300, { mapEmpty: true })
  ok('a want smaller than the empty cap is left alone', f.map === 150, `${f.map}px`)
}

console.log('\n-- both columns can be empty at once, and both yield --')
{
  const f = fitEmpty(1180, 495, 981, { mapEmpty: true, dashEmpty: true })
  ok('map is capped', f.map <= MAP_EMPTY_WANT, `${f.map}px`)
  ok('dash is capped', f.dash <= DASH_EMPTY_WANT, `${f.dash}px`)
  ok('room gets most of the window', f.room > 500, `${f.room}px`)
  const fitsAfter = f.map + f.dash + f.room + SPLIT * 2 <= 1180 + 0.5
  ok('and everything still fits', fitsAfter, JSON.stringify(f))
}

console.log('\n-- and the check can fail: a version that ignores emptiness entirely --')
{
  // The mutation this guards against: someone adds the mapEmpty/dashEmpty
  // parameters to the type and never reads them.
  const ignoresEmpty = (hostW, mapWant, dashWant) => {
    const mapAsked = Math.max(COL_MIN, mapWant)
    const dashAsked = Math.max(COL_MIN, dashWant)
    return { map: mapAsked, dash: dashAsked, room: hostW - SPLIT * 2 - mapAsked - dashAsked }
  }
  const f = ignoresEmpty(1180, 495, 315)
  ok(
    'a fit that does not read the empty flags fails this suite',
    !(f.map <= MAP_EMPTY_WANT),
    `${f.map}px - would wrongly pass if this were <= ${MAP_EMPTY_WANT}`
  )
}

// A floor on the work, set below the real count so it catches an empty or
// half-loaded run and never needs adjusting when a case is added. Read before
// the assertion so it does not count itself.
const ran = checked
ok('enough was checked for a pass to mean something', ran >= 15, `${ran} assertions`)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
