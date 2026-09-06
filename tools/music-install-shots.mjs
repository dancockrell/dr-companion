#!/usr/bin/env node
/**
 * The render check for #422 and #423: what the Sound panel actually draws
 * while an install is running, and what it draws for a group that is nothing
 * but half-files.
 *
 * `tools/music-library-test.mjs` asserts both as properties and reads the
 * source for the gates, which is the right shape for a rule and cannot tell
 * you whether the panel draws it. Both bugs here were about a control being
 * on screen or not, so this puts them on a screen.
 *
 *   a. every group all-`.part`, nothing finished. Before #423 the row offered
 *      Resume and no Remove, and 1.65 GB of half-files could not be deleted
 *      from anywhere in the app.
 *   b. one install running. Before #422 every other Install stayed clickable
 *      beside it, and pressing one discarded the Cancel on the first.
 *
 * The store is reached through the page's own module graph, because reaching
 * these states for real needs a 1.3 GB download and a cancel with the timing
 * of a coin toss. The check asserts it is the production singleton the panel
 * is holding: a second copy of the module would make every assertion below a
 * statement about a store nothing renders.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false until this script sets a stub,
 * and that stub never downloads anything - `install_music_library` returns a
 * promise that never settles, which is what "an install is running" looks
 * like from here. The Rust half is in `src-tauri/src/music.rs`'s own tests,
 * where the guard can be raced against a real loopback server.
 *
 * Usage: npm run dev -- --port 5192, then
 *        node tools/music-install-shots.mjs http://127.0.0.1:5192/
 */
import { launch } from './browser.mjs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5192/'
const out = (name) => join(root, 'docs/verification', name)

let bad = 0
const check = (label, cond, detail) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(60)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/** The whole music block's text, read from the DOM rather than from the store. */
const PANEL_TEXT = `
  const label = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Music library');
  const block = label ? label.closest('div').parentElement : null;
  return block ? block.innerText : null;
`

/** Every button in that block, with whether it is disabled. */
const BUTTONS = `
  const label = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Music library');
  const block = label ? label.closest('div').parentElement : null;
  if (!block) return null;
  return [...block.querySelectorAll('button')].map((b) => ({
    text: (b.innerText || b.getAttribute('aria-label') || '').trim(),
    disabled: b.disabled === true,
  }));
`

const b = await launch({ width: 1400, height: 1000, headless: true })
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
  // The Sound toggle is an icon; its name is a title, not text, so `click`'s
  // text match cannot see it.
  const opened = await b.run(`
    const el = [...document.querySelectorAll('button')]
      .find((x) => /^Sound: /.test(x.getAttribute('title') ?? x.getAttribute('aria-label') ?? ''));
    if (!el) return 'no Sound toggle';
    el.click();
    return 'clicked';
  `)
  check('the Sound panel opens', opened === 'clicked', opened)
  await b.waitFor('main', 5000)

  // The instrument, before anything is asserted with it.
  const wired = await b.eval(`(async () => {
    window.__music = await import('/src/lib/musicLibrary.ts');
    return window.__music.MUSIC_GROUPS.length;
  })()`)
  check('the page module graph is reachable', wired >= 2, `${wired} groups`)

  // a. #423 - every track of every group interrupted, nothing finished.
  const stranded = await b.run(`
    const m = window.__music;
    m.setInstalledMusicFiles([], m.MUSIC_GROUPS.flatMap((g) => g.tracks.map((t) => t.file)));
    const worst = m.MUSIC_GROUPS.reduce((a, g) => (g.bytes > a.bytes ? g : a));
    const s = (m.musicLibraryStatus()?.groups ?? []).find((g) => g.id === worst.id);
    return { name: worst.name, bytes: worst.bytes, installed: s.installed, partial: s.partial, state: s.state };
  `)
  check(
    'a. the largest group is all half-files with nothing finished',
    stranded.installed === 0 && stranded.partial > 0 && stranded.state === 'partial',
    `${stranded.name}: ${stranded.installed} installed, ${stranded.partial} interrupted, ${(stranded.bytes / 1024 ** 3).toFixed(2)} GB`
  )
  await b.run(`
    const label = [...document.querySelectorAll('span')].find((e) => e.textContent === 'Music library');
    label?.scrollIntoView({ block: 'center' });
    return true;
  `)
  const strandedText = await b.run(PANEL_TEXT)
  const strandedButtons = await b.run(BUTTONS)
  check(
    'a. the row says what is really on disk',
    /interrupted/.test(strandedText ?? ''),
    (strandedText ?? '').split('\n').slice(1, 4).join(' / ')
  )
  check(
    'a. and it offers a Remove for every group, which is what #423 lacked',
    (strandedButtons ?? []).filter((x) => /^Remove /.test(x.text)).length === wired,
    (strandedButtons ?? []).map((x) => x.text).join(', ')
  )
  check(
    'a. with the Resume beside it, not instead of it',
    (strandedButtons ?? []).some((x) => /^Resume/.test(x.text)),
    (strandedButtons ?? []).map((x) => x.text).join(', ')
  )
  check(
    'a. and none of them is disabled while nothing is installing',
    (strandedButtons ?? []).every((x) => !x.disabled),
    (strandedButtons ?? []).filter((x) => x.disabled).map((x) => x.text).join(', ') || 'none disabled'
  )
  await b.screenshot(out('music-install-remove-partial-2026-09-06.png'))

  // b. #422 - one install running, and it is the only thing that can be
  // pressed. The stub never settles, which is what in-flight looks like.
  const running = await b.eval(`(async () => {
    const m = window.__music;
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd) => (cmd === 'install_music_library'
        ? new Promise(() => {})
        : Promise.resolve(undefined)),
    };
    const group = m.MUSIC_GROUPS[2] ?? m.MUSIC_GROUPS[0];
    m.installMusicLibrary(group).catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    return m.musicInstallRun();
  })()`)
  check('b. one install is running and one place knows it', running?.groupName != null, running?.groupName)
  const runningButtons = await b.run(BUTTONS)
  const others = (runningButtons ?? []).filter((x) => x.text.startsWith('Installing '))
  check(
    'b. every other group offers a disabled button naming what is running',
    others.length >= wired - 1 && others.every((x) => x.disabled && x.text.includes(running.groupName)),
    others.map((x) => `${x.text}${x.disabled ? '' : ' (ENABLED)'}`).join(', ')
  )
  check(
    'b. the running group is the only one offering a Cancel',
    (runningButtons ?? []).filter((x) => x.text === 'Cancel').length === 1,
    (runningButtons ?? []).map((x) => x.text).join(', ')
  )
  check(
    'b. and no Install or Resume is left clickable beside it',
    (runningButtons ?? []).every((x) => !/^(Install|Resume)/.test(x.text) || x.disabled),
    (runningButtons ?? [])
      .filter((x) => /^(Install|Resume)/.test(x.text) && !x.disabled)
      .map((x) => x.text)
      .join(', ') || 'none clickable'
  )
  check(
    'b. and Remove is held too, so nothing deletes what is downloading',
    (runningButtons ?? []).filter((x) => /^Remove /.test(x.text)).every((x) => x.disabled),
    (runningButtons ?? [])
      .filter((x) => /^Remove /.test(x.text) && !x.disabled)
      .map((x) => x.text)
      .join(', ') || 'all held'
  )
  await b.screenshot(out('music-install-single-2026-09-06.png'))

  const errors = b.consoleErrors().filter((e) => !/companion|WebSocket|Tauri listen/i.test(e))
  check('no page exceptions', errors.length === 0, errors.join(' | '))
} finally {
  await b.close()
}

console.log(bad === 0 ? '\nall render checks passed' : `\n${bad} render check(s) failed`)
process.exit(bad === 0 ? 0 : 1)
