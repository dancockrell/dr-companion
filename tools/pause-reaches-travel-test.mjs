/**
 * Pause has to reach everything that can move the character - including the
 * half of automation that never touches the Rust command lane.
 *
 * Issue #462. `pause.rs` claimed the lane was "the one place every automated
 * command passes through". It is not: `map_walk` is a bridge intent, handled
 * inside `companion_bridge.lic`, and it starts Lich's `go2` as its own script.
 * Every movement command that route sends comes from inside Lich, so the lane
 * never sees one and `paused` is never consulted. Pressing Pause and then
 * clicking a distant tile walked the character across a zone.
 *
 * # Why this is a class check rather than one more case
 *
 * The bug is not "map_walk forgot a check". It is that a mover can be added on
 * the bridge side with nothing anywhere asking whether Pause reaches it -
 * exactly how this one arrived (#447 turned the viewer's read-only
 * `focus-room` into `travel-to-room`, which routes to `map_walk`).
 *
 * So the population is **derived from the bridge's own dispatch table**, not
 * listed here. A handler that starts a Lich script, or that sends commands the
 * player supplied, is a mover; every mover must appear in `PAUSE_HELD` and must
 * consult `pause_refusal` by name. N of N, with the names printed. A new mover
 * that skips the latch is red without anybody remembering to add a case.
 *
 * Sabotage: `tools/pause-reaches-travel-break-check.mjs` removes the latch
 * check from `map_walk` and requires this file to go red naming it, then
 * restores the file and verifies by hash.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks
 *      tools/pause-reaches-travel-test.mjs
 */
import { mock } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

let checks = 0
let failures = 0

function ok(cond, what, detail = '') {
  checks++
  if (cond) {
    console.log(`OK   ${what}${detail ? `: ${detail}` : ''}`)
  } else {
    failures++
    console.log(`FAIL ${what}${detail ? `: ${detail}` : ''}`)
  }
}

const LIC = 'lich-scripts/companion_bridge.lic'
const src = readFileSync(LIC, 'utf8').replace(/\r\n/g, '\n')

/* ------------------------------------------------------------------ */
/* Part 1 - the population, read from the bridge's own dispatch table  */
/* ------------------------------------------------------------------ */

/**
 * The intent names `Intents.dispatch` actually routes, from `HANDLERS`.
 *
 * The same object `implemented_intents` returns, so this cannot drift from
 * what the bridge really does the way a list parked in this file would.
 */
function handlerTable() {
  const block = src.match(/\n {4}HANDLERS = \{\n([\s\S]*?)\n {4}\}\.freeze/)
  if (!block) throw new Error('pause-reaches-travel-test: could not find HANDLERS in ' + LIC)
  const out = new Map()
  // One entry per line that opens a key. The lambda body may run on to the
  // next lines (several are multi-line), so the value captured here is only
  // used to find which method the intent routes to.
  for (const m of block[1].matchAll(/^ {6}'([\w:]+)'\s*=>\s*(.*)$/gm)) {
    out.set(m[1], m[2])
  }
  return out
}

const HANDLERS = handlerTable()
ok(HANDLERS.size >= 20, `the dispatch table was read (${HANDLERS.size} intents)`)
ok(HANDLERS.has('map_walk'), 'and it contains map_walk, the intent #462 is about')
ok(HANDLERS.has('run_macro') && HANDLERS.has('start_script'), 'and the other two movers')

/** The body of a `def name ... end` at module-body indentation. */
function methodBody(name) {
  const re = new RegExp(`\\n {4}def ${name}\\b[^\\n]*\\n([\\s\\S]*?)\\n {4}end\\n`)
  const m = src.match(re)
  return m ? m[1] : null
}

/**
 * Which intents can put the character in motion, decided by what their code
 * does rather than by a list.
 *
 * Two ways an intent moves things:
 *
 *   it starts a Lich script - `Script.start(...)`, which then acts on its own
 *   it sends commands the player supplied - `run_macro`, arbitrary game text
 *
 * The second cannot be derived from `Script.start`, so it is named, with the
 * reason, and asserted to be real below rather than assumed.
 */
const PLAYER_SUPPLIED_COMMANDS = ['run_macro']

/**
 * Movers that deliberately need no pause check, each with why.
 *
 * `install_mapdb` starts `download-prime-map`/`repository`: a network fetch of
 * Lich's map database. It moves nothing and sends no game command, so holding
 * it while paused would refuse a download for no safety reason. Asserted, not
 * asserted-by-comment: its body must not send a game command.
 */
const EXEMPT = {
  install_mapdb: 'starts a download, not a walker - sends no game command',
}

const movers = []
for (const intent of HANDLERS.keys()) {
  const body = methodBody(intent)
  if (body === null) continue // an inline lambda (trace_on and friends), not a method
  const startsAScript = /Script\.start\(/.test(body)
  if (startsAScript || PLAYER_SUPPLIED_COMMANDS.includes(intent)) movers.push(intent)
}

console.log(`\n-- movers derived from ${LIC}: ${movers.join(', ')} --`)
ok(movers.length >= 3, `the derivation found movers (${movers.length})`)
ok(movers.includes('map_walk'), 'derivation control: map_walk reads as a mover')
ok(
  movers.includes('install_mapdb'),
  'derivation control: install_mapdb reads as a mover too, so the exemption below is doing real work'
)
{
  // A classifier that matched everything would make the check vacuous from
  // the other direction. Read-only queries must not read as movers.
  const readOnly = ['map_here', 'map_path', 'map_zone', 'list_scripts', 'read_settings']
  const wrong = readOnly.filter((i) => movers.includes(i))
  ok(wrong.length === 0, `read-only intents are not movers${wrong.length ? ` (got ${wrong.join(', ')})` : ''}`)
  ok(
    readOnly.every((i) => HANDLERS.has(i)),
    'and those read-only intents really exist, so that check had something to examine'
  )
}
{
  const body = methodBody('run_macro')
  ok(
    body !== null && /Cmd\.exec\(/.test(body),
    'run_macro really does send player-supplied commands, which is why it is named above'
  )
}
for (const [intent, why] of Object.entries(EXEMPT)) {
  const body = methodBody(intent)
  ok(body !== null, `exempt ${intent} exists`)
  ok(
    body !== null && !/Cmd\.exec\(|send_raw\(/.test(body),
    `exempt ${intent} sends no game command (${why})`
  )
}

/* ------------------------------------------------------------------ */
/* Part 2 - every mover consults the latch, N of N                     */
/* ------------------------------------------------------------------ */

function pauseHeldKeys() {
  const block = src.match(/\n {4}PAUSE_HELD = \{\n([\s\S]*?)\n {4}\}\.freeze/)
  if (!block) throw new Error('pause-reaches-travel-test: could not find PAUSE_HELD in ' + LIC)
  return [...block[1].matchAll(/^ {6}'([\w]+)'\s*=>/gm)].map((m) => m[1])
}

const held = pauseHeldKeys()
console.log(`\n-- the bridge's declared pause-refusal set: ${held.join(', ')} --`)
ok(held.length >= 3, `PAUSE_HELD was read (${held.length} entries)`)

const shouldHold = movers.filter((i) => !(i in EXEMPT))
let covered = 0
for (const intent of shouldHold) {
  const body = methodBody(intent)
  const declared = held.includes(intent)
  const consults = body !== null && body.includes(`pause_refusal('${intent}')`)
  ok(declared, `${intent} is declared in PAUSE_HELD`)
  ok(consults, `${intent} consults the latch by name`)
  if (declared && consults) covered++
}
ok(
  covered === shouldHold.length,
  `every mover that should be held is held: ${covered} of ${shouldHold.length} (${shouldHold.join(', ')})`
)

// The other direction: a declared refusal for an intent that is not a mover is
// either a mover the derivation stopped seeing, or a dead entry. Both matter.
{
  const stray = held.filter((i) => !shouldHold.includes(i))
  ok(stray.length === 0, `no PAUSE_HELD entry names something that is not a held mover${stray.length ? ` (${stray.join(', ')})` : ''}`)
}

/* ------------------------------------------------------------------ */
/* Part 3 - the latch is wired to Pause, and reported back             */
/* ------------------------------------------------------------------ */

console.log('\n-- the latch is set, cleared and published --')
{
  const pauseAll = methodBody('pause_all')
  const resumeAll = methodBody('resume_all')
  ok(pauseAll !== null && /request_pause!/.test(pauseAll), 'pause_all latches')
  ok(resumeAll !== null && /clear_pause!/.test(resumeAll), 'resume_all clears the latch')
  ok(
    resumeAll !== null && /Script\.unpause/.test(resumeAll),
    'resume_all unpauses the scripts it suspended, so a route continues rather than being cancelled'
  )
  ok(
    pauseAll !== null && /Script\.pause/.test(pauseAll),
    'pause_all still suspends what is already running - the snapshot half'
  )
  ok(/'pauseLatched' => safe\(false\) \{ Intents\.pause_requested\? \}/.test(src),
    'status publishes pauseLatched')
  // And exactly once. The first draft of this change also put the field on the
  // `hello` frame, where nothing read it and where the very next line sends a
  // full status carrying the same fact - a second answer to one question.
  const publishes = src
    .split('\n')
    // Code lines only. A comment mentioning the field is prose, not a second
    // copy of it - counting text rather than parsing is how the first version
    // of this check reported the explanation as the defect.
    .filter((line) => !/^\s*#/.test(line) && line.includes('pauseLatched'))
  ok(
    publishes.length === 1,
    `and nothing else in the bridge publishes a second copy of it (${publishes.length})`,
    publishes.map((l) => l.trim()).join(' | ')
  )
  ok(!/clear_pause!/.test(methodBody('run_macro') ?? ''),
    'nothing but resume clears the latch: run_macro does not')
  ok(!/clear_pause!/.test(methodBody('map_walk') ?? ''), 'nor does map_walk')
}

/* ------------------------------------------------------------------ */
/* Part 4 - the app half                                               */
/* ------------------------------------------------------------------ */

console.log('\n-- the app: one sender, one vocabulary, three states --')

const { pauseStatus, PAUSED_TRAVEL_REFUSAL } = await import('../src/lib/pauseStatus.ts')

{
  // The refusal a player reads before the intent leaves this process must be
  // the sentence the bridge would have answered with. Two producers of one
  // refusal, checked against each other rather than trusted to stay in step.
  const bridgeSentence = src.match(/'map_walk'\s*=>\s*'([^']+)'/)?.[1]
  ok(Boolean(bridgeSentence), 'the bridge sentence for map_walk was read', bridgeSentence)
  ok(
    bridgeSentence === PAUSED_TRAVEL_REFUSAL,
    'the app refuses travel in the bridge\'s own words',
    `${PAUSED_TRAVEL_REFUSAL} / ${bridgeSentence}`
  )
}

{
  const running = pauseStatus({ appPaused: false, bridgeConnected: true, bridgePauseLatched: false })
  const confirmed = pauseStatus({ appPaused: true, bridgeConnected: true, bridgePauseLatched: true })
  const old = pauseStatus({ appPaused: true, bridgeConnected: true, bridgePauseLatched: undefined })
  const down = pauseStatus({ appPaused: true, bridgeConnected: false })
  const said = pauseStatus({ appPaused: true, bridgeConnected: true, bridgePauseLatched: false })
  ok(running.state === 'running', 'not paused reads as running')
  ok(confirmed.state === 'paused-confirmed', 'paused + latched reads as confirmed')
  ok(old.state === 'paused-unconfirmed', 'a bridge with no such field is unconfirmed, never confirmed')
  ok(down.state === 'paused-unconfirmed', 'a bridge that is not there is unconfirmed')
  ok(said.state === 'paused-unconfirmed', 'and a bridge that says false is unconfirmed too')
  ok(
    new Set([running.state, confirmed.state, old.state]).size === 3,
    'three states are actually distinguishable, not one label with three spellings'
  )
  ok(
    old.detail !== confirmed.detail && old.detail.length > 20,
    'the unconfirmed state says what a player can do about it'
  )
}

{
  // One sender. Before #462 both SafetyFooter and CommandPalette sent the
  // bridge intent by hand beside `requestPauseAll`, so a third caller would
  // have had to remember the pair - which is the same gap, one layer out.
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

  const senders = walked.filter((f) =>
    /requestIntent\(\s*'(pause|resume)'/.test(readFileSync(f, 'utf8'))
  )
  ok(
    senders.join(', ') === 'src/lib/bridgePauseRelay.ts',
    `the bridge pause intent has exactly one sender (found: ${senders.join(', ') || 'none'})`
  )
  ok(
    /installBridgePauseRelay\(\)/.test(readFileSync('src/main.tsx', 'utf8')),
    'and every window installs it'
  )
}

{
  // Behavioural, not a source read: pressing Pause really does put the intent
  // on the bridge. `bridge.send` is captured rather than mocked at module
  // level so this exercises the real relay, the real signal and the real
  // `requestPauseAll`.
  //
  // The bridge facade is doubled rather than imported: `mockBridge.ts` reaches
  // `import.meta.glob`, which is Vite's and does not exist under node, so the
  // real module cannot be loaded here at all. The double records what the relay
  // asked for, which is the proposition - everything between `requestPauseAll`
  // and that call is the real code.
  const sent = []
  const bridgeDouble = {
    bridge: {
      requestIntent: (intent, args) => sent.push({ type: 'intent', intent, args }),
    },
  }
  const nodeMajor = Number(process.versions.node.split('.')[0])
  const asExports = (stub) => (nodeMajor >= 24 ? { exports: stub } : { namedExports: stub })
  mock.module('../src/bridge/index.ts', asExports(bridgeDouble))
  // And the Tauri layer, for the reason `tools/kill-switch-test.mjs` gives:
  // there is no shell here, `set_paused` has nothing to reach, and the real
  // module's dynamic import of the Tauri API leaves the loop with work to do
  // at exit. Same double, same option-name-per-Node-version dance.
  mock.module(
    '../src/lib/tauri.ts',
    asExports({
      isTauri: () => false,
      listenTauri: () => () => {},
      invokeTauri: async () => undefined,
      setAlwaysOnTop: async () => {},
      getBridgeDefaultUrl: async () => '',
    })
  )

  const flowStop = await import('../src/lib/flowStop.ts')
  const { installBridgePauseRelay } = await import('../src/lib/bridgePauseRelay.ts')
  installBridgePauseRelay()

  {
    // The double is only worth something if the relay actually reaches it.
    const { bridge } = await import('../src/bridge/index.ts')
    ok(typeof bridge.requestIntent === 'function', 'the bridge double is in place')
  }

  // Deliberately not restored afterwards. `mock.restoreAll()` on this Node
  // (24.19.0, Windows) aborts the process at teardown with a libuv assertion
  // (`!(handle->flags & UV_HANDLE_CLOSING)`) and exit 127 - a crash *after* the
  // last check printed, which is precisely the shape that reads as a pass in a
  // runner that only looks at output. The mock lives for the rest of this
  // process and nothing after it imports the bridge.
  {
    flowStop.requestPauseAll()
    ok(
      sent.filter((m) => m.type === 'intent' && m.intent === 'pause').length === 1,
      'requestPauseAll put exactly one pause intent on the bridge',
      JSON.stringify(sent)
    )
    ok(flowStop.isAutomationPaused() === true, 'and the app records itself as paused')

    sent.length = 0
    flowStop.requestResumeAll()
    ok(
      sent.filter((m) => m.type === 'intent' && m.intent === 'resume').length === 1,
      'requestResumeAll put exactly one resume intent on the bridge',
      JSON.stringify(sent)
    )
    ok(flowStop.isAutomationPaused() === false, 'and the app records itself as running')
  }
}

{
  // The travel path refuses before the intent leaves. Source-level, because
  // the behaviour needs a Tauri event bus; the behavioural half of the same
  // proposition is `pause_test.rb`'s "map_walk refused while paused", against
  // the bridge that is the authority anyway.
  const intents = readFileSync('src/lib/presentationIntents.ts', 'utf8')
  ok(/isAutomationPaused\(\)/.test(intents), 'presentationIntents.ts consults Pause')
  const travelBlock = intents.match(/travelTargetForIntent[\s\S]*?requestIntent\('map_walk'/)?.[0] ?? ''
  ok(
    travelBlock.includes('isAutomationPaused()') &&
      travelBlock.indexOf('isAutomationPaused()') < travelBlock.indexOf("requestIntent('map_walk'"),
    'and it does so before sending map_walk, not after'
  )
  ok(/PAUSED_TRAVEL_REFUSAL/.test(intents), 'and reports the shared sentence')
}

/* ------------------------------------------------------------------ */

console.log('\n-- the claim pause.rs makes about its own coverage --')
{
  const pauseRs = readFileSync('src-tauri/src/pause.rs', 'utf8')
  // The sentence that was 95% true is what stopped the next reviewer looking
  // at the other 5%. It must not come back unqualified.
  const claimsEverything = /every automated command passes through/.test(pauseRs)
  ok(
    !claimsEverything || /map_walk|bridge/.test(pauseRs),
    'pause.rs does not claim the lane is the only path without naming the bridge half'
  )
  ok(/map_walk/.test(pauseRs), 'pause.rs names travel explicitly')
}

ok(checks >= 35, `enough was checked for a pass to mean something (${checks} checks)`)
console.log(failures ? `\n${failures} failed` : '\nall pause-reaches-travel checks passed')

// `process.exitCode`, never `process.exit()`. With a module mock installed,
// exiting while the loader still holds its side channel aborts this Node
// (24.19.0, Windows) on a libuv assertion and returns 127 - *after* the last
// line above has printed, so a runner reading only the output sees a pass while
// the exit code says failure with no failing check named. Measured both ways
// before this line was written. Letting the loop drain costs milliseconds and
// reports the real result.
await new Promise((resolve) => setTimeout(resolve, 20))
process.exitCode = failures ? 1 : 0
