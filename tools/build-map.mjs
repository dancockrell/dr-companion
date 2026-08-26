/**
 * Build the map the app draws, from the cartography already on this machine.
 *
 *   node tools/build-map.mjs
 *
 * C:\Genie4\Maps holds 90 zone files with everything an automapper needs:
 * node ids, names, descriptions, real x/y/z coordinates, and arcs carrying the
 * exit direction, the movement command and the destination node. There is no
 * reason to draw a placeholder diagram when this is sitting on disk.
 *
 * One file per zone rather than one big one. Crossing alone is 1,060 rooms and
 * a player is only ever in one zone, so loading 18,490 rooms to draw thirty of
 * them would be waste with no upside.
 *
 * Descriptions are deliberately left out. They are 20 MB across the set, the
 * map does not draw them, and room art already carries them.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'C:/Genie4/Maps'
const OUT = 'src/data/map'

const attr = (tag, name) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag)
  return m ? m[1] : undefined
}
const num = (v) => (v === undefined ? undefined : Number(v))

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

function parseZone(xml) {
  const zoneTag = /<zone\b[^>]*>/.exec(xml)?.[0] ?? ''
  const zone = {
    id: num(attr(zoneTag, 'id')),
    name: unescapeXml(attr(zoneTag, 'name') ?? ''),
    rooms: [],
  }

  const nodeRe = /<node\b([^>]*)>([\s\S]*?)<\/node>/g
  let m
  while ((m = nodeRe.exec(xml))) {
    const [, head, body] = m
    const pos = /<position\b([^>]*)\/>/.exec(body)?.[1] ?? ''

    const exits = []
    const arcRe = /<arc\b([^>]*)\/>/g
    let a
    while ((a = arcRe.exec(body))) {
      const t = a[1]
      const to = num(attr(t, 'destination'))
      // An arc with no destination is a one-way the cartographer never
      // followed. Drawing a line to nowhere is worse than drawing nothing.
      if (to === undefined || Number.isNaN(to)) continue
      exits.push({
        dir: attr(t, 'exit') ?? '',
        move: unescapeXml(attr(t, 'move') ?? ''),
        to,
      })
    }

    zone.rooms.push({
      id: num(attr(head, 'id')),
      name: unescapeXml(attr(head, 'name') ?? ''),
      x: num(attr(pos, 'x')) ?? 0,
      y: num(attr(pos, 'y')) ?? 0,
      z: num(attr(pos, 'z')) ?? 0,
      exits,
    })
  }
  return zone
}

mkdirSync(OUT, { recursive: true })

const index = []
let rooms = 0
let arcs = 0

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.xml'))) {
  const zone = parseZone(readFileSync(join(SRC, file), 'utf8').replace(/^\uFEFF/, ''))
  if (zone.id === undefined || !zone.rooms.length) continue

  writeFileSync(join(OUT, `${zone.id}.json`), JSON.stringify(zone))
  rooms += zone.rooms.length
  arcs += zone.rooms.reduce((n, r) => n + r.exits.length, 0)
  index.push({ id: zone.id, name: zone.name, rooms: zone.rooms.length })
}

index.sort((a, b) => b.rooms - a.rooms)
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1))

console.log(`${index.length} zones, ${rooms.toLocaleString()} rooms, ${arcs.toLocaleString()} exits`)
console.log('largest:')
for (const z of index.slice(0, 5)) console.log(`  ${String(z.rooms).padStart(5)}  ${z.name}`)
