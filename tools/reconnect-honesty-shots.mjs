#!/usr/bin/env node
/**
 * Does the window tell the truth while a link is down? (Issues #501 and #506.)
 *
 * Usage:  node tools/reconnect-honesty-shots.mjs [http://127.0.0.1:5173/]
 *
 * Needs the DEV server, not `vite preview`: the store handle this drives the
 * bridge drop through (`window.__store`) is behind `import.meta.env.DEV` and is
 * dead-code eliminated from a production build, which is the right place for it
 * to be.
 *
 * # What a node suite could not say
 *
 * `tools/link-reconnect-test.mjs` asserts both fixes as properties of
 * functions, and it would pass with every one of those functions correct and
 * nothing on screen changed - a placeholder computed and not rendered, a badge
 * rendered behind another element, a dimming class on a wrapper that has no
 * visible effect. Issue #501 is itself a defect nobody's tests could see:
 * three files each passing about themselves while two of them said different
 * things about one socket. So this asks the rendered document.
 *
 * # The two states, and how each is reached
 *
 * **Reconnecting** is a state of the *game* link, which lives in Rust and
 * reaches the app as a `game:state` event. There is no Rust here, so the
 * harness plays that part: a `__TAURI_INTERNALS__` stub that records the
 * listener `listenTauri` installs and hands it a state on demand. That is
 * enough for the three consumers to read the phase and render, and it is not a
 * backend - anything gated on a real command's *answer* is not exercised, and
 * this file says so rather than implying it covers both.
 *
 * **A bridge drop** is a state the mock bridge genuinely cannot produce:
 * `onLiveStatus` is the real transport's event and the mock has no socket to
 * lose. So it is reached through `simulateBridgeStatus`, which is a store
 * action calling the same `applyLiveStatus` the live subscription calls - not
 * a second copy of the rule, and not a hand-set flag. A state the fixture
 * cannot reach is a state nobody sees until a player does.
 *
 * # Denominators
 *
 * Nothing here concludes from an absence. The run fails unless the app
 * actually rendered (the demo banner), unless the command box was found, and
 * unless a *control* state was measured first - a live link reading "Command,
 * then Enter" and an unmarked cluster with no stale note. Without the control,
 * "the box does not say Not attached" is satisfied just as well by a box that
 * is not there.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5173/'
const out = (name) => join(root, 'docs/verification', name)

const BANNER = 'Demo: this is invented data. Attach to Lich to see your character.'

let bad = 0
let checks = 0
const check = (label, cond, detail) => {
  checks++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(62)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/**
 * Enough of Tauri for `isTauri()` to be true and for `listenTauri` to install a
 * real listener this file can fire.
 *
 * Tauri v2's `listen` is `invoke('plugin:event|listen', { event, handler })`
 * where `handler` is an id produced by `transformCallback`. So the stub keeps
 * the callback, remembers which event it was for, and `__emit` calls it the way
 * the runtime would. `addInit` rather than a post-navigation eval, because the
 * store and gameLink decide all of this at module-evaluation time.
 */
const TAURI_STUB = `
  window.__cbs = {};
  window.__events = {};
  window.__sent = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => {
      const id = 'cb' + Math.random().toString(36).slice(2);
      window.__cbs[id] = cb;
      return id;
    },
    invoke: (cmd, args) => {
      if (cmd === 'plugin:event|listen') {
        window.__events[args.event] = args.handler;
        return Promise.resolve(1);
      }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'game_backlog') return Promise.resolve({ lines: [], dropped: 0 });
      if (cmd === 'panel_windows') return Promise.resolve([]);
      // Whatever the command bar hands over is recorded rather than sent, so
      // the run can assert that a held command did not leave the app.
      if (cmd === 'game_send') {
        window.__sent.push(args && args.command);
        return Promise.reject(new Error('The connection is closed.'));
      }
      return Promise.resolve(null);
    },
  };
  window.__emit = (event, payload) => {
    const id = window.__events[event];
    if (!id) return false;
    window.__cbs[id]({ event, id, payload });
    return true;
  };
`

/** A LinkState as Rust emits it. */
const linkState = (patch) =>
  JSON.stringify({
    connected: false,
    host: '127.0.0.1',
    port: 11024,
    lines: 12,
    note: '',
    lich: 'alive',
    ...patch,
  })

/** What the command box and the connection bar currently say. */
const PROBE = `
  const box = document.querySelector('input[aria-label="Game command"]');
  const text = document.body.innerText || '';
  return {
    box: box ? { placeholder: box.placeholder, disabled: box.disabled } : null,
    sendTitle: (() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^Send$/i.test(x.getAttribute('aria-label') || ''));
      return b ? { title: b.title, disabled: b.disabled } : null;
    })(),
    error: (() => {
      const a = [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText.trim());
      return a.join(' | ');
    })(),
    // Asked of the WHOLE document, not of a slice of it. The first version of
    // this check tested a 4000-character prefix and reported that the footer
    // was silent about the reconnect, while the badge was on screen the whole
    // time about a thousand characters further down. A false red, and it was
    // the instrument.
    footerSaysReconnecting: /Reconnecting \\d+\\/\\d+/.test(text),
    footerBadges: (text.match(/Reconnecting \\d+\\/\\d+/g) || []).length,
    text: text.slice(0, 600),
    rendered: text.includes(${JSON.stringify(BANNER)}),
  };
`

/** Whether the vitals are marked stale, and whether the marking is visible. */
const STALE_PROBE = `
  const notes = [...document.querySelectorAll('[role="status"]')]
    .map((n) => n.innerText.trim())
    .filter((t) => /last known/i.test(t));
  // The dimming, read off the rendered style rather than off a class name: a
  // class that stopped being generated and a class that generates nothing look
  // the same in the markup.
  const rows = [...document.querySelectorAll('div')].filter((d) =>
    /^(Health|Stamina|Spirit)$/.test((d.firstElementChild && d.firstElementChild.textContent) || '')
  );
  const opacities = [...new Set(rows.map((r) => getComputedStyle(r).opacity))];
  return {
    notes,
    rows: rows.length,
    opacities,
    healthShown: rows.length ? rows[0].innerText.replace(/\\n/g, ' ') : null,
  };
`

/** Let the link's rAF coalescing and React's render both land before probing. */
const settle = () => new Promise((r) => setTimeout(r, 250))

const b = await launch({ width: 1180, height: 820, headless: true })
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)
  await b.addInit(TAURI_STUB)
  await b.goto(base, { waitFor: 'body' })
  await b.waitFor('input[aria-label="Game command"]', 20000)

  // ------------------------------------------------- the control: a live link
  const listening = await b.eval(`!!window.__events['game:state']`)
  check('the app installed a game:state listener, so this harness can drive it', listening === true)

  await b.eval(`window.__emit('game:state', ${linkState({ connected: true, note: 'Attached.' })})`)
  // `gameLink` coalesces its listeners onto the next animation frame, so a
  // probe fired in the same turn reads the state before the one just emitted.
  await settle()
  const live = await b.run(PROBE)
  check('the app rendered', live.rendered === true, live.rendered ? '' : live.text.slice(0, 120))
  check('control: a live link invites a command', live.box?.placeholder === 'Command, then Enter', `placeholder="${live.box?.placeholder}"`)
  check('control: and the Send button offers to send', /^Send$/.test(live.sendTitle?.title ?? ''), `title="${live.sendTitle?.title}"`)

  // ------------------------------------------------------- reconnecting (#501)
  await b.eval(
    `window.__emit('game:state', ${linkState({ reconnecting: true, attempt: 3, maxAttempts: 6, note: 'The connection dropped and is reconnecting - attempt 3 of 6.' })})`
  )
  await settle()
  const re = await b.run(PROBE)

  check(
    'the command box says the link is reconnecting',
    /reconnect/i.test(re.box?.placeholder ?? ''),
    `placeholder="${re.box?.placeholder}"`
  )
  check(
    'and never "Not attached" while a dial is running',
    !/not attached/i.test(re.box?.placeholder ?? ''),
    `placeholder="${re.box?.placeholder}"`
  )
  check(
    'the bars and the box agree: both carry 3/6',
    (re.box?.placeholder ?? '').includes('3/6') && re.footerSaysReconnecting,
    `box="${re.box?.placeholder}" | badges on screen: ${re.footerBadges}`
  )
  check(
    'and the badges are there to disagree with (control)',
    re.footerBadges >= 2,
    `the connection bar and the safety footer both render one: found ${re.footerBadges}`
  )
  check(
    'the Send button is reachable rather than disabled',
    re.sendTitle?.disabled === false,
    `disabled=${re.sendTitle?.disabled}`
  )

  // Type and press Enter: the command is held, said out loud, and left in the
  // box. `__sent` is the denominator that matters here - a held command that
  // reached `game_send` would be the dangerous case wearing a tidy message.
  await b.click('input[aria-label="Game command"]')
  await b.type('go east')
  await b.key('Enter')
  await settle()
  const held = await b.run(`
    const box = document.querySelector('input[aria-label="Game command"]');
    return {
      value: box.value,
      alert: [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText.trim()).join(' | '),
      sent: window.__sent,
      focused: document.activeElement === box,
    };
  `)
  check('a command typed during a reconnect is not sent', held.sent.length === 0, `game_send calls: ${JSON.stringify(held.sent)}`)
  check('it stays in the box', held.value === 'go east', `value="${held.value}"`)
  check('with focus back on it, ready for a second Enter', held.focused === true)
  check('and the refusal names the attempt', /attempt 3 of 6/i.test(held.alert), `"${held.alert}"`)
  check('and says the command is still here', /still here/i.test(held.alert), `"${held.alert}"`)
  check(
    'and does not promise to send it later',
    !/queued|automatically/i.test(held.alert),
    `"${held.alert}"`
  )

  await b.screenshot(out('reconnect-2026-09-07-reconnecting.png'))

  // ------------------------------------------------- a link that gave up (#501)
  await b.eval(`window.__emit('game:state', ${linkState({ attempt: 6, maxAttempts: 6, note: 'Gave up after 6 attempts.' })})`)
  await settle()
  await b.eval(`window.__sent.length = 0`)
  await b.click('input[aria-label="Game command"]')
  await b.key('Enter')
  await settle()
  const gaveUp = await b.run(`
    return {
      alert: [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText.trim()).join(' | '),
      sent: window.__sent,
      value: document.querySelector('input[aria-label="Game command"]').value,
    };
  `)
  // The whole point of dropping the frontend pre-check: the lane's own
  // sentence, from the one place it is written, reaches the box.
  check(
    'a spent link hands the press to the lane rather than answering for it',
    gaveUp.sent.length === 1,
    `game_send calls: ${JSON.stringify(gaveUp.sent)}`
  )
  check(
    "and the lane's own words reach the player",
    /connection is closed/i.test(gaveUp.alert),
    `"${gaveUp.alert}"`
  )
  check('with the command still in the box', gaveUp.value === 'go east', `value="${gaveUp.value}"`)
  check(
    'and reads as one sentence, not two full stops',
    !gaveUp.alert.includes('..'),
    `"${gaveUp.alert}"`
  )

  // -------------------------------------------------- a bridge drop (#506)
  /*
   * Measured in the Battle panel's own window rather than the main dashboard,
   * because that is where the vitals cluster actually renders: the main
   * window's default layout does not include the "You" panel, and at 1180x820
   * and 1600x1000 alike it draws no cluster at all. Asserting "the vitals are
   * dimmed" against a document with no vitals in it would pass or fail for
   * reasons that have nothing to do with the fix, which is why the control
   * below counts the rows before anything else is believed.
   */
  await b.goto(`${base}?view=panel&id=room`, { waitFor: 'body' })
  await b.waitFor('#root > *', 20000)
  await new Promise((r) => setTimeout(r, 2500))
  const fresh = await b.run(STALE_PROBE)
  check('control: the vitals rendered', fresh.rows >= 3, `rows=${fresh.rows} (${fresh.healthShown})`)
  check('control: and carry no stale note while the bridge is feeding', fresh.notes.length === 0, JSON.stringify(fresh.notes))
  check(
    'control: at full contrast',
    fresh.opacities.every((o) => Number(o) === 1),
    `opacities=${JSON.stringify(fresh.opacities)}`
  )

  const marked = await b.eval(`
    (() => {
      const before = window.__store.getState().character;
      window.__store.getState().simulateBridgeStatus('reconnecting');
      const s = window.__store.getState();
      return {
        keptCharacter: !!s.character && s.character.name === (before && before.name),
        keptScripts: s.scriptStates.length,
        mark: s.bridgeStaleSince,
        connected: s.bridgeConnected,
      };
    })()
  `)
  check('an unexpected drop keeps the character rather than blanking it', marked.keptCharacter === true)
  check('and marks it, with the moment the feed stopped', marked.mark > 0, `bridgeStaleSince=${marked.mark}`)
  check('and the store knows the bridge is not connected', marked.connected === false)
  await settle()

  // Long enough that the number on screen is one a person would read as a real
  // age rather than "0s ago", which is the case that proves nothing about
  // whether it counts.
  await new Promise((r) => setTimeout(r, 3200))
  const stale = await b.run(STALE_PROBE)
  check('the panel says the numbers are last-known', stale.notes.length > 0, JSON.stringify(stale.notes))
  check(
    'and how old they are, in seconds, counting',
    stale.notes.some((n) => /last known, [1-9][0-9]*s ago/.test(n)),
    JSON.stringify(stale.notes)
  )
  check(
    'and the numbers themselves are dimmed rather than hidden',
    stale.rows >= 3 && stale.opacities.some((o) => Number(o) < 1),
    `rows=${stale.rows} opacities=${JSON.stringify(stale.opacities)} shown="${stale.healthShown}"`
  )

  await b.screenshot(out('reconnect-2026-09-07-stale.png'))

  // And the mark ends when a payload lands, not when the socket returns.
  const cleared = await b.eval(`
    (() => {
      window.__store.getState().simulateBridgeStatus('connected');
      const afterSocket = window.__store.getState().bridgeStaleSince;
      window.__store.getState().connectBridge();
      return { afterSocket, afterData: window.__store.getState().bridgeStaleSince };
    })()
  `)
  check('the socket returning does not clear the mark', cleared.afterSocket > 0, `bridgeStaleSince=${cleared.afterSocket}`)
  check('a payload landing does', cleared.afterData === 0, `bridgeStaleSince=${cleared.afterData}`)

  await settle()
  const gone = await b.run(STALE_PROBE)
  check('and the note leaves the screen with it', gone.notes.length === 0, JSON.stringify(gone.notes))
  check(
    'and the numbers go back to full contrast',
    gone.opacities.every((o) => Number(o) === 1),
    `opacities=${JSON.stringify(gone.opacities)}`
  )
} finally {
  await b.close()
}

const FLOOR = 24
if (checks < FLOOR) {
  console.log(`FAIL only ${checks} checks ran, floor is ${FLOOR}: this run did not do its work`)
  bad++
}
console.log(bad ? `\nFAILURES: ${checks - bad}/${checks}` : `\nall passed: ${checks}/${checks}`)
process.exit(bad ? 1 : 0)
