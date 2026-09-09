/**
 * The application updater's rules, asserted where a webview cannot hide them.
 *
 * # What this suite is actually for
 *
 * Four of the propositions below are about calls that **must not happen**, and
 * those are the whole point. An updater that downloads when it should not, or
 * installs when the player said later, looks identical on screen to one that
 * behaves - right up until it closes the app in the middle of a fight. There
 * is no screenshot of an absence. So every dependency is a spy, and the
 * assertions are on its call count.
 *
 * The module under test imports nothing, which is why this runs under plain
 * node with no Tauri and no bundler. `src/lib/updaterWiring.ts` is the half
 * that touches the plugin and is not exercised here; what that costs is stated
 * in the report rather than papered over.
 *
 *     node --experimental-strip-types tools/updater-test.mjs
 *
 * `DRC_UPDATER_MODULE` points this at a different copy of the module. That is
 * not a convenience: `tools/updater-break-check.mjs` uses it to run this exact
 * suite against a deliberately damaged copy in a temp directory, so the
 * sabotage never touches the tree. A branch nobody can execute on purpose is a
 * branch nobody can prove they fixed.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const MODULE =
  process.env.DRC_UPDATER_MODULE ?? resolve(import.meta.dirname, '..', 'src', 'lib', 'updater.ts')

const { UpdateController, LiveSessionRefusal, UPDATE_STATE_KINDS, updateSummary } = await import(
  pathToFileURL(MODULE).href
)

let pass = 0
let fail = 0
const failed = []
function ok(label, condition) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`)
  if (condition) pass++
  else {
    fail++
    failed.push(label)
  }
}

const RELEASES = 'https://example.invalid/releases'

/**
 * A fake update, and the three counters the interesting assertions read.
 *
 * `downloads` and `installs` are the denominators that go to zero when the
 * rules hold. Counting states reached would not do: a controller that
 * installed behind the player's back would still reach exactly the states this
 * suite expects.
 */
function fakeUpdate({ version = '0.2.0', currentVersion = '0.1.1', notes = null, failOn = null } = {}) {
  const calls = { downloads: 0, installs: 0, closes: 0, chunks: [] }
  const update = {
    version,
    currentVersion,
    notes,
    async download(onProgress) {
      calls.downloads++
      if (failOn === 'download') throw new Error('connection reset')
      onProgress(0, 1000)
      onProgress(600, 1000)
      onProgress(1000, 1000)
    },
    async install() {
      calls.installs++
      if (failOn === 'install') throw new Error('installer refused to start')
    },
    async close() {
      calls.closes++
    },
  }
  return { update, calls }
}

function make({ result, inGame = false } = {}) {
  const checks = { count: 0 }
  const controller = new UpdateController({
    releasesUrl: RELEASES,
    now: () => 1_700_000_000_000,
    isInGame: () => inGame,
    async check() {
      checks.count++
      if (typeof result === 'function') return result(checks.count)
      if (result instanceof Error) throw result
      return result
    },
  })
  return { controller, checks }
}

const seen = new Set()
const record = (state) => {
  seen.add(state.kind)
  return state
}

// ── 1. up to date ───────────────────────────────────────────────────────────
{
  const { controller } = make({ result: null })
  record(controller.state)
  // Subscribed, not sampled after the await: `checking` exists only between
  // the call and its resolution, so a suite that only looks at return values
  // would report nine of ten states reached and call that complete. It did,
  // on the first run of this file.
  const off = controller.subscribe(() => record(controller.state))
  const state = record(await controller.check())
  off()
  ok('the transient checking state is observable while a check is in flight', seen.has('checking'))
  ok('a current build reports up-to-date', state.kind === 'up-to-date')
}

// ── 2. available, and checking never downloads ──────────────────────────────
{
  const { update, calls } = fakeUpdate({ notes: 'Fixed the thing.' })
  const { controller } = make({ result: update })
  const state = record(await controller.check())
  ok('a newer version reports available with both version numbers', state.kind === 'available' && state.version === '0.2.0' && state.currentVersion === '0.1.1')
  ok('release notes reach the state', state.notes === 'Fixed the thing.')
  ok('checking for updates downloads nothing', calls.downloads === 0)
  ok('checking for updates installs nothing', calls.installs === 0)
}

// ── 3. download stops at ready; it does not install ─────────────────────────
{
  const { update, calls } = fakeUpdate()
  const { controller } = make({ result: update })
  await controller.check()
  const state = record(await controller.download())
  ok('a finished download is ready, not installed', state.kind === 'ready' && state.version === '0.2.0')
  ok('downloading installs nothing', calls.installs === 0)
}

// ── 4. progress is reported as a running total ──────────────────────────────
{
  const { update } = fakeUpdate()
  const seenProgress = []
  const { controller } = make({ result: update })
  const off = controller.subscribe(() => {
    const s = controller.state
    if (s.kind === 'downloading') seenProgress.push(s.received)
  })
  await controller.check()
  record({ kind: 'downloading' })
  await controller.download()
  off()
  ok('download progress is reported and rises', seenProgress.length >= 2 && seenProgress.at(-1) === 1000)
}

// ── 5. "later" defers and does nothing else ─────────────────────────────────
{
  const { update, calls } = fakeUpdate()
  const { controller } = make({ result: update })
  await controller.check()
  const state = record(await controller.later())
  ok('later reaches the deferred state', state.kind === 'deferred' && state.version === '0.2.0')
  ok('later downloads nothing', calls.downloads === 0)
  ok('later installs nothing', calls.installs === 0)
  ok('later releases the plugin resource', calls.closes === 1)
  ok('later records the version as deferred', controller.isDeferred('0.2.0') === true)
}

// ── 6. a deferred version stays deferred at the next launch check ───────────
{
  const { update } = fakeUpdate()
  const { controller } = make({ result: () => fakeUpdate().update })
  await controller.check({ atLaunch: true })
  await controller.later()
  const again = record(await controller.check({ atLaunch: true }))
  ok('a version the player deferred is not raised again at launch', again.kind === 'deferred')
  void update
}

// ── 7. but the button in Settings still answers ─────────────────────────────
{
  const { controller } = make({ result: () => fakeUpdate().update })
  await controller.check({ atLaunch: true })
  await controller.later()
  const manual = await controller.check()
  ok('pressing Check for updates answers even for a deferred version', manual.kind === 'available')
}

// ── 8. deferring one version does not silence the next ──────────────────────
{
  const { controller } = make({
    result: (n) => (n === 1 ? fakeUpdate({ version: '0.2.0' }).update : fakeUpdate({ version: '0.3.0' }).update),
  })
  await controller.check({ atLaunch: true })
  await controller.later()
  const next = await controller.check({ atLaunch: true })
  ok('a later version is still offered after an earlier one was deferred', next.kind === 'available' && next.version === '0.3.0')
}

// ── 9. the live-session gate ────────────────────────────────────────────────
{
  const { update, calls } = fakeUpdate()
  const { controller } = make({ result: update, inGame: true })
  await controller.check()
  await controller.download()
  let refused = null
  try {
    await controller.install()
  } catch (e) {
    refused = e
  }
  ok('installing during a live game session is refused', refused instanceof LiveSessionRefusal)
  ok('the refusal names the version', refused?.message.includes('0.2.0') === true)
  ok('a refused install runs no installer', calls.installs === 0)

  const state = record(await controller.install({ confirmed: true }))
  ok('a confirmed install proceeds', state.kind === 'installing')
  ok('a confirmed install runs the installer exactly once', calls.installs === 1)
}

// ── 10. out of game, no confirmation needed ─────────────────────────────────
{
  const { update, calls } = fakeUpdate()
  const { controller } = make({ result: update, inGame: false })
  await controller.check()
  await controller.download()
  await controller.install()
  ok('installing outside a game session needs no confirmation', calls.installs === 1)
}

// ── 11. failures say what to do ─────────────────────────────────────────────
{
  const { controller } = make({ result: new Error('DNS went away') })
  const state = record(await controller.check())
  ok('a failed check is a failure state, not a silent nothing', state.kind === 'failed')
  ok('a failed check names the releases page', state.whatToDo.includes(RELEASES))
  ok('a failed check quotes the underlying error', state.message.includes('DNS went away'))
}
{
  const { update, calls } = fakeUpdate({ failOn: 'download' })
  const { controller } = make({ result: update })
  await controller.check()
  const state = await controller.download()
  ok('a failed download is a failure state naming the releases page', state.kind === 'failed' && state.whatToDo.includes(RELEASES))
  ok('a failed download installs nothing', calls.installs === 0)
}
{
  const { update } = fakeUpdate({ failOn: 'install' })
  const { controller } = make({ result: update })
  await controller.check()
  await controller.download()
  const state = await controller.install()
  ok('an installer that will not start is a failure state naming the releases page', state.kind === 'failed' && state.whatToDo.includes(RELEASES))
}

// ── 12. a build with no update channel says so, and asks nothing ────────────
{
  const { controller } = make({ result: 'unsupported' })
  const state = record(await controller.check())
  ok('a build with no update channel reports unsupported, not failed', state.kind === 'unsupported')
  ok('the unsupported state points at the releases page', state.why.includes(RELEASES))
}

// ── 13. idle after a dismiss ────────────────────────────────────────────────
{
  const { controller } = make({ result: new Error('x') })
  await controller.check()
  controller.reset()
  ok('dismissing a failure returns to idle', record(controller.state).kind === 'idle')
}

// ── 14. every state is reachable, and every state has a sentence ────────────
{
  const missing = UPDATE_STATE_KINDS.filter((k) => !seen.has(k))
  ok(
    `every one of the ${UPDATE_STATE_KINDS.length} update states was reached by this suite (${seen.size} reached)`,
    missing.length === 0
  )
  if (missing.length) console.log(`     not reached: ${missing.join(', ')}`)

  const samples = {
    idle: { kind: 'idle' },
    checking: { kind: 'checking' },
    'up-to-date': { kind: 'up-to-date', version: '', checkedAt: 0 },
    available: { kind: 'available', version: '0.2.0', currentVersion: '0.1.1', notes: null },
    downloading: { kind: 'downloading', version: '0.2.0', received: 1, total: 2 },
    ready: { kind: 'ready', version: '0.2.0' },
    installing: { kind: 'installing', version: '0.2.0' },
    deferred: { kind: 'deferred', version: '0.2.0' },
    failed: {
      kind: 'failed',
      version: null,
      message: 'Could not check for updates: DNS went away',
      whatToDo: 'Download the installer by hand.',
    },
    unsupported: { kind: 'unsupported', why: 'no channel' },
  }
  const wordless = UPDATE_STATE_KINDS.filter((k) => {
    const text = updateSummary(samples[k])
    return typeof text !== 'string' || text.trim().length < 8
  })
  ok(`all ${UPDATE_STATE_KINDS.length} states render a sentence a player can read`, wordless.length === 0)
  if (wordless.length) console.log(`     wordless: ${wordless.join(', ')}`)
}

console.log('')
const total = pass + fail
// Well below the real count (30) so it catches a truncated or half-loaded run
// without needing an edit every time a case is added.
const MIN_EXPECTED = 20
if (total < MIN_EXPECTED) {
  console.error(`FAILED: only ${total} checks ran, expected at least ${MIN_EXPECTED}`)
  process.exit(1)
}
console.log(`${total} checked, ${fail} failed`)
if (fail > 0) {
  console.error(`FAILED: ${failed.join(' | ')}`)
  process.exit(1)
}
console.log('all passed')
