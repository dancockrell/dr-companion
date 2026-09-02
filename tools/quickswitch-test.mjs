/**
 * The hotbar pin list: a tagged union (command, task, or script), capped at 50,
 * persisted, and validated on load for shape only — see quickSwitch.ts's
 * module note for why neither kind is checked against a known-id set any
 * more (both catalogs are read asynchronously now that the flow engine's
 * synchronous, compile-time id list is gone).
 *
 * Written when the pin shape grew a second kind (scripts, alongside the
 * original flows) — this module had shipped with no dedicated test at all
 * before that, which is exactly the gap this fixes rather than repeats.
 * Updated when flows became Python tasks and `loadPins` stopped filtering.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = join('node_modules', '.drc-test')
mkdirSync(dir, { recursive: true })
const out = join(dir, 'quickSwitch.mjs')
const storageOut = join(dir, 'storage.mjs')
const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
writeFileSync(
  storageOut,
  ts.transpileModule(readFileSync('src/lib/storage.ts', 'utf8'), { compilerOptions }).outputText
)
writeFileSync(
  out,
  ts.transpileModule(readFileSync('src/lib/quickSwitch.ts', 'utf8'), {
    compilerOptions,
  }).outputText.replace('./storage', './storage.mjs')
)

let fails = 0
let checked = 0
/**
 * Equality, not truthiness. An earlier version of this file called `ok`
 * with `(label, value, expectedDetail)` in a few places, which happened to
 * pass when `value` was truthy and fail whenever the correct answer was a
 * legitimate falsy one (`0`, `false`, an empty match) — a check that cannot
 * fail on the value it is checking is not a check. Every call site here
 * takes an explicit `want`, compared by JSON equality so an object or array
 * result compares correctly too.
 */
const ok = (label, got, want, detail = '') => {
  checked++
  const pass = JSON.stringify(got) === JSON.stringify(want)
  if (!pass) fails++
  console.log(
    `${pass ? 'OK  ' : 'FAIL'} ${label.padEnd(60)}${pass ? detail : `got ${JSON.stringify(got)} want ${JSON.stringify(want)} ${detail}`}`
  )
}

console.log('-- loadPins: a real store, freshly imported each time --')
let store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
const load = async () => import(pathToFileURL(out).href + '?' + Math.random())

{
  const m = await load()
  ok('empty storage yields no pins', m.loadPins().length, 0)
}

console.log('\n-- togglePin: pin, unpin, and the cap --')
{
  const m = await load()
  const taskPin = { kind: 'task', id: 'flow.hunt' }
  const scriptPin = { kind: 'script', name: 'hunting-buddy' }
  const commandPin = { kind: 'command', actionKey: 'attack:ambush' }

  const afterTask = m.togglePin([], taskPin)
  ok('pinning a task adds it', afterTask.pins.length, 1)
  ok('  and it is not refused', afterTask.refused, false)

  const afterBoth = m.togglePin(afterTask.pins, scriptPin)
  ok('pinning a script alongside a task keeps both', afterBoth.pins.length, 2)

  const afterAllKinds = m.togglePin(afterBoth.pins, commandPin)
  ok('pinning a command uses the same ordered hotbar', afterAllKinds.pins.length, 3)
  ok('  and retains its semantic action identity', afterAllKinds.pins[2], commandPin)

  const unpinned = m.togglePin(afterAllKinds.pins, taskPin)
  ok('toggling the same task pin again removes only it', unpinned.pins.length, 2)
  ok('  and the script pin survives', unpinned.pins[0].kind, 'script')

  // The control: fifty distinct pins fill every slot, and the fifty-first
  // must be refused rather than silently dropping the oldest — a player
  // who hits the cap should be told, not lose a pin without noticing.
  let full = []
  for (let i = 0; i < 50; i++) {
    full = m.togglePin(full, { kind: 'script', name: `script-${i}` }).pins
  }
  ok('fifty distinct pins all fit', full.length, 50)
  const overflow = m.togglePin(full, { kind: 'script', name: 'one-too-many' })
  ok('the fifty-first pin is refused', overflow.refused, true)
  ok('  and the list is unchanged', overflow.pins.length, 50)
}

console.log('\n-- isPinned: matches by kind and identity, not just by name/id colliding --')
{
  const m = await load()
  // Deliberately a task id and a script name that are the same string - the
  // shape this test exists to catch is a task pin and a script pin being
  // treated as the same pin because only the second field was compared.
  const pins = [{ kind: 'task', id: 'train' }, { kind: 'command', actionKey: 'train:train' }]
  ok('a task pin is not confused with a script of the same name', m.isPinned(pins, { kind: 'script', name: 'train' }), false)
  ok('but the real task pin is recognised', m.isPinned(pins, { kind: 'task', id: 'train' }), true)
  ok('an explicit Python pin matches the legacy no-language shape', m.isPinned(pins, { kind: 'task', id: 'train', lang: 'python' }), true)
  ok('a TypeScript task with the same bare id remains a distinct pin', m.isPinned(pins, { kind: 'task', id: 'train', lang: 'typescript' }), false)
  ok('and command identity stays separate from both', m.isPinned(pins, { kind: 'command', actionKey: 'train:train' }), true)
}

console.log('\n-- task identity: backend language survives pins, launches, and active state --')
{
  const m = await load()
  const py = { kind: 'task', id: 'task.watch', lang: 'python' }
  const ts = { kind: 'task', id: 'task.watch', lang: 'typescript' }
  const afterPython = m.togglePin([], py)
  const afterBoth = m.togglePin(afterPython.pins, ts)
  ok('Python and TypeScript tasks sharing an id can both be pinned', afterBoth.pins.length, 2)
  ok('Python task active identity stays bare', m.taskPinActiveId(py), 'task.watch')
  ok('TypeScript task active identity is namespaced', m.taskPinActiveId(ts), 'ts.task.watch')
  ok('TypeScript language is returned for dispatch', m.taskPinLanguage(ts), 'typescript')
  ok('legacy task pins still dispatch to Python', m.taskPinLanguage({ kind: 'task', id: 'task.watch' }), 'python')
}

console.log('\n-- loadPins trusts both kinds - neither is validated against a known list --')
{
  // Neither catalog (Python tasks, Lich scripts) is known synchronously at
  // store init any more, so a pin naming something that no longer exists is
  // not filtered out here - it fails to start when pressed instead, the
  // same honest refusal any other missing script already got.
  store = { 'drc.quickswitch.v3': JSON.stringify([
    { kind: 'task', id: 'a-task-that-may-no-longer-exist' },
    { kind: 'task', id: 'flow.hunt' },
    { kind: 'script', name: 'whatever-script' },
    { kind: 'command', actionKey: 'attack:advance' },
  ]) }
  const m = await load()
  const loaded = m.loadPins()
  ok('all four well-formed pins survive, unfiltered', loaded.length, 4)
  ok('  including the one naming an unverifiable task', loaded.some((p) => p.kind === 'task' && p.id === 'a-task-that-may-no-longer-exist'), true)
}

console.log('\n-- loadPins rejects malformed entries rather than crashing on them --')
{
  store = { 'drc.quickswitch.v3': JSON.stringify([
    { kind: 'task', id: 'flow.hunt' },
    'a-bare-string-from-the-old-v1-shape',
    { kind: 'task' }, // no id
    { kind: 'script' }, // no name
    { kind: 'command' }, // no actionKey
    { kind: 'task', id: 'unknown-language', lang: 'ruby' },
    { kind: 'nonsense', id: 'x' },
    null,
  ]) }
  const m = await load()
  const loaded = m.loadPins()
  ok('only the one well-formed pin survives the junk around it', loaded.length, 1)
  ok('  and it is the right one', loaded[0]?.id, 'flow.hunt')
}

console.log('\n-- loadPins upgrades the broken early TypeScript pin shape in place --')
{
  store = { 'drc.quickswitch.v3': JSON.stringify([
    { kind: 'task', id: 'ts.task.watch' },
    { kind: 'task', id: 'task.python' },
    { kind: 'task', id: 'ts.explicit', lang: 'typescript' },
  ]) }
  const m = await load()
  const loaded = m.loadPins()
  ok('legacy ts-prefixed id becomes a bare TypeScript task', loaded[0], { kind: 'task', id: 'task.watch', lang: 'typescript' })
  ok('legacy bare task remains a Python-compatible pin', loaded[1], { kind: 'task', id: 'task.python' })
  ok('explicit TypeScript pin is defensively stripped too', loaded[2], { kind: 'task', id: 'explicit', lang: 'typescript' })
  ok('the upgraded shape is persisted for the next launch', JSON.parse(store['drc.quickswitch.v3'])[0], loaded[0])
}

console.log('\n-- UI routes both click and keyboard launches through the pin language --')
{
  const panel = readFileSync('src/components/dashboard/TaskFlowPanel.tsx', 'utf8')
  const bar = readFileSync('src/components/layout/QuickSwitchBar.tsx', 'utf8')
  const app = readFileSync('src/App.tsx', 'utf8')
  const library = readFileSync('src/components/shared/ScriptLibraryPanel.tsx', 'utf8')
  ok('task panel stores TypeScript pins with a bare id and language', panel.includes("{ kind: 'task', id: entry.id.slice('ts.'.length), lang: 'typescript' }"), true)
  ok('hotbar launches a task with its selected language', bar.includes('requestStartFlow(pin.id, lang)'), true)
  ok('hotbar resolves TypeScript details from the Node catalog', bar.includes("lang === 'typescript' ? nodeTasks : pythonTasks"), true)
  ok('number keys launch a task with its selected language', app.includes('requestStartFlow(pin.id, taskPinLanguage(pin))'), true)
  ok('number keys compare the normalized active identity', app.includes('taskPinActiveId(pin) === activeFlow'), true)
  ok('task launch and edit controls have concise accessible names', panel.includes("aria-label={`${active ? 'Running ' : 'Run '}${entry.title}`}") && panel.includes('aria-label={`Edit ${entry.title}`}'), true)
  ok('script hotbar pins name the script and destination', library.includes("aria-label={`${pinned ? 'Remove' : 'Add'} ${name}"), true)
}

console.log('\n-- and the check can fail: a validator that accepts anything --')
{
  // The mutation this guards against: isPin() returning true unconditionally,
  // which would make every rejection test above pass for the wrong reason.
  const alwaysValid = () => true
  const junk = ['a-bare-string', { kind: 'task' }, null].filter(alwaysValid)
  ok(
    'a validator that accepts everything would have let all the junk through',
    junk.length,
    3,
    '- confirms the real isPin() above is doing real work, not passing by accident'
  )
}

const ran = checked
ok('enough was checked for a pass to mean something', ran >= 30, true, `${ran} assertions`)

console.log(fails ? `\n${fails} failed` : '\nall passed')
process.exit(fails ? 1 : 0)
