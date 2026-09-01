import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'scene-art-selection-'))
for (const source of ['roomArtOverrides', 'roomScenePatterns', 'grokRoomScenes']) {
  writeFileSync(join(dir, `${source}.mjs`), ts.transpileModule(readFileSync(`src/data/${source}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText)
}
writeFileSync(join(dir, 'demoInvasionRoom.mjs'), ts.transpileModule(readFileSync('src/data/demoInvasionRoom.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
let roomText = readFileSync('src/lib/roomText.ts', 'utf8')
  .replace("../data/roomArtOverrides'", "./roomArtOverrides.mjs'")
  .replace("../data/roomScenePatterns'", "./roomScenePatterns.mjs'")
  .replace("../data/grokRoomScenes'", "./grokRoomScenes.mjs'")
  .replace("../data/demoInvasionRoom'", "./demoInvasionRoom.mjs'")
writeFileSync(join(dir, 'roomText.mjs'), ts.transpileModule(roomText, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)

const { roomArtUrl } = await import(pathToFileURL(join(dir, 'roomText.mjs')).href)
const checks = [
  ['exact curated override wins', roomArtUrl('95', 175, 'Pokekehekepi korgi', 'dark shifting sands'), '/room-scenes/curated-pokekehekepi-korgi.webp'],
  ['Brambles uses the audited Magnific thicket', roomArtUrl('6', 26, 'Brambles', 'a scarred living thorn barricade'), '/room-scenes/curated-hostile-brambles.jpg'],
  ['Paasvadh Understory uses the audited Magnific forest', roomArtUrl('127', 186, 'Understory', 'bony limbs and rising mist'), '/room-scenes/curated-paasvadh-understory.jpg'],
  ['location pattern wins over broad fallback', roomArtUrl('1', 29, 'Clanthew Boulevard', 'a city street'), '/room-scenes/town-crossing-master.webp'],
  ['semantic fallback remains available', roomArtUrl('unmapped', 999, 'Unknown Forest', 'old trees'), '/room-scenes/master-forest-path.webp'],
  ['natural cave fallback is reviewed', roomArtUrl('unmapped', 1000, 'Dark Cavern', 'a rough underground cave'), '/room-scenes/master-natural-cavern.webp'],
  ['mountain fallback is reviewed', roomArtUrl('unmapped', 1001, 'Mountain Pass', 'a rocky ascent'), '/room-scenes/master-mountain-pass.webp'],
  ['tree-city fallback is reviewed', roomArtUrl('unmapped', 1002, 'Leth Deriel', 'treetop walks beneath the canopy'), '/room-scenes/town-leth-deriel-master.webp'],
]
let failures = 0
for (const [label, got, want] of checks) {
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${got}`)
}
process.exit(failures ? 1 : 0)
