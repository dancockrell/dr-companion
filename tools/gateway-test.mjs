/**
 * Cross-zone gateways, tested against the built map.
 *
 * Genie's arcs only point inside their own file, so for the whole life of this
 * project every zone was an island: 85 maps, none of them connected to any
 * other, and 810 arcs that lead somewhere were being dropped by a line of code
 * calling them "a one-way the cartographer never followed".
 *
 * The links are real and they were in the data all along, in the notes. This
 * test exists because nothing about their absence looked like a failure — the
 * map drew fine, the gates were visible, and clicking one simply did nothing.
 */
import { readFileSync, readdirSync } from 'node:fs'

let failed = 0
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(52)}${detail}`)
}

/**
 * Nothing in the set is bad, AND the set was not empty.
 *
 * "None of them are wrong" is true of nothing at all. Every assertion here is
 * of that shape, so all of them would pass against a map that failed to build
 * - which is the state this suite exists to catch. Proving the work happened
 * is as important as proving it found nothing.
 */
const noneOf = (name, bad, total, atLeast, detail = '') => {
  if (total < atLeast) {
    failed++
    console.log(`FAIL ${name.padEnd(52)}only ${total} to check, expected ${atLeast}+`)
    return
  }
  ok(name, bad === 0, `${total} checked${detail ? ', ' + detail : ''}`)
}

const DIR = 'src/data/map'
const zones = new Map()
const zoneFiles = readdirSync(DIR).filter((f) => f !== 'index.json')
for (const f of zoneFiles) {
  const z = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
  zones.set(z.id, z)
}

const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'))

const rooms = [...zones.values()].flatMap((z) => z.rooms.map((r) => ({ z, r })))
const gates = rooms.filter(({ r }) => r.gateway)

console.log('-- the gateways exist at all --')
ok('the map has zones', zones.size > 50, `${zones.size}`)
ok('gateways were resolved', gates.length > 250, `${gates.length} of ${rooms.length} rooms`)

console.log('\n-- every shipped zone and room is structurally usable --')
{
  const fileIds = new Set(zoneFiles.map((f) => f.replace(/\.json$/, '')))
  const indexIds = new Set(index.map((z) => z.id))
  ok('zone index covers every map file', fileIds.size === indexIds.size && [...fileIds].every((id) => indexIds.has(id)), `${indexIds.size}`)
  ok('every indexed zone has a map file', [...indexIds].every((id) => fileIds.has(id)))

  const badIndex = index.filter((entry) => {
    const zone = zones.get(entry.id)
    return !zone || entry.name !== zone.name || entry.rooms !== zone.rooms.length
  })
  noneOf('index names and room counts match zone files', badIndex.length, index.length, 50)

  const duplicateRooms = []
  const brokenExits = []
  for (const zone of zones.values()) {
    const ids = new Set()
    for (const room of zone.rooms) {
      if (ids.has(room.id)) duplicateRooms.push(`${zone.id}:${room.id}`)
      ids.add(room.id)
    }
    for (const room of zone.rooms) {
      for (const exit of room.exits ?? []) {
        if (!ids.has(exit.to)) brokenExits.push(`${zone.id}:${room.id}->${exit.to}`)
      }
    }
  }
  noneOf('no zone contains duplicate room ids', duplicateRooms.length, rooms.length, 17000, duplicateRooms.slice(0, 3).join(', '))
  const exits = rooms.reduce((sum, { r }) => sum + (r.exits?.length ?? 0), 0)
  noneOf('every internal exit reaches a real room', brokenExits.length, exits, 40000, brokenExits.slice(0, 3).join(', '))
}

console.log('\n-- every gateway points at a zone that exists --')
{
  const dangling = gates.filter(({ r }) => !zones.has(r.gateway.zone))
  noneOf('no gateway points nowhere', dangling.length, gates.length, 250,
    dangling.slice(0, 3).map(({ r }) => `${r.id}->${r.gateway.zone}`).join(', '))

  const selfref = gates.filter(({ z, r }) => r.gateway.zone === z.id)
  noneOf('no gateway points at its own zone', selfref.length, gates.length, 250)

  const unnamed = gates.filter(({ r }) => !r.gateway.name)
  noneOf('every gateway carries a name to show', unnamed.length, gates.length, 250)
}

console.log('\n-- the note is consumed, not shipped --')
{
  // The raw note was a build-time scratch field. Shipping it would put a
  // filename in the app bundle 17,750 times.
  const leaked = rooms.filter(({ r }) => 'note' in r)
  noneOf('no room ships its raw note', leaked.length, rooms.length, 17000)

  const filenameLabels = rooms.filter(({ r }) => /\.xml/i.test(r.label ?? ''))
  noneOf('no room is labelled with a filename', filenameLabels.length, rooms.length, 17000)
}

console.log('\n-- Crossing, which is the zone anyone will check first --')
{
  const crossing = zones.get('1')
  ok('Crossing is present', !!crossing)
  const cg = (crossing?.rooms ?? []).filter((r) => r.gateway)
  ok('Crossing has gates out', cg.length > 5, `${cg.length}`)

  const targets = new Set(cg.map((r) => r.gateway.name))
  // The four gates and the trade road are the routes every character uses.
  for (const want of ['Crossing East Gate', 'Crossing West Gate', 'Crossing North Gate', 'Northern Trade Road']) {
    ok(`reaches ${want}`, targets.has(want))
  }
}

console.log('\n-- gates lead somewhere you can come back from --')
{
  // Not every gate is reciprocal and that is fine, but a map where none were
  // would mean the resolution is matching the wrong direction.
  const reciprocal = gates.filter(({ z, r }) => {
    const far = zones.get(r.gateway.zone)
    return far?.rooms.some((o) => o.gateway?.zone === z.id)
  })
  ok('most gates have a way back', reciprocal.length > gates.length * 0.5,
    `${reciprocal.length} of ${gates.length}`)

  const withArrivals = gates.filter(({ r }) => r.gateway.arrivals?.length)
  ok('reciprocal gates carry arrival context', withArrivals.length === reciprocal.length,
    `${withArrivals.length} gateways with reciprocal arrival rooms`)
  const badArrivals = gates.filter(({ z, r }) => (r.gateway.arrivals ?? []).some((id) => {
    const target = zones.get(r.gateway.zone)
    const arrival = target?.rooms.find((candidate) => candidate.id === id)
    return !arrival || arrival.gateway?.zone !== z.id
  }))
  noneOf('every arrival room exists and explicitly leads back', badArrivals.length, withArrivals.length, 200)
}

console.log('\n-- every zone is reachable through the map UI --')
{
  const neighbors = new Map([...zones.keys()].map((id) => [id, new Set()]))
  for (const { z, r } of gates) {
    neighbors.get(z.id).add(r.gateway.zone)
    neighbors.get(r.gateway.zone).add(z.id)
  }
  const seen = new Set()
  const stack = ['1']
  while (stack.length) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    for (const next of neighbors.get(id) ?? []) stack.push(next)
  }
  ok('ordinary gateway graph covers the main world', seen.size >= 75, `${seen.size} of ${zones.size}`)

  /**
   * Every zone the gateway graph cannot reach from Crossing, and why.
   *
   * This used to be an INFO line, and #175 is what an INFO line costs. Its
   * finding 2 read zone 33a's 48 rooms, found no exit out of any of them, and
   * concluded the cartography had a hole in it. The cartography is fine.
   * `Map33a_Road_to_Therenborough.xml` names two destinations in its notes -
   * `Map33_Riverhaven_West_Gate.xml` and `Map34_Mistwood_Forest.xml` - and
   * neither file is in this machine's Genie install, so `build-map.mjs` cannot
   * turn either note into a gateway. A zone whose doors lead to maps nobody
   * shipped and a zone with no doors at all produce the same silence here, and
   * the difference is the difference between a missing download and a bug.
   *
   * So the reason is recorded per zone, and the set is asserted in both
   * directions. Losing a route is the failure everyone expects; a zone
   * quietly gaining one matters just as much, because it means this table has
   * stopped describing the map and the next reader will trust it anyway.
   */
  const UNREACHABLE = {
    '997': 'arena instance: the source sheet carries no cross-file note at all',
    '999': 'teleport instance: the source sheet carries no cross-file note at all',
    TF990: 'festival sheet: the source sheet carries no cross-file note at all',
    '90e': 'closed in the source cartography: no cross-file note at all',
    '99a': 'closed in the source cartography: no cross-file note at all',
    '33a': 'doors exist; Map33_Riverhaven_West_Gate.xml and Map34_Mistwood_Forest.xml are not in this Genie install',
    '14d': 'doors exist; Map7c_NTR_Part2.xml is not in this Genie install',
  }
  const special = [...zones.keys()].filter((id) => !seen.has(id))
  const expected = Object.keys(UNREACHABLE)
  const newlyIsolated = special.filter((id) => !(id in UNREACHABLE))
  const nowConnected = expected.filter((id) => !special.includes(id))
  ok('no zone lost its way out of the world', newlyIsolated.length === 0,
    `${special.length} unreachable, ${expected.length} expected${newlyIsolated.length ? '; new: ' + newlyIsolated.join(', ') : ''}`)
  ok('every zone recorded as unreachable still is', nowConnected.length === 0,
    nowConnected.length ? `now connected, drop from the table: ${nowConnected.join(', ')}` : `${expected.length} still unreachable`)
  for (const id of expected.filter((x) => special.includes(x))) {
    console.log(`INFO   ${id.padEnd(6)}${UNREACHABLE[id]}`)
  }

  const mapIndex = readFileSync('src/lib/mapZoneIndex.ts', 'utf8')
  const search = readFileSync('src/components/shared/PlaceSearch.tsx', 'utf8')
  const panel = readFileSync('src/components/shared/MapPanel.tsx', 'utf8')
  const window = readFileSync('src/components/MapWindow.tsx', 'utf8')
  const browsing = readFileSync('src/lib/useZoneBrowsing.ts', 'utf8')
  ok('all-zone browser is populated from the shipped index', mapIndex.includes('export const ZONE_INDEX') && search.includes('ZONE_INDEX.map'))
  ok('docked and popped-out maps expose all-zone browsing', panel.includes('<PlaceSearch here={zone.zone} onPick={goToPlace} onZone={pushZone} />') && window.includes('<PlaceSearch here={zone?.zone} onPick={goToPlace} onZone={pushZone} />'))
  ok('zone transitions load before changing the visible stack', browsing.indexOf("beginZoneLoad(id, 'browse'") < browsing.indexOf('setZoneStack((st) => [...st, id])'))
  ok('zone transitions expose failure and retry state', browsing.includes('zoneLoadError') && browsing.includes('retryZone'))
}

console.log('\n-- the leaving exits that identified them are kept --')
{
  const withLeaves = rooms.filter(({ r }) => r.leaves?.length)
  ok('rooms record how you leave the zone', withLeaves.length > 100, `${withLeaves.length}`)
  const empty = withLeaves.filter(({ r }) => r.leaves.some((x) => !x))
  noneOf('no leaving exit is blank', empty.length, withLeaves.length, 100)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
