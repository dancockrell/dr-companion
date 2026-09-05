/**
 * The viewer is optional, so every path has to degrade rather than break.
 *
 * `docs/THREE_D_REBUILD_HANDOFF.md` makes it an acceptance rule - "client
 * remains usable if Godot is absent/crashed" - and until this file nothing
 * checked it. The states that matter are precisely the ones a developer never
 * sees, because a machine with a built viewer cannot produce them: no viewer
 * on disk, and a process list that could not be read at all.
 *
 * # What this runs against
 *
 * `invokeTauri` returns `undefined` outside the app rather than throwing
 * (`src/lib/tauri.ts`), and this file runs in Node, so `viewerStatus()` here
 * takes the real no-backend path rather than a mock of it. The decision
 * functions are then exercised over every combination, including the ones the
 * happy path can never reach.
 *
 * It does not render `PresentationBridgePanel`: there is no component-render
 * harness in this repository and introducing one is a larger decision than
 * this increment. What it does instead is check the strings the panel shows,
 * at the functions the panel now calls for them - which is why
 * `viewerStateLabel` was lifted out of the component's ternary. The gap that
 * leaves is the JSX itself, and it is written down here rather than left to
 * be discovered.
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Transpiled rather than imported directly, the same way tools/frontend-test.mjs
// reaches into src/lib: Node cannot read TypeScript, and the alternative is a
// second copy of these decisions living in the test.
const dir = mkdtempSync(join(tmpdir(), 'viewer-absent-'))
const done = new Set()

/**
 * Transpile a `src/lib` module and everything it reaches, flattened into one
 * directory under the same basenames, with `./x.ts` rewritten to `./x.mjs`.
 *
 * Recursive because it has to be: `presentationBridge.ts` imports `room.ts`,
 * which imports `bestiary.ts`. The first version of this file transpiled only
 * the direct imports and died on the second level - which is the honest
 * failure, and better than a mock that would have hidden that the real module
 * graph does not load.
 */
function load(relative) {
  const out = join(dir, relative.replace(/\.ts$/, '.mjs'))
  if (done.has(relative)) return out
  done.add(relative)
  const source = readFileSync(relative, 'utf8')
  const here = dirname(relative)
  for (const [, spec] of source.matchAll(/from '(\.\.?\/[^']+)'/g)) {
    const target = join(here, spec).replace(/\\/g, '/')
    if (spec.endsWith('.ts')) load(target)
    else if (spec.endsWith('.mjs') || spec.endsWith('.json')) {
      // Data and plain JavaScript the module reads at import time. Copied
      // rather than stubbed: a stub would be a second copy of the game's own
      // data, drifting.
      const dest = join(dir, target)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, readFileSync(target))
    }
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(
    out,
    ts
      .transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/from '(\.\.?\/[^']+)\.ts'/g, "from '$1.mjs'")
  )
  return out
}

let fails = 0
let checks = 0
const ok = (label, condition) => {
  checks += 1
  if (!condition) fails += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
}

// The whole module graph, so an import that only resolves under Vite fails
// here rather than at runtime in the app.
// Two modules since C4 (#296) split them: viewerClient owns the viewer's own
// status and the decisions the panel reads, presentationBridge still owns the
// publish. Both are loaded, because "nothing throws with no backend" is a
// claim about both halves.
const bridge = load('src/lib/presentationBridge.ts')
const client = load('src/lib/viewerClient.ts')

// `src/lib/tauri.ts` imports `@tauri-apps/api`, which does not resolve outside
// the repo's own node_modules, and it is also the seam this file needs to
// control. So the transpiled copy is replaced with a stub whose behaviour a
// test can set: return a value, or reject the way the real one does inside the
// app. Everything else in the graph is the real module.
writeFileSync(
  join(dir, 'src/lib/tauri.mjs'),
  [
    'export const backend = { mode: "absent", value: undefined, error: "no backend" }',
    'export function isTauri() { return backend.mode !== "absent" }',
    'export async function invokeTauri(cmd) {',
    '  if (backend.mode === "absent") return undefined',
    '  if (backend.mode === "reject") throw new Error(backend.error)',
    '  return backend.value',
    '}',
    'export async function setAlwaysOnTop() {}',
    'export async function getBridgeDefaultUrl() { return "ws://127.0.0.1:7415/companion" }',
    'export function listenTauri() { return () => {} }',
  ].join('\n')
)

const m = { ...(await import(pathToFileURL(bridge).href)), ...(await import(pathToFileURL(client).href)) }
const { backend } = await import(pathToFileURL(join(dir, 'src/lib/tauri.mjs')).href)

// 1. No backend at all - the browser-preview case, where invokeTauri returns
//    undefined rather than throwing.
backend.mode = 'absent'
const absent = await m.viewerStatus()
ok('viewerStatus resolves with no backend rather than throwing', absent !== undefined)
ok('nothing is installed when nothing answered', absent.installed === false)
ok('and no path is claimed for it', absent.path === null)
ok('running is false', absent.running === false)
ok(
  'and runningKnown is false, so "no viewer" is not confused with "could not look"',
  absent.runningKnown === false
)
ok('no exit code is invented', absent.exitCode === null)

// 1b. A backend that answers "not installed", which is the case on every
//     machine where nobody has run `npm run godot:export`.
backend.mode = 'value'
backend.value = { installed: false, path: null, running: false, runningKnown: true }
const notBuilt = await m.viewerStatus()
ok('an uninstalled viewer is reported as such', notBuilt.installed === false)
ok(
  'and the panel calls it "not built yet"',
  m.viewerStateLabel(notBuilt, false) === 'not built yet'
)

// 1c. A backend that rejects. Inside the app a failed invoke throws, and the
//     panel's job is to show the reason rather than swallow it - so the
//     rejection has to survive as a readable message.
backend.mode = 'reject'
backend.error = 'Could not start the world viewer: file not found'
let launchError = null
try {
  await m.launchViewer()
} catch (e) {
  launchError = e
}
ok('launchViewer rejects rather than resolving quietly', launchError !== null)
ok(
  'and the reason is readable enough to show',
  String(launchError?.message || '').includes('Could not start the world viewer')
)
backend.mode = 'absent'

// 2. The label the panel shows, over every state including the unreachable
//    ones. A machine with a built viewer cannot produce the first two.
const status = (over = {}) => ({
  installed: true,
  path: 'C:/x/DRCompanionWorldViewer.exe',
  running: false,
  runningKnown: true,
  exitCode: null,
  ...over,
})
ok('nothing checked yet says so', m.viewerStateLabel(null, true) === 'checking…')
ok('and an idle unknown is a dash, not a claim', m.viewerStateLabel(null, false) === '—')
ok(
  'no viewer built reads "not built yet"',
  m.viewerStateLabel(status({ installed: false, path: null }), false) === 'not built yet'
)
ok(
  'an unreadable process list says so rather than "ready"',
  m.viewerStateLabel(status({ runningKnown: false }), false) ===
    'installed, cannot tell if open'
)
ok('a running viewer reads "open"', m.viewerStateLabel(status({ running: true }), false) === 'open')
ok('a built, idle viewer reads "ready"', m.viewerStateLabel(status(), false) === 'ready')
ok(
  'a crashed one reads "exited", not "ready"',
  m.viewerStateLabel(status({ exitCode: 3 }), false) === 'exited'
)

// 3. The exit note. Null in every case where saying "exited" would be a lie.
ok('no status, no note', m.viewerExitNote(null) === null)
ok('a running viewer has no exit note', m.viewerExitNote(status({ running: true })) === null)
ok(
  'a viewer nobody launched has no exit note',
  m.viewerExitNote(status({ exitCode: null })) === null
)
ok(
  'a clean close is reported as a close',
  m.viewerExitNote(status({ exitCode: 0 })) === 'The viewer was closed.'
)
ok(
  'a crash names its code',
  m.viewerExitNote(status({ exitCode: 3 })) === 'The viewer exited (code 3).'
)
ok(
  'a negative code, which is what a forced kill gives on Windows, still reads',
  m.viewerExitNote(status({ exitCode: -1 })) === 'The viewer exited (code -1).'
)

// 4. A publish with nothing to publish is a no-op, not a throw. This is the
//    same absence one layer up: no zone, no room, no character.
let threw = null
try {
  await m.publishWorldSnapshotIfChanged({ zone: null, here: null, character: null })
} catch (e) {
  threw = e
}
ok('publishing with no world does not throw', threw === null)

// The floor. Set well below the real count so a truncated or half-imported run
// reports itself instead of passing for free.
if (checks < 15) {
  console.log(`\nFAIL only ${checks} checks ran; this file has many more than that`)
  process.exit(1)
}

console.log(
  fails === 0 ? `\n${checks} checks, all passed` : `\n${fails} of ${checks} FAILED`
)
process.exit(fails === 0 ? 0 : 1)
