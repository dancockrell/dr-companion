#!/usr/bin/env node
/**
 * Gags in a real browser: add one, watch the line go, put it back.
 *
 * `tools/line-rules-test.mjs` proves the resolver and the store. It does not
 * mount a component, so it cannot say that the game pane is one line shorter,
 * that the "Show hidden" switch appears at all, or that the switch puts the
 * line back on screen. This does that half.
 *
 * # Chrome is not the app, and here is what that costs
 *
 * There is no socket, so no `game:line` event ever fires on its own and the
 * buffer would be empty - which is the state where "the gagged line is
 * absent" is true and means nothing. So this installs enough of
 * `__TAURI_INTERNALS__` to satisfy `isTauri()` and to carry the event plugin's
 * `listen`, captures the handler `gameLink.ts` registers, and delivers chunks
 * through it exactly as the reader thread would. Everything after that is the
 * real store, the real hook and the real resolver.
 *
 * The positive control below is the point: it asserts the four lines are on
 * screen *before* any gag exists. Without it a broken stub and a working gag
 * produce the same screenshot.
 *
 * Usage: node tools/line-rules-shots.mjs [http://127.0.0.1:5199/]
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5199/'
const out = (name) => join(root, 'docs/verification', name)

/** `run` wraps its body in a plain arrow, so `await` inside it is a syntax
 *  error. This is the same thing for a body that needs one. */
const runAsync = (b, body) => b.eval(`(async () => { ${body} })()`)

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/**
 * Enough of the Tauri bridge for `isTauri()` to be true and for the event
 * plugin's `listen` to reach a callback this file can fire.
 *
 * Installed with `addInit` because `gameLink.ts` subscribes at first render,
 * and anything run after the navigation has already missed it.
 */
const TAURI_STUB = `
  window.__drcHandlers = {};
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
      if (cmd === 'game_status' || cmd === 'game_attach' || cmd === 'game_detach') {
        return Promise.resolve({ connected: true, host: '', port: 0, lines: 0, note: '' });
      }
      if (cmd === 'panel_windows') return Promise.resolve([]);
      return Promise.resolve(null);
    },
  };
`

const SENT = [
  "A Gor'Tog guard just arrived.",
  'You feel fully rested.',
  'A kobold guard swings a scimitar at you!',
  'Your mind is clear.',
]

const b = await launch({ width: 1280, height: 900, headless: true })
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)
  await b.addInit(TAURI_STUB)

  // ------------------------------------------------- the game pane, live
  await b.goto(base, { waitFor: 'body' })
  await b.waitFor('button', 15000).catch(() => {})

  /*
   * Delivered on a game channel, not on the main window.
   *
   * `StreamTabs` renders a channel's lines and the companion's own log; text
   * the game did not put in a stream has no tab of its own, so lines sent
   * untagged arrive in the buffer and are drawn nowhere - which looks exactly
   * like a gag that hid everything. Found by running this harness with the
   * control in place, which is what the control is for.
   */
  const delivered = await b.run(`
    const id = window.__drcHandlers['game:line'];
    if (!id) return 'no handler';
    const sent = ${JSON.stringify(SENT)};
    const NL = String.fromCharCode(10);
    sent.forEach((text, i) => window[id]({
      event: 'game:line',
      id: i + 1,
      payload: {
        seq: i + 1,
        receivedAtMs: 1700000000000 + i,
        text: "<pushStream id='thoughts'/>" + text + NL + '<popStream/>' + NL,
      },
    }));
    return sent.length;
  `)
  check('the rig delivered lines through the real handler', delivered === SENT.length, String(delivered))

  const paneText = () => b.eval("document.body.innerText || ''")
  await new Promise((r) => setTimeout(r, 600))
  await b.run(`
    const tab = [...document.querySelectorAll('button')].find((el) => /Thought/i.test(el.textContent || ''));
    if (tab) tab.click();
    return !!tab;
  `)
  await new Promise((r) => setTimeout(r, 400))

  // ------------------------------------------------------ positive control
  const before = await paneText()
  check('control: the game pane shows the lines before any gag', /You feel fully rested/.test(before))
  check('control: and the other lines too', /kobold guard/.test(before))
  check('the toggle is absent while no gag exists', (await b.eval('document.querySelector(\'[data-testid="show-gagged-toggle"]\') !== null')) === false)

  // ----------------------------------------------------- add a gag, for real
  await runAsync(b, `
    const cfg = await import('/src/lib/playerConfig.ts');
    cfg.addEntry('gags', { id: 'g1', enabled: true, source: 'player', pattern: 'fully rested' });
    return cfg.domainEntries('gags').length;
  `)
  await new Promise((r) => setTimeout(r, 400))

  const gagged = await paneText()
  check('the gagged line is off screen', !/You feel fully rested/.test(gagged))
  check('and the other lines are untouched', /kobold guard/.test(gagged))
  check(
    'the line is still in the raw buffer',
    (await runAsync(b, `
      const L = await import('/src/lib/gameLink.ts');
      return L.gameLines().some((l) => l.text.includes('fully rested'));
    `)) === true
  )
  check('the toggle appeared once a gag existed', (await b.eval('document.querySelector(\'[data-testid="show-gagged-toggle"]\') !== null')) === true)
  await b.screenshot(out('player-config-2026-09-06-gagged-pane.png'))

  // ------------------------------------------- and the switch puts it back
  await b.run(`document.querySelector('[data-testid="show-gagged-toggle"]').click(); return true;`)
  await new Promise((r) => setTimeout(r, 400))
  const shown = await paneText()
  check('clicking Show hidden puts the line back', /You feel fully rested/.test(shown))
  check('and the button says so', /Hiding off/.test(shown))
  await b.screenshot(out('player-config-2026-09-06-gags-shown.png'))

  // ------------------------------------------------------- the editor tabs
  await b.goto(`${base}?view=panel&id=config`, { waitFor: '[data-testid="player-config-panel"]' })
  await b.run(`document.querySelector('[data-testid="config-tab-gags"]').click(); return true;`)
  await new Promise((r) => setTimeout(r, 300))

  const tab = await paneText()
  check('the Gags tab is an editor rather than a placeholder', !/editor arrives with Q4/.test(tab))
  check('the stored gag is listed', /fully rested/.test(tab))
  check('the preview says what would change', /would change/.test(tab))
  check('the inferred format is stated on screen', /inferred/.test(tab))

  // A pattern that cannot run is refused before it is stored.
  await b.run(`
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const input = document.querySelector('[data-testid="gag-pattern"]');
    set.call(input, '(a+)+$');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-testid="gag-regex"]').click();
    return true;
  `)
  await new Promise((r) => setTimeout(r, 200))
  await b.run(`document.querySelector('[data-testid="gag-add-button"]').click(); return true;`)
  await new Promise((r) => setTimeout(r, 300))
  const refused = await b.eval('document.querySelector(\'[data-testid="gag-refused"]\')?.innerText ?? ""')
  check('a pattern that would freeze the pane is refused on screen', /took \d+ms/.test(refused), JSON.stringify(refused.slice(0, 60)))
  check(
    'and it never reached the store',
    (await runAsync(b, `
      const cfg = await import('/src/lib/playerConfig.ts');
      return cfg.domainEntries('gags').length;
    `)) === 1
  )

  await b.screenshot(out('player-config-2026-09-06-gags.png'))
  console.log(`\nwrote ${out('player-config-2026-09-06-gags.png')}`)

  await b.run(`document.querySelector('[data-testid="config-tab-substitutes"]').click(); return true;`)
  await new Promise((r) => setTimeout(r, 300))
  const subsTab = await paneText()
  check('the Substitutes tab is an editor too', !/editor arrives with Q4/.test(subsTab))
  await b.screenshot(out('player-config-2026-09-06-substitutes.png'))
} finally {
  await b.close()
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
