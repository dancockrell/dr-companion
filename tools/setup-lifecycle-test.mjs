import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { JSDOM } from 'jsdom'
import { createElement, StrictMode } from 'react'
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement
registerHooks({ load(url, context, next) {
  if (new URL(url).pathname.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url.split('?')[0]), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText }
  return next(url, context)
} })
const timers = new Map(); let timerId = 0
window.setTimeout = (fn) => { timers.set(++timerId, fn); return timerId }
window.clearTimeout = (id) => timers.delete(id)
let entered = 0, connected = 0, checks = 0, plans = [], installs = []
const state = { setSetupComplete: () => entered++, connectBridge: () => connected++, addLog: () => {}, setupReopened: false }
mock.module('../src/store/useAppStore.ts', { namedExports: { useAppStore: (select) => select(state) } })
mock.module('../src/lib/tauri.ts', { namedExports: { isTauri: () => true } })
const setup = Object.fromEntries(['downloadComponent', 'installBundledRuby4Lich5', 'extractArchive', 'installBridgeScript', 'installBundle', 'runInstaller', 'revealFile'].map((name) => [name, async () => {}]))
Object.assign(setup, { installBridgeScript: () => new Promise((resolve) => installs.push(resolve)), planSetup: () => new Promise((resolve, reject) => plans.push({ resolve, reject })), appDataPath: async () => '/data', frontendConflictStatus: async () => ({ known: true, running: false }), onSetupProgress: () => () => {} })
mock.module('../src/lib/setup.ts', { namedExports: setup })
mock.module('../src/components/first-run/Preflight.tsx', { namedExports: { Preflight: ({ onSkip }) => createElement('button', { onClick: onSkip }, 'Skip setup') } })
mock.module('../src/components/first-run/ComponentCard.tsx', { namedExports: { ComponentCard: ({ onInstallBridge }) => createElement('button', { onClick: onInstallBridge }, 'Install bridge') } })
for (const name of ['NoobChecklist', 'ConnectGuide', 'DependencyStrip']) mock.module(`../src/components/first-run/${name}.tsx`, { namedExports: { [name]: () => null } })
const { render, cleanup, act, fireEvent, screen } = await import('@testing-library/react')
const { SetupWizard } = await import('../src/components/first-run/SetupWizard.tsx')
const ready = { ready: true, components: [{ id: 'ruby', required: true, presence: 'present', options: [] }] }
function check(label, callback) { callback(); checks++; console.log(`OK   ${label}`) }
async function flushTimers() { await act(async () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn() } }) }
try {
  const first = render(createElement(SetupWizard))
  first.unmount()
  await act(async () => plans.shift().resolve(ready))
  await flushTimers()
  check('leaving setup cancels an unfinished dependency check', () => assert.equal(entered, 0))
  render(createElement(SetupWizard))
  fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }))
  await act(async () => plans.shift().resolve(ready))
  await flushTimers()
  check('skip enters once despite late ready response', () => assert.equal(entered, 1))
  check('skip attaches only one bridge connection', () => assert.equal(connected, 1))
  cleanup()
  entered = 0; connected = 0
  render(createElement(StrictMode, null, createElement(SetupWizard)))
  const old = plans.shift(); const latest = plans.shift()
  await act(async () => latest.resolve(ready))
  await act(async () => old.resolve(ready))
  await flushTimers()
  check('Strict Mode repeated check connects only once', () => assert.equal(connected, 1))
  check('Strict Mode repeated check enters only once', () => assert.equal(entered, 1))
  cleanup()
  entered = 0
  const pending = render(createElement(SetupWizard))
  await act(async () => plans.shift().resolve(ready))
  pending.unmount()
  await flushTimers()
  check('unmount cancels already scheduled automatic entry', () => assert.equal(entered, 0))
  render(createElement(SetupWizard))
  await act(async () => plans.shift().resolve({ ...ready, ready: false }))
  await flushTimers()
  fireEvent.click(screen.getByRole('button', { name: 'Install bridge' }))
  cleanup()
  await act(async () => installs.shift()('/bridge'))
  check('finishing installation after unmount cannot start a new check', () => assert.equal(plans.length, 0))
  await flushTimers()
  check('late installer completion cannot reopen setup or connect', () => assert.equal(entered, 0))
} finally { cleanup(); dom.window.close(); mock.restoreAll() }
console.log(`setup lifecycle: ${checks} checks passed`)
