#!/usr/bin/env node
/**
 * What the footer says about the bridge, in each state, on screen. (Issue #532.)
 *
 * Usage:  node tools/bridge-state-shots.mjs [http://127.0.0.1:5199/]
 *
 * Needs the DEV server: the store handle this drives the states through
 * (`window.__store`) is behind `import.meta.env.DEV` and is dead-code
 * eliminated from a production build, which is where it belongs.
 *
 * # What a node suite could not say, and what this is for
 *
 * `tools/link-reconnect-test.mjs` asserts every one of these states as a
 * property of `bridgePhase`, and it would pass with all of them correct and
 * nothing on screen changed: a chip computed and not rendered, a tone class
 * that resolves to nothing, a colour that is the same grey in every arm. The
 * defect this issue came from was a rendered thing - Dan read it off the
 * window, not out of a test - so the fix has to be read off the window too.
 *
 * # The four states, and how each is reached
 *
 * Through `simulateBridgeStatus`, which is the store action that calls the
 * same `applyLiveStatus` the live subscription calls. Not a hand-set flag and
 * not a second copy of the rule.
 *
 * Its second argument is what makes two of these reachable at all. The phase a
 * player reads is a function of the status *and* of whether a socket has ever
 * opened, and in a browser the real transport has never opened one - so
 * without the override, asking for `reconnecting` renders `connecting` and the
 * two states this issue is actually about cannot be produced. A state the
 * fixture cannot reach is a state nobody sees until a player does, and that is
 * exactly how the amber chip shipped.
 *
 * # Denominators
 *
 * Nothing here concludes from an absence:
 *
 *   - the run fails unless the app actually rendered (the demo banner);
 *   - unless the footer's status row was found at all;
 *   - and unless the four states produce four *different* readings. A chip
 *     that is stuck on one string satisfies "it does not say reconnecting" in
 *     three of the four cases, which is the trap of asserting what a thing
 *     does not say.
 *
 * The `data-bridge-phase` attribute and the words are both read, because a
 * check that had only the text could not tell a relabelled state from a wrong
 * one, and one that had only the attribute could not tell whether the player
 * was shown anything at all.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5199/'
const stamp = process.env.DRC_SHOT_STAMP ?? '2026-09-09'
const out = (name) => join(root, 'docs/verification', `bridge-states-${stamp}-${name}.png`)

const BANNER = 'Demo: this is invented data. Attach to Lich to see your character.'

let bad = 0
let checks = 0
const check = (label, cond, detail) => {
  checks++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(64)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/**
 * Enough of Tauri for the app to mount the same way it does in the window.
 * Copied in shape from `reconnect-honesty-shots.mjs`; nothing here fires Rust
 * events, because the bridge is not a Rust transport.
 */
const TAURI_STUB = `
  window.__cbs = {};
  window.__events = {};
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = 'cb' + Math.random().toString(36).slice(2);
      window.__cbs[id] = cb;
      return id;
    },
    invoke: (cmd, args) => {
      if (cmd === 'plugin:event|listen') { window.__events[args.event] = args.handler; return Promise.resolve(1); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'game_backlog') return Promise.resolve({ lines: [], dropped: 0 });
      if (cmd === 'panel_windows') return Promise.resolve([]);
      if (cmd === 'read_bridge_token') return Promise.resolve('');
      return Promise.resolve(null);
    },
  };
`

/**
 * The footer's bridge chip: its phase, its words, and the colour a player
 * actually sees.
 *
 * The colour is read from `getComputedStyle`, not from the class list. A tone
 * that resolves to no rule at all leaves the class name in the DOM looking
 * correct, and the whole complaint here was about a colour.
 */
const PROBE = `
  const row = document.querySelector('[role="status"][aria-live="polite"]');
  const chip = row ? row.querySelector('[data-bridge-phase]') : null;
  return {
    rendered: (document.body.innerText || '').includes(${JSON.stringify(BANNER)}),
    rowFound: !!row,
    phase: chip ? chip.getAttribute('data-bridge-phase') : null,
    text: chip ? chip.textContent.trim() : null,
    title: chip ? chip.getAttribute('title') : null,
    color: chip ? getComputedStyle(chip).color : null,
    // Every chip in the row, so a run can say what else was on screen beside
    // it rather than implying the bridge chip was alone.
    rowText: row ? row.innerText.replace(/\\n/g, ' | ') : null,
  };
`

const settle = () => new Promise((r) => setTimeout(r, 250))

const b = await launch({ width: 1180, height: 820, headless: true })
const seen = []
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)
  await b.addInit(TAURI_STUB)
  await b.goto(base, { waitFor: 'body' })
  await b.waitFor('[role="status"][aria-live="polite"]', 20000)

  // A zustand store is a callable with `getState` on it, not a plain object.
  // The first version of this check tested for `'object'` and failed against a
  // perfectly good handle, which would have read as "the harness cannot drive
  // the app" - a false red about the instrument, in a file whose whole job is
  // to be trusted about the app.
  const handle = await b.eval(`typeof (window.__store && window.__store.getState)`)
  check(
    'the dev store handle is present, so these states can be driven',
    handle === 'function',
    `typeof __store.getState = ${handle}`
  )

  /**
   * One state: set it, let React render, read it, photograph it.
   *
   * `everConnected` is passed explicitly in every call rather than only where
   * it matters, so the table below reads as what it is - a list of complete
   * situations, not a list of statuses with a hidden extra variable.
   *
   * `attempt` is written to the store *after* `simulateBridgeStatus`, and the
   * order is load-bearing. `applyLiveStatus` reads the count off the live
   * transport, which in a browser has never dialled, so it publishes zero over
   * anything set beforehand. The first version of this file set it first and
   * photographed "Lich reconnecting 0/8" - a real reading of a state the app
   * cannot actually be in, which was one run away from going into
   * docs/verification as evidence that the fix worked.
   *
   * It is the one number this harness supplies rather than drives: a value the
   * chip prints, not a decision the chip makes.
   */
  async function state(name, status, everConnected, attempt) {
    await b.eval(
      `(() => {
        window.__store.getState().simulateBridgeStatus('${status}', ${everConnected});
        // The attempt count, set AFTER the simulate and not before it: see the
        // note above this function. (No backticks in here - this whole string
        // is a template literal, and one would end it.)
        window.__store.setState({ bridgeAttempt: ${attempt}, bridgeMaxAttempts: 8 });
        return true;
      })()`
    )
    await settle()
    const r = await b.run(PROBE)
    seen.push({ name, ...r })
    await b.screenshot(out(name))
    return r
  }

  // ------------------------------------------------- never connected (#532)
  const notConnected = await state('not-connected', 'disconnected', false, 0)
  check('the app rendered', notConnected.rendered === true)
  check('the footer status row is on screen', notConnected.rowFound === true)
  check(
    'before sign-in the chip says the bridge is not connected',
    notConnected.phase === 'not-connected' && notConnected.text === 'Not connected',
    `phase=${notConnected.phase} text="${notConnected.text}"`
  )
  check(
    'and it does NOT say reconnecting, which is what Dan was looking at',
    !/reconnect/i.test(notConnected.text ?? ''),
    `text="${notConnected.text}"`
  )
  check(
    'and it tells the player what to do about it',
    /sign in/i.test(notConnected.title ?? ''),
    `title="${notConnected.title}"`
  )

  // ------------------------------------------------------------- connecting
  const connecting = await state('connecting', 'connecting', false, 0)
  check(
    'while it looks for Lich the chip says connecting, not reconnecting',
    connecting.phase === 'connecting' && !/reconnect/i.test(connecting.text ?? ''),
    `phase=${connecting.phase} text="${connecting.text}"`
  )

  // ------------------------------------------------------------ reconnecting
  const reconnecting = await state('reconnecting', 'reconnecting', true, 3)
  check(
    'a bridge that really dropped counts its attempts',
    reconnecting.phase === 'reconnecting' && (reconnecting.text ?? '').includes('3/8'),
    `phase=${reconnecting.phase} text="${reconnecting.text}"`
  )

  // ----------------------------------------------------------------- gave up
  const gaveUp = await state('gave-up', 'gave-up', true, 8)
  check(
    'and when it stops, it says so and names the action',
    gaveUp.phase === 'gave-up' && /start lich|attach/i.test(gaveUp.title ?? ''),
    `phase=${gaveUp.phase} text="${gaveUp.text}" title="${gaveUp.title}"`
  )

  /*
   * The denominator, and the check that matters most.
   *
   * Everything above is satisfiable by a chip stuck on one string: three of
   * the four cases assert what the chip does NOT say. So the four states must
   * be four distinct readings, and the two that carry an alarm must be
   * distinguishable by colour from the two that do not - which is the whole
   * complaint restated as a measurement.
   */
  const phases = new Set(seen.map((s) => s.phase))
  check(
    'the four states are four distinct phases on screen',
    phases.size === 4,
    [...phases].join(', ')
  )
  const words = new Set(seen.map((s) => s.text))
  check('and four distinct sentences', words.size === 4, [...words].join(' / '))

  const quiet = new Set(seen.filter((s) => s.phase === 'not-connected' || s.phase === 'connecting').map((s) => s.color))
  const loud = new Set(seen.filter((s) => s.phase === 'reconnecting' || s.phase === 'gave-up').map((s) => s.color))
  check(
    'the two ordinary states share one quiet colour',
    quiet.size === 1,
    [...quiet].join(' / ')
  )
  check(
    'the two that need attention are coloured differently from them',
    [...loud].every((c) => !quiet.has(c)) && loud.size === 2,
    `quiet=${[...quiet].join(',')} loud=${[...loud].join(',')}`
  )

  console.log('\n-- what the footer row said in each state --')
  for (const s of seen) console.log(`   ${s.name.padEnd(14)} ${s.rowText}`)
} finally {
  await b.close()
}

const FLOOR = 12
if (checks < FLOOR) {
  console.log(`FAIL only ${checks} checks ran, floor is ${FLOOR}: this run did not do its work`)
  bad++
}
console.log(bad ? `\n${bad} of ${checks} failed` : `\nall passed: ${checks}/${checks}`)
process.exit(bad ? 1 : 0)
