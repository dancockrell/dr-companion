/**
 * Room descriptions, split by zone so they can be loaded on demand.
 *
 *   node tools/build-room-text.mjs
 *
 * 17,736 of the game's 17,750 rooms have a written description, mined off
 * Elanthipedia for the art prompts. That is 5.1 MB of prose, which is far too
 * much to hold in the bundle and exactly the right amount to have on disk: the
 * room column wants the text for one room at a time, and the player is in one
 * zone at a time.
 *
 * So it is written the same way the map is, one file per zone, fetched when
 * the zone changes and cached after that. Crossing is the largest at 351 KB
 * and every other zone is smaller.
 *
 * This is a stopgap and worth being honest about. The game itself prints the
 * room description on arrival, and once the bridge forwards that, the live
 * text should win: it knows about weather, time of day, and whatever is
 * currently on fire. What this gives is a description for every room in
 * Elanthia including the ones the character has never walked into, which is
 * what the column needs in order not to be empty.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const IN = 'data/art/room-prompts.json'
const OUT = 'public/roomtext'

const prompts = JSON.parse(readFileSync(IN, 'utf8'))

const zones = new Map()
for (const [key, v] of Object.entries(prompts)) {
  if (!v.zone) continue
  if (!zones.has(v.zone)) zones.set(v.zone, {})
  zones.get(v.zone)[key] = {
    title: v.title ?? null,
    // The description, and nothing else from the prompt file. The prompt text
    // itself is instructions to a model and would read as nonsense to a
    // player; the lore is what the wiki says the room looks like.
    text: v.lore ?? null,
  }
}

mkdirSync(OUT, { recursive: true })

let rooms = 0
let bytes = 0
const index = []
for (const [zone, entries] of zones) {
  const json = JSON.stringify(entries)
  writeFileSync(join(OUT, `${zone}.json`), json)
  rooms += Object.keys(entries).length
  bytes += json.length
  index.push({ zone, rooms: Object.keys(entries).length, kb: Math.round(json.length / 1024) })
}

index.sort((a, b) => b.rooms - a.rooms)
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 1))

console.log(`${zones.size} zones, ${rooms.toLocaleString()} rooms, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
console.log('largest:')
for (const z of index.slice(0, 5)) console.log(`  ${String(z.rooms).padStart(5)} rooms  ${String(z.kb).padStart(4)} KB  zone ${z.zone}`)
