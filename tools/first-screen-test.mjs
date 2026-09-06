#!/usr/bin/env node
/**
 * The first screen is honest: no invented character before anybody asked.
 *
 * # What this is defending
 *
 * A real first run on a clean Windows VM finished the setup wizard and landed
 * on the main UI showing "In combat, 84 of 100 health", a character called
 * Dan the Bold, room 308 in the Empaths' Guild and eighteen people present -
 * on a machine that had never connected to anything. Recorded as defect 3 of
 * `docs/verification/first-run-2026-09-05.md`; issue #382.
 *
 * The cause was one line: `bridgeMode: 'mock'` among the persisted defaults,
 * so a profile with nothing stored started the mock bridge, which publishes a
 * complete invented world within a tick. The fix is `'live'` there plus one
 * selector that also honours an explicit `?bridge=` request.
 *
 * # Properties, not mechanism
 *
 * Every assertion below is written as the thing that must be true for a
 * person, not as the shape of the code that happens to make it true:
 *
 *   1. a fresh profile, with no request of any kind, opens on the real bridge;
 *   2. a stored demo preference is honoured, so a returning user gets what
 *      they left;
 *   3. an explicit `?bridge=` flag wins over the stored preference, which is
 *      what the dev server and the browser harnesses use now that they no
 *      longer get the demo for free by being the default;
 *   4. leaving the demo takes the invented character with it - the literal
 *      string "Dan the Bold" must not survive into the empty state;
 *   5. the demo, when it is on, says so in a sentence across the window, and
 *      that sentence is rendered only when the demo is on;
 *   6. the empty state offers the attach control and a way into the demo.
 *
 * 1 to 4 are executed, not read. 5 and 6 are source checks because App.tsx
 * cannot be imported outside Vite (`import.meta.glob` reaches it through the
 * store; see `src/lib/stateVersion.ts`'s header for the same limit).
 *
 * # Choosers are tested where the wrong answer is available
 *
 * Every selector case below names a state in which the *other* mode is the
 * plausible answer - a stored 'mock' with a `?bridge=live` flag, and the
 * reverse - so the test is of the choosing and not of the code running.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks tools/first-screen-test.mjs
 */
import { mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) {
    pass += 1
    console.log(`OK   ${label.padEnd(64)} ${detail ?? ''}`)
  } else {
    fail += 1
    console.log(`FAIL ${label.padEnd(64)} ${detail ?? ''}`)
  }
}

/**
 * A localStorage that is present but empty, which is exactly a fresh install.
 * Installed before `persistence.ts` is imported, since `storage.ts` reads the
 * global at call time and would otherwise take its "unavailable" branch and
 * hand back defaults for the wrong reason - a pass that proves nothing.
 */
const cell = new Map()
globalThis.localStorage = {
  getItem: (k) => (cell.has(k) ? cell.get(k) : null),
  setItem: (k, v) => cell.set(k, String(v)),
  removeItem: (k) => cell.delete(k),
  clear: () => cell.clear(),
}

/**
 * The bridge, stubbed, so `bridgeLifecycle.ts` can be executed here at all.
 * Its real import chain reaches `mapData.ts` and `import.meta.glob`, which
 * only Vite provides. Nothing in this file asserts anything about the stub:
 * it exists so the real `setBridgeMode` runs.
 */
mock.module('../src/bridge/index.ts', {
  namedExports: {
    bridge: {
      disconnect() {},
      setMode() {},
      getMode: () => 'live',
      connect() {},
      onMessage: () => () => {},
      onLiveStatus: () => () => {},
      getLiveStatus: () => 'disconnected',
    },
  },
})

const { selectBridgeMode } = await import('../src/lib/bridgeModeSelect.ts')
const { loadPrefs } = await import('../src/lib/persistence.ts')
const { setBridgeMode } = await import('../src/store/bridgeLifecycle.ts')

console.log('-- 1. a fresh profile opens on the real bridge --')
{
  cell.clear()
  const prefs = loadPrefs()
  ok(
    'nothing stored: the persisted preference is live',
    prefs.bridgeMode === 'live',
    `bridgeMode=${prefs.bridgeMode}`
  )
  ok(
    'nothing stored and no flag: the selected bridge is the real one',
    selectBridgeMode(prefs.bridgeMode, '') === 'live',
    selectBridgeMode(prefs.bridgeMode, '')
  )
  // The same claim stated as the absence it is really about. A first run must
  // not reach the mock bridge, whatever else is true.
  ok(
    'a fresh install never selects mock',
    selectBridgeMode(undefined, '') !== 'mock',
    selectBridgeMode(undefined, '')
  )
  ok(
    'an unrelated query string does not change that',
    selectBridgeMode(undefined, '?view=panel&id=map') === 'live'
  )
}

console.log('\n-- 2. a stored preference is honoured --')
{
  cell.clear()
  cell.set('dr-companion-prefs-v1', JSON.stringify({ bridgeMode: 'mock' }))
  const prefs = loadPrefs()
  ok('a stored demo preference survives a reload', prefs.bridgeMode === 'mock', prefs.bridgeMode)
  ok(
    'and it is what gets selected',
    selectBridgeMode(prefs.bridgeMode, '') === 'mock'
  )
  cell.clear()
  cell.set('dr-companion-prefs-v1', JSON.stringify({ bridgeMode: 'live' }))
  ok('a stored live preference survives too', loadPrefs().bridgeMode === 'live')
  cell.clear()
}

console.log('\n-- 3. an explicit flag wins over the stored preference --')
{
  // Both directions, each run against a stored value that disagrees with the
  // flag, so "the flag won" cannot be satisfied by the code doing nothing.
  ok(
    '?bridge=mock beats a stored live',
    selectBridgeMode('live', '?bridge=mock') === 'mock'
  )
  ok(
    '?bridge=live beats a stored mock',
    selectBridgeMode('mock', '?bridge=live') === 'live'
  )
  ok(
    '?bridge=mock beats a fresh profile',
    selectBridgeMode(undefined, '?bridge=mock') === 'mock'
  )
  ok(
    'the flag is read among others',
    selectBridgeMode(undefined, '?view=app&bridge=mock&x=1') === 'mock'
  )
  ok(
    'a value that is neither mode falls back to the preference',
    selectBridgeMode('mock', '?bridge=banana') === 'mock'
  )
  ok(
    'and to live when there is no preference either',
    selectBridgeMode(undefined, '?bridge=banana') === 'live'
  )
}

console.log('\n-- 4. leaving the demo takes the invented character with it --')
{
  // The state a person is actually in when they press "Leave the demo": the
  // mock world, fully populated, with the name from the first-run screenshot.
  let state = {
    bridgeMode: 'mock',
    bridgeConnected: true,
    character: { name: 'Dan the Bold', health: 84, situation: ['in_combat'] },
    characterAt: 1_725_000_000,
    scriptStates: [{ id: 'demo' }],
    runningScripts: ['demo'],
    logs: [],
  }
  const set = (patch) => {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  }
  const get = () => ({ ...state, addLog: (line) => state.logs.push(line) })
  let persisted = null

  setBridgeMode('live', set, get, (m) => {
    persisted = m
  })

  ok('the mode is now live', state.bridgeMode === 'live', state.bridgeMode)
  ok('the choice was persisted', persisted === 'live', String(persisted))
  ok('the character is gone', state.character === null, JSON.stringify(state.character))
  // The property, said as the thing a person would see. A field set to null
  // somewhere is not the same claim as the name being off the screen.
  ok(
    'no "Dan the Bold" survives anywhere in the state',
    !JSON.stringify(state).includes('Dan the Bold'),
    JSON.stringify(state).slice(0, 120)
  )
  ok('the invented script list is gone too', state.runningScripts.length === 0)
  ok('and the app is not claiming a connection', state.bridgeConnected === false)

  // Positive control on the instrument: the same search over the state as it
  // was before proves the needle was findable, so the pass above is a fact
  // about the code and not about a search that could never hit.
  ok(
    'control: the name was present before the switch',
    JSON.stringify({ character: { name: 'Dan the Bold' } }).includes('Dan the Bold')
  )

  // And the other direction: asking for the demo must actually select it.
  setBridgeMode('mock', set, get, (m) => {
    persisted = m
  })
  ok('asking for the demo selects it', state.bridgeMode === 'mock', state.bridgeMode)
  ok('and that choice persists as well', persisted === 'mock', String(persisted))
}

console.log('\n-- 5. while the demo is on, the window says so in a sentence --')
{
  const BANNER = 'Demo: this is invented data. Attach to Lich to see your character.'
  const banner = read('src/components/layout/DemoBanner.tsx')
  const app = read('src/App.tsx')

  ok('the banner carries the sentence verbatim', banner.includes(BANNER))
  ok('it offers a way out', /Leave the demo/.test(banner))
  ok(
    'and leaving it switches to live',
    /setBridgeMode\('live'\)/.test(banner)
  )
  ok('App renders the banner exactly once', (app.match(/<DemoBanner\s*\/>/g) ?? []).length === 1)
  ok(
    'and only when the demo is on',
    /bridgeMode === 'mock' && <DemoBanner \/>/.test(app),
    (app.match(/.{0,40}<DemoBanner \/>/) ?? [''])[0]
  )
  // Rendered nowhere else, unconditionally or otherwise: a second copy would
  // be a sentence that could appear over live data.
  const strayBanner = ['src/components/layout/TopBar.tsx', 'src/components/layout/AppControls.tsx']
    .filter((f) => read(f).includes(BANNER))
  ok('no other component prints it', strayBanner.length === 0, strayBanner.join(' '))
}

console.log('\n-- 6. the empty state says what to do next --')
{
  const waiting = read('src/components/shared/WaitingForCharacter.tsx')
  ok('it names attaching to Lich', /Attach to Lich/.test(waiting))
  ok(
    'the attach control the setup flow uses is on the screen',
    /<LichLauncher \/>/.test(waiting)
  )
  ok('the demo is offered by name', /Start the demo/.test(waiting))
  ok(
    'and asking for it sets the mode rather than just connecting',
    /setBridgeMode\('mock'\)/.test(waiting)
  )
  // The old wording was the tell that a button connected whatever bridge
  // happened to be selected. If it comes back, so has the bug.
  const stale = ['src/components/shared/WaitingForCharacter.tsx', 'src/components/dashboard/Dashboard.tsx']
    .filter((f) => read(f).includes('Open the demo dashboard'))
  ok('no demo button still relies on the old default', stale.length === 0, stale.join(' '))
  ok(
    'control: that phrase is findable when present',
    'x Open the demo dashboard y'.includes('Open the demo dashboard')
  )
}

console.log('\n-- 7. one selector, not two --')
{
  const selector = read('src/lib/bridgeModeSelect.ts')
  ok('the selector exists and exports the decision', /export function selectBridgeMode/.test(selector))
  const store = read('src/store/useAppStore.ts')
  ok(
    'the store gets its opening mode from it',
    /bridgeMode: initialBridgeMode\(prefs\.bridgeMode\)/.test(store)
  )
  ok(
    'and does not read the preference straight through any more',
    !/bridgeMode: prefs\.bridgeMode/.test(store)
  )
  const persistence = read('src/lib/persistence.ts')
  ok(
    'the persisted default is live',
    /^\s*bridgeMode: 'live',$/m.test(persistence),
    (persistence.match(/^\s*bridgeMode: '\w+',$/m) ?? [''])[0].trim()
  )
}

console.log(`\n${pass} checks passed, ${fail} failed`)

// The denominator, derived rather than typed: a throw or an early return
// halfway down otherwise looks exactly like a clean pass.
const source = readFileSync(new URL(import.meta.url), 'utf8')
const declared = [...source.matchAll(/^\s+ok\(/gm)].length
const ran = pass + fail
if (ran !== declared) {
  console.log(`FAIL ${ran} of ${declared} assertions in this file ran - the rest never executed`)
  process.exit(1)
}
console.log(`   all ${declared} assertions in the file ran`)
process.exit(fail === 0 ? 0 : 1)
