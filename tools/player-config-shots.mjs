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
  check('the tab names the increment that will fill it', /editor arrives with Q2/.test(before))
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
} finally {
  await b.close()
}

console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
