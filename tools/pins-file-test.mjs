/**
 * pinsFile.ts's pure YAML layer - pinsToYaml/yamlToPins - and, since Q5, its
 * file layer as well. Round-trip fidelity and whether a malformed file
 * degrades one bad entry rather than the whole import are the same "storage
 * survives garbage already in it" standard pins-test.mjs holds mapPins.ts's
 * own localStorage layer to.
 *
 * # The file layer, and where the seam is
 *
 * `exportPinsToFile`/`readPinsImportPreview` used to be untestable here: they
 * wrapped a Genie write and could only be exercised inside the desktop app.
 * Q5 moved them onto `playerFiles.ts`, which is compiled and loaded here **for
 * real** - the stub is one level lower, at `tauri.js`'s `invokeTauri`, which
 * is precisely the boundary to the Rust side. So the spy sits on the Rust
 * command, and everything above it is the shipping code.
 *
 * Below that seam is a faithful fake of `src-tauri/src/player_files.rs`
 * against a temp directory: it is not a second implementation of anything the
 * app runs, it is the test double for a process boundary. The Rust side's own
 * guarantees (atomic rename, backup-once, the compare-and-swap, the leaf
 * refusal) are tested in `cargo test player_files`. What is tested here is
 * what only the TypeScript can get wrong: whether the export reads
 * immediately before it writes and passes what it read, and whether anything
 * still reaches for a Genie path.
 *
 * Same transpile-and-stub trick as pins-test.mjs, extended with a stub
 * mapPins.js so pinsFile.ts's import of PIN_COLORS/PIN_ICONS/loadAllPins/
 * replaceAllPins resolves without pulling in localStorage or profiles.ts at
 * all - this file never touches either.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          // Let the compiler rewrite './x.ts' -> './x.js' rather than a regex
          // below. Six copies of that regex existed; one had learned about
          // explicit .ts extensions and five had not, so five suites broke the
          // day src/ adopted them (C14). tsc has owned this since 5.7.
          rewriteRelativeImportExtensions: true,
        },
      })
      .outputText
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

// The seam. `isTauri` and `invokeTauri` are the only two things stubbed, and
// they are the boundary to the Rust process - so `playerFiles.ts` itself is
// the real module, compiled below and exercised as it ships.
writeFileSync(
  join(dir, 'tauri.js'),
  [
    'export function isTauri(){ return globalThis.__drcTauri === true }',
    'export async function invokeTauri(cmd, args){ return globalThis.__drcInvoke(cmd, args) }',
    '',
  ].join('\n')
)
compile('src/lib/playerFiles.ts', 'playerFiles.js')

const jsYamlUrl = new URL('../node_modules/js-yaml/dist/js-yaml.mjs', import.meta.url).href
writeFileSync(pinsFilePath, readFileSync(pinsFilePath, 'utf8').replace("from 'js-yaml'", `from '${jsYamlUrl}'`))

const { applyPinsImport, exportPinsToFile, PINS_LEAF, pinsToYaml, previewPinsImport, readPinsImportPreview, undoLastPinsImport, yamlToPins } =
  await import(pathToFileURL(pinsFilePath).href)
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
// `provenance` is an authored field of MapPin since G9, and loadAllPins fills
// it in on read for anything written before it existed - so a fixture without
// it would make this comparison fail on the migration rather than on the undo.
const local = {
  hero: [
    { id: 'local-1', roomId: 1, zone: '1', label: 'Home', color: 'blue', note: 'mine', provenance: 'player', createdAt: 1 },
    { id: 'local-2', roomId: 2, zone: '1', label: 'Keep me', color: 'gold', provenance: 'player', createdAt: 2 },
    { id: 'corpse', roomId: 99, zone: '1', label: 'Your corpse', color: 'red', system: true, provenance: 'player', createdAt: 3 },
  ],
  untouched: [{ id: 'u', roomId: 8, zone: '', label: 'Other', color: 'green', provenance: 'player', createdAt: 1 }],
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

console.log('\n-- the file layer: where it lands, and what it never touches --')
// A faithful fake of src-tauri/src/player_files.rs against a temp directory
// standing in for app_data_dir()/config. See this file's header for why the
// seam is here and not higher up.
const appData = mkdtempSync(join(tmpdir(), 'pinsfile-appdata-'))
/** Every command that crossed the boundary, in order: `${cmd}` plus its leaf. */
const invoked = []
globalThis.__drcTauri = true
globalThis.__drcInvoke = async (cmd, args) => {
  invoked.push(`${cmd}:${args?.leaf ?? ''}`)
  const target = join(appData, args.leaf)
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null
  if (cmd === 'read_player_file') {
    // One-shot: the next read hands back a view of the file from before
    // another window wrote it. That is the only way to put the shipping
    // export on the losing side of the race - see the two-window case below.
    const stale = globalThis.__drcStaleRead
    if (stale !== undefined) {
      globalThis.__drcStaleRead = undefined
      return { path: target, text: stale, found: true, note: '' }
    }
    return { path: target, text: current ?? '', found: current !== null, note: current === null ? `No ${args.leaf} saved yet.` : '' }
  }
  if (cmd === 'adopt_genie_file') {
    return { adopted: false, from: '', path: target, note: '' }
  }
  if (cmd === 'write_player_file') {
    if (args.expectedPrevious !== undefined && (current ?? '') !== args.expectedPrevious) {
      throw new Error(`${args.leaf} changed since this window last read it - another window of this app, or a text editor, has written to it since.`)
    }
    if (current !== null && !existsSync(`${target}.bak`)) writeFileSync(`${target}.bak`, current)
    writeFileSync(target, args.text)
    return { path: target, backedUp: existsSync(`${target}.bak`) }
  }
  throw new Error(`unstubbed command ${cmd}`)
}

globalThis.__pinsStore = { hero: [{ id: 'f1', roomId: 11, zone: '1', label: 'Forge', color: 'gold', provenance: 'player', createdAt: 1 }] }
const first = await exportPinsToFile()
ok('the export lands in the app data folder, not a Genie one', first.path === join(appData, PINS_LEAF), first.path)
ok('and the file is really there afterwards - the call is not trusted for it', existsSync(join(appData, PINS_LEAF)))
ok('a first export has nothing to back up and says so', first.backedUp === false, String(first.backedUp))

// Second export over an existing file: the backup is the point of it.
globalThis.__pinsStore = { hero: [{ id: 'f2', roomId: 22, zone: '1', label: 'Bank', color: 'blue', provenance: 'player', createdAt: 2 }] }
const second = await exportPinsToFile()
ok('a second export reports the backup it left', second.backedUp === true, String(second.backedUp))
ok('and the backup file exists on disk, holding the pre-overwrite pins', readFileSync(join(appData, `${PINS_LEAF}.bak`), 'utf8').includes('Forge'))

// Two windows racing on one file. Window B holds a view taken before window A
// wrote; that is exactly the state expectedPrevious exists to refuse, and it
// is only reachable because the export reads immediately before it writes
// rather than acting on something it read earlier.
const windowBsView = readFileSync(join(appData, PINS_LEAF), 'utf8')

// Window A exports different pins, and succeeds - a refusal must be a refusal
// of the loser, not of everybody.
globalThis.__pinsStore = { hero: [{ id: 'a1', roomId: 33, zone: '1', label: 'Window A was here', color: 'red', provenance: 'player', createdAt: 3 }] }
let refusal = ''
try {
  await exportPinsToFile()
} catch (e) {
  refusal = String(e)
}
ok('the window that re-read before writing goes through', refusal === '', refusal)
ok('and its pins are the ones on disk', readFileSync(join(appData, PINS_LEAF), 'utf8').includes('Window A was here'))

// Window B now exports from its stale view, through the shipping
// `exportPinsToFile` rather than by poking the fake - so this reddens if
// pinsFile stops passing expectedPrevious. Without it the write simply
// succeeds and window A's export is gone with nothing to show for it.
globalThis.__pinsStore = { hero: [{ id: 'b1', roomId: 44, zone: '1', label: 'Window B was here', color: 'green', provenance: 'player', createdAt: 4 }] }
globalThis.__drcStaleRead = windowBsView
let clobbered = ''
try {
  await exportPinsToFile()
} catch (e) {
  clobbered = String(e)
}
ok('a second window exporting from a stale view is refused', clobbered.includes('changed since this window last read it'), clobbered || 'it was allowed to write')
ok('and the refusal names the file rather than an error code', clobbered.includes(PINS_LEAF), clobbered)
ok("and the refusal is real - the other window's export is still on disk", readFileSync(join(appData, PINS_LEAF), 'utf8').includes('Window A was here'))
ok("and window B's pins did not reach the file", !readFileSync(join(appData, PINS_LEAF), 'utf8').includes('Window B was here'))
// Control: the same window, same pins, no stale view - it must go through.
// Without this the refusal above is equally satisfied by an export that can
// never write at all.
await exportPinsToFile()
ok('control: window B succeeds once it has re-read - a refusal is recoverable', readFileSync(join(appData, PINS_LEAF), 'utf8').includes('Window B was here'))

// Whether the export passes an expectation at all, read off the shipping
// module rather than inferred from the fake's behaviour: a fake that only
// refuses when handed an expectation cannot, by itself, distinguish "the
// caller passed a good one" from "the caller passed none".
const shipped = readFileSync('src/lib/pinsFile.ts', 'utf8')
ok(
  'the export passes expectedPrevious, so two windows cannot clobber each other',
  /writePlayerFile\(PINS_LEAF, text, [^)]+\)/.test(shipped),
  shipped.match(/writePlayerFile\([^)]*\)/)?.[0] ?? 'no writePlayerFile call found'
)

// The property Q5 exists for. A spy over every command that crossed the
// boundary, with the positive control immediately after it: an empty list has
// no Genie writes in it for the same reason a correct one does.
const genie = invoked.filter((c) => /genie/i.test(c) && !c.startsWith('adopt_genie_file:'))
ok('no Genie write path was ever invoked', genie.length === 0, genie.join(', ') || 'none')
ok(
  'control: the spy did record the calls that were made',
  invoked.filter((c) => c.startsWith('write_player_file:')).length >= 2 &&
    invoked.some((c) => c === `read_player_file:${PINS_LEAF}`),
  `${invoked.length} call(s): ${invoked.join(', ')}`
)
ok(
  'control: and the spy would have seen a Genie write if one happened',
  (() => {
    const probe = [...invoked, 'write_genie_config:highlights.cfg']
    return probe.filter((c) => /genie/i.test(c) && !c.startsWith('adopt_genie_file:')).length === 1
  })()
)

// The migration runs before the read, once, and is the only thing that ever
// looks at a Genie folder.
invoked.length = 0
await readPinsImportPreview()
ok('the import adopts a pre-Q5 Genie file before reading', invoked[0] === `adopt_genie_file:${PINS_LEAF}`, invoked.join(', '))
ok('and then reads the app data copy, never the Genie one', invoked[1] === `read_player_file:${PINS_LEAF}`, invoked.join(', '))

globalThis.__drcTauri = false

console.log('\n-- positive control: this suite can actually fail --')
const { store: controlStore } = mustParse(pinsToYaml({ z: [{ id: 'a', roomId: 1, zone: '', label: 'X', color: 'blue', createdAt: 1 }] }))
ok('sabotage check: a genuinely present pin is detected as present', (controlStore.z ?? []).length === 1)

console.log('')
const total = pass + fail
// Far below the real count on purpose: a tripwire for a truncated or
// half-loaded run, not a regression test on the number of cases.
//
// This replaces an `ok(denom >= 15)` that stood here. Same intent, and the
// old shape was circular: the floor was itself a check, so it incremented
// the very denominator it was measuring, and it could only report as one
// more FAIL line among the rest rather than aborting the run naming the
// number. A floor has to sit outside what it counts.
const MIN_EXPECTED = 33
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
// `total`, not `pass`: the denominator has to be the number of checks that
// ran, or it shrinks by one per failure and reports a smaller suite on
// exactly the run where you need to know the size did not change.
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error('FAILED')
  process.exit(1)
}
console.log('all passed')
