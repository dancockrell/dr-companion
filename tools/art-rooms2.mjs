/**
 * Room art prompts, keyed to the map the app actually draws.
 *
 *   node tools/art-rooms2.mjs
 *
 * There were two parsers over the same files and they disagreed. The prompt
 * builder read the XML itself and fell back to the *filename* for a zone id
 * when a file had no zone tag; the map builder read the zone tag. The result
 * was 740 prompts keyed to rooms the app has never heard of — art that would
 * render, cost GPU time, and then never be found by anything.
 *
 * So this walks the built map, which is canonical because it is what the app
 * loads, and pulls each room's description out of the source XML by zone and
 * node. One id space, no reconciliation, and a prompt cannot exist for a room
 * that is not on the map.
 *
 * Descriptions live only in the XML: they are 20 MB across the game and the
 * map files are loaded in the browser, so they are deliberately not carried
 * there.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { NEGATIVE } from './art-safety.mjs'
import { join } from 'node:path'

const MAPS = 'C:/Genie4/Maps'
const BUILT = 'src/data/map'
const OUT = 'data/art/room-prompts.json'

/** Identical to the creature style, minus the studio framing a room cannot use. */
const STYLE =
  'painterly digital illustration, muted naturalistic palette, soft directional ' +
  'light, atmospheric depth, painted texture, wide establishing shot, no people, ' +
  'no text, no watermark, consistent fantasy realism'


function seedOf(key) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/**
 * Descriptions by node id, for one zone.
 *
 * A room with a day and a night look carries two; the first is used and the
 * rest counted, because one room is one image.
 */
function describeZone(xml) {
  const out = new Map()
  let extra = 0
  for (const m of xml.matchAll(/<node\b([^>]*)>([\s\S]*?)<\/node>/g)) {
    const id = Number((/id="(\d+)"/.exec(m[1]) ?? [])[1])
    if (!Number.isFinite(id)) continue
    const all = [...m[2].matchAll(/<description>([\s\S]*?)<\/description>/g)]
    if (!all.length) continue
    if (all.length > 1) extra += all.length - 1
    out.set(id, unescapeXml(all[0][1]).replace(/\s+/g, ' ').trim())
  }
  return { out, extra }
}

// Which source file holds which zone, by reading the zone tag rather than the
// filename. The filename is where the two parsers diverged.
const fileByZone = new Map()
for (const f of readdirSync(MAPS).filter((n) => n.endsWith('.xml'))) {
  const xml = readFileSync(join(MAPS, f), 'utf8').replace(/^\uFEFF/, '')
  const id = (/<zone\b[^>]*\bid="([^"]*)"/.exec(xml) ?? [])[1]
  if (id) fileByZone.set(id, xml)
}

const prompts = {}
let described = 0
let titleOnly = 0
let variants = 0

for (const file of readdirSync(BUILT).filter((f) => f !== 'index.json')) {
  const zone = JSON.parse(readFileSync(join(BUILT, file), 'utf8'))
  const xml = fileByZone.get(zone.id)
  if (!xml) continue

  const { out: descriptions, extra } = describeZone(xml)
  variants += extra

  for (const room of zone.rooms) {
    const key = `${zone.id}-${room.id}`
    const lore = descriptions.get(room.id)
    if (lore) described++
    else titleOnly++

    // The description is the scene. Where there is none, the room name is all
    // there is, and a name like "The Crossing, Magen Road" still says street.
    const subject = lore ? lore : room.name

    prompts[key] = {
      source: lore ? 'description' : 'name',
      zone: zone.id,
      zoneName: zone.name,
      room: room.id,
      title: room.name,
      lore: lore ?? null,
      prompt: [subject, STYLE].join(', '),
      negative: NEGATIVE,
      seed: seedOf(key),
      width: 1344,
      height: 768,
    }
  }
}

mkdirSync('data/art', { recursive: true })
writeFileSync(OUT, JSON.stringify(prompts))

const total = Object.keys(prompts).length
console.log(`${total.toLocaleString()} rooms, all keyed to the built map`)
console.log(`  ${described.toLocaleString()} carry a description, ${titleOnly.toLocaleString()} are name only`)
console.log(`  ${variants.toLocaleString()} extra day/night descriptions dropped`)

// Prove the thing this file exists to fix, rather than asserting it.
if (existsSync(join(BUILT, 'index.json'))) {
  const mapRooms = readdirSync(BUILT)
    .filter((f) => f !== 'index.json')
    .reduce((n, f) => n + JSON.parse(readFileSync(join(BUILT, f), 'utf8')).rooms.length, 0)
  console.log(
    total === mapRooms
      ? `  matches the map exactly (${mapRooms.toLocaleString()})`
      : `  MISMATCH: map has ${mapRooms.toLocaleString()}`
  )
}
