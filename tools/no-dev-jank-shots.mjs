#!/usr/bin/env node
/**
 * What the panels look like now, photographed rather than described.
 *
 *   node tools/no-dev-jank-shots.mjs [http://127.0.0.1:5207/]
 *
 * Four states, each reached the way a player would reach it:
 *
 *   a. the AI panel with no model - the state Dan's machine is in, and the
 *      one that filled two thirds of a rail with counters;
 *   b. the same panel with the setup affordance pressed;
 *   c. the AI panel with a model answering - a real loopback server speaking
 *      the `/v1/models` subset `aiLocalProvider.ts` probes, reached through
 *      the panel's own Test button, so this is the app's real path and not a
 *      state poked into a store;
 *   d. the room text and the panel-crash boundary, the two other surfaces
 *      this lane changed.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app: `isTauri()` is false, so the desktop-only halves of
 * these screens do not run. This is the cheaper check and it says which half
 * it covers. `tools/app-eyes.mjs` is the one that attaches to the real
 * WebView2.
 */
import { launch } from './browser.mjs'
import { createServer } from 'node:http'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5207/'
const out = (name) => join(root, `docs/verification/no-dev-jank-2026-09-09-${name}.png`)

let bad = 0
let checks = 0
const check = (label, cond, detail) => {
  checks += 1
  if (!cond) bad += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(56)} ${detail ?? ''}`)
}

// The stand-in model server. Loopback only, because the host refuses anything
// else and this has to go through the same door a real one would.
const MODEL_PORT = 11439
const model = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  if (req.url?.startsWith('/v1/models')) {
    res.end(JSON.stringify({ data: [{ id: 'stand-in-7b' }] }))
    return
  }
  res.statusCode = 404
  res.end('{}')
})
await new Promise((r) => model.listen(MODEL_PORT, '127.0.0.1', r))

const b = await launch({ width: 1280, height: 860, headless: true })
try {
  // A profile through setup, in the mock world, so the workspace and its right
  // rail exist at all. Without a character App.tsx renders WaitingForCharacter
  // and this panel is not on screen to photograph.
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)
  await b.goto(base)
  await b.waitFor('[aria-label="Context side"]', 20000)

  const a = await b.eval(
    'document.querySelector(\'[aria-label="Context side"]\')?.innerText ?? ""',
  )
  await b.screenshot(out('ai-no-model'))
  check('a. one sentence says why it is off', /The assistant is off/.test(a), JSON.stringify(a.slice(0, 90)))
  check('a. one affordance to set it up', /Set one up/.test(a))
  // The absence checks, by the names that were in front of Dan.
  check('a. no unreviewed-events counter in front', !/Unreviewed events/.test(a))
  check('a. no background-jobs row in front', !/Background jobs/.test(a))
  check('a. no last-attempt string in front', !/Last attempt/.test(a))
  check('a. no model-server field in front', !/Model address/.test(a))
  check('a. no port numbers in front', !/11434|1234|8080/.test(a))
  // The control on those absences: the same names must be present inside the
  // disclosure, or "absent" would only mean the panel is empty.
  // `textContent`, not `innerText`: a closed `<details>` is not rendered, so
  // innerText returns the summary alone and this control failed while the
  // counters were sitting right there in the DOM. A control that cannot pass
  // is as empty as one that cannot fail, and every absence check above means
  // nothing without it.
  const hidden = await b.eval(
    'document.querySelector(\'[aria-label="Context side"] details\')?.textContent ?? ""',
  )
  check(
    'a. control: the counters are inside the disclosure',
    /Unreviewed events/.test(hidden) && /Worker turns/.test(hidden),
    JSON.stringify(hidden.slice(0, 90)),
  )
  const open = await b.eval(
    'document.querySelector(\'[aria-label="Context side"] details\')?.open ?? null',
  )
  check('a. and the disclosure is closed by default', open === false, String(open))

  await b.click('button', /Set one up/)
  await b.waitFor('#ai-provider-url', 10000)
  const bText = await b.eval(
    'document.querySelector(\'[aria-label="Context side"]\')?.innerText ?? ""',
  )
  await b.screenshot(out('ai-setup-open'))
  check('b. pressing it reveals the address field', /Model address/.test(bText))
  check('b. and the three known addresses', /11434/.test(bText) && /1234/.test(bText) && /8080/.test(bText))

  // c. a model that answers, reached through the panel's own button.
  await b.run(`
    document.querySelector('#ai-provider-url').value = '';
    return true;
  `)
  await b.run(`
    document.querySelector('#ai-provider-url').focus();
    return true;
  `)
  await b.type(`http://127.0.0.1:${MODEL_PORT}`)
  await b.click('button', /^Test$/)
  let cText = ''
  for (let i = 0; i < 60; i += 1) {
    cText = await b.eval('document.querySelector(\'[aria-label="Context side"]\')?.innerText ?? ""')
    if (/watching the game/.test(cText)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  await b.screenshot(out('ai-model-present'))
  check('c. with a model it says what it is doing', /watching the game/.test(cText), JSON.stringify(cText.slice(0, 90)))
  check('c. and still no counter in front', !/Unreviewed events/.test(cText))

  // d. the two other surfaces this lane changed.
  const room = await b.eval(
    'document.querySelector(\'[aria-label="Board"]\')?.innerText ?? ""',
  )
  await b.screenshot(out('room-text'))
  check('d. the room ids are no longer prose beside the room name', !/Lich room/.test(room) && !/game uid/.test(room))

  const footer = await b.eval('document.body.innerText')
  await b.screenshot(out('safety-footer'))
  check(
    'd. the footer carries no bridge retry counter',
    !/Bridge reconnecting \d/.test(footer) && !/Bridge gave up \(/.test(footer),
    JSON.stringify(footer.slice(0, 90)),
  )
} finally {
  await b.close()
  model.close()
}

console.log(`\n${checks} checks, ${bad} failure(s)`)
process.exit(bad === 0 ? 0 : 1)
