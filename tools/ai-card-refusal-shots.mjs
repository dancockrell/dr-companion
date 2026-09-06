#!/usr/bin/env node
/**
 * The render check for issue #399: a refusal is shown with the suggestion it
 * is about, and a fresh suggestion wears none.
 *
 * `tools/ai-suggestions-test.mjs` asserts the rule (`suggestionCardView`) with
 * nothing rendered, which is the right shape for a property and cannot tell
 * you whether the panel draws the answer it is given. This clicks Confirm in a
 * real browser and reads what is on the card, which is how the bug was found
 * in the first place - it was invisible in the source and obvious on screen.
 *
 * Three states, reached the way a player reaches them:
 *
 *   a. a suggestion pinned to a state version that is no longer current;
 *   b. after pressing Confirm - the gate refuses and *settles* it, so before
 *      #399 the card simply vanished with nothing said. It must now still be
 *      there, marked "not sent", carrying its own reason, and offering no
 *      Confirm, because there is nothing left to confirm;
 *   c. a new, valid suggestion - which must carry no trace of (b)'s refusal.
 *      That is the half that was measured on the issue: a good card with 60
 *      seconds on the clock wearing another proposal's red line.
 *
 * The suggestions are created through the page's own module graph, because
 * producing one for real needs a local model this machine does not have. The
 * store reached is the production singleton the panel is holding - the check
 * asserts that, since a second copy of the module would make every assertion
 * below a statement about a store nothing renders.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app: `isTauri()` is false, so nothing here exercises the
 * bridge or the real command path. It does not need to - no command is sent in
 * any of these states, and the gate's own suite covers the one that is.
 *
 * Usage: npm run dev -- --port 5187, then
 *        node tools/ai-card-refusal-shots.mjs http://127.0.0.1:5187/
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5187/'
const out = (name) => join(root, 'docs/verification', name)

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

// The card's text, read from the DOM rather than from anything this script
// believes about the store.
const CARD_TEXT = `
  const label = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Suggested command');
  const card = label ? label.closest('div.rounded') : null;
  return card ? card.innerText : null;
`

const b = await launch({ width: 1400, height: 900, headless: true })
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true }));
    return true;
  `)
  await b.goto(base)
  await b.click('button', /Start the demo/)
  await b.waitFor('header[aria-label="Character and location"]', 15000)

  // The instrument, before anything is asserted with it: this must be the
  // store the panel holds, or every check below is about a store nobody draws.
  // `eval` rather than `run`: the helper's `run` wraps the body in a plain
  // arrow function, which cannot await a dynamic import.
  const wired = await b.eval(`(async () => {
    const m = await import('/src/lib/aiSuggestions.ts');
    window.__store = m.suggestionStore();
    const sv = await import('/src/lib/stateVersion.ts');
    window.__stateVersion = sv.currentStateVersion;
    return true;
  })()`)
  check('the page module graph is reachable', wired === true, String(wired))

  const before = await b.run(CARD_TEXT)
  check('no card before anything is proposed', before === null, before)

  // a. a proposal the gate will refuse, and settle, on Confirm.
  const stale = await b.run(`
    const r = window.__store.create({
      exactCommand: 'look chest',
      commandType: 'look',
      basedOnStateVersion: 999999,
      expiresAt: Date.now() + 60000,
      evidenceRefs: ['event:1'],
    });
    return r.ok ? r.suggestion.id : 'refused: ' + r.reason;
  `)
  check('a. a suggestion was recorded', /^suggestion:/.test(stale), stale)
  await b.waitFor('div.rounded', 5000)
  const offered = await b.run(CARD_TEXT)
  check('a. the card is on screen at all', offered !== null && offered.includes('look chest'), offered)
  check('a. and it offers Confirm while it is live', /Confirm/.test(offered ?? ''), offered)
  await b.screenshot(out('ai-card-refusal-2026-09-06-offered.png'))

  // b. the refusal that used to disappear.
  await b.click('button', /^Confirm$/)
  const settled = await b.run(CARD_TEXT)
  check('b. the card did not vanish', settled !== null, settled)
  check('b. it still names the command it is about', /look chest/.test(settled ?? ''), settled)
  check('b. it says why, in its own card',
    /Not sent: the state it was based on is no longer current/.test(settled ?? ''), settled)
  check('b. it is marked as not sent', /not sent/.test(settled ?? ''), settled)
  // `settled !== null` first: without it this passes when there is no card at
  // all, which is the very failure the case above is about - a check that a
  // button is absent is satisfied by the whole screen being absent.
  check('b. and Confirm is gone, because there is nothing left to confirm',
    settled !== null && !/Confirm/.test(settled.replace(/you confirm this exact text[\s\S]*/, '')),
    settled)
  await b.screenshot(out('ai-card-refusal-2026-09-06.png'))

  // c. the next proposal must be clean. This is the measured half of #399.
  const fresh = await b.run(`
    const r = window.__store.create({
      exactCommand: 'look table',
      commandType: 'look',
      basedOnStateVersion: window.__stateVersion(),
      expiresAt: Date.now() + 60000,
      evidenceRefs: ['event:2'],
    });
    return r.ok ? r.suggestion.id : 'refused: ' + r.reason;
  `)
  check('c. a second suggestion was recorded', /^suggestion:/.test(fresh), fresh)
  const next = await b.run(CARD_TEXT)
  check('c. the new card is the one on screen', /look table/.test(next ?? ''), next)
  check('c. the old command is gone with it', !/look chest/.test(next ?? ''), next)
  check('c. and it carries no refusal', !/Not sent:/.test(next ?? ''), next)
  check('c. it is confirmable', /Confirm/.test(next ?? ''), next)
  await b.screenshot(out('ai-card-refusal-2026-09-06-next.png'))

  const errors = b.consoleErrors().filter((e) => !/companion|WebSocket/i.test(e))
  check('no page exceptions', errors.length === 0, errors.join(' | '))
} finally {
  await b.close()
}

console.log(bad === 0 ? '\nall render checks passed' : `\n${bad} render check(s) failed`)
process.exit(bad === 0 ? 0 : 1)
