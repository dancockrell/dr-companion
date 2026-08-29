/**
 * pinsFile.ts's pure YAML layer: pinsToYaml/yamlToPins. Not the Tauri-backed
 * exportPinsToFile/importPinsFromFile - those are thin wrappers around
 * invokeTauri/saveGenieConfig, and can only be verified for real inside the
 * desktop app. What lives here is where correctness risk actually is:
 * round-trip fidelity, and whether a malformed file degrades one bad entry
 * rather than the whole import - the same "storage survives garbage
 * already in it" standard pins-test.mjs holds mapPins.ts's own localStorage
 * layer to.
 *
 * Same transpile-and-stub trick as pins-test.mjs, extended with a stub
 * mapPins.js so pinsFile.ts's import of PIN_COLORS/PIN_ICONS/loadAllPins/
 * replaceAllPins resolves without pulling in localStorage or profiles.ts at
 * all - this file never touches either.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'pinsfile-'))
const compile = (src, name) => {
  const out = join(dir, name)
  writeFileSync(
    out,
    ts
      .transpileModule(readFileSync(src, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from '(\.\/[^']+)'/g, (_, r) => `from '${r}.js'`)
  )
  return out
}

// Real mapPins.ts, so PIN_COLORS/PIN_ICONS are the actual live lists - a
// preset added there and not here would otherwise go unnoticed.
writeFileSync(join(dir, 'storage.js'), 'export function readJSON(){return {}}\nexport function writeJSON(){}\n')
writeFileSync(join(dir, 'profiles.js'), 'export function profileKey(n,i){return n+":"+i}\n')
const mapPinsPath = compile('src/lib/mapPins.ts', 'mapPins.js')
const pinsFilePath = compile('src/lib/pinsFile.ts', 'pinsFile.js')

// pinsFile.ts also imports tauri.ts and genieConfigWrite.ts for the two
// Tauri-backed functions this suite does not exercise - stubbed so the
// module loads at all.
writeFileSync(join(dir, 'tauri.js'), 'export function isTauri(){return false}\nexport async function invokeTauri(){throw new Error("not stubbed")}\n')
writeFileSync(join(dir, 'genieConfigWrite.js'), 'export async function saveGenieConfig(){throw new Error("not stubbed")}\n')

const jsYamlUrl = new URL('../node_modules/js-yaml/dist/js-yaml.mjs', import.meta.url).href
writeFileSync(pinsFilePath, readFileSync(pinsFilePath, 'utf8').replace("from 'js-yaml'", `from '${jsYamlUrl}'`))

const { pinsToYaml, yamlToPins } = await import(pathToFileURL(pinsFilePath).href)
const { PIN_COLORS, PIN_ICONS } = await import(pathToFileURL(mapPinsPath).href)

let pass = 0
let fail = 0
function ok(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`OK   ${label}`)
  } else {
    fail++
    console.log(`FAIL ${label}${detail ? ` (${detail})` : ''}`)
  }
}

console.log('-- round trip: what goes in comes back out --')
const store = {
  'Prime:dan the bold': [
    { id: '1', roomId: 82, zone: '312', label: 'Bank', color: 'gold', icon: 'landmark', createdAt: 1 },
    { id: '2', roomId: 445, zone: '', label: "Thieves' Den", color: 'purple', icon: 'lock', createdAt: 2 },
    // A system pin (the corpse marker) must never reach the file - see this
    // module's own header for why.
    { id: '3', roomId: 9, zone: '', label: 'Your corpse', color: 'red', icon: 'skull', createdAt: 3, system: true },
  ],
}
const yaml = pinsToYaml(store)
ok('the file opens with an explanatory comment', yaml.startsWith('#'))
ok('the system pin never reaches the file', !yaml.includes('Your corpse'), yaml)

const { store: back, skipped } = yamlToPins(yaml)
ok('no entries were skipped on a clean round trip', skipped === 0, String(skipped))
ok('the character key survived', Object.keys(back).length === 1)
const pins = back['Prime:dan the bold'] ?? []
ok('both hand-made pins survived', pins.length === 2, String(pins.length))
ok('the label with an apostrophe survived intact', pins.some((p) => p.label === "Thieves' Den"))
ok('room id survived as a number, not a string', pins.find((p) => p.label === 'Bank')?.roomId === 82)
ok('icon survived', pins.find((p) => p.label === 'Bank')?.icon === 'landmark')
ok('color survived', pins.find((p) => p.label === 'Bank')?.color === 'gold')
ok('zone survived when present', pins.find((p) => p.label === 'Bank')?.zone === '312')

console.log('\n-- every preset icon/colour this app ships round-trips too --')
const allIconsPins = PIN_ICONS.map((icon, i) => ({
  id: String(i),
  roomId: i,
  zone: '',
  label: `Room ${icon}`,
  color: PIN_COLORS[i % PIN_COLORS.length],
  icon,
  createdAt: i,
}))
const { store: iconBack, skipped: iconSkipped } = yamlToPins(pinsToYaml({ x: allIconsPins }))
ok(
  `all ${PIN_ICONS.length} icons round-trip with none skipped`,
  iconSkipped === 0 && (iconBack.x ?? []).length === PIN_ICONS.length,
  `${(iconBack.x ?? []).length}/${PIN_ICONS.length}, ${iconSkipped} skipped`
)

console.log('\n-- garbage in the file degrades that entry, not the whole import --')
const messy = `
x:
  - label: Good
    room: 5
    color: blue
  - label: ""
    room: 6
  - room: 7
    color: blue
  - label: Also good
    room: not-a-number
  - notEvenAnObject
y: "just a string, not a list"
`
const { store: messyBack, skipped: messySkipped } = yamlToPins(messy)
ok('the one genuinely valid entry survived', (messyBack.x ?? []).length === 1, JSON.stringify(messyBack))
// 4 malformed entries inside `x`, plus `y` itself (not a list) - both
// branches of yamlToPins increment the same counter, on purpose: a key
// that isn't a list is exactly as much "something did not import" as a
// malformed entry is.
ok('every malformed thing was counted as skipped, not silently dropped', messySkipped === 5, String(messySkipped))
ok('a key whose value is not a list is skipped rather than crashing', !('y' in messyBack))

console.log('\n-- sabotage: not-YAML-at-all must degrade to empty, not throw --')
try {
  const { store: brokenStore, skipped: brokenSkipped } = yamlToPins('{{{not valid yaml::: [')
  ok('unparseable text yields an empty store', Object.keys(brokenStore).length === 0)
  ok('and reports nothing skipped, rather than crashing (that is the point)', brokenSkipped === 0)
} catch (e) {
  ok('unparseable text must not throw', false, String(e))
}

console.log('\n-- positive control: this suite can actually fail --')
const { store: controlStore } = yamlToPins(pinsToYaml({ z: [{ id: 'a', roomId: 1, zone: '', label: 'X', color: 'blue', createdAt: 1 }] }))
ok('sabotage check: a genuinely present pin is detected as present', (controlStore.z ?? []).length === 1)

const denom = pass + fail
ok(`enough was checked for a pass to mean something: ${denom} assertions`, denom >= 15)

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
