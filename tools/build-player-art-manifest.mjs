/**
 * Rebuilds public/player-art/manifest.json from whatever webp files are
 * actually sitting in the folder — the same "the manifest asks the folder,
 * never the other way around" shape as install() in art-daemon.mjs and
 * loadArtManifest() in creatureArt.ts. Run this after merging a player-art
 * PR (or as part of CI) so a submitted file actually becomes visible without
 * a manual edit to a hand-maintained list.
 *
 *   node tools/build-player-art-manifest.mjs
 */
import { readdirSync, writeFileSync } from 'node:fs'

const DIR = 'public/player-art'

const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith('.webp'))
  .map((f) => f.replace(/\.webp$/i, ''))
  .sort()

writeFileSync(`${DIR}/manifest.json`, JSON.stringify(files, null, 1))
console.log(`${files.length} player portraits in the manifest`)
