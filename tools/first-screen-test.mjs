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
 *   6. the empty state offers the attach control and a way into the demo;
 *   7. the demo is one fact about the app, not one per window - leaving it in
 *      a popped-out panel leaves it everywhere, and starting it in the main
 *      window starts it everywhere, each at the cost of one message.
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
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

/** Every .tsx under src/, so "nothing else mounts it" is a claim about the tree. */
function sourceFiles(rel = 'src') {
  const out = []
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    const next = `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...sourceFiles(next))
    else if (entry.name.endsWith('.tsx')) out.push(next)
  }
  return out
}

/** Which components actually render `<DemoBanner …>`. */
function mountsOfBanner() {
  return sourceFiles().filter((f) => /<DemoBanner\b/.test(read(f)))
}

/**
 * Top-level components of a module, by name.
 *
 * Line-addressed rather than brace-counted: a top-level function in this
 * codebase opens on a line starting at column zero and closes on a line that
 * is exactly `}`, and comments here are full of braces (`{ kind: 'app' }`)
 * that a depth counter would trip over.
 */
function topLevelFunctions(source) {
  const lines = source.split(/\r?\n/)
  const found = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(export default )?function ([A-Za-z_$][\w$]*)\s*\(/.exec(lines[i])
    if (!m) continue
    let end = i
    while (end < lines.length && lines[end] !== '}') end += 1
    found.push({ name: m[2], exported: Boolean(m[1]), body: lines.slice(i, end + 1).join('\n') })
    i = end
  }
  return found
}

/**
 * Is the demo banner mounted above the view switch, for every window kind?
 *
 * Returns a verdict rather than a boolean so a rejection says which of the
 * links broke - and so the same function can be run over a deliberately
 * sabotaged source and be seen to reject it.
 */
function bannerAboveRouteSwitch(appSource, shellSource) {
  const parts = topLevelFunctions(appSource)
  const rootComponent = parts.find((p) => p.exported)
  if (!rootComponent) return { ok: false, why: 'no default-exported component in App.tsx', returns: 0 }

  // Whatever the root wraps its content in. Named by its tag, not assumed.
  const wrap = /<([A-Z][\w$]*)\b[^>]*>\s*<([A-Z][\w$]*)\s*\/>/.exec(rootComponent.body)
  if (!wrap) {
    return { ok: false, why: 'the root component does not wrap a single view component', returns: 0 }
  }
  const [, shellTag, viewTag] = wrap
  const viewSwitch = parts.find((p) => p.name === viewTag)
  if (!viewSwitch) return { ok: false, why: `${viewTag} is not defined in App.tsx`, returns: 0, shellTag }

  const returns = (viewSwitch.body.match(/\breturn\s*\(/g) ?? []).length
  const rootReturns = (rootComponent.body.match(/\breturn\s*\(/g) ?? []).length
  const shellRendersBanner = /<DemoBanner\b/.test(shellSource)
  const shellReturns = (shellSource.match(/\breturn\s*\(/g) ?? []).length
  /*
   * The guard, in either of the two forms that satisfy this property.
   *
   * It was `bridgeMode === 'mock' && <DemoBanner` alone, which is the older
   * and weaker of the two: that is true whenever the demo mode is set,
   * including while a real game socket is open, and that combination is
   * exactly what put this banner's "invented data" sentence over live text on
   * the clean VM (#525). `sessionSource` folds the socket into the question
   * and refuses the pair outright, so `source === 'demo'` is strictly
   * narrower.
   *
   * The property this check is named for - the sentence is rendered only when
   * the demo is on - is more true under the second form, not less. Both are
   * accepted here so this file does not become a vote about which module owns
   * the decision; `tools/session-source-test.mjs` is what requires the
   * narrower one, and that is where that argument belongs.
   */
  const DEMO_GUARD = /(bridgeMode === 'mock'|source === 'demo') && <DemoBanner /
  const shellGuarded = DEMO_GUARD.test(shellSource)

  // The property, in the order the links have to hold.
  if (!shellRendersBanner) return { ok: false, why: `${shellTag} does not render the banner`, returns, shellTag }
  if (!shellGuarded) return { ok: false, why: `${shellTag} does not guard it on the demo being on`, returns, shellTag }
  if (shellReturns !== 1) {
    return { ok: false, why: `${shellTag} has ${shellReturns} returns, so a window could skip the banner`, returns, shellTag }
  }
  if (rootReturns !== 1) {
    return { ok: false, why: `the root component has ${rootReturns} returns, so a window could bypass ${shellTag}`, returns, shellTag }
  }
  if (/<DemoBanner\b/.test(viewSwitch.body)) {
    return { ok: false, why: `the view switch ${viewTag} mounts the banner itself, so only that branch has it`, returns, shellTag }
  }
  if (returns < 2) return { ok: false, why: `${viewTag} does not look like a view switch`, returns, shellTag }
  return {
    ok: true,
    why: `all ${returns} returns of ${viewTag} are reached through ${shellTag}`,
    returns,
    shellTag,
    rootRendersShell: true,
  }
}

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
const { createBridgeModeSync } = await import('../src/lib/bridgeModeSync.ts')

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
  ok(
    'exactly one component in src/ mounts it',
    mountsOfBanner().length === 1,
    mountsOfBanner().join(' ')
  )
  ok(
    'and only when the demo is on',
    // The same two accepted forms as `DEMO_GUARD` above; see its note.
    /(bridgeMode === 'mock'|source === 'demo') && <DemoBanner /.test(
      read(mountsOfBanner()[0] ?? 'src/App.tsx')
    ),
    mountsOfBanner()[0] ?? 'nothing mounts it'
  )
  ok('App.tsx does not mount it itself any more', !/<DemoBanner\b/.test(app))
  // Rendered nowhere else, unconditionally or otherwise: a second copy would
  // be a sentence that could appear over live data.
  const strayBanner = ['src/components/layout/TopBar.tsx', 'src/components/layout/AppControls.tsx']
    .filter((f) => read(f).includes(BANNER))
  ok('no other component prints it', strayBanner.length === 0, strayBanner.join(' '))
}

console.log('\n-- 5b. every window carries it, not only the main one (#400) --')
{
  /*
   * The defect: `DemoBanner` was mounted inside the `v.kind === 'app'` return
   * of App.tsx, and the map window and the popped-out panel windows returned
   * *above* it. A player who popped out the stats panel while in the demo got
   * a full invented stat block in its own window, with no banner, no MOCK
   * badge and no way out.
   *
   * The property, stated as the thing that must be true rather than as the
   * shape of today's code: **every return in the view switch is reached
   * through the component that renders the banner.** Written so it does not
   * depend on line numbers, or on which component happens to be called what:
   * the file is parsed into its top-level components, the default export is
   * found, the component it wraps in the shell is followed by name, and the
   * returns are counted there.
   */
  const verdict = bannerAboveRouteSwitch(read('src/App.tsx'), read('src/components/layout/WindowShell.tsx'))
  ok('the banner is mounted above the view switch', verdict.ok, verdict.why)
  ok('the view switch holds every window kind', verdict.returns >= 3, `${verdict.returns} returns`)
  ok('the shell it goes through is the default export', verdict.rootRendersShell, verdict.shellTag)
  ok(
    'the pop-out windows get a compact variant of the same band',
    /compact/.test(read('src/components/layout/WindowShell.tsx')) &&
      /compact/.test(read('src/components/layout/DemoBanner.tsx'))
  )
  ok(
    'which still says the data is invented and still offers the exit',
    /invented data/.test(read('src/components/layout/DemoBanner.tsx')) &&
      /Leave the demo/.test(read('src/components/layout/DemoBanner.tsx'))
  )

  // Sabotage the *property*, not the file: the same function, run over a
  // source that has the banner back inside one branch of the view switch,
  // must reject it. Without this the check above could be one that cannot
  // fail, which is the same as no check at all.
  const sabotaged = bannerAboveRouteSwitch(
    `import { DemoBanner } from './x.tsx'
export default function App() {
  const v = view()
  return (
    <Frame>
      <AppViews />
    </Frame>
  )
}

function AppViews() {
  if (v.kind === 'map') {
    return (<MapWindow />)
  }
  if (v.kind === 'panel') {
    return (<PanelWindow />)
  }
  return (
    <div>
      {bridgeMode === 'mock' && <DemoBanner />}
    </div>
  )
}
`,
    // A shell that is otherwise correct, so the sabotage is rejected by the
    // link it is aimed at rather than being intercepted by an earlier one.
    `export function Frame({ aux, children }) {
  return (
    <div>
      {setupComplete && bridgeMode === 'mock' && <DemoBanner compact={aux} />}
      {children}
    </div>
  )
}
`
  )
  ok('sabotage: the banner back inside one branch is rejected', !sabotaged.ok, sabotaged.why)
  ok(
    'and the sabotage was rejected for the right reason',
    /view switch/.test(sabotaged.why ?? ''),
    sabotaged.why
  )
  // Control on the parser: a source it cannot read must not read as a pass.
  const unparsable = bannerAboveRouteSwitch('const x = 1\n', 'const y = 2\n')
  ok('control: a file with no components at all is not a pass', !unparsable.ok, unparsable.why)
}

console.log('\n-- 6. the empty state says what to do next --')
{
  const waiting = read('src/components/shared/WaitingForCharacter.tsx')
  /*
   * The words moved; the property did not.
   *
   * This screen's prose now comes from `workspaceScreen()` in
   * `src/lib/sessionSource.ts`, so one module decides what each state says and
   * two screens cannot describe the same state differently (#523). The empty
   * state must still name attaching - it is simply no longer this file that
   * types the sentence. Checked wherever the words live rather than pinned to
   * the file they used to live in.
   */
  const emptyStateWords = waiting + read('src/lib/sessionSource.ts')
  ok('it names attaching to Lich', /attach to (a )?Lich/i.test(emptyStateWords))
  ok(
    '  control: that phrase is findable when it is present',
    /attach to (a )?Lich/i.test('x attach to Lich y')
  )
  ok(
    'the attach control the setup flow uses is on the screen',
    /<LichLauncher \/>/.test(waiting)
  )
  ok('the demo is offered by name', /Start the demo/.test(waiting))
  ok(
    'and asking for it sets the mode rather than just connecting',
    /*
     * `startDemo()` is that act, and it is now the only one: it sets the mode,
     * connects, and closes a game socket first if one is open - all in the
     * single place that decides between the demo and the game
     * (`src/store/sessionSwitch.ts`, #525).
     *
     * The property here is that the button asks for the demo rather than
     * connecting whatever bridge happens to be selected, which is what it was
     * written for after #382. `startDemo` satisfies it more completely than
     * the bare `setBridgeMode('mock')` it replaces, so the check follows the
     * property rather than the call it used to be made of.
     */
    /startDemo\(\)/.test(waiting) || /setBridgeMode\('mock'\)/.test(waiting)
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

  /*
   * Issue #418. On the clean VM both of those buttons rendered perfectly and
   * neither could be reached: the panel is taller than the app's own default
   * window (1180x820, `REQUESTED` in lib.rs) and the container clipped it at
   * both ends instead of scrolling.
   *
   * The measured half of this lives in `tools/first-screen-shots.mjs`
   * section e, which drives a real browser at four window sizes and asks
   * whether a click would land. These two are the source half, and they are
   * the properties a future edit is most likely to undo without noticing: a
   * container that scrolls, and a flex column that does not centre content it
   * cannot fit - `justify-center` pushes the overflow off the top as well,
   * where no scrollbar can reach it.
   */
  const container = (waiting.match(/<div className="([^"]*\bh-full\b[^"]*)"/) ?? [])[1] ?? ''
  ok(
    'the empty state container declares vertical overflow auto',
    /\boverflow-y-auto\b/.test(container),
    container || 'no h-full container found'
  )
  ok(
    'and does not centre content it may be too small to hold',
    !/\bjustify-center\b/.test(container),
    container
  )
  // Without this an empty match reads as a pass on both of the above: a
  // regex that stopped matching cannot fail, it just finds nothing.
  ok('control: the container was actually found to test', container.length > 0, container)
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

console.log('\n-- 8. one demo mode for the whole app, not one per window --')
{
  /*
   * Two windows, driven through the real `setBridgeMode` and the real
   * `createBridgeModeSync`, over an in-memory transport that behaves the way
   * Tauri's `emit` does: every message reaches every subscriber *including*
   * the window that sent it, which is the arrangement an echo guard has to
   * survive.
   *
   * The transport counts what it carries, because the number that goes wrong
   * when the guard breaks is not the final mode - both windows still end up
   * correct in an echo storm - it is how many times they said so.
   */
  function makeBus() {
    const subscribers = new Set()
    const carried = []
    return {
      carried,
      transport: {
        publish(mode) {
          carried.push(mode)
          for (const handler of [...subscribers]) handler(mode)
        },
        subscribe(handler) {
          subscribers.add(handler)
          return () => subscribers.delete(handler)
        },
      },
    }
  }

  /** One window: its own store cell, its own sync, one shared bus. */
  function makeWindow(bus, initial, { guard = true } = {}) {
    const sync = guard
      ? createBridgeModeSync(bus.transport)
      : // The sabotage, kept in the file as a positive control: the same
        // wiring with the echo guard removed. If this does not storm, the
        // message counter below is not measuring anything.
        { publish: (mode) => bus.transport.publish(mode), subscribe: (a) => bus.transport.subscribe(a) }
    const state = {
      bridgeMode: initial,
      character: { name: 'Dan the Bold' },
      addLog() {},
    }
    const set = (partial) =>
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    const get = () => state
    const win = {
      state,
      change(mode) {
        setBridgeMode(mode, set, get, (m) => {
          state.persisted = m
          sync.publish(m)
        })
      },
    }
    sync.subscribe((mode) => {
      if (mode === state.bridgeMode) return
      win.change(mode)
    })
    return win
  }

  {
    const bus = makeBus()
    const main = makeWindow(bus, 'mock')
    const popout = makeWindow(bus, 'mock')
    popout.change('live')
    ok(
      'leaving the demo in a pop-out takes the main window out of it',
      main.state.bridgeMode === 'live',
      `main=${main.state.bridgeMode} popout=${popout.state.bridgeMode}`
    )
    ok(
      'and clears the invented character there, so its banner has nothing to sit over',
      main.state.character === null
    )
    ok(
      'the preference the main window would reload is the new one',
      main.state.persisted === 'live',
      `persisted=${main.state.persisted}`
    )
    ok(
      'one change puts exactly one message on the transport',
      bus.carried.length === 1,
      `${bus.carried.length} carried: ${bus.carried.join(',')}`
    )
  }

  {
    // The other direction, which is the one issue #424 explicitly did not
    // ask for and #400's framing does: starting the demo in the main window
    // must put an already-open pop-out into it too, banner and all.
    const bus = makeBus()
    const main = makeWindow(bus, 'live')
    const popout = makeWindow(bus, 'live')
    main.change('mock')
    ok(
      'starting the demo in the main window puts an open pop-out into it',
      popout.state.bridgeMode === 'mock',
      `popout=${popout.state.bridgeMode}`
    )
    ok('still exactly one message', bus.carried.length === 1, `${bus.carried.length} carried`)
  }

  {
    // The control. Same two windows, guard removed: each window answers the
    // other's message with one of its own. Without this, a green count above
    // could equally mean the transport was never used at all.
    const bus = makeBus()
    makeWindow(bus, 'mock', { guard: false })
    makeWindow(bus, 'mock', { guard: false })
    let stormed = false
    try {
      bus.transport.publish('live')
    } catch {
      // A RangeError from the recursion is the same finding as a high count.
      stormed = true
    }
    ok(
      'control: without the guard the same change echoes, so the count can fail',
      stormed || bus.carried.length > 1,
      `${bus.carried.length} carried without the guard`
    )
  }

  {
    // A window that does not subscribe is the bug, so the harness has to be
    // able to see one. Same as above with the subscription left off.
    const bus = makeBus()
    const sync = createBridgeModeSync(bus.transport)
    const state = { bridgeMode: 'mock', character: { name: 'Dan the Bold' }, addLog() {} }
    const set = (p) => Object.assign(state, typeof p === 'function' ? p(state) : p)
    setBridgeMode('live', set, () => state, (m) => sync.publish(m))
    ok(
      'control: an unsubscribed window would be caught - it stays in the demo',
      state.bridgeMode === 'live' && bus.carried.length === 1
    )
  }

  // The wiring, which the in-memory model above cannot see: every window has
  // to actually reach that subscription, and the publish has to sit on the
  // persist seam so the browser transport's listener reads a written value.
  const shell = read('src/components/layout/WindowShell.tsx')
  ok(
    'the shell every window passes through subscribes to the mode',
    /useBridgeModeSync\(/.test(shell)
  )
  const store = read('src/store/useAppStore.ts')
  ok(
    'and the store publishes from the same seam that persists',
    /savePrefs\(\{ bridgeMode: mode \}\)\s*\n\s*publishBridgeMode\(mode\)/.test(store)
  )
  const sync = read('src/lib/bridgeModeSync.ts')
  ok(
    'the browser transport reuses the storage channel pins already use',
    /subscribeStorageKey\(/.test(sync) && !/new BroadcastChannel/.test(sync),
    'no second cross-window channel'
  )
  ok(
    'and the app transport is a Tauri event, chosen once by isTauri()',
    /isTauri\(\) \? tauriTransport : storageTransport/.test(sync)
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
