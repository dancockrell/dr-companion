/**
 * The metadata half of the NPC pile: which installed file is which role,
 * race and gender, so a future keyword match ("an unknown merchant") has
 * something to search. public/npcs/manifest.json (written by the daemon's
 * own install()) is just a flat filename list, same as portraits/creatures
 * — this adds the tags on top without touching that shared code.
 *
 *   node tools/build-npc-tags.mjs
 *
 * Safe to re-run any time; it only reads the prompt file and the installed
 * manifest, both already on disk.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

if (!existsSync('public/npcs/manifest.json')) {
  console.log('public/npcs/manifest.json does not exist yet — nothing installed')
  process.exit(0)
}

const prompts = JSON.parse(readFileSync('data/art/npc-prompts.json', 'utf8'))
const installed = JSON.parse(readFileSync('public/npcs/manifest.json', 'utf8'))

const tags = {}
let missing = 0
for (const file of installed) {
  const key = file.replace(/\.webp$/, '')
  const entry = prompts[key]
  if (!entry) {
    missing++
    continue
  }
  tags[file] = { tags: entry.tags, role: entry.role, race: entry.race, gender: entry.gender }
}

writeFileSync('public/npcs/tags.json', JSON.stringify(tags, null, 1))
console.log(`${Object.keys(tags).length} tagged, ${missing} installed files had no matching prompt entry`)
