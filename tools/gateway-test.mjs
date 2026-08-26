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

const DIR = 'src/data/map'
const zones = new Map()
for (const f of readdirSync(DIR)) {
  if (f === 'index.json') continue
  const z = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'))
  zones.set(z.id, z)
}

const rooms = [...zones.values()].flatMap((z) => z.rooms.map((r) => ({ z, r })))
const gates = rooms.filter(({ r }) => r.gateway)

console.log('-- the gateways exist at all --')
ok('the map has zones', zones.size > 50, `${zones.size}`)
ok('gateways were resolved', gates.length > 250, `${gates.length} of ${rooms.length} rooms`)

console.log('\n-- every gateway points at a zone that exists --')
{
  const dangling = gates.filter(({ r }) => !zones.has(r.gateway.zone))
  ok('no gateway points nowhere', dangling.length === 0,
    dangling.slice(0, 3).map(({ r }) => `${r.id}->${r.gateway.zone}`).join(', '))

  const selfref = gates.filter(({ z, r }) => r.gateway.zone === z.id)
  ok('no gateway points at its own zone', selfref.length === 0, `${selfref.length}`)

  const unnamed = gates.filter(({ r }) => !r.gateway.name)
  ok('every gateway carries a name to show', unnamed.length === 0, `${unnamed.length}`)
}

console.log('\n-- the note is consumed, not shipped --')
{
  // The raw note was a build-time scratch field. Shipping it would put a
  // filename in the app bundle 17,750 times.
  const leaked = rooms.filter(({ r }) => 'note' in r)
  ok('no room ships its raw note', leaked.length === 0, `${leaked.length}`)

  const filenameLabels = rooms.filter(({ r }) => /\.xml/i.test(r.label ?? ''))
  ok('no room is labelled with a filename', filenameLabels.length === 0, `${filenameLabels.length}`)
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
}

console.log('\n-- the leaving exits that identified them are kept --')
{
  const withLeaves = rooms.filter(({ r }) => r.leaves?.length)
  ok('rooms record how you leave the zone', withLeaves.length > 100, `${withLeaves.length}`)
  const empty = withLeaves.filter(({ r }) => r.leaves.some((x) => !x))
  ok('no leaving exit is blank', empty.length === 0, `${empty.length}`)
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
