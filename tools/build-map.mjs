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

/**
 * What kind of place a room is, read off its name.
 *
 * The cartography carries no tags, but the names are not decorative: 353 of
 * Crossing's 1,060 rooms say what they are. A map of identical boxes tells you
 * where you are and nothing else, and knowing which square is the bank is most
 * of what a map is for.
 *
 * Order matters. A guild healer is a guild first.
 */
const KINDS = [
  ['guild', /\bguild\b/i],
  ['healer', /\bhealer|empath|infirmary\b/i],
  ['bank', /\bbank\b|teller|money-?changer|exchange/i],
  ['temple', /\btemple|shrine|altar|chapel\b/i],
  ['gate', /\bgate\b|portcullis/i],
  ['bridge', /\bbridge\b|ferry|\bdock\b|\bpier\b/i],
  ['shop', /\bshop|store|market|emporium|smith|forge|apothecary|alchemist|tailor|jeweler|bakery|\binn\b|tavern/i],
  ['park', /\bpark\b|garden|grove|orchard/i],
]

/**
 * Classify on the part before the comma, and only for rooms you walk into.
 *
 * Naive matching on the whole name paints streets as venues: "The Crossing,
 * Bank Street" is a road, not a bank, and there are several of them. The names
 * are structured, and the structure is the answer. An establishment puts its
 * own name first ("First Provincial Bank, Lobby"); a street puts the town
 * first ("The Crossing, Bank Street").
 *
 * Requiring a `go` arc as well was tried and was worse: it is true of shops
 * but not of the bank, so it swapped false positives for false negatives and
 * lost every bank and guild in the game. The prefix alone is the rule.
 */
/**
 * The label a cartographer gave this room, if any.
 *
 * Pipe separated, most specific first: "Town Green|TGN|Wanted Board". The
 * first field is the name to draw; the rest are aliases worth keeping for
 * search but not for the map.
 *
 * Some notes are transport bookkeeping rather than places — they name another
 * map file — so those are dropped.
 */
function labelOf(note) {
  if (!note) return undefined
  const first = note.split('|')[0].trim()
  if (!first || /.xml$/i.test(first) || /^Mapd+/i.test(first)) return undefined
  return first
}

/** Every alias, for finding a place by a name a player actually types. */
function aliasesOf(note) {
  if (!note) return undefined
  const all = note
    .split('|')
    .map((x) => x.trim())
    .filter((x) => x && !/.xml$/i.test(x) && !/^Mapd+/i.test(x))
  return all.length > 1 ? all.slice(1) : undefined
}

/** The part after the comma: the street or place, which is how players say where they are. */
function placeOf(name) {
  const i = name.indexOf(',')
  return i >= 0 ? name.slice(i + 1).trim() : name.trim()
}

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
    // A string, not a number. Zone ids include 1a, 1j, 107a and TF1: the
    // sub-maps, which are the interiors and passages that hang off the main
    // zones. Parsing them as integers silently dropped 33 of 85 files,
    // including Crossing Thief Passages, Crossing Temple, Market Plaza and
    // the Seacaves.
    id: attr(zoneTag, 'id'),
    name: unescapeXml(attr(zoneTag, 'name') ?? ''),
    rooms: [],
  }

  const nodeRe = /<node\b([^>]*)>([\s\S]*?)<\/node>/g
  let m
  while ((m = nodeRe.exec(xml))) {
    const [, head, body] = m
    const pos = /<position\b([^>]*)\/>/.exec(body)?.[1] ?? ''

    const exits = []
    const leaves = []
    const arcRe = /<arc\b([^>]*)\/>/g
    let a
    while ((a = arcRe.exec(body))) {
      const t = a[1]
      const to = num(attr(t, 'destination'))
      // An arc with no destination is a one-way the cartographer never
      // followed. Drawing a line to nowhere is worse than drawing nothing.
      if (to === undefined || Number.isNaN(to)) {
        // An arc with no destination leaves the zone. Genie has nowhere to
        // point it because the far side lives in another file, and it was
        // being dropped as "a one-way the cartographer never followed" -
        // which is how 810 doors between zones became dead ends on our map.
        // Five arcs in the game carry neither a move nor an exit. They are
        // real doors the cartographer never wrote a direction for, and a blank
        // entry in the tooltip is worse than saying nothing.
        const how = unescapeXml(attr(t, 'move') || attr(t, 'exit') || '').trim()
        if (how) leaves.push(how)
        continue
      }
      exits.push({
        dir: attr(t, 'exit') ?? '',
        move: unescapeXml(attr(t, 'move') ?? ''),
        to,
      })
    }

    const name = unescapeXml(attr(head, 'name') ?? '')
    zone.rooms.push({
      id: num(attr(head, 'id')),
      name,
      label: labelOf(attr(head, 'note')),
      // The raw note, kept only until the second pass resolves gateways. A
      // note whose first segment is a map filename is a door out of this zone,
      // and the file it names cannot be turned into a zone id until every file
      // has been read.
      note: attr(head, 'note') || undefined,
      aliases: aliasesOf(attr(head, 'note')),
      // The cartographer's own colour. Their classification beats mine.
      color: attr(head, 'color'),
      place: placeOf(name),
      x: num(attr(pos, 'x')) ?? 0,
      y: num(attr(pos, 'y')) ?? 0,
      z: num(attr(pos, 'z')) ?? 0,
      exits,
      // How you leave the zone from here, if you can.
      leaves: leaves.length ? leaves : undefined,
    })
  }
  return zone
}

mkdirSync(OUT, { recursive: true })

const index = []
let rooms = 0
let arcs = 0
let tagged = 0

/**
 * Two passes, because a gateway names a file and the map needs a zone id.
 *
 * A room that leads out of its zone carries a note whose first segment is the
 * destination's filename: "Map31b_Maelshyve's_Fortress.xml|Maelshyve's
 * Fortress|Therengia". Turning that into something clickable means knowing
 * which zone id lives inside that file, and that is not known until every file
 * has been read. So pass one parses and pass two resolves and writes.
 *
 * Until now every zone was an island. You could see the door and there was
 * nothing on the other side of it.
 */
const parsed = []
for (const file of readdirSync(SRC).filter((f) => f.endsWith('.xml'))) {
  const zone = parseZone(readFileSync(join(SRC, file), 'utf8').replace(/^\uFEFF/, ''))
  if (!zone.id || !zone.rooms.length) continue
  parsed.push({ file, zone })
}

// Matched without the extension and case-insensitively: the notes and the
// directory listing do not reliably agree on either.
const fileKey = (f) => f.replace(/\.xml$/i, '').toLowerCase()
const byFile = new Map(parsed.map(({ file, zone }) => [fileKey(file), zone]))

let gateways = 0
let unresolved = 0

for (const { zone } of parsed) {
  for (const r of zone.rooms) {
    const first = (r.note ?? '').split('|')[0].trim()
    delete r.note
    if (!first || !/\.xml$/i.test(first)) continue

    const target = byFile.get(fileKey(first))
    if (!target) {
      // The note names a map this install does not have. Counted rather than
      // dropped in silence, because it is the difference between "the data has
      // no gateways" and "this Genie install is missing files".
      unresolved++
      continue
    }
    if (target.id === zone.id) continue

    r.gateway = { zone: target.id, name: target.name }
    gateways++
  }

  writeFileSync(join(OUT, `${zone.id}.json`), JSON.stringify(zone))
  rooms += zone.rooms.length
  arcs += zone.rooms.reduce((n, r) => n + r.exits.length, 0)
  tagged += zone.rooms.filter((r) => r.label).length
  index.push({ id: zone.id, name: zone.name, rooms: zone.rooms.length })
}

index.sort((a, b) => b.rooms - a.rooms)
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1))

console.log(`${index.length} zones, ${rooms.toLocaleString()} rooms, ${arcs.toLocaleString()} exits`)
console.log(`${tagged.toLocaleString()} rooms carry a cartographer's label`)
console.log('largest:')
for (const z of index.slice(0, 5)) console.log(`  ${String(z.rooms).padStart(5)}  ${z.name}`)
