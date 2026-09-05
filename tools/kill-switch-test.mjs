/**
 * The kill switch has to work when nothing else does.
 *
 * Stop, Pause and Resume are the controls a player reaches for when something
 * is already wrong: a task walking the wrong way, a script that will not stop
 * talking, a backend that has died. So they are held to two properties that
 * the rest of the client is not.
 *
 * **They work with `isTauri()` false.** Not "they do not crash" - the local
 * half still does its job with no Rust process behind it, and the calls that
 * do need Rust resolve rather than throwing. A browser preview, a half-started
 * shell, and a shell whose backend has fallen over all present the same way to
 * this code, and that is the state the player is in when they press Stop.
 *
 * **They import nothing optional.** The viewer and the local model are both
 * shipped absent by default (plan section 5, bars 5 and 6). A kill switch that
 * cannot load without one of them is a kill switch that is missing exactly
 * when the optional subsystem is what went wrong. The import check below walks
 * the *transitive* closure from each owner, because one hop is not the
 * question - `flowStop -> X -> aiWorkerHost` would fail the property while
 * passing a check that only read flowStop's own import lines.
 *
 * # What this does not test
 *
 * `tools/flow-stop-test.ts` owns the fan-out contract of
 * `stopAllTaskBackends` - that one failing backend cannot block the other.
 * That is a different question (does the combinator behave), asked with two
 * fake backends. This file asks whether the real wiring survives a missing
 * backend, and deliberately does not restate the combinator's own cases.
 *
 * Run: node --experimental-test-module-mocks tools/kill-switch-test.mjs
 */
import { mock } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve as resolvePath, relative, basename } from 'node:path'

let checks = 0
let failures = 0

function ok(cond, what) {
  checks++
  if (cond) {
    console.log(`OK   ${what}`)
  } else {
    failures++
    console.log(`FAIL ${what}`)
  }
}

/**
 * The owners, and why each is here.
 *
 * `grep -rn "runaway\|cancelCommand" src/lib/*.ts` finds only a comment in
 * `aiAlertBroker.ts` (a severity example), which owns no stop path. If that
 * grep ever finds a third owner, add it here - the list is the denominator
 * for every source check below.
 */
const OWNERS = [
  'src/lib/stopAllTasks.ts',
  'src/lib/flowStop.ts',
]

/* ------------------------------------------------------------------ */
/* Part 1 - the controls work with isTauri() false                     */
/* ------------------------------------------------------------------ */

// The real tauri.ts returns undefined from every invoke when there is no
// Tauri, which is the browser path exactly. This double reproduces that and
// records what was asked for, so "Stop reached both backends" is observable
// instead of inferred from the source text.
const invoked = []
const stub = {
  isTauri: () => false,
  listenTauri: () => () => {},
  invokeTauri: async (cmd) => {
    invoked.push(cmd)
    return undefined
  },
  setAlwaysOnTop: async () => {},
  getBridgeDefaultUrl: async () => '',
}

// node:test renamed this option between releases: `namedExports` on Node 22,
// `exports` on 24. The wrong one silently produces a module with no named
// exports and fails at link time naming neither file nor option - see the
// same note in tools/backlog-test.mjs, which paid for it in a CI round trip.
const nodeMajor = Number(process.versions.node.split('.')[0])
mock.module('../src/lib/tauri.ts', nodeMajor >= 24 ? { exports: stub } : { namedExports: stub })

console.log('-- the real tauri module reports no shell under node --')
{
  // The double above claims isTauri() is false; this is the check that the
  // claim matches reality rather than being a fixture that decided its own
  // answer. Loaded through a query string so the mock does not intercept it.
  const realTauri = await import('../src/lib/tauri.ts?unmocked=1')
  ok(realTauri.isTauri() === false, 'src/lib/tauri.ts: isTauri() is false with no window')
  ok((await realTauri.invokeTauri('stop_python_task')) === undefined,
    'src/lib/tauri.ts: invokeTauri resolves to undefined rather than throwing')
}

const rejections = []
process.on('unhandledRejection', (reason) => rejections.push(reason))

const flowStop = await import('../src/lib/flowStop.ts')
const pythonTasks = await import('../src/lib/pythonTasks.ts')
const nodeTasks = await import('../src/lib/nodeTasks.ts')
const { stopAllTaskBackends } = await import('../src/lib/stopAllTasks.ts')

const settle = () => new Promise((r) => setTimeout(r, 10))

console.log('\n-- src/lib/flowStop.ts: Stop reaches both backends with no shell --')
{
  invoked.length = 0
  flowStop.requestStopAll()
  await settle()
  ok(invoked.includes('stop_python_task'),
    'src/lib/flowStop.ts: requestStopAll asked Rust to stop the Python task')
  ok(invoked.includes('stop_node_task'),
    'src/lib/flowStop.ts: requestStopAll asked Rust to stop the TypeScript task')
  ok(rejections.length === 0,
    'src/lib/flowStop.ts: requestStopAll created no unhandled rejection')
}

console.log('\n-- src/lib/flowStop.ts: Pause and Resume keep their local half --')
{
  // The Rust gate is the wide half of Pause (it holds scripts this app never
  // started), and it is absent here. The local signal is what is left, and it
  // is what the mounted UI reads, so it must still fire.
  let paused = 0
  let resumed = 0
  const offPause = flowStop.onPauseAll(() => { paused += 1 })
  const offResume = flowStop.onResumeAll(() => { resumed += 1 })

  invoked.length = 0
  flowStop.requestPauseAll()
  await settle()
  ok(paused === 1, 'src/lib/flowStop.ts: requestPauseAll notified its subscriber with no Rust gate')
  ok(invoked.includes('set_paused'), 'src/lib/flowStop.ts: requestPauseAll still attempted the Rust gate')

  invoked.length = 0
  flowStop.requestResumeAll()
  await settle()
  ok(resumed === 1, 'src/lib/flowStop.ts: requestResumeAll notified its subscriber with no Rust gate')
  ok(invoked.includes('set_paused'), 'src/lib/flowStop.ts: requestResumeAll still attempted the Rust gate')

  offPause()
  offResume()
  ok(rejections.length === 0, 'src/lib/flowStop.ts: Pause and Resume created no unhandled rejection')
}

console.log('\n-- src/lib/stopAllTasks.ts: the real backends settle with no shell --')
{
  // flow-stop-test.ts asks this of two fakes. The question here is whether
  // the *shipped* pair resolves when the process they stop cannot be reached:
  // a stop that rejects on a dead backend leaves the player pressing a button
  // that reports nothing.
  invoked.length = 0
  const results = await stopAllTaskBackends(pythonTasks.stopTask, nodeTasks.stopNodeTask)
  ok(results.length === 2 && results.every((r) => r.status === 'fulfilled'),
    'src/lib/stopAllTasks.ts: both real stops settled fulfilled with isTauri() false')
  ok(invoked.includes('stop_python_task') && invoked.includes('stop_node_task'),
    'src/lib/stopAllTasks.ts: both real stops were attempted, not skipped')
}

console.log('\n-- the task backends report idle rather than throwing --')
{
  const py = await pythonTasks.stopTask()
  const ts = await nodeTasks.stopNodeTask()
  ok(py !== undefined && py !== null,
    'src/lib/pythonTasks.ts: stopTask returned a state with no backend to ask')
  ok(ts !== undefined && ts !== null,
    'src/lib/nodeTasks.ts: stopNodeTask returned a state with no backend to ask')
  ok(py.running === false, 'src/lib/pythonTasks.ts: that state is not-running')
  ok(ts.running === false, 'src/lib/nodeTasks.ts: that state is not-running')
}

/* ------------------------------------------------------------------ */
/* Part 2 - no owner reaches an optional subsystem                     */
/* ------------------------------------------------------------------ */

/**
 * Classify a module path into the categories a kill switch must not need.
 *
 * Returns null for anything unremarkable. The categories come from the
 * increment: `ai*`, viewer, python runner, node runner.
 */
function category(modulePath) {
  const name = basename(modulePath)
  if (/^ai[A-Z]/.test(name)) return 'ai'
  if (/viewer|godot|worldView/i.test(name)) return 'viewer'
  if (/^pythonTasks\./.test(name)) return 'python-runner'
  if (/^nodeTasks\./.test(name)) return 'node-runner'
  return null
}

console.log('\n-- the classifier can see what it is looking for --')
{
  // A classifier that matched nothing would report every owner clean. These
  // are real files in src/lib; if a rename makes one of these stop matching,
  // the check below has quietly stopped being able to fail.
  ok(category('src/lib/aiWorkerHost.ts') === 'ai', 'classifier: aiWorkerHost.ts reads as ai')
  ok(category('src/lib/aiModelProvider.ts') === 'ai', 'classifier: aiModelProvider.ts reads as ai')
  ok(category('src/lib/pythonTasks.ts') === 'python-runner', 'classifier: pythonTasks.ts reads as the Python runner')
  ok(category('src/lib/nodeTasks.ts') === 'node-runner', 'classifier: nodeTasks.ts reads as the TypeScript runner')
  ok(category('src/lib/stopAllTasks.ts') === null, 'classifier: stopAllTasks.ts is unremarkable')
  for (const name of ['aiWorkerHost.ts', 'aiModelProvider.ts', 'pythonTasks.ts', 'nodeTasks.ts']) {
    ok(existsSync(`src/lib/${name}`), `classifier sample src/lib/${name} still exists`)
  }
}

/** Every relative import in a source file, resolved to a repo-relative path. */
function relativeImports(file) {
  const source = readFileSync(file, 'utf8')
  const out = []
  // Static imports and re-exports only. A dynamic import would be a way to
  // reach an optional subsystem without appearing here, so it is asserted
  // against separately below.
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[^\n;]*?from\s+'(\.[^']+)'/g)) {
    const spec = match[1]
    const base = resolvePath(dirname(file), spec)
    const candidate = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((p) => existsSync(p))
    if (candidate) out.push(relative(process.cwd(), candidate).split('\\').join('/'))
  }
  return out
}

/** Transitive closure of relative imports, owner included. */
function closure(entry) {
  const seen = new Set()
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()
    if (seen.has(file)) continue
    seen.add(file)
    for (const next of relativeImports(file)) queue.push(next)
  }
  return [...seen]
}

console.log('\n-- what each kill-switch owner can reach --')
const found = []
for (const owner of OWNERS) {
  ok(existsSync(owner), `owner ${owner} exists`)
  const reached = closure(owner)
  // The denominator. An owner that reaches only itself means the import
  // parser stopped working, and every category check below would pass on an
  // empty set.
  ok(reached.length >= 1, `${owner}: closure has ${reached.length} modules`)
  console.log(`     ${owner} reaches: ${reached.join(', ')}`)

  const ai = reached.filter((m) => category(m) === 'ai')
  const viewer = reached.filter((m) => category(m) === 'viewer')
  ok(ai.length === 0, `${owner}: reaches no ai* module${ai.length ? ` (found ${ai.join(', ')})` : ''}`)
  ok(viewer.length === 0, `${owner}: reaches no viewer module${viewer.length ? ` (found ${viewer.join(', ')})` : ''}`)

  for (const m of reached) {
    const kind = category(m)
    if (kind === 'python-runner' || kind === 'node-runner') found.push(`${owner} -> ${m}`)
  }

  const source = readFileSync(owner, 'utf8')
  ok(!/\bimport\s*\(/.test(source), `${owner}: no dynamic import to smuggle a subsystem past the closure`)
}

console.log('\n-- task-runner coupling is pinned, not assumed --')
{
  /*
   * A recorded finding, deliberately not papered over.
   *
   * `src/lib/flowStop.ts` imports both task-runner modules. It is the wiring
   * layer, and stopping those two processes is the whole of what Stop means,
   * so the coupling is the feature rather than a leak - but it does mean the
   * kill switch cannot be loaded with the runner modules absent, which is a
   * weaker property than the one `stopAllTasks.ts` holds. `stopAllTasks.ts`
   * is the safety core and takes its backends as arguments, so it imports
   * nothing at all.
   *
   * The list below is exact on purpose: a third runner import, or any runner
   * import reaching the core, fails this check rather than joining a set that
   * quietly grows.
   */
  const EXPECTED = [
    'src/lib/flowStop.ts -> src/lib/pythonTasks.ts',
    'src/lib/flowStop.ts -> src/lib/nodeTasks.ts',
  ]
  const sorted = [...found].sort()
  const expected = [...EXPECTED].sort()
  ok(sorted.join(' | ') === expected.join(' | '),
    `task-runner imports are exactly the two flowStop.ts exists to stop (found: ${sorted.join(', ') || 'none'})`)
  ok(!found.some((f) => f.startsWith('src/lib/stopAllTasks.ts')),
    'src/lib/stopAllTasks.ts: the safety core imports no runner at all')
}

ok(checks >= 30, `enough was checked for a pass to mean something (${checks} checks)`)

console.log(failures ? `\n${failures} failed` : '\nall kill-switch checks passed')
process.exit(failures ? 1 : 0)
