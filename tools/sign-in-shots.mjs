#!/usr/bin/env node
/**
 * The render check for the sign-in screen (increment N5).
 *
 * Drives a real browser through the whole flow and saves what it saw, rather
 * than describing it. Reading the component is not looking at it, and every
 * layout defect this project has shipped was invisible in the source and
 * obvious in a picture - issue #418 was a call to action rendered below the
 * bottom edge of the window.
 *
 * Four states, each reached by pressing what a person would press:
 *
 *   form      the account/password/game form on a profile with nothing stored
 *   picker    the character list that came back, which is the `C` reply
 *   launched  after picking one, with the attach flow taking over
 *   error     a failure shown as a sentence, not a stack trace
 *
 * Usage: node tools/sign-in-shots.mjs [http://127.0.0.1:1420/]
 *
 * # What this cannot tell you, said plainly
 *
 * Chrome is not the app. `isTauri()` is false here, so this is driving the
 * TS-side stand-in in `src/lib/lichLoginFake.ts` behind `?lichDryRun=1`, not
 * `eaccess.rs` and not a real Lich. It proves the screen, the state machine and
 * the sentences. It proves nothing about the protocol, which is N1's job, or
 * about the launch, which is N3's, or about the real server, which is N7's and
 * needs Dan. `tools/app-eyes.mjs` is the tool that attaches to the real
 * WebView2 once those exist.
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = (process.argv[2] ?? 'http://127.0.0.1:1420/').replace(/\/$/, '')
const out = (name) => join(root, 'docs/verification', name)
const url = (q) => `${base}/?lichDryRun=1&${q}`

let bad = 0
let checked = 0
const check = (label, cond, detail) => {
  checked += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(56)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/** Type into a field found by its label text, the way a person reaches it. */
async function fill(b, labelText, value) {
  const done = await b.run(`
    const label = [...document.querySelectorAll('label')]
      .find((l) => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
    if (!label) return 'no label ' + ${JSON.stringify(labelText)};
    const el = label.querySelector('input, select');
    if (!el) return 'no field under ' + ${JSON.stringify(labelText)};
    const proto = el.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  `)
  if (done !== 'ok') throw new Error(`could not fill ${labelText}: ${done}`)
}

const b = await launch({ width: 1024, height: 768, headless: true })
try {
  // A profile that has been through setup and nothing else, at the smallest
  // window size the sign-in has to fit in without clipping.
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true }));
    return true;
  `)

  // ---------------------------------------------------------------- form
  await b.goto(url('bridge=live'))
  const formText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-2026-09-06-form.png'))

  // Case-insensitive: the heading carries `uppercase`, and innerText reports
  // what is rendered, so an exact-case match tests the stylesheet.
  check('form: the screen offers a sign-in', /sign in to dragonrealms/i.test(formText))
  check('form: it asks for an account name', /Account name/.test(formText))
  check('form: and a password', /Password/.test(formText))
  check('form: and which game', /DragonRealms/.test(formText))
  check(
    'form: the password sentence is the true one',
    /held only in memory, and not stored unless you later ask for it/.test(formText)
  )
  check(
    'form: nothing tells anybody to configure another client',
    !/lichconnect|licharguments|#config/i.test(formText),
    'no retired walkthrough on screen'
  )
  // N8 built the box; this used to assert its absence. What is on screen now
  // must be the offer *and* the warning, because a box that says only
  // "remember password" hides the half a player needs to decide.
  check(
    'form: the remember-password box is offered',
    /Remember password on this computer/i.test(formText)
  )
  check(
    'form: and it says who else on this machine could use it',
    /Anyone signed in to this Windows account can use it/i.test(formText)
  )

  // Nothing may sit outside the window at 1024x768, which is the defect #418
  // was, in the screen that has just replaced the one it was found in.
  const overflow = await b.run(`
    const w = document.documentElement.clientWidth;
    const h = document.documentElement.clientHeight;
    const out = [];
    for (const el of document.querySelectorAll('button, input, select, a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > w + 1 || r.bottom > h + 1 || r.left < -1 || r.top < -1) {
        out.push((el.innerText || el.type || el.tagName).trim().slice(0, 30) +
          ' @' + Math.round(r.left) + ',' + Math.round(r.top));
      }
    }
    return { w, h, examined: document.querySelectorAll('button, input, select, a').length, out };
  `)
  // The denominator: an error page has no controls outside the window for the
  // same reason a suite that never ran has no failures.
  check(
    'form: the overflow probe examined real controls',
    overflow.examined >= 6,
    `${overflow.examined} controls at ${overflow.w}x${overflow.h}`
  )
  check(
    'form: every control is inside the 1024x768 window',
    overflow.out.length === 0,
    overflow.out.join(' | ')
  )

  // -------------------------------------------------------------- picker
  await fill(b, 'Account name', 'demo')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  await b.waitFor('button', 10000)
  // The list arrives after a round trip; wait for a name rather than sleeping.
  for (let i = 0; i < 60; i += 1) {
    if (/Phemius/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const pickerText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-2026-09-06-picker.png'))

  check('picker: the account’s own characters are offered', /Phemius/.test(pickerText))
  check('picker: all three the command returned', /Testwright/.test(pickerText) && /Nobody/.test(pickerText))
  check('picker: the player is not asked to type a name', !/Character name/i.test(pickerText))
  check('picker: there is a way back', /Back to sign in/.test(pickerText))

  // The password field is gone from the DOM with the form, so the string
  // cannot still be sitting in an input somebody screenshots.
  const stillTyped = await b.run(`
    return [...document.querySelectorAll('input')]
      .filter((i) => i.type === 'password' && i.value).length;
  `)
  check('picker: no password field is left holding a value', stillTyped === 0, `${stillTyped} found`)

  const persisted = await b.run(`
    return localStorage.getItem('dr-companion-prefs-v1') || '';
  `)
  check(
    'picker: the account name was remembered (control)',
    persisted.includes('"lichAccount":"demo"'),
    'lichAccount present'
  )
  check(
    'picker: and the password was not',
    !persisted.includes('not-a-real-password-9d4f') && !/password/i.test(persisted)
  )

  // ------------------------------------------------------------ launched
  await b.click('button', /^Phemius$/)
  for (let i = 0; i < 60; i += 1) {
    if (/Started Phemius/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const launchedText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-2026-09-06-launched.png'))
  check('launched: the app says what it started', /Started Phemius/.test(launchedText))
  check('launched: and what happens next', /game text appears/.test(launchedText))

  // --------------------------------------------------------------- error
  // A failure has to read as a sentence. `locked` is a fixture account whose
  // whole purpose is to make this arm reachable without an account.
  await b.goto(url('bridge=live'))
  await fill(b, 'Account name', 'locked')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/locked this account/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const errorText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-2026-09-06-error.png'))
  check('error: it is a sentence a player can act on', /Play\.net has locked this account/.test(errorText))
  check('error: no token, no stack, no error code', !/account_locked|Error:|at \w+ \(/.test(errorText))
  const cleared = await b.run(`
    return [...document.querySelectorAll('input')]
      .filter((i) => i.type === 'password' && i.value).length;
  `)
  check('error: the password field was cleared on the failure', cleared === 0, `${cleared} still filled`)

  // ------------------------------------------------- the empty-list state
  await b.goto(url('bridge=live'))
  await fill(b, 'Account name', 'nochars')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/has no /.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const emptyText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-2026-09-06-no-characters.png'))
  check(
    'empty: an account with no characters says so',
    /has no DragonRealms characters/.test(emptyText)
  )
  check('empty: and still offers a way back', /Back to sign in/.test(emptyText))

  // ------------------------------------- the three states issue #459 needs
  //
  // Added with N9. The first two are what a real failure looks like now that
  // the backend sends a code (#457) - before it, every one of them rendered as
  // "Signing in failed." followed by whatever prose Rust happened to write.
  // The third is the state N8 built and nothing could reach: an account whose
  // password is saved, where the form must not ask for one again.

  // locked: the sentence that costs a player most, and the reason #457 was
  // filed. A locked account used to read "Signing in failed. the account
  // cannot sign in right now (NEW)".
  await b.goto(url('bridge=live'))
  await fill(b, 'Account name', 'locked')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/locked this account/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const lockedText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-errors-2026-09-06-locked.png'))
  check(
    'locked: the player is told where to go and what to do',
    /Sign in on the Play\.net website to unlock it/.test(lockedText)
  )
  check(
    'locked: and what the server actually said is under it, not instead of it',
    /the account cannot sign in right now/.test(lockedText),
    'the detail line'
  )
  check(
    'locked: the generic sentence is not what is shown',
    !/^Signing in failed\.$/m.test(lockedText)
  )
  // Looking, not reading. `innerText` reports a sentence rendered below the
  // fold of a scrolling column exactly as happily as one a player can see, and
  // that is what issue #418 was. Measured against the window, after the
  // component's own scroll-into-view has had its chance.
  //
  // This check was added because the first run of it failed: the detail line
  // pushed the block past the bottom edge at 1024x768, and the screenshot said
  // so while every text assertion above stayed green.
  const errorBox = await b.run(`
    const p = [...document.querySelectorAll('p')]
      .find((el) => /Sign in on the Play\\.net website/.test(el.textContent || ''));
    if (!p) return { found: false };
    const box = p.parentElement.getBoundingClientRect();
    return {
      found: true,
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      viewport: document.documentElement.clientHeight,
    };
  `)
  check('locked: the failure block was found (control)', errorBox.found === true, JSON.stringify(errorBox))
  check(
    'locked: and the whole of it is on screen, detail line included',
    errorBox.found && errorBox.top >= 0 && errorBox.bottom <= errorBox.viewport,
    JSON.stringify(errorBox)
  )

  // badpw: an account with nothing in the fixtures, which the stand-in
  // refuses with the real `bad_credentials` object.
  await b.goto(url('bridge=live'))
  await fill(b, 'Account name', 'nosuchaccount')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/was not accepted/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const badpwText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-errors-2026-09-06-badpw.png'))
  check(
    'badpw: a refusal says which two things to check',
    /That account name or password was not accepted\. Check both and try again\./.test(badpwText)
  )
  const badpwCleared = await b.run(`
    return [...document.querySelectorAll('input')]
      .filter((i) => i.type === 'password' && i.value).length;
  `)
  check('badpw: the field was cleared', badpwCleared === 0, `${badpwCleared} still filled`)

  // stored: `saved` is a fixture account the stand-in reports a stored
  // password for. The password field must be gone, the Sign in button must
  // still work, and there must be a way to type a different one.
  await b.goto(url('bridge=live'))
  await fill(b, 'Account name', 'saved')
  for (let i = 0; i < 60; i += 1) {
    if (/Using the password saved/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const storedText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-errors-2026-09-06-stored.png'))
  check(
    'stored: the form says it is using the saved password',
    /Using the password saved on this computer for saved/.test(storedText)
  )
  check('stored: and offers a way past it', /Use a different password/.test(storedText))
  const storedFields = await b.run(`
    return {
      password: [...document.querySelectorAll('input')].filter((i) => i.type === 'password').length,
      signInDisabled: [...document.querySelectorAll('button')]
        .filter((x) => x.innerText.trim() === 'Sign in')
        .map((x) => x.disabled),
      remember: /Remember password on this computer/.test(document.body.innerText),
    };
  `)
  check('stored: there is no password box at all', storedFields.password === 0, `${storedFields.password} found`)
  check(
    'stored: and Sign in is pressable without typing one',
    storedFields.signInDisabled.length === 1 && storedFields.signInDisabled[0] === false,
    JSON.stringify(storedFields.signInDisabled)
  )
  check(
    'stored: the remember box is not offered when nothing is being typed',
    storedFields.remember === false
  )

  // The direction that finds things: pressing "Use a different password" must
  // bring the field back, or a saved password that has stopped working is a
  // dead end.
  await b.click('button', /^Use a different password$/)
  for (let i = 0; i < 60; i += 1) {
    const n = await b.run(`
      return [...document.querySelectorAll('input')].filter((i) => i.type === 'password').length;
    `)
    if (n > 0) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const backToTyping = await b.run(`
    return [...document.querySelectorAll('input')].filter((i) => i.type === 'password').length;
  `)
  check('stored: "Use a different password" brings the field back', backToTyping === 1, `${backToTyping} field(s)`)
} finally {
  await b.close()
}

console.log(`\n${checked} checked, ${bad} failed`)
if (checked < 20) {
  console.log('REFUSING TO REPORT A RESULT: too few checks ran for a pass to mean anything.')
  process.exit(2)
}
process.exit(bad === 0 ? 0 : 1)
