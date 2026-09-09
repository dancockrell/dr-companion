/**
 * The scene pane's three states, and the promise that they are remembered per
 * size of window.
 *
 * Pure, over `src/lib/scenePane.ts` alone, because that is where the decisions
 * are: which states exist, which one a fresh window of a given shape opens
 * with, which stored answer a window of that shape reads back, and what the
 * rail asks for in each state. The browser-driven half - that the pane is
 * actually in the corner and that the control actually moves it - is
 * `tools/play-first-layout-test.mjs`. Two suites because they can fail for
 * completely different reasons and a single red line saying "the scene pane is
 * wrong" would not say which.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const dir = mkdtempSync(join(tmpdir(), 'scene-pane-'))
const compile = (src, name) => {
  const out = join(dir, name)
  writeFileSync(
    out,
    ts.transpileModule(readFileSync(src, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        rewriteRelativeImportExtensions: true,
      },
    }).outputText
  )
  return out
}
compile('src/lib/columns.ts', 'columns.js')
compile('src/lib/storage.ts', 'storage.js')
const modulePath = compile('src/lib/scenePane.ts', 'scenePane.js')

const store = new Map()
globalThis.window = new EventTarget()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const m = await import(pathToFileURL(modulePath).href)

let checked = 0
let fails = 0
const ok = (label, cond, detail = '') => {
  checked++
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(64)} ${detail}`)
}

/*
 * The sizes this suite reasons about, and why each is here. The two ends are
 * the ones that matter: the app's own minimum window, where there is no room
 * for a pane at all, and Dan's own monitor, where there is.
 */
const MIN = [720, 480]
const LAPTOP = [1366, 768]
const DAN = [1997, 935]

ok('the three states are exactly the three states', m.SCENE_PANE_STATES.join(',') === 'minimap,popped,hidden', m.SCENE_PANE_STATES.join(','))
ok(
  'one control reaches every state and comes back to where it started',
  m.nextScenePaneState(m.nextScenePaneState(m.nextScenePaneState('minimap'))) === 'minimap',
  [...m.SCENE_PANE_STATES].map((s) => `${s}->${m.nextScenePaneState(s)}`).join(' ')
)

ok('the app minimum is a narrow bucket', m.sizeBucket(...MIN) === 'narrow-short', m.sizeBucket(...MIN))
ok('a 1366x768 laptop is a standard bucket', m.sizeBucket(...LAPTOP) === 'standard-tall', m.sizeBucket(...LAPTOP))
ok('a 1997x935 window is a wide bucket', m.sizeBucket(...DAN) === 'wide-tall', m.sizeBucket(...DAN))
ok(
  'the buckets are distinct, which is the whole point of storing per size',
  new Set([m.sizeBucket(...MIN), m.sizeBucket(...LAPTOP), m.sizeBucket(...DAN)]).size === 3
)

ok('a window too narrow for the frame opens with no pane', m.defaultScenePaneState(...MIN) === 'hidden', m.defaultScenePaneState(...MIN))
ok('every window that can hold one opens with the corner pane', m.defaultScenePaneState(...DAN) === 'minimap' && m.defaultScenePaneState(...LAPTOP) === 'minimap')

// The property the whole module exists for. Choosing `hidden` on a laptop must
// not reach the big monitor, and vice versa - a single stored answer would.
m.writeScenePaneState(...LAPTOP, 'hidden')
ok('a choice made at one size comes back at that size', m.readScenePaneState(...LAPTOP) === 'hidden', m.readScenePaneState(...LAPTOP))
ok('and does not reach a different size', m.readScenePaneState(...DAN) === 'minimap', m.readScenePaneState(...DAN))
m.writeScenePaneState(...DAN, 'popped')
ok('two sizes hold two different answers at once', m.readScenePaneState(...LAPTOP) === 'hidden' && m.readScenePaneState(...DAN) === 'popped')
ok(
  'and both survive a reload, which is what "persists" means',
  JSON.parse(store.get(m.SCENE_PANE_KEY))[m.sizeBucket(...DAN)] === 'popped',
  store.get(m.SCENE_PANE_KEY)
)

store.set(m.SCENE_PANE_KEY, JSON.stringify({ [m.sizeBucket(...DAN)]: 'enormous' }))
ok(
  'a stored value that is not one of the three is not read as one',
  m.readScenePaneState(...DAN) === 'minimap',
  m.readScenePaneState(...DAN)
)
store.set(m.SCENE_PANE_KEY, 'not json at all')
ok('and neither is a store that will not parse', m.readScenePaneState(...DAN) === 'minimap')

// The ceiling, not a rewrite. This is the half a player notices: pressing
// hidden has to give the width back, and pressing minimap has to give their
// own dragged width back rather than a default.
const dragged = 520
ok('the corner pane gets exactly the width the player dragged', m.railWant('minimap', dragged) === dragged, String(m.railWant('minimap', dragged)))
ok('hiding the pane gives the surplus width back to the text', m.railWant('hidden', dragged) === m.COMPACT_RAIL_W, String(m.railWant('hidden', dragged)))
ok('so does popping it out', m.railWant('popped', dragged) === m.COMPACT_RAIL_W, String(m.railWant('popped', dragged)))
ok(
  'a rail already narrower than the compact width is not widened by hiding the pane',
  m.railWant('hidden', 140) === 140,
  String(m.railWant('hidden', 140))
)
ok('and the stored preference itself is never touched', m.railWant('minimap', dragged) === dragged)

ok('a fight may widen the pane, but not without limit', m.COMBAT_GROWTH > 1 && m.COMBAT_GROWTH <= 1.5, String(m.COMBAT_GROWTH))
ok(
  'the default corner width leaves the text most of a laptop window',
  LAPTOP[0] - m.SCENE_RAIL_W * m.COMBAT_GROWTH > LAPTOP[0] * 0.5,
  `${Math.round(LAPTOP[0] - m.SCENE_RAIL_W * m.COMBAT_GROWTH)}px of ${LAPTOP[0]}`
)

// A floor well under the real count, so a truncated or broken import reports
// itself instead of reporting a clean sweep.
const FLOOR = 16
if (checked < FLOOR) {
  console.log(`FAIL only ${checked} checks ran, expected at least ${FLOOR} - the suite did not do its job`)
  fails++
}
console.log(`\n${checked} checked, ${fails} failed`)
process.exit(fails ? 1 : 0)
