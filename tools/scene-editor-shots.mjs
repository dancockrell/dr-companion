#!/usr/bin/env node
/**
 * The scene editor in a real browser, driven the way a person drives it.
 *
 * `tools/scene-editor-test.mjs` proves the resolver and the compiler. It
 * cannot prove that the panel renders, that the dropdown is reachable, or that
 * choosing something writes anything: it never mounts a component. This does
 * that half, by opening the popped-out panel window, changing the ground kind
 * with the control a person would use, and reading back what landed in the
 * store.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false here, so this runs against the
 * mock bridge rather than a live Lich, and nothing about the Godot viewer is
 * exercised at all - `tools/viewer-snapshot-server.mjs` is that capture, and
 * it is a separate artefact in the same verification note. This is the cheaper
 * check and it says which half it covers.
 *
 * Usage: node tools/scene-editor-shots.mjs [http://127.0.0.1:5183/]
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5183/'
const out = (name) => join(root, 'docs/verification', name)

const KEY = 'drc.scene.v1'
const CHOSEN = 'forest'

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(58)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

const b = await launch({ width: 900, height: 1000, headless: true })
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)

  await b.goto(`${base}?view=panel&id=scene`, { waitFor: '[data-testid="scene-panel"]' })

  /*
   * The room is reached through the place search rather than by following the
   * character, and that is a real limit of this capture rather than a
   * preference. A popped-out panel is its own webview with its own bridge
   * connection, and the mock does not deliver a `here` to it inside the time
   * this waits - the main window has one (`Room 308 · Empaths' Guild`,
   * measured), the pop-out does not. So the follow-the-character path is NOT
   * covered here; what is covered is the path a person uses to edit a room
   * they are not standing in, which is also the path that has to work with
   * nothing connected at all (`panelDataContracts.ts` says this panel does not
   * require a live character, and this is what makes that true).
   */
  const empty = await b.eval('document.body.innerText')
  check('with no room the panel says so rather than inventing one', /No room yet/.test(empty))

  await b.run(`
    const el = document.querySelector('input[placeholder^="Find a place"]');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, 'Town Green');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `)
  await new Promise((r) => setTimeout(r, 2500))
  await b.click('button', /Truffenyi/)

  let roomLabel = ''
  for (let i = 0; i < 40; i += 1) {
    roomLabel = await b.eval(
      'document.querySelector(\'[data-testid="scene-room"]\')?.innerText ?? ""'
    )
    if (roomLabel) break
    await new Promise((r) => setTimeout(r, 250))
  }
  check('the place search points the editor at a room', roomLabel.length > 0, JSON.stringify(roomLabel))
  if (!roomLabel) throw new Error('no room: every check below would be vacuous')

  const roomId = roomLabel.split('—')[0].trim()

  const beforeText = await b.eval('document.body.innerText')
  check('the ground field says where its value came from', /Ground · from the batch/.test(beforeText))
  check('the block field is on screen', /Block ·/.test(beforeText))
  check('the landmark field is on screen', /Landmark ·/.test(beforeText))
  check('the backdrop grid is on screen', /Backdrop ·/.test(beforeText))
  check(
    'landmarks are labelled as not drawn by the viewer rather than implied to be',
    /viewer draws no landmarks yet/.test(beforeText)
  )
  check(
    'no reset is offered for a field nobody has overridden',
    !/reset to guess/.test(beforeText),
    'reset only appears when there is something to reset'
  )
  check('nothing is stored before anything is chosen', (await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) === null)

  const artCount = await b.eval('document.querySelectorAll("[data-scene-art]").length')
  check('the backdrop grid offers the reviewed images', artCount >= 5, `${artCount} images`)

  await b.screenshot(out('scene-editor-2026-09-06-panel.png'))

  // The control a person uses, not a direct write to the store.
  await b.select(CHOSEN)
  await new Promise((r) => setTimeout(r, 400))

  const stored = JSON.parse((await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) ?? 'null')
  check('choosing a ground kind writes it to the store', stored?.[roomId]?.ground === CHOSEN, JSON.stringify(stored))
  check(
    'and writes nothing else',
    stored != null && Object.keys(stored).length === 1 && Object.keys(stored[roomId]).length === 1,
    JSON.stringify(Object.keys(stored?.[roomId] ?? {}))
  )

  const afterText = await b.eval('document.body.innerText')
  check('the panel now says the value is yours', /Ground · yours/.test(afterText))
  check('and offers to put it back', /reset to guess/.test(afterText))

  // The export shape, read through the app's own module rather than rebuilt
  // here, because a second statement of the file format is the thing this
  // whole lane is about not having.
  const exported = await b.eval(`
    (async () => {
      const m = await import('/src/lib/sceneOverrides.ts')
      return JSON.stringify(m.exportSceneOverrides())
    })()
  `)
  const parsed = JSON.parse(exported)
  check('the exported set carries the choice', parsed.overrides?.[roomId]?.ground === CHOSEN, exported)
  check('and says what kind of file it is', parsed.version === 1 && parsed.provenance === 'player')

  await b.screenshot(out('scene-editor-2026-09-06-chosen.png'))

  await b.click('button', /reset to guess/)
  await new Promise((r) => setTimeout(r, 400))
  const afterReset = JSON.parse((await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) ?? 'null')
  check('reset removes the room from the store entirely', afterReset?.[roomId] === undefined, JSON.stringify(afterReset))
  check('and the batch answer is back on screen', /Ground · from the batch/.test(await b.eval('document.body.innerText')))
} finally {
  await b.close()
}

console.log(bad === 0 ? '\nno failures' : `\n${bad} failed`)
process.exit(bad === 0 ? 0 : 1)
