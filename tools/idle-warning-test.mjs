import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import {
  IDLE_WARNING_TEXT,
  advanceIdleWarning,
  dismissIdleWarning,
  freshIdleWarningState,
  idleWarningSecondsLeft,
  isIdleWarning,
} from '../src/lib/idleWarning.ts'
import { feed, newStreamState } from '../src/lib/gameStream.ts'

let checks = 0
function check(label, callback) {
  callback()
  checks++
  console.log(`OK   ${label}`)
}
let now = 1_000_000
const line = (seq, text = IDLE_WARNING_TEXT, receivedAtMs = now, stream = '') => ({ seq, text, receivedAtMs, stream })
const start = () => freshIdleWarningState()

check('exact live-session text is recognized', () => assert.equal(isIdleWarning(line(1)), true))
check('BEL-wrapped CRLF warning is recognized', () => assert.equal(isIdleWarning(line(1, `\x07${IDLE_WARNING_TEXT}\x07\r\n`)), true))
check('harmless whitespace and casing do not hide warning', () => assert.equal(isIdleWarning(line(1, 'you have been idle too long.  please respond.')), true))
for (const stream of ['whispers', 'talk', 'thoughts', 'group']) {
  check(`quoted warning in ${stream} is not a server warning`, () => assert.equal(isIdleWarning(line(1, IDLE_WARNING_TEXT, now, stream)), false))
}
for (const text of ['You feel idle.', `Dan says, "${IDLE_WARNING_TEXT}"`, `> ${IDLE_WARNING_TEXT}`, 'PLEASE RESPOND.']) {
  check(`unrelated or quoted main-window text is ignored: ${text}`, () => assert.equal(isIdleWarning(line(1, text)), false))
}
check('actual stream parser delivers the BEL warning to detection', () => {
  const parsed = feed(newStreamState(), `\x07${IDLE_WARNING_TEXT}\x07\r\n`)
  assert.equal(parsed.length, 1)
  assert.equal(isIdleWarning(parsed[0]), true)
})
const live = advanceIdleWarning(start(), [line(1)], true, now)
check('live warning starts at the native receipt time', () => {
  assert.equal(live.warning.estimatedDeadlineMs, now + 60_000)
  assert.equal(idleWarningSecondsLeft(live.warning, now), 60)
})
check('delayed delivery subtracts elapsed time instead of granting a new minute', () => {
  const delayed = advanceIdleWarning(start(), [line(1, IDLE_WARNING_TEXT, now - 25_000)], true, now)
  assert.equal(idleWarningSecondsLeft(delayed.warning, now), 35)
})
check('overdue countdown clamps to zero without asserting disconnected', () => assert.equal(idleWarningSecondsLeft(live.warning, now + 61_000), 0))
check('clock moving backward cannot inflate countdown above a minute', () => assert.equal(idleWarningSecondsLeft(live.warning, now - 60_000), 60))
check('old backlog warning never receives a new countdown', () => assert.equal(advanceIdleWarning(start(), [line(1, IDLE_WARNING_TEXT, now - 61_000)], true, now).warning, null))
check('an already visible warning is not silently dismissed on expiry', () => assert.equal(advanceIdleWarning(live, [line(1)], true, now + 61_000).warning, live.warning))
check('ambient room text does not imply the player responded', () => assert.equal(advanceIdleWarning(live, [line(2, 'A breeze rustles the leaves.')], true, now).warning, live.warning))
check('buffer trimming does not replay or reset the warning', () => assert.equal(advanceIdleWarning(live, [], true, now), live))
const dismissed = dismissIdleWarning(live, 1)
check('dismissal preserves the cursor and does not replay the same warning', () => assert.equal(advanceIdleWarning(dismissed, [line(1)], true, now).warning, null))
const second = advanceIdleWarning(dismissed, [line(1), line(2)], true, now)
check('a new warning after dismissal is actionable again', () => assert.equal(second.warning.seq, 2))
check('late dismissal for an earlier warning cannot hide its replacement', () => assert.equal(dismissIdleWarning(second, 1), second))
const disconnected = advanceIdleWarning(live, [line(1), line(2)], false, now)
check('disconnect retires warning and consumes remaining history', () => assert.deepEqual(disconnected, { seenThrough: 2, warning: null }))
check('reconnect cannot revive the old session warning', () => assert.equal(advanceIdleWarning(disconnected, [line(1), line(2)], true, now).warning, null))
check('fresh warning after reconnect is surfaced', () => assert.equal(advanceIdleWarning(disconnected, [line(3)], true, now).warning.seq, 3))
check('quiet connection alone cannot invent an idle warning', () => assert.equal(advanceIdleWarning(start(), [], true, now).warning, null))
for (const receipt of [NaN, 0, now + 10_000]) {
  check(`unusable receipt time ${receipt} surfaces warning without a fake deadline`, () => {
    const warning = advanceIdleWarning(start(), [line(1, IDLE_WARNING_TEXT, receipt)], true, now).warning
    assert.ok(warning)
    assert.equal(idleWarningSecondsLeft(warning, now), null)
  })
}

// Execute the real component, including repeat clicks and late promises.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true
registerHooks({ load(url, context, next) {
  if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText }
  return next(url, context)
} })
const realNow = Date.now
Date.now = () => now
const timers = new Map()
let nextTimer = 0
window.setInterval = (callback) => { const id = ++nextTimer; timers.set(id, callback); return id }
window.clearInterval = (id) => { timers.delete(id) }
let soundCalls = 0
const sends = []
let send = async () => {}
mock.module('../src/lib/gameActions.ts', { namedExports: { sendGameAction: async (...args) => { sends.push(args); return send() } } })
mock.module('../src/lib/alertSound.ts', { namedExports: { playAlert: () => { soundCalls++ } } })
const { createElement } = await import('react')
const { render, screen, fireEvent, cleanup, act } = await import('@testing-library/react')
const { IdleWarningBanner } = await import('../src/components/shared/IdleWarningBanner.tsx')
const element = (lines, connected = true) => createElement(IdleWarningBanner, { lines, connected })
try {
  const view = render(element([]))
  check('quiet play screen contains no invented warning', () => assert.equal(screen.queryByRole('region', { name: 'Game idle warning' }), null))
  const firstLines = [line(10, `\x07${IDLE_WARNING_TEXT}\x07`, now - 15_000)]
  view.rerender(element(firstLines))
  check('real warning produces a prominent accessible live alert', () => assert.ok(screen.getByRole('alert', { name: '' }).textContent.includes('respond now')))
  check('actual game message is visible beside response control', () => assert.ok(screen.getByText(IDLE_WARNING_TEXT)))
  check('countdown preserves original receipt time', () => assert.match(screen.getByRole('timer').textContent, /About 45s/))
  check('warning arrival sends no automatic game commands', () => assert.equal(sends.length, 0))
  check('alert requests the normal volume-controlled sound once', () => assert.equal(soundCalls, 1))
  act(() => { now += 10_000; for (const timer of timers.values()) timer() })
  check('elapsed timer updates countdown', () => assert.match(screen.getByRole('timer').textContent, /About 35s/))
  check('countdown does not repeatedly announce or play sound', () => {
    assert.equal(screen.getByRole('timer').getAttribute('aria-live'), 'off')
    assert.equal(soundCalls, 1)
  })
  send = async () => { throw new Error('The connection rejected this command.') }
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: "I'm here (send look)" })) })
  check('command failure is visibly retained beside warning', () => assert.ok(screen.getByText('Not sent: The connection rejected this command.')))
  check('failed response is retryable', () => assert.equal(screen.getByRole('button', { name: "I'm here (send look)" }).disabled, false))
  let resolveSend
  send = () => new Promise((resolve) => { resolveSend = resolve })
  act(() => {
    const button = screen.getByRole('button', { name: "I'm here (send look)" })
    fireEvent.click(button)
    fireEvent.click(button)
  })
  check('repeated activation while pending sends only once', () => assert.equal(sends.length, 2))
  check('response follows the existing validated UI command lane', () => assert.deepEqual(sends[1], ['look', "I'm here", 'ui-action']))
  check('pending response disables the send control', () => assert.equal(screen.getByRole('button', { name: 'Sending look…' }).disabled, true))
  await act(async () => resolveSend())
  check('transport acceptance is distinguished from game acknowledgment', () => assert.match(screen.getByRole('status').textContent, /sent to Lich\. Check the game replied/))
  check('successful transport does not silently remove the warning', () => assert.ok(screen.getByRole('region', { name: 'Game idle warning' })))
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  check('dismissal hides warning without sending another command', () => {
    assert.equal(screen.queryByRole('region', { name: 'Game idle warning' }), null)
    assert.equal(sends.length, 2)
  })
  view.rerender(element([...firstLines, line(11, 'A bird sings.')]))
  check('new ambient text cannot reopen dismissed warning', () => assert.equal(screen.queryByRole('region', { name: 'Game idle warning' }), null))
  view.rerender(element([line(12)]))
  fireEvent.click(screen.getByRole('button', { name: "I'm here (send look)" }))
  const resolveOld = resolveSend
  view.rerender(element([line(13)]))
  await act(async () => resolveOld())
  check('late response cannot mark a newer warning as answered', () => assert.equal(screen.getByRole('button', { name: "I'm here (send look)" }).disabled, false))
  act(() => { now += 61_000; for (const timer of timers.values()) timer() })
  check('expired estimate remains actionable without claiming disconnected', () => {
    assert.match(screen.getByRole('timer').textContent, /estimated response time has elapsed/)
    assert.equal(screen.getByRole('button', { name: "I'm here (send look)" }).disabled, false)
  })
  view.rerender(element([line(13)], false))
  check('actual disconnect removes unusable response controls', () => assert.equal(screen.queryByRole('region', { name: 'Game idle warning' }), null))
  check('disconnect clears the banner clock', () => assert.equal(timers.size, 0))
  view.rerender(element([line(13)]))
  check('reconnect with retained raw scrollback cannot revive warning', () => assert.equal(screen.queryByRole('region', { name: 'Game idle warning' }), null))
  view.rerender(element([line(14)]))
  fireEvent.click(screen.getByRole('button', { name: "I'm here (send look)" }))
  const resolveDismissed = resolveSend
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  await act(async () => resolveDismissed())
  check('dismissing while a send is pending stays dismissed on completion', () => assert.equal(screen.queryByRole('region', { name: 'Game idle warning' }), null))
} finally {
  cleanup()
  Date.now = realNow
  dom.window.close()
  mock.restoreAll()
}

const signals = readFileSync('src/components/shared/GameSignals.tsx', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')
check('mounted GameSignals passes raw ungagged lines to the banner', () => {
  assert.match(signals, /const lines = useRawGameLines\(\)/)
  assert.match(signals, /<IdleWarningBanner lines=\{lines\} connected=\{linkPhase\(link\) === 'connected'\}/)
})
check('warning is reachable at app root independently of AI enablement', () => assert.match(app, /\{setupComplete && <GameSignals\s*\/>\}/))
console.log(`idle warning: ${checks} checks passed`)
