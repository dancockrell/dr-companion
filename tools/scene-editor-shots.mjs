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

  // ------------------------------------------------------------------ S3
  // The picker, driven with the two controls a person has: the square, and the
  // numbers. `scene-editor-test.mjs` proves the store and the compiler accept a
  // placement; only this can say that a click on the footprint produces one.

  const kinds = await b.eval('document.querySelectorAll("[data-scene-placeable]").length')
  const offered = await b.eval(`
    (async () => {
      const m = await import('/src/lib/sceneOverrides.ts')
      return m.sceneOptions().placeable.length
    })()
  `)
  check('the picker offers the registry’s placeable kinds', kinds >= 1, `${kinds} kinds, compiled not typed`)
  check(
    'and offers no row for a kind the registry does not admit',
    kinds === offered,
    'the grid is the registry, with nothing added and nothing greyed out'
  )

  // The centre of the square, which is (0, 0) in the cell. A weak position on
  // purpose: the next check moves it, and a value that had to travel is worth
  // more than one that happened to match the default.
  await b.click('[data-testid="scene-footprint"]')
  await new Promise((r) => setTimeout(r, 400))
  const placed = JSON.parse((await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) ?? 'null')
  check(
    'clicking the footprint places a primitive',
    Array.isArray(placed?.[roomId]?.primitives) && placed[roomId].primitives.length === 1,
    JSON.stringify(placed?.[roomId]?.primitives)
  )
  check(
    'it lands where the click was, not at a default nobody chose',
    placed?.[roomId]?.primitives?.[0]?.x === 0 && placed?.[roomId]?.primitives?.[0]?.z === 0,
    'the centre of the square is the centre of the cell'
  )
  const markers = await b.eval('document.querySelectorAll("[data-scene-placed]").length')
  check('and it is drawn on the square', markers >= 1, `${markers} marker(s)`)

  // Typing a value no click could produce. The property is not that the field
  // clamps but that whatever reaches the store is something the store accepts:
  // a refusal here would be a red message about a number the person was handed
  // a box to type.
  const half = await b.eval(`
    (async () => {
      const m = await import('/src/lib/sceneOverrides.ts')
      return m.PLACEMENT_HALF_EXTENT
    })()
  `)
  await b.run(`
    const el = document.querySelector('[data-scene-placed-x="0"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '99');
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `)
  await new Promise((r) => setTimeout(r, 400))
  const nudged = JSON.parse((await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) ?? 'null')
  check(
    'a typed position past the edge is pulled back rather than refused',
    nudged?.[roomId]?.primitives?.[0]?.x === half,
    `typed 99, stored ${nudged?.[roomId]?.primitives?.[0]?.x} against a half-extent of ${half}`
  )
  check(
    'and no refusal is shown for a value the control itself offered',
    !/is not a primitives this build can draw/.test(await b.eval('document.body.innerText'))
  )

  await b.screenshot(out('scene-editor-2026-09-06-picker.png'))

  // Reload, because S3's `verify:` is "place one, reload, still there" and a
  // value living only in React state would pass everything above.
  await b.goto(`${base}?view=panel&id=scene`, { waitFor: '[data-testid="scene-panel"]' })
  await new Promise((r) => setTimeout(r, 600))
  const survived = JSON.parse((await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) ?? 'null')
  check(
    'the placement survives a reload',
    survived?.[roomId]?.primitives?.[0]?.x === half,
    'the store, not component state'
  )

  // ------------------------------------------------------------------ S4
  // Coverage and transfer, on the room the search reopens after the reload.

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
  await b.waitFor('[data-testid="scene-transfer"]')

  const exportCount = await b.eval(
    'document.querySelector(\'[data-testid="scene-export-count"]\')?.innerText ?? ""'
  )
  check('the transfer section counts the rooms decided here', exportCount === '1', JSON.stringify(exportCount))

  await b.click('[data-testid="scene-transfer"] summary')
  const exportText = await b.eval('document.querySelector(\'[data-testid="scene-export"]\')?.value ?? ""')
  check(
    'the export on screen is the file the builder reads back',
    JSON.parse(exportText).overrides?.[roomId]?.primitives?.[0]?.x === half,
    'the same shape tools/build-world-content.mjs takes as its first rule'
  )

  // Somebody else's file, naming the same room. The merge is per *field* and
  // not per room, which is the distinction worth checking here: the incoming
  // file disagrees about the placement, which this player has decided, and also
  // offers a ground, which they have not. The first must be kept and the second
  // taken - a room-level rule would have to throw one of those away, and either
  // direction loses something nobody asked it to lose.
  //
  // Written this way after the first version asserted the room-level rule and
  // went red. The code was right and the check was wrong.
  //
  // The second room is `1-1`, which is a real room in this zone. It used to be
  // `999-1` - not a room in any zone this app ships - and it was taken, stored,
  // and then dropped at compile without a word, which is #461's third finding
  // sitting inside the check that was supposed to be watching. Since the import
  // checks room existence, a case written that way is now refused, correctly,
  // while proving nothing about the merge.
  const foreign = JSON.stringify({
    version: 1,
    provenance: 'somebody-else',
    overrides: {
      [roomId]: { primitives: [{ kind: 'water-ribbon-5m', x: -1, z: 1 }], ground: 'water' },
      '1-1': { ground: 'sand' },
    },
  })
  await b.run(`
    const el = document.querySelector('[data-testid="scene-import-text"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(foreign)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `)
  await b.click('[data-testid="scene-import"]')
  await new Promise((r) => setTimeout(r, 400))
  const merged = JSON.parse((await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)) ?? 'null')
  const resultLine = await b.eval(
    'document.querySelector(\'[data-testid="scene-import-result"]\')?.innerText ?? ""'
  )
  check('an import takes what is new', merged?.['1-1']?.ground === 'sand', 'a room this machine had no opinion about')
  check(
    'and never overwrites a local choice',
    merged?.[roomId]?.primitives?.[0]?.x === half,
    'the incoming placement disagreed and the local one stands'
  )
  check(
    'while still taking a field of that same room nobody here had decided',
    merged?.[roomId]?.ground === 'water',
    'the merge is per field, so a disagreement about one thing does not throw away agreement about another'
  )
  check('and reports the conflict by count rather than resolving it silently', /kept mine over 1/.test(resultLine), resultLine)

  const coverage = await b.eval(
    'document.querySelector(\'[data-testid="scene-coverage-count"]\')?.innerText ?? "(absent)"'
  )
  check(
    'the coverage list states this zone’s unclassified count',
    /^\d+$/.test(coverage),
    `${coverage} unclassified in this zone, derived from the zone's own content file`
  )

  // ----------------------------------------------------------------- #461
  // A bad file, and the reason on screen where the person is looking. The
  // node suite proves the parse refuses; only this says the refusal reaches a
  // pixel. The store is read after each one, because a refusal that is shown
  // and stored anyway is worse than no refusal at all.

  const paste = async (text) => {
    await b.run(`
      const el = document.querySelector('[data-testid="scene-import-text"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)
    await b.click('[data-testid="scene-import"]')
    await new Promise((r) => setTimeout(r, 500))
    return {
      error: await b.eval('document.querySelector(\'[data-testid="scene-import-error"]\')?.innerText ?? ""'),
      refusals: await b.eval('document.querySelector(\'[data-testid="scene-import-refusals"]\')?.innerText ?? ""'),
      store: await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`),
    }
  }

  const before461 = await b.eval(`localStorage.getItem(${JSON.stringify(KEY)})`)
  const future = await paste(
    JSON.stringify({ version: 99, provenance: 'attacker', overrides: { '1-2': { ground: 'water' } } })
  )
  check('a file from a future format is refused on screen, naming the version', /99/.test(future.error), future.error)
  check('and nothing from it is stored', future.store === before461)

  const ghost = await paste(
    JSON.stringify({
      version: 1,
      provenance: 'somebody-else',
      overrides: { '1-99999': { ground: 'water' }, '1-3': { ground: 'water' } },
    })
  )
  check(
    'a room this map does not have is named as refused',
    /1-99999/.test(ghost.refusals),
    ghost.refusals.split('\n')[0] ?? ''
  )
  check(
    'and the rooms that are real in the same file are still taken',
    JSON.parse(ghost.store ?? 'null')?.['1-3']?.ground === 'water' &&
      JSON.parse(ghost.store ?? 'null')?.['1-99999'] === undefined,
    'one bad room does not cost a person the rest of the file'
  )

  const payload = await paste(
    JSON.stringify({
      version: 1,
      provenance: 'somebody-else',
      overrides: {
        '1-4': { primitives: [{ kind: 'water-ribbon-5m', x: 0, z: 0, payload: { a: { b: 'x'.repeat(64) } } }] },
      },
    })
  )
  check(
    'a primitive carrying a nested payload is refused, naming the key',
    /payload/.test(payload.refusals),
    payload.refusals.split('\n')[0] ?? ''
  )
  check('and it is not in the store', JSON.parse(payload.store ?? 'null')?.['1-4'] === undefined)

  await b.screenshot(out('scene-import-2026-09-06.png'))

  // The quota this origin actually has, measured rather than assumed, because
  // `SCENE_LIMITS` is chosen against it and a cap chosen against a number
  // nobody measured is a guess with a comment.
  const quota = await b.eval(`
    (() => {
      const key = 'drc.quota-probe'
      const chunk = 'x'.repeat(1024)
      let written = 0
      try {
        for (;;) {
          localStorage.setItem(key, chunk.repeat(written + 64))
          written += 64
          if (written > 20000) break
        }
      } catch (e) {
        // the expected end
      }
      const held = (localStorage.getItem(key) ?? '').length
      localStorage.removeItem(key)
      return held
    })()
  `)
  console.log(
    `NOTE this origin held ${quota} characters in one key (${(quota / 1048576).toFixed(2)} MiB of characters) before refusing`
  )
  const cap = await b.eval(`
    (async () => (await import('/src/lib/sceneOverrides.ts')).SCENE_LIMITS.totalChars)()
  `)
  check(
    'the scene cap is a fraction of what this origin will hold',
    quota > cap * 2,
    `cap ${cap}, measured quota ${quota} characters in a single key`
  )
} finally {
  await b.close()
}

console.log(bad === 0 ? '\nno failures' : `\n${bad} failed`)
process.exit(bad === 0 ? 0 : 1)
