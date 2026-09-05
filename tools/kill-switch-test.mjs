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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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

/**
 * What each owner's import closure should come to, including the file itself.
 *
 * Stated rather than floored, because the two owners are deliberately
 * different shapes and a single floor cannot express that. `stopAllTasks.ts`
 * imports nothing at all — it takes its backends as arguments, which is what
 * lets the safety core load with the task runners absent — so its closure is
 * exactly itself, and that 1 is a property to assert, not a number to clear.
 * `flowStop.ts` is the wiring layer and reaches the two runners plus Tauri.
 *
 * A number here changing is a real event: it means a kill-switch owner grew a
 * dependency. Update it deliberately and say why in the commit.
 *
 * # G11 added a consumer and these numbers did not move, which is the point
 *
 * Stop now also has to reach the confirmation gate in `src/lib/aiSuggestions.ts`
 * and reject every suggestion a player has not confirmed. The obvious way to
 * write that is for `flowStop.ts` to import the gate and call it, and it would
 * be wrong: it would put an `ai*` module in a kill switch's closure, which is
 * the exact thing the checks below exist to forbid, and it would mean Stop
 * could not load on the evening the AI subsystem is what went wrong.
 *
 * So the dependency runs the other way. `flowStop.ts` publishes an `onStopAll`
 * signal; the gate subscribes to it. The closure numbers above are therefore
 * still 1 and 5, and that is a property, not an oversight.
 *
 * The denominator that *does* move is `EXPECTED_STOP_CONSUMERS` below: the
 * exact list of modules that subscribe. Adding a consumer changes that list,
 * and a consumer that stops subscribing - which is how this whole guarantee
 * would die quietly - changes it too.
 */
const EXPECTED_CLOSURE = {
  'src/lib/stopAllTasks.ts': 1,
  'src/lib/flowStop.ts': 5,
}

/**
 * Every module that subscribes to `onStopAll`, stated exactly.
 *
 * This is the denominator for "Stop reaches everything it has to reach". A
 * module that quietly stops subscribing is the failure this guarantee has, and
 * it is invisible from `flowStop.ts` - the signal fires either way and nothing
 * errors. Only counting the subscribers can tell a Stop that reached two
 * things from a Stop that reached one.
 *
 * Add a row when you add a consumer, and say in the commit what Stop now
 * cancels.
 */
const EXPECTED_STOP_CONSUMERS = [
  // G11: rejects every suggestion the player has not confirmed, so a proposed
  // command on screen when Stop is pressed cannot be confirmed afterwards.
  'src/lib/aiSuggestions.ts',
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

/**
 * Every relative import in a source file, resolved to a repo-relative path.
 *
 * Matched on the specifier rather than on the whole statement. The earlier
 * pattern anchored at the `import`/`export` keyword and forbade a newline
 * before `from` (`[^\n;]*?`), so it could only see an import written on one
 * line - and Prettier wraps a long specifier list across several. `src/lib`
 * held 46 such imports on the day this was corrected, none of them yet inside
 * a kill-switch owner's closure, which is why nothing had gone wrong and why
 * nothing would have said so when it did.
 *
 * Demonstrated before the change: appending a wrapped
 * `import {\n  viewerStateLabel,\n} from './viewerClient.ts'` to
 * `src/lib/pythonTasks.ts` put a viewer module inside `flowStop.ts`'s real
 * runtime closure, and this file still printed `all kill-switch checks
 * passed` and exited 0. The pinned `EXPECTED_CLOSURE` did not catch it
 * either: an import the walker cannot see does not change the count it
 * compares against, so the closure read 5 both ways.
 *
 * Static imports and re-exports only, and the specifier is now the whole
 * signal, so no amount of wrapping hides one. A dynamic import would be a way
 * to reach an optional subsystem without appearing here, so it is asserted
 * against separately below. The shape is the one
 * `tools/ai-script-repair-test.mjs` already uses, reused rather than a third
 * parser being invented.
 */
function relativeImports(file) {
  const source = readFileSync(file, 'utf8')
  const out = []
  for (const match of source.matchAll(/(?:from|import)\s+'(\.[^']+)'/g)) {
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

console.log('\n-- the import parser itself, before trusting anything it says --')
{
  // This is the check the per-owner denominator below was trying and failing
  // to be. `closure()` seeds itself with the entry file, so "reached at least
  // one module" is true before a single import is parsed - the old floor
  // (`reached.length >= 1`) permitted precisely the state its own comment said
  // it existed to catch. An independent review demonstrated it by making
  // `relativeImports()` return `[]`: four checks about a safety-critical
  // control went vacuously green on an empty set, and the suite only went red
  // through an unrelated check that happened to act as an accidental control.
  //
  // So the parser is now tested against a file known to import things, which
  // no owner's own closure size can fake. If this line is red, nothing below
  // it means anything.
  const CONTROL = 'src/lib/flowStop.ts'
  const direct = relativeImports(CONTROL)
  ok(
    direct.length >= 2,
    `the import parser reads real imports: ${CONTROL} has ${direct.length}`,
    direct.join(', ')
  )

  // And the population the old parser could not see at all. Every owner's
  // imports happen to be single-line, so `flowStop.ts` above is a control on
  // the wrong population: a wrapped import would have been absent from it too.
  // This one is aimed at the case that was broken - a real file in the tree
  // whose `from` sits on a later line than its `import` - so that the fix
  // cannot silently revert.
  const wrapped = /(?:^|\n)[ \t]*import\b[^;'"]*?\n[^;]*?from\s+'(\.[^']+)'/
  let sample = null
  for (const name of readdirSync('src/lib')) {
    if (!/\.tsx?$/.test(name)) continue
    const hit = wrapped.exec(readFileSync(`src/lib/${name}`, 'utf8'))
    if (hit) {
      sample = { file: `src/lib/${name}`, spec: hit[1] }
      break
    }
  }
  if (!sample) {
    // Three states, not two. No wrapped import in the tree means this control
    // examined nothing, which is not the same as the parser being right.
    console.log(
      'NOT CHECKED  no wrapped import exists in src/lib today, so the multi-line case could not be exercised'
    )
  } else {
    const seen = relativeImports(sample.file)
    const target = resolvePath(dirname(sample.file), sample.spec)
    const resolved = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`]
      .filter((p) => existsSync(p))
      .map((p) => relative(process.cwd(), p).split('\\').join('/'))
    ok(
      resolved.length > 0 && seen.includes(resolved[0]),
      `the import parser reads an import wrapped across lines: ${sample.file} -> ${sample.spec}`,
      seen.join(', ')
    )
  }
}

console.log('\n-- what each kill-switch owner can reach --')
const found = []
for (const owner of OWNERS) {
  ok(existsSync(owner), `owner ${owner} exists`)
  const reached = closure(owner)
  // Each owner declares what it should reach, rather than clearing a floor.
  // A blanket `>= 2` would be wrong: `stopAllTasks.ts` genuinely imports
  // nothing, because it takes its backends as arguments, and that is a
  // property worth stating rather than a bar to get over.
  const expected = EXPECTED_CLOSURE[owner]
  ok(
    expected !== undefined && reached.length === expected,
    `${owner}: closure has ${reached.length} modules, expected ${expected ?? '(undeclared owner)'}`
  )
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

/* ------------------------------------------------------------------ */
/* Part 3 - Stop reaches what holds state, not only what holds a pid   */
/* ------------------------------------------------------------------ */

console.log('\n-- every subscriber to Stop is declared --')
{
  // The sweep first, so a zero here is a claim about the world rather than
  // about a walker that found no files.
  const walked = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) walked.push(full)
    }
  }
  walk('src')
  ok(walked.length >= 100, `the src sweep read a believable number of files (${walked.length})`)
  ok(walked.includes('src/lib/flowStop.ts'), 'and it includes the file that publishes the signal')

  const subscribers = walked
    .filter((f) => f !== 'src/lib/flowStop.ts')
    .filter((f) => /\bonStopAll\b/.test(readFileSync(f, 'utf8')))
    .sort()
  ok(subscribers.join(' | ') === [...EXPECTED_STOP_CONSUMERS].sort().join(' | '),
    `Stop's subscribers are exactly the declared list (found: ${subscribers.join(', ') || 'none'})`)

  const flowStop = readFileSync('src/lib/flowStop.ts', 'utf8')
  ok(/export const onStopAll = stopAll\.on/.test(flowStop),
    'src/lib/flowStop.ts: Stop is subscribable')
  ok(/stopAll\.request\(\)/.test(flowStop),
    'src/lib/flowStop.ts: requestStopAll actually fires it')
}

console.log('\n-- Stop rejects a pending AI suggestion, with no shell --')
{
  // The behavioural half. The source check above says the gate subscribes;
  // this says pressing Stop reaches it, through the real singleton, the real
  // signal and the real `requestStopAll` - and that doing so sends nothing.
  const { suggestionStore } = await import('../src/lib/aiSuggestions.ts')
  const { currentStateVersion } = await import('../src/lib/stateVersion.ts')
  const store = suggestionStore()
  const created = store.create({
    exactCommand: 'look chest',
    commandType: 'look',
    basedOnStateVersion: currentStateVersion(),
    expiresAt: Date.now() + 60_000,
    evidenceRefs: ['event:1'],
  })
  ok(created.ok === true, `a suggestion could be proposed to be cancelled (${created.reason ?? ''})`)
  ok(store.get(created.suggestion.id).status === 'pending',
    'src/lib/aiSuggestions.ts: it is pending before Stop')

  invoked.length = 0
  flowStop.requestStopAll()
  await settle()

  ok(store.get(created.suggestion.id).status === 'rejected',
    'src/lib/flowStop.ts: Stop rejected the pending suggestion')
  ok(!invoked.includes('game_send'),
    'src/lib/aiSuggestions.ts: cancelling it sent nothing to the game')
  ok(invoked.includes('stop_python_task') && invoked.includes('stop_node_task'),
    'src/lib/flowStop.ts: and Stop still reached both task backends')

  const after = store.requestExecution(created.suggestion.id, {
    suggestionId: created.suggestion.id, commandText: 'look chest',
  })
  ok(after.ok === false, 'src/lib/aiSuggestions.ts: confirming it after Stop is refused')
  ok(!invoked.includes('game_send'),
    'src/lib/aiSuggestions.ts: and that refusal reached no outbound write either')
  ok(rejections.length === 0, 'no unhandled rejection came out of any of this')
}

ok(checks >= 30, `enough was checked for a pass to mean something (${checks} checks)`)

console.log(failures ? `\n${failures} failed` : '\nall kill-switch checks passed')
process.exit(failures ? 1 : 0)
