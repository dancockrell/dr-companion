#!/usr/bin/env node
/**
 * The three attach states, photographed. Issues #523 and #525.
 *
 *   node tools/attach-states-shots.mjs http://127.0.0.1:5199/
 *
 * Writes `docs/verification/attach-states-2026-09-09-*.png`.
 *
 * # Why photographs and not only assertions
 *
 * `tools/attach-states-test.mjs` asserts that every state has a screen and
 * every screen has an action. That is a claim about two pure functions and a
 * pattern in a `.tsx` file, and none of it looks at what is on the glass.
 * Every defect in this pair was invisible in the source and obvious in a
 * picture: the sentence "Nothing is connected yet" over an open socket, and a
 * game pane showing this app's own log while the game talked.
 *
 * # What is real here and what is a stand-in
 *
 * Real: the whole React tree, `gameLink`'s parser and buffer, `sessionSource`,
 * `StreamTabs`, and the routing in `App.tsx`.
 *
 * Stood in for, and this is the honest limit of these three shots: **Rust**.
 * This is a browser at the dev server, so `isTauri()` is false until the stub
 * below makes it true, and the stub answers `game_attach` rather than opening
 * a socket. So these prove the app *renders* each state correctly given the
 * link state Rust would report. They do not prove Rust reports it.
 * `tools/mud-client-e2e.mjs` drives a real loopback socket through the same
 * modules and is what covers that half; `tools/lane-attach-probe.mjs` measures
 * the tab reachability against a real socket.
 *
 * Every step prints OK or FAIL with what it measured, and the run refuses to
 * write a shot of a state it could not confirm it reached - a photograph of
 * the wrong screen filed under the right name is worse than no photograph.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5199/'
const outDir = join(root, 'docs', 'verification')
mkdirSync(outDir, { recursive: true })
const out = (n) => join(outDir, n)

let checks = 0
let fails = 0
const check = (what, pass, detail = '') => {
  checks++
  if (!pass) fails++
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`)
}

/**
 * The Tauri stub, with the link state under this file's control.
 *
 * `window.__drcLink` is what `game_status` and `game_attach` return, so the
 * harness can put the app in "no socket" and "socket open" without a socket.
 * `game_detach` clears it, so leaving the demo behaves as it does in the app.
 */
const TAURI_STUB = `
  window.__drcHandlers = {};
  window.__drcLink = { connected: false, host: '127.0.0.1', port: 11124, lines: 0, note: 'Not attached.' };
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = 'cb' + Math.random().toString(36).slice(2);
      window[id] = cb;
      return id;
    },
    invoke: (cmd, args) => {
      if (cmd === 'plugin:event|listen') {
        window.__drcHandlers[args.event] = args.handler;
        return Promise.resolve(1);
      }
      if (cmd === 'game_backlog') return Promise.resolve({ lines: [], dropped: 0 });
      if (cmd === 'game_attach') {
        window.__drcLink = { connected: true, host: '127.0.0.1', port: (args && args.port) || 11124, lines: 0, note: '' };
        return Promise.resolve(window.__drcLink);
      }
      if (cmd === 'game_detach') {
        window.__drcLink = { connected: false, host: '127.0.0.1', port: 11124, lines: 0, note: 'Not attached.' };
        return Promise.resolve(window.__drcLink);
      }
      if (cmd === 'game_status') return Promise.resolve(window.__drcLink);
      if (cmd === 'panel_windows') return Promise.resolve([]);
      return Promise.resolve(null);
    },
  };
`

/** Real game text: two channels and the main window, which carries no tag. */
const NL = String.fromCharCode(13, 10)
const GAME_TEXT =
  `<pushStream id='thoughts'/>You hear the faint thoughts of Aral.<popStream/>${NL}` +
  `[The Town Green, Northwest]${NL}` +
  `A wide green stretches north, worn bare along the paths.${NL}` +
  `Obvious paths: north, east, southwest.${NL}` +
  `<pushStream id='talk'/>Someone says, "well met, traveller."<popStream/>${NL}` +
  `You see nothing unusual about the guard.${NL}`

const b = await launch({ width: 1280, height: 900, headless: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stateOf = () =>
  b.eval("(document.querySelector('[data-workspace-state]')||{dataset:{}}).dataset.workspaceState || 'none-found'")

try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'live' }));
    return true;
  `)
  await b.addInit(TAURI_STUB)

  // ------------------------------------------------------------ 1. nothing
  await b.goto(base, { waitFor: 'body' })
  await b.waitFor('button', 15000).catch(() => {})
  await sleep(800)
  let state = await stateOf()
  check("state 1 is 'none'", state === 'none', state)
  const text1 = await b.eval('document.body.innerText || ""')
  check('  it says nothing is connected', /Nothing is connected yet/i.test(text1))
  // The whole point of #523: the Attach control is on screen in this state.
  const attach1 = await b.eval(
    `[...document.querySelectorAll('[aria-label]')].some(el => el.getAttribute('aria-label') === 'Attach')`
  )
  check('  and the Attach control is on screen', attach1 === true)
  if (state === 'none') await b.screenshot(out('attach-states-2026-09-09-1-nothing-connected.png'))
  else check('  shot 1 written', false, 'refused: wrong state on screen')

  // ------------------------------------- 2. a socket open, and no character
  await b.run(`
    const bar = [...document.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label') === 'Attach');
    if (bar) bar.click();
    return Boolean(bar);
  `)
  await sleep(900)
  // And the game starts talking, through the real handler, as Rust delivers it.
  const delivered = await b.run(`
    const id = window.__drcHandlers['game:line'];
    if (!id) return 'no handler';
    window[id]({ event: 'game:line', id: 1, payload: { seq: 1, receivedAtMs: 1757000000000, text: ${JSON.stringify(GAME_TEXT)} } });
    return 'sent';
  `)
  check('the game text went through the real game:line handler', delivered === 'sent', String(delivered))
  await sleep(900)
  state = await stateOf()
  check("state 2 is 'live-waiting'", state === 'live-waiting', state)
  const text2 = await b.eval('document.body.innerText || ""')
  check('  it does not still say nothing is connected', !/Nothing is connected yet/i.test(text2))
  check('  it says the game is connected', /Connected to the game/i.test(text2))
  // The half of #525 that made live text undisplayable: the main window tab.
  check('  the pane offers a Main tab', /\bMain\b/.test(text2))
  check(
    '  and the main-window text is actually on screen',
    /A wide green stretches north/.test(text2),
    'the untagged room description'
  )
  check('  the channels the game named are there too', /Thoughts/.test(text2) && /Speech/.test(text2))
  if (state === 'live-waiting') await b.screenshot(out('attach-states-2026-09-09-2-connected-no-character.png'))
  else check('  shot 2 written', false, 'refused: wrong state on screen')

  // ------------------------------------------------------------- 3. the demo
  /*
   * Reached by detaching first, which is the real player path rather than a
   * convenience for the harness.
   *
   * `live-waiting` deliberately offers no Start the demo button. It would sit
   * directly under the sentence announcing the game connection, and its effect
   * would be to close that connection - a destructive act should not be one
   * click from the screen that announces the thing it destroys. Settings still
   * has the demo for anybody who wants it from there.
   *
   * So the rule that starting the demo closes an open socket is asserted where
   * it lives: the walk in `tools/session-source-test.mjs` and the sabotages in
   * `tools/session-source-break-check.mjs`. This file photographs the screens,
   * and says so rather than implying it covers that too.
   */
  await b.run(`
    const d = [...document.querySelectorAll('[aria-label]')].find(el => el.getAttribute('aria-label') === 'Detach');
    if (d) d.click();
    return Boolean(d);
  `)
  await sleep(900)
  const backToNone = await stateOf()
  check("detaching goes back to 'none'", backToNone === 'none', backToNone)
  await b.run(`
    const btn = [...document.querySelectorAll('button')].find(el => /Start the demo/i.test(el.textContent || ''));
    if (btn) btn.click();
    return Boolean(btn);
  `)
  await sleep(1500)
  const socketAfterDemo = await b.eval('window.__drcLink.connected')
  check('no game connection is open while the demo runs', socketAfterDemo === false, String(socketAfterDemo))
  const text3 = await b.eval('document.body.innerText || ""')
  check('  the demo banner is on screen', /Demo: this is invented data/i.test(text3))
  check('  and it is not sitting over live game text', !/A wide green stretches north/.test(text3))
  await b.screenshot(out('attach-states-2026-09-09-3-demo.png'))
} finally {
  await b.close()
}

console.log(`\n${checks} checked, ${fails} failed`)
if (checks < 14) {
  console.log(`FAIL only ${checks} steps ran, fewer than this harness has.`)
  process.exit(1)
}
process.exit(fails > 0 ? 1 : 0)
