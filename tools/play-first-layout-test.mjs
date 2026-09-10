#!/usr/bin/env node
/**
 * The play-first frame, asserted in a real browser at every size the window
 * can be.
 *
 * Dan, 9 September 2026, after his first live session: *"its really hard to
 * run ... the game screen needs to be quite large so that I can actually play
 * the game as mud"*, then *"it's not best to put the screen in the middle ...
 * put it in the right corner and have a bottom bar of icons for various
 * functions and then on the left you have room for your text heavy windows."*
 *
 * Four properties, and they are properties rather than mechanisms - a test
 * that asserts a class name or a call site goes red for a rename and green for
 * a regression (CLAUDE.md section 1, "a test can encode the bug as the spec"):
 *
 *   1. **the text gets the window.** Its share of the width is above a floor
 *      at every supported size, and the command line is inside the viewport
 *      and inside the text region.
 *   2. **the pane is in the right corner**, not the middle: its right edge is
 *      at the window's right edge and its top is in the upper half of the
 *      workspace.
 *   3. **every function is reachable from the bar**, its name is on it, and
 *      what it is for is one hover or focus away. A panel that is neither on
 *      the bar nor named in `OFF_BAR` is a function a player cannot reach.
 *   4. **the four states work and are remembered.** One control moves
 *      between them and a reload comes back to the same one.
 *
 * # The sizes are derived, not typed
 *
 * The smallest is read out of `src-tauri/src/window_size.rs`, which is where
 * the app's own minimum window is declared. A hand-copied 720x480 here would
 * go stale the moment that number moved, and the suite would then be checking
 * sizes the app can no longer be.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app: `isTauri()` is false, so `openPanelWindow` no-ops and
 * the popped-out window is not actually created here. The state, the rail's
 * response to it and the note that says where the pane went are all exercised;
 * the window itself is `tools/mud-client-e2e.mjs`'s and the real app's.
 *
 * Usage: node tools/play-first-layout-test.mjs [http://127.0.0.1:5199/]
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { launch } from './browser.mjs'

const root = join(import.meta.dirname, '..')

/**
 * The dev server, started here and stopped by the pid started here.
 *
 * Never by image name and never by a wildcard: several sessions run node and
 * vite on this machine, and killing by name would take another lane's server
 * down with this one (CLAUDE.md section 4). Pass a base URL as the first
 * argument to drive an already-running server instead and skip all of this.
 *
 * The port is derived from `DRC_TEST_PORT`, which is how every other suite on
 * this machine avoids colliding with a parallel lane, rather than from a
 * constant that is right until two of these run at once.
 */
const PORT = Number(process.env.DRC_TEST_PORT ?? 5199) + 3
let server = null
let base = process.argv[2] ?? null

async function startServer() {
  const child = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (d) => {
      log += d
    })
  }
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the dev server exited ${child.exitCode}: ${log.slice(-400)}`)
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      if (res.ok) return child
    } catch {
      // Not up yet. The deadline is what decides, not this.
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  child.kill()
  throw new Error(`the dev server never answered on ${PORT} within 60s: ${log.slice(-400)}`)
}

function stopServer() {
  if (!server || server.exitCode !== null) return
  try {
    server.kill()
  } catch {
    // Already gone.
  }
}
process.on('exit', stopServer)

let checked = 0
let fails = 0
const ok = (label, cond, detail = '') => {
  checked++
  if (!cond) fails++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(72)} ${detail}`)
}

/* ---------------------------------------------------------------------- *
 * The sizes, smallest first, derived from the app's own declared minimum.
 * ---------------------------------------------------------------------- */
const rust = readFileSync(new URL('../src-tauri/src/window_size.rs', import.meta.url), 'utf8')
const minMatch = rust.match(/const MIN: \(f64, f64\) = \(([\d.]+), ([\d.]+)\);/)
if (!minMatch) {
  console.log('FAIL could not read MIN out of src-tauri/src/window_size.rs; no size list can be derived')
  process.exit(1)
}
const MIN = [Math.round(Number(minMatch[1])), Math.round(Number(minMatch[2]))]

/**
 * Every size, and why it is here. The minimum comes from Rust; the rest are
 * the shapes a person actually has - a small laptop, the app's own default
 * (`REQUESTED` in lib.rs), the commonest laptop, and Dan's own window.
 */
const SIZES = [
  [...MIN, "the app's declared minimum (MIN in window_size.rs)"],
  [1024, 768, 'a small laptop'],
  [1180, 820, "the app's own default window"],
  [1366, 768, 'the commonest laptop width'],
  [1997, 935, "Dan's own window, 9 Sep 2026"],
]

/**
 * How much of the window's width the text has to hold.
 *
 * Not an area share: the bar, the console and the footer take a fixed slice of
 * the height whatever the layout does, so an area floor would be measuring
 * them rather than this. Width is the number the rearrangement is about, and
 * 0.55 is chosen so the arrangement this replaced - where the transcript held
 * a strip of the bottom and the picture held the middle - could not pass it.
 */
const TEXT_WIDTH_FLOOR = 0.55

/** How far the pane's right edge may sit from the window's, in px. The rail
 * has a 4px pad and a 1px border; anything past this is not "the corner". */
const CORNER_SLACK = 16

const GEOMETRY = `
  const W = window.innerWidth, H = window.innerHeight;
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const command = document.querySelector('[aria-label="Text"] input');
  const text = box('[aria-label="Text"]');
  const commandBox = command ? command.getBoundingClientRect() : null;
  // Would a click land on it? The same question browser.mjs's own click asks,
  // and the only one that answers "clipped", "covered" and "off screen" at
  // once - a rect inside the viewport is not a claim that a person can use it.
  const commandReachable = commandBox
    ? (() => {
        const x = commandBox.left + commandBox.width / 2, y = commandBox.top + commandBox.height / 2;
        const top = document.elementFromPoint(x, y);
        return !!top && (top === command || command.contains(top) || top.contains(command));
      })()
    : false;
  return {
    window: { w: W, h: H },
    text,
    pane: box('[aria-label="Scene pane"]'),
    rail: box('[aria-label="Context side"]'),
    bar: box('[aria-label="Functions"]'),
    main: box('main'),
    command: commandBox
      ? { top: Math.round(commandBox.top), bottom: Math.round(commandBox.bottom), left: Math.round(commandBox.left), right: Math.round(commandBox.right), reachable: commandReachable }
      : null,
    overflowX: Math.max(0, document.body.scrollWidth - document.body.clientWidth),
    poppedNote: /open in its own window/i.test(document.body.innerText),
  };
`

/** Every button on the bar, with the name and the description it offers. */
const BAR = `
  const bar = document.querySelector('[aria-label="Functions"]');
  if (!bar) return null;
  return [...bar.querySelectorAll('button')].map((b) => {
    const r = b.getBoundingClientRect();
    // Scroll the bar to the button before asking, the same way a person would
    // - the bar scrolls horizontally on purpose, so a control past the right
    // edge is reachable and must not read as unreachable.
    b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rr = b.getBoundingClientRect();
    const x = rr.left + rr.width / 2, y = rr.top + rr.height / 2;
    const top = document.elementFromPoint(x, y);
    const card = b.parentElement ? b.parentElement.querySelector('[role="tooltip"]') : null;
    return {
      panel: b.getAttribute('data-panel'),
      scene: b.getAttribute('data-scene-state'),
      label: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || '',
      card: card ? card.innerText.trim() : '',
      sized: r.width > 0 && r.height > 0,
      reachable: !!top && (top === b || b.contains(top) || top.contains(b)),
    };
  });
`

/* ---------------------------------------------------------------------- *
 * The bar's own completeness, read from source rather than from the page:
 * a panel that is neither on the bar nor deliberately off it is a function
 * a player can no longer reach, and only the two lists can say which.
 * ---------------------------------------------------------------------- */
const panelBarSrc = readFileSync(new URL('../src/lib/panelBar.ts', import.meta.url), 'utf8')
const panelsSrc = readFileSync(new URL('../src/components/dashboard/panels.tsx', import.meta.url), 'utf8')
const titlesBlock = panelsSrc.match(/PANEL_TITLES: Record<PanelId, string> = \{([\s\S]*?)\n\}/)
const allPanels = titlesBlock ? [...titlesBlock[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]) : []
const orderBlock = panelBarSrc.match(/PANEL_BAR_ORDER: readonly PanelId\[\] = \[([\s\S]*?)\]/)
const onBar = orderBlock ? [...orderBlock[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : []
const offBlock = panelBarSrc.match(/OFF_BAR: Partial<Record<PanelId, string>> = \{([\s\S]*?)\n\}/)
const offBar = offBlock ? [...offBlock[1].matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]) : []

ok(
  'the panel list was actually read (a broken match would check nothing)',
  allPanels.length >= 12,
  `${allPanels.length} panels, ${onBar.length} on the bar, ${offBar.length} deliberately off`
)
const unreachable = allPanels.filter((id) => id !== 'board' && !onBar.includes(id) && !offBar.includes(id))
ok(
  'every panel is either on the bar or named as deliberately off it',
  unreachable.length === 0,
  unreachable.length ? `not reachable: ${unreachable.join(', ')}` : 'none missing'
)
const strays = onBar.filter((id) => !allPanels.includes(id))
ok('the bar names no panel that does not exist', strays.length === 0, strays.join(', ') || 'none')

/* ---------------------------------------------------------------------- *
 * The browser half.
 * ---------------------------------------------------------------------- */
if (!base) {
  server = await startServer()
  base = `http://127.0.0.1:${PORT}/`
}

const b = await launch({ width: 1366, height: 768, headless: true })
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true }));
    return true;
  `)
  await b.goto(base)
  await b.click('button', /Start the demo/)
  await b.waitFor('header[aria-label="Character and location"]', 20000)

  for (const [w, h, why] of SIZES) {
    await b.resize(w, h)
    await b.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
    const g = await b.run(GEOMETRY)
    const at = `${w}x${h}`

    if (!g.text) {
      ok(`${at} the text region exists`, false, why)
      continue
    }

    const share = g.text.w / g.window.w
    ok(
      `${at} the game text holds most of the width`,
      share >= TEXT_WIDTH_FLOOR,
      `${(share * 100).toFixed(1)}% (floor ${(TEXT_WIDTH_FLOOR * 100).toFixed(0)}%) - ${why}`
    )
    ok(
      `${at} the command line is inside the text region and clickable`,
      !!g.command && g.command.reachable && g.command.bottom <= g.window.h && g.command.top >= 0,
      g.command ? `${g.command.top}..${g.command.bottom} of ${g.window.h}, reachable ${g.command.reachable}` : 'no command line'
    )
    ok(`${at} nothing overflows the window sideways`, g.overflowX === 0, `${g.overflowX}px`)

    if (g.pane) {
      ok(
        `${at} the scene pane is in the right corner, not the middle`,
        g.window.w - g.pane.right <= CORNER_SLACK && g.pane.top <= g.main.top + g.main.h / 2,
        `right edge ${g.window.w - g.pane.right}px in, top ${g.pane.top} of workspace ${g.main.top}..${g.main.top + g.main.h}`
      )
    } else {
      // Not a skip that reads as a pass: at the narrow sizes the pane is
      // supposed to be absent, and this says which of the two it is.
      ok(
        `${at} the pane is absent because the window is too narrow for one`,
        w < 1120,
        'a pane was expected at this width and there is none'
      )
    }

    const bar = await b.run(BAR)
    if (!bar) {
      ok(`${at} the icon bar is on screen`, false, why)
      continue
    }
    ok(`${at} the icon bar renders exactly the order it declares`, bar.length === onBar.length + 1, `${bar.length} buttons`)
    /*
     * And that what it renders is every function a player can still reach.
     *
     * Against the panel manifest, not against `PANEL_BAR_ORDER`: the check
     * above compares the rendered buttons to the order array, and both move
     * together, so dropping a panel from the order satisfies it perfectly
     * while making that panel unreachable. Measured - that sabotage reddened
     * one check where two were expected, which is what an entangled pair
     * looks like from the outside.
     */
    const rendered = new Set(bar.map((x) => x.panel).filter(Boolean))
    const wanted = allPanels.filter((id) => id !== 'board' && !offBar.includes(id))
    const absent = wanted.filter((id) => !rendered.has(id))
    ok(
      `${at} and every panel not deliberately off the bar is on it`,
      absent.length === 0,
      absent.length ? `missing: ${absent.join(', ')}` : `${rendered.size} of ${wanted.length}`
    )
    const nameless = bar.filter((x) => !x.label || x.label.length < 3)
    ok(`${at} every icon says its own name`, nameless.length === 0, nameless.map((x) => x.panel ?? 'scene').join(', ') || 'all named')
    const silent = bar.filter((x) => !x.title || x.title.length < 25)
    ok(
      `${at} and what it is for, on hover and on focus`,
      silent.length === 0,
      silent.map((x) => x.panel ?? 'scene').join(', ') || 'all described'
    )
    const dead = bar.filter((x) => !x.sized || !x.reachable)
    ok(`${at} every icon can actually be pressed`, dead.length === 0, dead.map((x) => x.panel ?? 'scene').join(', ') || 'all reachable')
  }

  /* ------------------------------------------------------------------ *
   * The three states, and that they are remembered per size.
   * ------------------------------------------------------------------ */
  await b.resize(1997, 935)
  await b.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')

  const sceneState = async () => b.eval(`document.querySelector('[data-scene-state]')?.getAttribute('data-scene-state') ?? 'none'`)
  const pressScene = async () => {
    await b.click('[data-scene-state]')
    await b.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  }

  ok('a wide window opens docked - the primary panel, not a corner tile', (await sceneState()) === 'docked', await sceneState())
  const wide = await b.run(GEOMETRY)
  ok('and the pane is drawn', !!wide.pane, wide.pane ? `${wide.pane.w}x${wide.pane.h}` : 'absent')

  await pressScene()
  ok('one press shrinks it to the small preview', (await sceneState()) === 'minimap', await sceneState())
  const mini = await b.run(GEOMETRY)
  ok(
    'and the preview is narrower than the primary panel was',
    !!mini.pane && mini.pane.w < wide.pane.w,
    `${wide.pane.w} -> ${mini.pane?.w ?? 'absent'}`
  )

  await pressScene()
  ok('the next press pops it out', (await sceneState()) === 'popped', await sceneState())
  const popped = await b.run(GEOMETRY)
  ok('the corner stops drawing a second copy of it', !popped.pane)
  ok('and says where it went rather than going blank', popped.poppedNote)
  ok(
    'popping it out gives the width back to the text',
    popped.text.w > wide.text.w,
    `${wide.text.w} -> ${popped.text.w}`
  )

  await pressScene()
  ok('the next press hides it', (await sceneState()) === 'hidden', await sceneState())
  await pressScene()
  ok('and the next brings it back to the primary panel', (await sceneState()) === 'docked', await sceneState())

  // Persistence, both halves: the same size comes back to what was chosen,
  // and a different size does not inherit it.
  await pressScene()
  await pressScene()
  await pressScene()
  ok('hidden, on this size', (await sceneState()) === 'hidden', await sceneState())
  await b.goto(base)
  await b.waitFor('[data-scene-state]', 20000)
  ok('a reload comes back to the state that was chosen', (await sceneState()) === 'hidden', await sceneState())

  await b.resize(1366, 768)
  await b.eval('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
  ok(
    'and a different size keeps its own answer rather than inheriting that one',
    (await sceneState()) === 'docked',
    await sceneState()
  )
} finally {
  await b.close()
  stopServer()
}

const FLOOR = 30
if (checked < FLOOR) {
  console.log(`FAIL only ${checked} checks ran, expected at least ${FLOOR} - the suite did not do its job`)
  fails++
}
console.log(`
${checked} checked, ${fails} failed`)
process.exit(fails ? 1 : 0)
