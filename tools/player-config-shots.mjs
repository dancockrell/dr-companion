#!/usr/bin/env node
/**
 * The player config panel in a real browser, driven the way a person drives it.
 *
 * `tools/player-config-test.mjs` proves the store and `player-config-import-test.mjs`
 * proves the mapping. Neither mounts a component, so neither can say the panel
 * renders, that seven tabs are reachable, or that picking a config file puts a
 * report on screen. This does that half.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false here, so the "Import from my
 * Genie install" button is deliberately absent and the file picker is the path
 * exercised - which is also the path that has to work for a player who moved
 * machines and has the files but not the install. The Tauri route shares one
 * importer with it (`importGenieConfig`), and that importer is what the two
 * suites above cover.
 *
 * Usage: node tools/player-config-shots.mjs [http://127.0.0.1:5196/]
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5196/'
const out = (name) => join(root, 'docs/verification', name)

const DOMAINS = ['presets', 'highlights', 'aliases', 'macros', 'substitutes', 'gags', 'variables']

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(62)} ${detail ?? ''}`)
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

  await b.goto(`${base}?view=panel&id=config`, { waitFor: '[data-testid="player-config-panel"]' })

  const tabs = await b.eval('document.querySelectorAll(\'[role="tab"]\').length')
  check('the panel shows one tab per domain', tabs === 7, `${tabs} of 7 tabs`)
  for (const domain of DOMAINS) {
    const present = await b.eval(
      `document.querySelector('[data-testid="config-tab-${domain}"]') !== null`
    )
    check(`the ${domain} tab is on screen`, present === true)
  }

  const before = await b.eval('document.body.innerText')
  check('an empty store reads as absent rather than as an error', /Read: absent/.test(before))
  // The default tab is `highlights`, which has an editor now. A tab that does
  // not is what this check is about, so it looks at one: an unbuilt tab has to
  // read as unbuilt rather than as broken. Q2 pointed this at `aliases`, and
  // Q3 built that tab, so it moves to one of the two Q4 still owes rather than
  // being deleted - the property outlives whichever tab happens to be last.
  await b.click('[data-testid="config-tab-substitutes"]')
  const unbuilt = await b.eval('document.body.innerText')
  check('an unbuilt tab names the increment that will fill it', /editor arrives with Q4/.test(unbuilt))
  await b.click('[data-testid="config-tab-highlights"]')
  check('nothing is stored before anything is imported', (await b.eval("localStorage.getItem('drc.player-config.aliases.v1')")) === null)

  /*
   * A fixture, not the machine's real config: this runs in CI too, and a
   * player's own aliases are not a thing to commit or to depend on. The two
   * files carry one entry that must map and one that must not, so a report of
   * all zeros cannot be mistaken for a clean run.
   */
  await b.run(`
    const files = {
      'aliases.cfg': '#alias {appc} {appraise $0 careful}\\n#alias {} {no name}',
      'highlights.cfg': '#highlight {line} {#66DDFF} {just arrived} {people}',
    };
    const dt = new DataTransfer();
    for (const [name, text] of Object.entries(files)) {
      dt.items.add(new File([text], name, { type: 'text/plain' }));
    }
    const input = document.querySelector('[data-testid="config-import-files"]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return dt.files.length;
  `)

  let applied = ''
  for (let i = 0; i < 40; i += 1) {
    applied = await b.eval(
      'document.querySelector(\'[data-testid="config-import-applied"]\')?.innerText ?? ""'
    )
    if (applied) break
    await new Promise((r) => setTimeout(r, 250))
  }
  check('the import reports what it added', /Added 2 rules/.test(applied), JSON.stringify(applied))

  const report = await b.eval(
    'document.querySelector(\'[data-testid="config-import-report"]\')?.innerText ?? ""'
  )
  check('the report is on screen', report.length > 0, `${report.length} characters`)
  check('it states every leaf, found or not', /substitutes\.cfg[\s\S]*not found/.test(report), '')
  check('it names the malformed line rather than swallowing it', /empty alias name/.test(report))
  check('and it lists what Genie has that this app does not', /#script/.test(report))

  const stored = JSON.parse((await b.eval("localStorage.getItem('drc.player-config.aliases.v1')")) ?? 'null')
  check('the alias reached the store, at the current version', stored?.version === 1 && stored?.entries?.length === 1, JSON.stringify(stored?.entries?.[0]?.name))
  check('marked as having come from Genie', stored?.entries?.[0]?.source === 'genie-import')

  await b.screenshot(out('player-config-2026-09-06-panel.png'))
  console.log(`\nwrote ${out('player-config-2026-09-06-panel.png')}`)

  /*
   * Q2: the highlights editor, driven the way a person drives it.
   *
   * The claim is not "a rule was written" - `tools/highlight-test.mjs` proves
   * that against the store. It is that typing a pattern into the panel changes
   * what the preview paints, with no reload, through the same `paint()` the
   * game pane uses. So the check reads the rendered colour off the preview,
   * not the store.
   */
  await b.run(`
    localStorage.removeItem('drc.player-config.highlights.v1');
    localStorage.removeItem('drc.player-config.presets.v1');
    return true;
  `)
  // Reloaded rather than reset in place: the import above left rules in these
  // two keys, and a preview that was already coloured would make the next
  // check pass without the editor doing anything.
  await b.goto(`${base}?view=panel&id=config`, { waitFor: '[data-testid="player-config-panel"]' })
  await b.click('[data-testid="config-tab-highlights"]')
  const emptyPreview = await b.eval(
    'document.querySelector(\'[data-testid="highlight-preview-count"]\')?.innerText ?? ""'
  )
  check('the preview says how many lines it searched', /of 6 lines matched/.test(emptyPreview), JSON.stringify(emptyPreview))
  check('and that they are a sample, not the game', /nothing is attached/.test(emptyPreview))
  check('nothing matches before a rule exists', /^Preview: 0 /.test(emptyPreview))

  const coloured = () =>
    b.eval(`
      [...document.querySelectorAll('[data-testid="highlight-preview-line"] span')]
        .filter((s) => s.style.color)
        .map((s) => s.style.color + '|' + s.innerText)
    `)
  check('no preview text is coloured yet', (await coloured()).length === 0)

  await b.run(`
    const input = document.querySelector('[data-testid="highlight-add-pattern"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'just arrived');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return input.value;
  `)
  await b.click('[data-testid="highlight-add"]')

  const painted = await coloured()
  check('the new rule colours a line in the preview', painted.length > 0, JSON.stringify(painted))
  check(
    'and it is the line it was written for, in the colour it was given',
    painted.some((v) => v.includes('Wipsy just arrived.') && v.startsWith('rgb(102, 221, 255)')),
    JSON.stringify(painted)
  )
  const afterAdd = await b.eval(
    'document.querySelector(\'[data-testid="highlight-preview-count"]\')?.innerText ?? ""'
  )
  check('the count moved with it', /^Preview: 1 of 6/.test(afterAdd), JSON.stringify(afterAdd))
  const storedRule = JSON.parse(
    (await b.eval("localStorage.getItem('drc.player-config.highlights.v1')")) ?? 'null'
  )
  check('and the rule is durable, not only on screen', storedRule?.entries?.length === 1, JSON.stringify(storedRule?.entries?.map((e) => e.pattern)))

  // An invalid pattern is refused at save and never reaches the store.
  await b.run(`
    const sel = document.querySelector('[data-testid="highlight-add-type"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, 'regexp');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.querySelector('[data-testid="highlight-add-pattern"]');
    const isetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    isetter.call(input, '([unclosed');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  `)
  await b.click('[data-testid="highlight-add"]')
  const addError = await b.eval(
    'document.querySelector(\'[data-testid="highlight-add-error"]\')?.innerText ?? ""'
  )
  check('an invalid pattern is refused, naming the error', /Unterminated character class/.test(addError), JSON.stringify(addError))
  const afterBad = JSON.parse(
    (await b.eval("localStorage.getItem('drc.player-config.highlights.v1')")) ?? 'null'
  )
  check('and it never reached the store', afterBad?.entries?.length === 1, `${afterBad?.entries?.length}`)

  // A preset in use cannot be deleted without being told what uses it.
  await b.click('[data-testid="config-tab-presets"]')
  await b.click('[data-testid="preset-add"]')
  const presetId = await b.eval(
    'JSON.parse(localStorage.getItem("drc.player-config.presets.v1")).entries[0].id'
  )
  await b.click('[data-testid="config-tab-highlights"]')
  await b.select(presetId)
  await b.click('[data-testid="config-tab-presets"]')
  await b.click(`[data-testid="preset-delete-${presetId}"]`)
  const presetNote = await b.eval(
    'document.querySelector(\'[data-testid="preset-note"]\')?.innerText ?? ""'
  )
  check('a preset in use is not deleted', /is used by 1 highlight/.test(presetNote), JSON.stringify(presetNote))
  check('and the refusal names the rule', /just arrived/.test(presetNote))
  const presetsLeft = JSON.parse(
    (await b.eval("localStorage.getItem('drc.player-config.presets.v1')")) ?? 'null'
  )
  check('the preset is still there', presetsLeft?.entries?.length === 1, `${presetsLeft?.entries?.length}`)

  /*
   * The panel has to be usable at the smallest size a docked panel gets. This
   * measures the controls rather than eyeballing the screenshot: a control
   * wider than the window is a control nobody can reach, and it is invisible
   * in a picture taken at a comfortable size.
   */
  await b.click('[data-testid="config-tab-highlights"]')
  const small = await b.resize(720, 480)
  check('the viewport really is 720x480', small.w === 720 && small.h === 480, JSON.stringify(small))
  const overflow = await b.run(`
    const panel = document.querySelector('[data-testid="player-config-panel"]');
    const box = panel.getBoundingClientRect();
    const bad = [];
    let examined = 0;
    for (const el of panel.querySelectorAll('button, input, select, [role="tab"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      examined += 1;
      if (r.right > box.right + 1 || r.left < box.left - 1) {
        bad.push((el.dataset.testid || el.tagName) + ' ' + Math.round(r.left) + '-' + Math.round(r.right));
      }
    }
    return { examined, bad, panelWidth: Math.round(box.width) };
  `)
  // The denominator: an empty panel has no controls outside the window for the
  // same reason a suite that never ran has no failures.
  check('there were controls to measure', overflow.examined >= 15, `${overflow.examined} examined`)
  check('every control is inside the panel at 720x480', overflow.bad.length === 0, overflow.bad.join(', '))
  await b.screenshot(out('player-config-2026-09-06-highlights.png'))
  console.log(`wrote ${out('player-config-2026-09-06-highlights.png')}`)

  const restored = await b.resize(900, 1000)
  check('the window is back to the size this shot is taken at', restored.w === 900 && restored.h === 1000, JSON.stringify(restored))

  /*
   * Q3's three tabs, driven the way a person drives them.
   *
   * `tools/macro-dry-run-test.mjs` proves the dry run sends nothing and that
   * the chooser prefers a player binding. Neither mounts a component, so
   * neither can say that a macro can be created here at all, or that the
   * ordered list a dry run produces reaches the screen. This does that half,
   * and it is also where the screenshot comes from.
   */
  const seeded = await b.run(`
    localStorage.setItem('drc.player-config.variables.v1', JSON.stringify({
      version: 1,
      entries: [{ id: 'var-shop', enabled: true, source: 'player', name: 'shop', value: 'the pawnshop' }],
    }));
    localStorage.setItem('drc.player-config.macros.v1', JSON.stringify({
      version: 1,
      entries: [
        { id: 'mac-walk', enabled: true, source: 'player', key: 'F3', modifiers: [],
          commands: ['stand', 'go $shop', 'look'] },
        { id: 'mac-script', enabled: false, source: 'genie-import', key: 'F5', modifiers: [],
          commands: ['#queue {north}'] },
      ],
    }));
    localStorage.setItem('drc.player-config.aliases.v1', JSON.stringify({
      version: 1,
      entries: [
        { id: 'ali-sell', enabled: true, source: 'player', name: 'sell', expansion: 'go $shop; sell $0' },
        { id: 'ali-cls', enabled: false, source: 'genie-import', name: 'combat', expansion: '#class {combat} on' },
      ],
    }));
    return true;
  `)
  check('the fixture was written before the panel was reloaded', seeded === true)

  await b.goto(`${base}?view=panel&id=config`, { waitFor: '[data-testid="player-config-panel"]' })

  await b.eval('document.querySelector(\'[data-testid="config-tab-aliases"]\').click()')
  const aliasText = await b.eval('document.querySelector(\'[data-testid="aliases-tab"]\')?.innerText ?? ""')
  check('the Aliases tab has an editor rather than a placeholder', aliasText.length > 0, `${aliasText.length} characters`)
  check('a scripted alias says why it cannot be switched on', /Genie script/.test(aliasText), '')
  const scriptedToggle = await b.eval(
    'document.querySelector(\'[data-testid="alias-enabled-combat"]\')?.disabled === true'
  )
  check('and its switch is refused, not merely unticked', scriptedToggle === true)

  await b.eval('document.querySelector(\'[data-testid="config-tab-variables"]\').click()')
  const varText = await b.eval('document.querySelector(\'[data-testid="variables-tab"]\')?.innerText ?? ""')
  check('the Variables tab lists the names this app does not support', /roomid/.test(varText) && /downid/.test(varText), '')

  await b.eval('document.querySelector(\'[data-testid="config-tab-macros"]\').click()')
  const macroText = await b.eval('document.querySelector(\'[data-testid="macros-tab"]\')?.innerText ?? ""')
  check('the Macros tab shows the bound chord', /F3/.test(macroText), '')

  // A macro created through the form, not seeded: the seeded ones prove
  // display, and only this proves a player can make one.
  // Two steps with a render between them, the way a person does it: the click
  // arms the capture and React has to commit that state before the keydown can
  // be read. Doing both in one task passes the key to a handler still holding
  // the pre-click state, which is a property of this test and not of the app -
  // and the first version of this check failed for exactly that reason.
  await b.run(`
    const capture = document.querySelector('[data-testid="macro-capture"]');
    capture.click();
    return capture.innerText;
  `)
  await new Promise((r) => setTimeout(r, 200))
  const captured = await b.run(`
    const set = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const capture = document.querySelector('[data-testid="macro-capture"]');
    capture.dispatchEvent(new KeyboardEvent('keydown', { code: 'F6', key: 'F6', bubbles: true }));
    set(document.querySelector('[data-testid="macro-commands"]'), 'stand' + String.fromCharCode(10) + 'go gate');
    return true;
  `)
  check('the capture accepted a key press', captured === true)
  await new Promise((r) => setTimeout(r, 200))
  await b.eval('document.querySelector(\'[data-testid="macro-add"]\').click()')
  await new Promise((r) => setTimeout(r, 200))
  const storedMacros = JSON.parse((await b.eval("localStorage.getItem('drc.player-config.macros.v1')")) ?? 'null')
  const made = (storedMacros?.entries ?? []).find((e) => e.key === 'F6')
  check('a macro made in the panel reaches the store', !!made, JSON.stringify(made?.commands))
  check('with its commands, in order', JSON.stringify(made?.commands) === JSON.stringify(['stand', 'go gate']))

  await b.eval('document.querySelector(\'[data-testid="macro-dry-run-F3"]\').click()')
  const plan = await b.eval('document.querySelector(\'[data-testid="macro-plan-F3"]\')?.innerText ?? ""')
  check('the dry run puts the ordered list on screen', /stand/.test(plan) && /look/.test(plan), plan.replace(/\n/g, ' | '))
  check('with variables resolved, so it shows what the lane would receive', /the pawnshop/.test(plan), '')
  check('and says plainly that nothing was sent', /Nothing was sent/.test(plan), '')

  await b.screenshot(out('player-config-2026-09-06-macros.png'))
  console.log(`wrote ${out('player-config-2026-09-06-macros.png')}`)
} finally {
  await b.close()
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
