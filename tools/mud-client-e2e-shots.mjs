#!/usr/bin/env node
/**
 * The eyes-on half of `tools/mud-client-e2e.mjs`: pictures of the screens a
 * player meets when Godot is not there.
 *
 *   npm run dev -- --port 5183 --strictPort false
 *   node tools/mud-client-e2e-shots.mjs http://127.0.0.1:5183/
 *
 * # Why this is separate from the harness
 *
 * The harness runs in Node against the real `src/lib` modules and finishes in
 * two seconds, which is what lets it live in `npm run test:all` and run on
 * every change. This needs a dev server and a browser, which no registered
 * suite in this repository has ever needed - every browser check here is a
 * `*-shots.mjs` run by hand, and this follows that rather than being the first
 * suite that quietly requires Chrome.
 *
 * What it adds is the half a module test cannot reach: the JSX. The harness
 * reads `PanelWindow.tsx`'s guard and its sentence out of the source and says
 * plainly that this is a source check; this renders it.
 *
 * # What it cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false here, so the sign-in screen runs
 * its `?lichDryRun=1` stand-in rather than the real EAccess, and nothing
 * attaches to anything. That limit is `tools/first-screen-shots.mjs`'s too,
 * and it is stated for the same reason: a check that reached the screen by a
 * private door is not checking the screen a person sees.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5183/'
const out = (name) => join(root, 'docs/verification', `mud-client-e2e-2026-09-09-${name}.png`)

let bad = 0
let checks = 0
const check = (label, condition, detail = '') => {
  checks += 1
  if (!condition) bad += 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label.padEnd(52)}  ${detail}`)
}

const b = await launch({ width: 1280, height: 860, headless: true })
try {
  // A profile that has been through setup and is on the real bridge: the state
  // a player is in with nothing connected, which is what "stands alone" has to
  // look like.
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'live' }));
    return true;
  `)

  // 1. The first screen with nothing attached and no viewer.
  await b.goto(base, { waitFor: '#root > *' })
  const first = await b.eval('document.body.innerText')
  await b.screenshot(out('01-empty-state'))
  check('the empty state offers a way in', /Attach to Lich|Sign in|Nothing is connected/i.test(first), JSON.stringify(first.slice(0, 60)))
  check('and claims no character', !/Dan the Bold/.test(first))
  check('and no panel reports the absent viewer as an error', !/viewer.{0,40}error/i.test(first))

  /*
   * 2. Sign in, through the scripted EAccess, by typing into the form and
   *    pressing the button.
   *
   * Driven rather than looked at, because looking is what makes a check like
   * this pass for the wrong reason: the empty state's own reassurance sentence
   * contains both the words "account" and "password", so a screen with no form
   * on it at all satisfies `/account|password/i`. The form's *fields*, and the
   * character list that only a completed sign-in can produce, cannot be
   * satisfied that way.
   */
  await b.goto(`${base}?lichDryRun=1`, { waitFor: '#root > *' })
  const fields = await b.eval(
    "JSON.stringify([...document.querySelectorAll('input')].map(i => i.type))"
  )
  check('the sign-in form has a password field', /"password"/.test(fields), fields)
  const typedAccount = await b.run(`
    const account = document.querySelector('input[type="text"], input:not([type])');
    const password = document.querySelector('input[type="password"]');
    if (!account || !password) return false;
    const set = (el, v) => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(account, 'demo');
    set(password, 'demo');
    return true;
  `)
  check('the account and password can be typed', typedAccount === true)
  await b.screenshot(out('02-sign-in'))
  const pressed = await b.click('button', /^Sign in$/)
  check('the sign-in button is clickable', !!pressed && !pressed.dead, JSON.stringify(pressed))
  /*
   * The character picker is the thing only a completed sign-in can produce.
   *
   * Asserted on the picker's own prompt and on the names the scripted account
   * carries, not on the absence of the sign-in heading: that heading is the
   * section's title and stays on screen through every stage, so "the heading
   * is gone" was a check that could never pass and reported a sign-in that had
   * in fact worked.
   */
  let picker = ''
  for (let i = 0; i < 40; i += 1) {
    picker = await b.eval('document.body.innerText')
    if (/Pick a character to play/.test(picker)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  await b.screenshot(out('03-characters'))
  const named = ['Phemius', 'Testwright', 'Nobody'].filter((n) => picker.includes(n))
  check(
    'signing in reaches the character list',
    /Pick a character to play/.test(picker),
    JSON.stringify(picker.replace(/\s+/g, ' ').slice(0, 140))
  )
  check(
    'and every character on the account is offered',
    named.length === 3,
    `${named.length} of 3: ${named.join(', ')}`
  )

  // 3. A popped-out panel that exists, and one that does not. The second is
  //    the control: without it, "the gone state renders" would be a claim
  //    about a route nobody proved was different from a working one.
  await b.goto(`${base}?view=panel&id=stats`, { waitFor: '#root > *' })
  const real = await b.eval('document.body.innerText')
  await b.screenshot(out('04-panel-window'))
  check('a real panel id renders a panel', real.trim().length > 10 && !/No panel called/.test(real), JSON.stringify(real.slice(0, 60)))

  await b.goto(`${base}?view=panel&id=nosuchpanel`, { waitFor: '#root > *' })
  const gone = await b.eval('document.body.innerText')
  await b.screenshot(out('05-panel-gone'))
  check('an unknown panel id is named, not blank', /No panel called nosuchpanel/.test(gone), JSON.stringify(gone.slice(0, 60)))

  const errors = b.consoleErrors()
  check('nothing threw on any of those routes', errors.length === 0, errors.slice(0, 2).join(' | '))
} finally {
  await b.close()
}

if (checks < 11) {
  console.log(`\nFAIL only ${checks} checks ran; this file has at least 11`)
  process.exit(1)
}
console.log(bad === 0 ? `\n${checks} checks, all passed` : `\n${bad} of ${checks} FAILED`)
process.exit(bad === 0 ? 0 : 1)
