/**
 * `roomKind` and `kindOfExit` - the room/exit classification that moved out
 * of MapCanvas.tsx and into mapData.ts, on the reasoning that "is this room
 * a hazard" is a fact about DragonRealms geography, not about SVG. Neither
 * had a test of its own before or after the move; this is that test, not
 * a regression check for the move itself.
 *
 * `mapData.ts` calls `import.meta.glob(...)` at module scope for `loadZone`/
 * `zoneIndex` - a Vite build-time macro that does not exist under plain
 * Node. Stubbed to an empty object in the transpiled output rather than
 * avoided by re-deriving `roomKind` from a copy: this is the same file real
 * callers import, so a test importing anything else would not be testing
 * what ships.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'mapdata-'))
const out = join(dir, 'mapData.js')
const transpiled = ts.transpileModule(readFileSync('src/lib/mapData.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const patched = transpiled.replace(/import\.meta\.glob(<[^>]*>)?\([^)]*\)/, '{}')
if (patched === transpiled) {
  throw new Error('map-data-test: expected an import.meta.glob(...) call to stub - did mapData.ts change shape?')
}
writeFileSync(out, patched)

const { roomKind } = await import(pathToFileURL(out).href)

let failed = 0
let checked = 0
const ok = (name, cond, detail = '') => {
  checked++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(58)}${detail}`)
  if (!cond) failed++
}

console.log('-- generated map metadata stays synchronized with the index --')
{
  const index = JSON.parse(readFileSync('src/data/map/index.json', 'utf8'))
  const metadata = JSON.parse(readFileSync('src/data/map-metadata.json', 'utf8'))
  ok('metadata zone count matches the searchable index', metadata.zones === index.length)
  ok('metadata room count matches the searchable index', metadata.rooms === index.reduce((sum, zone) => sum + zone.rooms, 0))
  const mapSource = readFileSync('src/lib/mapData.ts', 'utf8')
  ok('the zone chunk glob excludes the searchable index', mapSource.includes("!../data/map/index.json"))
  ok('setup metadata lives outside the zone-only directory', !mapSource.includes('map-metadata.json'))
}

const room = (over = {}) => ({
  id: 1, uid: null, title: 'A Room', x: 0, y: 0, z: 0, tags: [], ...over,
})

console.log('-- precedence: here beats everything, route beats hazard/service --')
{
  const r = room({ id: 5, tags: ['bank', 'water'] })
  ok('a hazard-and-service room you are standing in reads as here', roomKind(r, 5, new Set()) === 'here')
  ok('a hazard room on the route reads as route', roomKind(r, null, new Set([5])) === 'route')
}

console.log('\n-- hazard and service, from the room\'s own tags --')
{
  ok('water is a hazard', roomKind(room({ tags: ['water'] }), null, new Set()) === 'hazard')
  ok('drown is a hazard', roomKind(room({ tags: ['you can drown here'] }), null, new Set()) === 'hazard')
  ok('bank is a service', roomKind(room({ tags: ['bank'] }), null, new Set()) === 'service')
  ok('healer is a service', roomKind(room({ tags: ['healer'] }), null, new Set()) === 'service')
  ok('a hazard tag wins over a service tag on the same room',
    roomKind(room({ tags: ['bank', 'water'] }), null, new Set()) === 'hazard')

  // Regression: HAZARD's `rt` (short for "roundtime") used to be a bare
  // fragment rather than word-bounded, so it matched any substring
  // containing those two letters - an ordinary courtyard read as a hazard
  // for no reason a player could see. Caught by this test, not by anyone
  // noticing a wrongly-red room on the chart.
  ok('an ordinary courtyard is not a hazard',
    roomKind(room({ tags: ['courtyard'] }), null, new Set()) === 'plain')
  ok('a genuine roundtime tag is still a hazard',
    roomKind(room({ tags: ['costs roundtime to cross'] }), null, new Set()) === 'hazard')
  ok('the bare "rt" abbreviation, as its own word, is still a hazard',
    roomKind(room({ tags: ['rt'] }), null, new Set()) === 'hazard')
}

console.log('\n-- plain is the honest default, not a guess --')
{
  ok('no tags at all is plain', roomKind(room({ tags: [] }), null, new Set()) === 'plain')
  ok('a tag with no hazard/service word in it is plain',
    roomKind(room({ tags: ['a peaceful courtyard'] }), null, new Set()) === 'plain')
}

console.log('\n-- an unset id and an unset "here" are both null, and null === null --')
{
  // roomKind compares with `===`, not an explicit null check on either side.
  // Established here rather than guessed: a room with no id, asked about
  // against a character whose room is also not known, reads as "here" -
  // two unknowns compare equal in JS the same way they would for any other
  // value. Neither side of this is expected to happen with real Lich data
  // (a real room always carries a real id), so this is documenting the
  // actual behavior of an edge case rather than asserting it is the "right"
  // one - changing it is a real design decision, not a bug fix, and out of
  // scope for a test written to describe what already ships.
  ok('a room with no id, with hereId also unset, reads as here (null === null)',
    roomKind(room({ id: null }), null, new Set()) === 'here')
}

console.log('\n-- onRoute is checked by id, not by reference or truthiness --')
{
  const onRoute = new Set([2, 3, null])
  ok('a room whose id is in the set is on route', roomKind(room({ id: 3 }), null, onRoute) === 'route')
  ok('a room whose id is not in the set is not', roomKind(room({ id: 4 }), null, onRoute) === 'plain')
  // Same "null is a value like any other" property as above, from the other
  // input: onRoute is typed Set<number | null> because a route's own `to`
  // can be null, and Set.has(null) is true when null was actually inserted.
  // A room with id:null does match that - real behavior, not a guess, and
  // not expected to matter in practice since a room from live Lich data
  // always has a real id.
  // hereId is 99, not null, here - id:null must not also win via the
  // earlier `here` check (null === null), which is exactly the trap the
  // previous section is about. This isolates the onRoute check alone.
  ok("a room with a null id matches onRoute's own null entry, if it has one",
    roomKind(room({ id: null }), 99, onRoute) === 'route')
}

// --- the docstring's own numbers, checked against the shipped data ----------
//
// `mapData.ts` opens by saying how much cartography ships. It said 90 zones,
// 18,490 rooms and 44,864 exits; the data holds 85, 17,750 and 42,866, and had
// for long enough that nobody knows when it stopped being true. A docstring is
// read far more often than it is verified, which is what makes a stale one
// worse than none: it spends the reader's attention and teaches them the file
// lies.
//
// The claim is parsed out of the comment and compared to the files. Written
// this way round deliberately - the prose stays the thing a person reads, and
// this is what stops it drifting, rather than replacing it with a generated
// line nobody would read at all.
{
  const { readFileSync, readdirSync } = await import('node:fs')
  const source = readFileSync('src/lib/mapData.ts', 'utf8')
  const claim = /(\d[\d,]*) zones, (\d[\d,]*) rooms, (\d[\d,]*) exits/.exec(source)
  const num = (s) => Number(String(s).replace(/,/g, ''))

  ok('the module still states how much cartography ships', claim !== null)
  if (claim) {
    const files = readdirSync('src/data/map').filter((f) => f.endsWith('.json') && f !== 'index.json')
    let rooms = 0
    let exits = 0
    for (const f of files) {
      const zone = JSON.parse(readFileSync(`src/data/map/${f}`, 'utf8'))
      const raw = zone.rooms ?? zone
      const list = Array.isArray(raw) ? raw : Object.values(raw)
      rooms += list.length
      for (const r of list) exits += (r.moves ?? r.exits ?? []).length
    }
    // A floor first. An empty data directory would make the walk silent, and
    // silence would read as a measurement rather than as a broken instrument.
    ok('there is cartography to count', files.length > 50 && rooms > 1000, `${files.length} zones, ${rooms} rooms`)
    ok('the zone count in the docstring is real', num(claim[1]) === files.length, `says ${claim[1]}, is ${files.length}`)
    ok('the room count in the docstring is real', num(claim[2]) === rooms, `says ${claim[2]}, is ${rooms}`)
    ok('the exit count in the docstring is real', num(claim[3]) === exits, `says ${claim[3]}, is ${exits}`)
  }
}

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 10, `${ran} assertions`)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
