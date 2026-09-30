import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.IS_REACT_ACT_ENVIRONMENT = true
registerHooks({ load(url, context, next) {
  if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText }
  return next(url, context)
} })
let native = true
let app = { bridgeMode: 'live', bridgeConnected: true }
let status = { installed: true, running: false, runningKnown: true, path: '/viewer', exitCode: null }
let statusError = null
let launches = 0
let launch = async () => 'Opened 3D viewer'
mock.module('../src/lib/tauri.ts', { namedExports: { isTauri: () => native } })
mock.module('../src/store/useAppStore.ts', { namedExports: { useAppStore: (select) => select(app) } })
mock.module('../src/lib/viewerClient.ts', { namedExports: {
  viewerStatus: async () => { if (statusError) throw statusError; return { ...status } },
  launchViewer: async () => { launches++; return launch() },
  viewerExitNote: (s) => s && !s.running && s.exitCode !== null ? `Viewer exited (${s.exitCode})` : null,
} })
const { createElement } = await import('react')
const { render, screen, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react')
const { WorldViewerControl } = await import('../src/components/room/WorldViewerControl.tsx')
let checks = 0
function check(label, callback) { callback(); checks++; console.log(`OK   ${label}`) }
try {
  render(createElement(WorldViewerControl))
  await screen.findByText('Ready to explore')
  check('3D launch is available directly on play surface', () => assert.equal(screen.getByRole('button', { name: 'Open 3D view' }).disabled, false))
  let resolveLaunch
  launch = () => new Promise((resolve) => { resolveLaunch = resolve })
  const open = screen.getByRole('button', { name: 'Open 3D view' })
  act(() => { fireEvent.click(open); fireEvent.click(open) })
  check('repeated activation launches only once', () => assert.equal(launches, 1))
  check('opening disables launch', () => assert.equal(screen.getByRole('button', { name: 'Opening…' }).disabled, true))
  status.running = true
  await act(async () => resolveLaunch('Opened 3D viewer'))
  await screen.findByText('Open in a separate window')
  check('running viewer cannot be launched twice', () => assert.equal(screen.getByRole('button', { name: '3D view open' }).disabled, true))
  status.running = false; status.exitCode = 0
  fireEvent.focus(window)
  await screen.findByText('Ready to reopen')
  check('closing viewer enables relaunch on return', () => assert.equal(screen.getByRole('button', { name: 'Reopen 3D view' }).disabled, false))
  launch = async () => { throw new Error('Missing executable') }
  fireEvent.click(screen.getByRole('button', { name: 'Reopen 3D view' }))
  await screen.findByText('Could not open the 3D view: Missing executable')
  check('failed launch offers retry and readable error', () => assert.equal(screen.getByRole('button', { name: 'Reopen 3D view' }).disabled, false))
  status.installed = false
  fireEvent.click(screen.getByRole('button', { name: 'Refresh 3D viewer status' }))
  await screen.findByText('Not included in this build')
  check('missing viewer is explained without dead launch', () => assert.equal(screen.getByRole('button', { name: 'Reopen 3D view' }).disabled, true))
  cleanup()
  native = false; app.bridgeMode = 'mock'; app.bridgeConnected = false
  render(createElement(WorldViewerControl))
  check('browser preview clearly requires desktop', () => assert.ok(screen.getByText('Desktop app required')))
  check('demo source is explicitly labelled', () => assert.match(document.body.textContent, /Demo world/))
  check('browser cannot pretend to launch native viewer', () => assert.equal(screen.getByRole('button', { name: 'Open 3D view' }).disabled, true))
  cleanup()
  native = true; app.bridgeMode = 'live'; statusError = new Error('Offline')
  render(createElement(WorldViewerControl))
  await screen.findByText('Could not check the 3D view: Offline')
  check('status failures are visible with retry', () => assert.ok(screen.getByRole('button', { name: 'Refresh 3D viewer status' })))
  check('disconnected source never claims live world', () => assert.match(document.body.textContent, /Waiting for your game/))
  statusError = null; status.installed = true; status.runningKnown = false; status.exitCode = null
  fireEvent.focus(window)
  await screen.findByText('Installed · could not check whether open')
  check('unknown process state never claims ready or allows duplicate launch', () => assert.equal(screen.getByRole('button', { name: 'Open 3D view' }).disabled, true))
  check('successful automatic check clears stale check error', () => assert.equal(document.body.textContent.includes('Could not check'), false))
  status.runningKnown = true
  fireEvent.focus(window)
  await screen.findByText('Ready to explore')
  check('status recovery enables launch again', () => assert.equal(screen.getByRole('button', { name: 'Open 3D view' }).disabled, false))
  status.exitCode = 23
  fireEvent.focus(window)
  await screen.findByText('Viewer exited (23)')
  check('crash exit reason is visible with relaunch', () => assert.equal(screen.getByRole('button', { name: 'Reopen 3D view' }).disabled, false))
} finally { cleanup(); dom.window.close(); mock.restoreAll() }
console.log(`world viewer control: ${checks} checks passed`)
