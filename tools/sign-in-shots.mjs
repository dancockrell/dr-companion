#!/usr/bin/env node
/**
 * The render check for the sign-in screen.
 *
 * Drives a real browser through the whole flow and saves what it saw, rather
 * than describing it. Reading the component is not looking at it, and every
 * layout defect this project has shipped was invisible in the source and
 * obvious in a picture - issue #418 was a call to action rendered below the
 * bottom edge of the window.
 *
 * States, each reached by pressing what a person would press:
 *
 *   form         the account/password/game form on a profile with nothing stored
 *   picker       the character list that came back, which is the `C` reply
 *   launched     after picking one, with the attach flow taking over
 *   error        a failure shown as a sentence, not a stack trace
 *   one press    a returning player with everything remembered, signing in
 *                with a single press (9 September 2026)
 *   stranded     an offer with nothing to attach to, which must still have a
 *                way back (#523)
 *
 * # Why this file grew rather than a second one appearing beside it
 *
 * The 9 September 2026 work on the first-contact experience asked for a
 * real-browser harness. There was already one, for this screen, and a second
 * would have been two harnesses answering one question - which drift, and then
 * both are wrong. So the new states are cases here, the screenshots carry the
 * new date, and the checks that the reversal turned over were turned over
 * rather than duplicated.
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

/** Whether the account field arrived filled, and what it held. */
const accountPrefilled = (o) => o.accountValue === 'saved'
const accountDetail = (o) => JSON.stringify(o.accountValue)

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

/**
 * A profile that has been through setup and remembers nothing, at the smallest
 * window size the sign-in has to fit in without clipping.
 *
 * Every cold case starts here. Before 9 September 2026 one `localStorage.clear()`
 * at the top was enough, because nothing was remembered unless a box was
 * ticked; now a successful sign-in remembers the account, the game and the
 * character by default, so the second case would open on a returning player's
 * screen with a button reading "Sign in as Phemius" and its click would miss.
 * The first run of this harness died exactly there, and the app was right.
 */
async function freshProfile() {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true }));
    return true;
  `)
  await b.goto(url('bridge=live'))
}

try {
  // ---------------------------------------------------------------- form
  await freshProfile()
  const formText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-form.png'))

  // Case-insensitive: the heading carries `uppercase`, and innerText reports
  // what is rendered, so an exact-case match tests the stylesheet.
  check('form: the screen offers a sign-in', /sign in to dragonrealms/i.test(formText))
  check('form: it asks for an account name', /Account name/.test(formText))
  check('form: and a password', /Password/.test(formText))
  check('form: and which game', /DragonRealms/.test(formText))
  check(
    'form: the password sentence is the true one',
    /and kept in Windows Credential Manager unless you untick the box/.test(formText)
  )
  check(
    'form: and the sentence it replaced is gone from the screen',
    !/not stored unless you later ask for it/.test(formText),
    'the opt-in promise is not still on the panel'
  )
  check(
    'form: nothing tells anybody to configure another client',
    !/lichconnect|licharguments|#config/i.test(formText),
    'no retired walkthrough on screen'
  )
  // The box, its consequence and its warning. It governs the whole sign-in
  // now, not the password alone, and it is ticked when the screen opens -
  // which is exactly why the consequence has to be on the panel rather than
  // behind the act of ticking: nobody had to do anything to reach this state.
  check(
    'form: the remember box is offered, and named for what it does',
    /Remember my sign-in on this computer/i.test(formText)
  )
  check(
    'form: it says what is kept and why',
    /account name, game, character and password are kept/i.test(formText)
  )
  check(
    'form: and it says who else on this machine could use it',
    /Anyone signed in to this Windows account can use it/i.test(formText)
  )
  const rememberTicked = await b.run(`
    const box = [...document.querySelectorAll('input')].filter((i) => i.type === 'checkbox');
    return { count: box.length, checked: box.map((i) => i.checked) };
  `)
  check(
    'form: the box is on screen (control)',
    rememberTicked.count === 1,
    `${rememberTicked.count} checkbox(es)`
  )
  check(
    'form: and it is ticked when the screen opens',
    rememberTicked.checked[0] === true,
    JSON.stringify(rememberTicked.checked)
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
  await b.screenshot(out('sign-in-experience-2026-09-09-picker.png'))

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
    if (/Phemius is in the game/i.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const launchedText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-launched.png'))
  check('launched: the app says who it signed in', /Phemius is in the game/i.test(launchedText))
  check('launched: and what happens next', /game text appears/.test(launchedText))

  // --------------------------------------------------------------- error
  // A failure has to read as a sentence. `locked` is a fixture account whose
  // whole purpose is to make this arm reachable without an account.
  await freshProfile()
  await fill(b, 'Account name', 'locked')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/locked this account/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const errorText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-error.png'))
  check('error: it is a sentence a player can act on', /Play\.net has locked this account/.test(errorText))
  check('error: no token, no stack, no error code', !/account_locked|Error:|at \w+ \(/.test(errorText))
  const cleared = await b.run(`
    return [...document.querySelectorAll('input')]
      .filter((i) => i.type === 'password' && i.value).length;
  `)
  check('error: the password field was cleared on the failure', cleared === 0, `${cleared} still filled`)

  /* ------------------------------------------- the attach offer (#504)
   *
   * A refused launch used to put one button on screen - "Attach to the
   * Lich that is running" - on the strength of one `tasklist` match on an
   * image name, and pressing it dialled the constant 11024. It could join
   * another account's character with nothing on screen saying the character
   * had changed, and for a Lich started without `--detachable-client` its
   * "press it again" advice could never come true.
   *
   * Five answers now, each its own sentence, and four of them are only
   * reachable at all because `lichLoginFake` has a fixture per answer: a
   * state the stand-in cannot produce is a state nobody sees until a
   * player does.
   *
   * The rows assert what is *not* said as well as what is. `no_port` and
   * `unknown` must offer no button, because a press that cannot work is
   * the defect, and `foreign` must carry the other character's name,
   * because that name is the only thing on screen that would stop somebody
   * joining a session they did not mean to.
   */
  const OFFERS = [
    {
      account: 'runningours',
      kind: 'ours',
      shot: 'sign-in-experience-2026-09-09-attach-ours.png',
      says: /This app started that Lich and it is still running\./,
      action: /^Attach to it$/,
    },
    {
      account: 'running',
      kind: 'foreign',
      shot: 'sign-in-experience-2026-09-09-attach-foreign.png',
      says: /A Lich is running for Someoneelse on port 11024\./,
      action: /^Attach to Someoneelse$/,
    },
    {
      account: 'runningnoport',
      kind: 'no_port',
      shot: 'sign-in-experience-2026-09-09-attach-no-port.png',
      says: /has no attachable port/,
      action: null,
    },
    {
      account: 'runningnolich',
      kind: 'no_lich',
      shot: 'sign-in-experience-2026-09-09-attach-no-lich.png',
      says: /No Lich is running now\./,
      action: null,
    },
    {
      account: 'runningunknown',
      kind: 'unknown',
      shot: 'sign-in-experience-2026-09-09-attach-unknown.png',
      says: /Could not tell which Lich is running/,
      action: null,
    },
  ]

  const kindsSeen = []
  for (const row of OFFERS) {
    await freshProfile()
    await fill(b, 'Account name', row.account)
    await fill(b, 'Password', 'not-a-real-password-9d4f')
    await b.click('button', /^Sign in$/)
    for (let i = 0; i < 60; i += 1) {
      if (/^Phemius$/m.test(await b.eval('document.body.innerText'))) break
      await new Promise((r) => setTimeout(r, 100))
    }
    await b.click('button', /^Phemius$/)
    // The offer is a second round trip after the refusal, so wait for the
    // answer rather than for the refusal.
    let seen = null
    for (let i = 0; i < 80; i += 1) {
      seen = await b.run(`
        const el = document.querySelector('[data-attach-kind]');
        const box = document.querySelector('[data-testid="attach-offer"]');
        return {
          kind: el ? el.getAttribute('data-attach-kind') : null,
          sentence: el ? el.textContent.trim() : '',
          buttons: box ? [...box.querySelectorAll('button')].map((x) => x.innerText.trim()) : [],
        };
      `)
      if (seen.kind && seen.kind !== 'checking') break
      await new Promise((r) => setTimeout(r, 100))
    }
    await b.screenshot(out(row.shot))
    kindsSeen.push(seen.kind)

    check(`attach ${row.kind}: the offer is that one`, seen.kind === row.kind, String(seen.kind))
    check(`attach ${row.kind}: the sentence says so`, row.says.test(seen.sentence), JSON.stringify(seen.sentence))
    // The old sentence, named, so a revert reads as a failure rather than
    // as a different wording.
    check(
      `attach ${row.kind}: not the old unconditional offer`,
      !/Attach to the Lich that is running/.test(seen.sentence + seen.buttons.join(' ')),
      seen.buttons.join(' | ')
    )
    if (row.action) {
      // One *attach*, and it says what it will join. The panel also carries a
      // way back now (#523), so the old `buttons.length === 1` would have been
      // asserting the absence of the escape hatch rather than the presence of
      // one offer.
      const attaches = seen.buttons.filter((x) => /^Attach/.test(x))
      check(
        `attach ${row.kind}: one attach button, and it says what it will join`,
        attaches.length === 1 && row.action.test(attaches[0]),
        seen.buttons.join(' | ')
      )
      check(
        `attach ${row.kind}: and a way back beside it`,
        seen.buttons.some((x) => /Back to sign in/.test(x)),
        seen.buttons.join(' | ')
      )
    } else {
      // #523, and this is the check that turned over on 9 September 2026. It
      // used to assert *no* buttons at all, which was right about the attach
      // and wrong about the screen: a sentence saying why nothing can be
      // pressed, with nothing to press, is where a player was stranded. There
      // is no attach, and there is a way back.
      check(
        `attach ${row.kind}: no attach, because pressing could not work`,
        !seen.buttons.some((x) => /^Attach/.test(x)),
        seen.buttons.join(' | ')
      )
      check(
        `attach ${row.kind}: and still a way back rather than a dead end`,
        seen.buttons.some((x) => /Back to sign in/.test(x)),
        seen.buttons.join(' | ') || 'no buttons at all'
      )
    }
  }
  // The denominator: five distinct answers were actually produced, so a
  // stand-in that had collapsed to one could not pass the rows above by
  // repeating it.
  check(
    'attach: five distinct offers were reachable',
    new Set(kindsSeen).size === 5,
    kindsSeen.join(', ')
  )
  // ------------------------------------------------- the empty-list state
  await freshProfile()
  await fill(b, 'Account name', 'nochars')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/has no /.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const emptyText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-no-characters.png'))
  check(
    'empty: an account with no characters says so',
    /has no characters in the game you chose/.test(emptyText)
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
  await freshProfile()
  await fill(b, 'Account name', 'locked')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/locked this account/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const lockedText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-locked.png'))
  check(
    'locked: the player is told where to go and what to do',
    /Sign in on the Play\.net website to unlock it/.test(lockedText)
  )
  check(
    'locked: the technical line is not on the panel',
    !/the account cannot sign in right now/.test(lockedText),
    'nothing but the sentence, until it is asked for'
  )
  await b.click('button', /Details for a bug report/)
  for (let i = 0; i < 40; i += 1) {
    if (/the account cannot sign in right now/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const lockedDetail = await b.eval('document.body.innerText')
  check(
    'locked: and one press away, for a bug report',
    /the account cannot sign in right now/.test(lockedDetail),
    'the detail line, disclosed'
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
  await freshProfile()
  await fill(b, 'Account name', 'nosuchaccount')
  await fill(b, 'Password', 'not-a-real-password-9d4f')
  await b.click('button', /^Sign in$/)
  for (let i = 0; i < 60; i += 1) {
    if (/was not accepted/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const badpwText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-badpw.png'))
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
  await freshProfile()
  await fill(b, 'Account name', 'saved')
  for (let i = 0; i < 60; i += 1) {
    if (/Using the password remembered/.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const storedText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-stored.png'))
  check(
    'stored: the form says it is using the saved password',
    /Using the password remembered on this computer for saved/.test(storedText)
  )
  check('stored: and offers a way past it', /Use a different password/.test(storedText))
  const storedFields = await b.run(`
    return {
      password: [...document.querySelectorAll('input')].filter((i) => i.type === 'password').length,
      signInDisabled: [...document.querySelectorAll('button')]
        .filter((x) => x.innerText.trim() === 'Sign in')
        .map((x) => x.disabled),
      remember: /Remember my sign-in on this computer/.test(document.body.innerText),
    };
  `)
  check('stored: there is no password box at all', storedFields.password === 0, `${storedFields.password} found`)
  check(
    'stored: and Sign in is pressable without typing one',
    storedFields.signInDisabled.length === 1 && storedFields.signInDisabled[0] === false,
    JSON.stringify(storedFields.signInDisabled)
  )
  // Turned over on 9 September 2026, not deleted. The box used to be hidden
  // here on the reasoning that there was nothing to remember - true while it
  // governed a password only. It governs the account, the game and the
  // character too now, so hiding it would hide the control that turns all of
  // that off from the one screen a returning player ever sees.
  check(
    'stored: the remember box is still offered, because it governs more than the password',
    storedFields.remember === true
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

  /* ------------------------------------------------ one press (9 Sep 2026)
   *
   * The whole point of remembering everything. A returning player's screen
   * opens with the account filled, no password field, the last character
   * named on the button, and focus already on it - so the sign-in is one
   * press and the character list never appears.
   *
   * Seeded through `localStorage` rather than by signing in first, because
   * what is being checked is the state a player *arrives* in.
   */
  await b.goto(base)
  await b.run(`
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({
      setupComplete: true,
      lichAccount: 'saved',
      lichGameCode: 'DR',
      lichCharacter: 'Phemius',
      lichRemember: true,
    }));
    return true;
  `)
  // Not `freshProfile()`: this case is about the state a returning player
  // arrives in, so the profile seeded above is the whole point.
  await b.goto(url('bridge=live')) // returning profile, seeded above
  for (let i = 0; i < 60; i += 1) {
    if (/Sign in as Phemius/i.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const backText = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-one-press.png'))
  check('one press: the screen greets a returning player', /Welcome back/i.test(backText))
  check('one press: and names the character on the button', /Sign in as Phemius/i.test(backText))
  const onepress = await b.run(`
    const buttons = [...document.querySelectorAll('button')];
    const submit = buttons.find((x) => /^Sign in as Phemius$/.test(x.innerText.trim()));
    return {
      passwordFields: [...document.querySelectorAll('input')].filter((i) => i.type === 'password').length,
      accountValue: (document.querySelector('input[name="username"]') || {}).value || '',
      submitFound: Boolean(submit),
      submitDisabled: submit ? submit.disabled : null,
      focused: document.activeElement ? document.activeElement.innerText.trim() : '',
      actionsToPlay: (document.querySelector('[data-actions-to-play]') || {}).dataset
        ? document.querySelector('[data-actions-to-play]').dataset.actionsToPlay
        : null,
    };
  `)
  check('one press: the account is already filled', accountPrefilled(onepress), accountDetail(onepress))
  check('one press: no password is asked for', onepress.passwordFields === 0, `${onepress.passwordFields} field(s)`)
  check('one press: the button is there and pressable (control)',
    onepress.submitFound === true && onepress.submitDisabled === false,
    JSON.stringify({ found: onepress.submitFound, disabled: onepress.submitDisabled }))
  check('one press: focus is already on it, so Enter is enough',
    /Sign in as Phemius/.test(onepress.focused), JSON.stringify(onepress.focused))
  // The number, on the screen rather than only in a test: one act from here.
  check('one press: the screen is offering a one-act sign-in',
    onepress.actionsToPlay === '1', String(onepress.actionsToPlay))

  // And it works: one press, no character list, straight to the game.
  await b.click('button', /^Sign in as Phemius$/)
  for (let i = 0; i < 80; i += 1) {
    if (/Phemius is in the game/i.test(await b.eval('document.body.innerText'))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const afterPress = await b.eval('document.body.innerText')
  await b.screenshot(out('sign-in-experience-2026-09-09-one-press-done.png'))
  check('one press: one press reached the game', /Phemius is in the game/i.test(afterPress))
  check('one press: and the character list was never shown',
    !/Pick a character/.test(afterPress), 'the picker was skipped')
} finally {
  await b.close()
}

console.log(`\n${checked} checked, ${bad} failed`)
if (checked < 40) {
  console.log('REFUSING TO REPORT A RESULT: too few checks ran for a pass to mean anything.')
  process.exit(2)
}
process.exit(bad === 0 ? 0 : 1)
