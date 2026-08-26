/**
 * Build the searchable list of named places, from the zone files already built.
 *
 *   node tools/build-places.mjs
 *
 * Built from src/data/map/*.json rather than from C:\Genie4\Maps, so it runs on
 * a checkout with no Genie install. tools/build-map.mjs is the one that needs
 * the source cartography; this is a second pass over what that produced.
 *
 * An index exists at all because the alternative is loading 85 zone files to
 * answer one keystroke. Together they are 3.7 MB, almost all of it exits and
 * coordinates the search never looks at, and the app would have to fetch every
 * one of them the first time somebody typed "ba". The index is 106 KB.
 *
 * Zone names are stored once in a lookup rather than repeated on every place.
 * "Northern Trade Road" against 3,174 rows is a large share of the file
 * otherwise, and this is fetched on the first keystroke, where a wait shows.
 *
 * Written beside bestiary.json rather than into src/data/map, which was tried
 * first and broke three unrelated tools on the spot. Four separate places read
 * that directory with `readdirSync` and treat every file in it as a zone; a
 * file with no `rooms` array is a TypeError in each of them, and two of the
 * four are in the art pipeline where nobody would connect the failure to a
 * search index. The directory means "one file per zone" and that is worth more
 * than the tidiness of keeping map things together.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'src/data/map'
const OUT = 'src/data/places.json'

const zones = {}
const places = []

for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.json') || file === 'index.json') continue
  const zone = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  zones[zone.id] = zone.name

  for (const room of zone.rooms) {
    if (!room.label) continue
    // 1,973 of the 3,174 places carry no alias, so the slot is left off rather
    // than written as an empty array that many times.
    const entry = [zone.id, room.id, room.label]
    if (room.aliases?.length) entry.push(room.aliases)
    places.push(entry)
  }
}

// Sorted by name, which costs nothing here and makes the file diffable. Without
// it the order follows readdir and a rebuild on another machine looks like a
// rewrite of the whole thing.
places.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]) || a[1] - b[1])

writeFileSync(OUT, JSON.stringify({ zones, places }))

const aliases = places.reduce((n, p) => n + (p[3]?.length ?? 0), 0)
const bytes = readFileSync(OUT).length
console.log(
  `${places.length.toLocaleString()} places, ${aliases.toLocaleString()} aliases, ` +
    `${Object.keys(zones).length} zones, ${(bytes / 1024).toFixed(0)} KB`
)
