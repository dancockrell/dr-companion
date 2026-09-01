import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'room-art-overrides-'))
const out = join(dir, 'roomArtOverrides.mjs')
writeFileSync(out, ts.transpileModule(readFileSync('src/data/roomArtOverrides.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const { roomArtOverride } = await import(pathToFileURL(out).href)
const expected = [
  ['95', 175, '/room-scenes/curated-pokekehekepi-korgi.webp'],
  ['7', 8, '/room-scenes/curated-underwater-marsh-channel.webp'],
  ['112', 155, '/room-scenes/curated-underwater-marsh-channel.webp'],
  ['127', 435, '/room-scenes/curated-north-wind-catacombs.webp'],
  ['127', 505, '/room-scenes/curated-north-wind-catacombs.webp'],
  ['106', 117, '/room-scenes/curated-seord-fal.webp'],
  ['1', 295, '/room-scenes/curated-crossing-sewer.webp'],
  ['66', 446, '/room-scenes/curated-maelshyves-ascent.webp'],
  ['4', 140, '/room-scenes/curated-hunting-preserve-grasslands.webp'],
  ['4', 340, '/room-scenes/curated-rain-grooved-outcrop.webp'],
  ['98', 25, '/room-scenes/curated-shadaer-jama.webp'],
  ['40a', 187, '/room-scenes/curated-duvli-rinu.webp'],
]
let failures = 0
for (const [zone, room, want] of expected) {
  const got = roomArtOverride(zone, room)
  const ok = got === want
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${zone}-${room}: ${got}`)
}
for (const [zone, room, forbidden] of [
  ['95', 174, '/room-scenes/curated-pokekehekepi-korgi.webp'],
  ['7', 64, '/room-scenes/curated-underwater-marsh-channel.webp'],
  ['127', 437, '/room-scenes/curated-north-wind-catacombs.webp'],
  ['106', 160, '/room-scenes/curated-seord-fal.webp'],
  ['1', 301, '/room-scenes/curated-crossing-sewer.webp'],
  ['66', 447, '/room-scenes/curated-maelshyves-ascent.webp'],
  ['4', 173, '/room-scenes/curated-hunting-preserve-grasslands.webp'],
  ['4', 329, '/room-scenes/curated-rain-grooved-outcrop.webp'],
  ['98', 26, '/room-scenes/curated-shadaer-jama.webp'],
  ['40a', 188, '/room-scenes/curated-duvli-rinu.webp'],
]) {
  const got = roomArtOverride(zone, room)
  const ok = got !== forbidden
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} boundary ${zone}-${room}: ${got}`)
}
const held = roomArtOverride('90', 734)
for (const room of [735, 736]) {
  const ok = roomArtOverride('90', room) === held
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} deterministic hold 90-${room}: ${roomArtOverride('90', room)}`)
}
{
  const ok = roomArtOverride('90', 737) !== held
  if (!ok) failures++
  console.log(`${ok ? 'OK  ' : 'FAIL'} deterministic advance 90-737: ${roomArtOverride('90', 737)}`)
}
process.exit(failures ? 1 : 0)
