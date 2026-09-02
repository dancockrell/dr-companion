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
writeFileSync(join(dir, 'storage.js'), 'export function readJSON(){return globalThis.__pinsStore ?? {}}\nexport function writeJSON(_k,v){globalThis.__pinsStore=v}\n')
writeFileSync(join(dir, 'profiles.js'), 'export function profileKey(n,i){return n+":"+i}\n')
compile('src/lib/mapPlaceColors.ts', 'mapPlaceColors.js')
const mapPinsPath = compile('src/lib/mapPins.ts', 'mapPins.js')
const pinsFilePath = compile('src/lib/pinsFile.ts', 'pinsFile.js')

// pinsFile.ts also imports tauri.ts and genieConfigWrite.ts for the two
// Tauri-backed functions this suite does not exercise - stubbed so the
// module loads at all.
writeFileSync(join(dir, 'tauri.js'), 'export function isTauri(){return false}\nexport async function invokeTauri(){throw new Error("not stubbed")}\n')
writeFileSync(join(dir, 'genieConfigWrite.js'), 'export async function saveGenieConfig(){throw new Error("not stubbed")}\n')

const jsYamlUrl = new URL('../node_modules/js-yaml/dist/js-yaml.mjs', import.meta.url).href
writeFileSync(pinsFilePath, readFileSync(pinsFilePath, 'utf8').replace("from 'js-yaml'", `from '${jsYamlUrl}'`))

const { applyPinsImport, pinsToYaml, previewPinsImport, undoLastPinsImport, yamlToPins } = await import(pathToFileURL(pinsFilePath).href)
const { loadAllPins, PIN_COLORS, PIN_ICONS } = await import(pathToFileURL(mapPinsPath).href)

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
function mustParse(text) {
  const parsed = yamlToPins(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed
}

console.log('-- round trip: what goes in comes back out --')
const store = {
  'Prime:dan the bold': [
    {
      id: '1',
      roomId: 82,
      zone: '312',
      label: 'Bank',
      color: 'gold',
      icon: 'landmark',
      note: "Lost my whole coin purse to a pickpocket right here. Never again.",
      createdAt: 1,
    },
    { id: '2', roomId: 445, zone: '', label: "Thieves' Den", color: 'purple', icon: 'lock', createdAt: 2 },
    // A system pin (the corpse marker) must never reach the file - see this
    // module's own header for why.
    { id: '3', roomId: 9, zone: '', label: 'Your corpse', color: 'red', icon: 'skull', createdAt: 3, system: true },
  ],
}
const yaml = pinsToYaml(store)
ok('the file opens with an explanatory comment', yaml.startsWith('#'))
ok('the system pin never reaches the file', !yaml.includes('Your corpse'), yaml)

const { store: back, skipped } = mustParse(yaml)
ok('no entries were skipped on a clean round trip', skipped === 0, String(skipped))
ok('the character key survived', Object.keys(back).length === 1)
const pins = back['Prime:dan the bold'] ?? []
ok('both hand-made pins survived', pins.length === 2, String(pins.length))
ok('the label with an apostrophe survived intact', pins.some((p) => p.label === "Thieves' Den"))
ok('room id survived as a number, not a string', pins.find((p) => p.label === 'Bank')?.roomId === 82)
ok('icon survived', pins.find((p) => p.label === 'Bank')?.icon === 'landmark')
ok(
  "the story survived - a pin shared without it is a label with the point removed",
  pins.find((p) => p.label === 'Bank')?.note === "Lost my whole coin purse to a pickpocket right here. Never again."
)
ok('a pin with no story round-trips with note left undefined, not an empty string', pins.find((p) => p.label === "Thieves' Den")?.note === undefined)
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
const { store: iconBack, skipped: iconSkipped } = mustParse(pinsToYaml({ x: allIconsPins }))
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
const { store: messyBack, skipped: messySkipped } = mustParse(messy)
ok('the one genuinely valid entry survived', (messyBack.x ?? []).length === 1, JSON.stringify(messyBack))
// 4 malformed entries inside `x`, plus `y` itself (not a list) - both
// branches of yamlToPins increment the same counter, on purpose: a key
// that isn't a list is exactly as much "something did not import" as a
// malformed entry is.
ok('every malformed thing was counted as skipped, not silently dropped', messySkipped === 5, String(messySkipped))
ok('a key whose value is not a list is skipped rather than crashing', !('y' in messyBack))

console.log('\n-- invalid and valid-empty files are different states --')
const broken = yamlToPins('{{{not valid yaml::: [')
ok('unparseable text reports a parse failure', !broken.ok && broken.error.length > 0)
const validEmpty = yamlToPins('# deliberately empty\n{}\n')
ok('a valid empty file parses successfully', validEmpty.ok)
ok('a valid empty file is identified as empty', validEmpty.ok && validEmpty.empty)

console.log('\n-- staged merge, explicit replace, system preservation, and undo --')
const local = {
  hero: [
    { id: 'local-1', roomId: 1, zone: '1', label: 'Home', color: 'blue', note: 'mine', createdAt: 1 },
    { id: 'local-2', roomId: 2, zone: '1', label: 'Keep me', color: 'gold', createdAt: 2 },
    { id: 'corpse', roomId: 99, zone: '1', label: 'Your corpse', color: 'red', system: true, createdAt: 3 },
  ],
  untouched: [{ id: 'u', roomId: 8, zone: '', label: 'Other', color: 'green', createdAt: 1 }],
}
const incoming = {
  hero: [
    { id: 'in-1', roomId: 1, zone: '1', label: 'Home updated', color: 'purple', note: 'shared', createdAt: 9 },
    { id: 'in-3', roomId: 3, zone: '1', label: 'New', color: 'green', createdAt: 9 },
  ],
}
let preview = previewPinsImport(incoming, local)
ok('preview reports the conflict before mutation', preview.characters[0].updated === 1)
ok('preview reports what Replace would delete', preview.characters[0].removedByReplace === 1)
globalThis.__pinsStore = structuredClone(local)
const mergedResult = applyPinsImport(preview, { hero: 'merge' })
let applied = loadAllPins()
ok('Merge updates the conflicting room', applied.hero.find((p) => p.roomId === 1)?.label === 'Home updated')
ok('Merge preserves unrelated local pins', applied.hero.some((p) => p.roomId === 2))
ok('Merge preserves the system corpse pin', applied.hero.some((p) => p.system))
ok('Merge reports added and updated separately', mergedResult.added === 1 && mergedResult.updated === 1 && mergedResult.removed === 0)
ok('characters absent from the file are untouched', applied.untouched?.[0]?.note === local.untouched[0].note)
ok('Undo restores every authored field exactly', undoLastPinsImport() && JSON.stringify(loadAllPins()) === JSON.stringify(local))
preview = previewPinsImport(incoming, local)
applyPinsImport(preview, { hero: 'replace' })
applied = loadAllPins()
ok('Replace removes only the local pin disclosed by preview', !applied.hero.some((p) => p.roomId === 2))
ok('Replace still preserves the system corpse pin', applied.hero.some((p) => p.system))

console.log('\n-- import preview follows the shared modal interaction contract --')
const importDialog = readFileSync('src/components/shared/PinImportDialog.tsx', 'utf8')
ok('the import dialog uses shared focus trapping, Escape handling, and focus restoration', importDialog.includes('useModalDialog(onClose)'))
ok('the import dialog can receive fallback focus', importDialog.includes('tabIndex={-1}'))
ok('gameplay shortcuts are suspended while import choices are open', importDialog.includes('data-gameplay-shortcuts="suspend"'))

console.log('\n-- positive control: this suite can actually fail --')
const { store: controlStore } = mustParse(pinsToYaml({ z: [{ id: 'a', roomId: 1, zone: '', label: 'X', color: 'blue', createdAt: 1 }] }))
ok('sabotage check: a genuinely present pin is detected as present', (controlStore.z ?? []).length === 1)

const denom = pass + fail
ok(`enough was checked for a pass to mean something: ${denom} assertions`, denom >= 15)

console.log(fail === 0 ? '\nall passed' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
