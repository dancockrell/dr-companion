import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

let pass = 0
let fail = 0
function ok(label, condition) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  condition ? pass++ : fail++
}

const dir = mkdtempSync(join(tmpdir(), 'map-state-sync-'))
const compiled = join(dir, 'subscribedStorage.mjs')
writeFileSync(compiled, ts.transpileModule(readFileSync('src/lib/subscribedStorage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText)
const { subscribeStorageKey } = await import(pathToFileURL(compiled))

const target = new EventTarget()
let notifications = 0
const unsubscribe = subscribeStorageKey('pins', 'pins-changed', () => notifications++, target)
target.dispatchEvent(new Event('pins-changed'))
ok('same-document writes notify subscribers immediately', notifications === 1)
const otherKey = new Event('storage')
Object.defineProperty(otherKey, 'key', { value: 'other' })
target.dispatchEvent(otherKey)
ok('unrelated storage keys remain isolated', notifications === 1)
const pinsKey = new Event('storage')
Object.defineProperty(pinsKey, 'key', { value: 'pins' })
target.dispatchEvent(pinsKey)
ok('cross-document storage events refresh the matching store', notifications === 2)
unsubscribe()
target.dispatchEvent(new Event('pins-changed'))
ok('unmounted subscribers are detached', notifications === 2)

const pinsSource = readFileSync('src/lib/mapPins.ts', 'utf8')
const markerSource = readFileSync('src/lib/playerMarker.ts', 'utf8')
const mapWindow = readFileSync('src/components/MapWindow.tsx', 'utf8')
const mapPanel = readFileSync('src/components/shared/MapPanel.tsx', 'utf8')
ok('pin writes publish the same-document event', pinsSource.includes('dispatchEvent(new Event(MAP_PINS_CHANGED_EVENT))'))
ok('marker writes publish the same-document event', markerSource.includes('dispatchEvent(new Event(PLAYER_MARKER_CHANGED_EVENT))'))
ok('both map surfaces consume subscribed pin snapshots', [mapWindow, mapPanel].every((source) => source.includes('useMapPins(')))
ok('both map surfaces consume subscribed marker snapshots', [mapWindow, mapPanel].every((source) => source.includes('usePlayerMarker(')))
ok('manual render counters are gone', !`${mapWindow}${mapPanel}`.match(/pinVersion|markerVersion/))

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
