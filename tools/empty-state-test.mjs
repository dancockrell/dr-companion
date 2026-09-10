#!/usr/bin/env node
/**
 * The empty state, measured in a real browser at the window sizes the app can
 * actually be (issue #418).
 *
 * # Why a second suite and not more of `first-screen-test.mjs`
 *
 * That one reads the source and asserts two properties of a class list:
 * the container declares `overflow-y-auto`, and it does not `justify-center`.
 * Both are true and both were true while the bug below was on screen. A
 * source check cannot see where anything ended up.
 *
 * The measured half already existed in `tools/first-screen-shots.mjs`
 * section e — and it is not in `tools/test-suites.json`, so nothing in the
 * gate has ever run it. It is a shots tool: somebody has to remember. Between
 * September's rewrite of this screen and now, nobody did, and two of its five
 * needles had gone stale into a silent NOT FOUND in the meantime.
 *
 * # The property this adds, and why the older harness could not see it
 *
 * `first-screen-shots.mjs` loads the page and then calls `resize()`. That
 * relayout resets the scroll container to the top, which is precisely the
 * state the defect is not in. Measured at the app's own default window:
 *
 *     scrollTop 180, scrollHeight 702, clientHeight 287
 *     activeElement INPUT "Your Play.net account"
 *
 * `SignIn`'s focus effect asked the browser to bring its account field into
 * view, and the browser scrolled the whole empty state to do it — so the app
 * opened with the heading and both call-to-action buttons above the top edge.
 * Reachable, and not visible, which is #418 arriving by a second route after
 * the first was closed.
 *
 * So every size here is **loaded at that size** rather than resized into it,
 * and the first thing asserted is that the panel is at its top. A resize-after-
 * load harness passes this whatever the focus effect does.
 *
 * # The sizes are read, not typed
 *
 * `REQUESTED` and `MIN` come out of `src-tauri/src/window_size.rs`, which is
 * where the app declares them. A hand-copied 1180x820 goes stale the moment
 * that number moves, and the suite then checks a window the app cannot be.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false, so `LichLauncher` renders
 * nothing and this panel is shorter here than in the real app — which makes
 * every assertion below *weaker* than the real case rather than stronger, and
 * is why the reachability half keeps a size shorter than the app allows.
 * `tools/app-eyes.mjs` is the tool that drives the real WebView2.
 *
 * Usage: node tools/empty-state-test.mjs [http://127.0.0.1:5199/]
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { launch } from './browser.mjs'
import { EMPTY_STATE_PROBE, EMPTY_STATE_CONTROLS } from './empty-state-probe.mjs'

const root = join(import.meta.dirname, '..')

/**
 * The dev server, started here and stopped by the pid started here — never by
 * image name and never by a wildcard, because several sessions run vite on
 * this machine (CLAUDE.md section 4). Offset from `DRC_TEST_PORT` by a
 * different amount than `play-first-layout-test.mjs` uses, so the two can run
 * in one suite without fighting for a port.
 */
const PORT = Number(process.env.DRC_TEST_PORT ?? 5199) + 7
let server = null
let base = process.argv[2] ?? null

async function startServer() {
  const child = spawn(
    process.execPath,
    [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let log = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (d) => {
      log += d
    })
  }
  const deadline = Date.now() + 60000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the dev server exited ${child.exitCode}: ${log.slice(-400)}`)
    }
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      if (res.ok) return child
    } catch {
      // Not up yet. The deadline decides, not this.
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
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(66)} ${detail}`)
}

/* ------------------------------------------------------------------ *
 * Sizes, read out of the Rust that declares them.
 * ------------------------------------------------------------------ */
const rust = readFileSync(new URL('../src-tauri/src/window_size.rs', import.meta.url), 'utf8')
const read = (name) => {
  const m = rust.match(new RegExp(`const ${name}: \\(f64, f64\\) = \\(([\\d.]+), ([\\d.]+)\\);`))
  return m ? [Math.round(Number(m[1])), Math.round(Number(m[2]))] : null
}
const REQUESTED = read('REQUESTED')
const MIN = read('MIN')
if (!REQUESTED || !MIN) {
  // Not a pass with a note. A suite whose sizes come from a file it could not
  // read is checking nothing, and must say so with a non-zero exit rather
  // than quietly measuring a default somebody typed here.
  console.log('FAIL could not read REQUESTED and MIN out of src-tauri/src/window_size.rs')
  process.exit(1)
}

const SIZES = [
  [...REQUESTED, "the app's own default window (REQUESTED in window_size.rs)"],
  [1366, 768, 'the commonest laptop'],
  [...MIN, 'the declared minimum (MIN in window_size.rs)'],
]

const PREFS = JSON.stringify({ setupComplete: true, bridgeMode: 'live' })

async function main() {
  if (!base) {
    server = await startServer()
    base = `http://127.0.0.1:${PORT}/`
  }
  console.log(`-- the empty state at ${SIZES.length} window sizes, ${base}`)

  for (const [w, h, why] of SIZES) {
    // A fresh browser per size, opened AT that size. See the header: resizing
    // into a size resets the scroll container and hides the defect.
    const b = await launch({ width: w, height: h, headless: true })
    try {
      await b.goto(`${base}?bridge=live`)
      await b.run(`localStorage.clear(); localStorage.setItem('dr-companion-prefs-v1', ${JSON.stringify(PREFS)}); return true;`)
      await b.goto(`${base}?bridge=live`)
      // The layout, and the focus effect after it, settle on frames.
      await new Promise((r) => setTimeout(r, 800))

      const at = await b.run(`
        const host = document.querySelector('[data-workspace-state]');
        if (!host) return null;
        return {
          scrollTop: Math.round(host.scrollTop),
          scrollHeight: Math.round(host.scrollHeight),
          clientHeight: Math.round(host.clientHeight),
          overflowY: getComputedStyle(host).overflowY,
          focused: document.activeElement ? document.activeElement.tagName : null,
        };
      `)
      // The denominator. Everything below is a claim about this element, and
      // without it every one of them would be vacuously true.
      ok(`${w}x${h} the empty state is on screen to measure`, at !== null, why)
      if (at === null) continue

      /*
       * The property, stated as a property: what the panel offers first is
       * what a person sees first. Not "SignIn passes preventScroll" - that is
       * the mechanism, and a test that names it goes green for a rewrite that
       * reintroduces the bug through a different focus call.
       */
      ok(
        `${w}x${h} opens at the top of the panel, not scrolled past its own buttons`,
        at.scrollTop === 0,
        `scrollTop ${at.scrollTop} of ${at.scrollHeight - at.clientHeight} scrollable, focus on ${at.focused}`
      )
      ok(
        `${w}x${h} and the panel can still be scrolled`,
        at.overflowY === 'auto' || at.overflowY === 'scroll',
        `overflow-y: ${at.overflowY}`
      )

      const m = await b.run(EMPTY_STATE_PROBE)
      // Every needle has to be found before any verdict about it means
      // anything: two of these went stale into a silent NOT FOUND once
      // already, and the run still read as a pass.
      const missing = m.controls.filter((c) => !c.found).map((c) => c.needle)
      ok(
        `${w}x${h} all ${EMPTY_STATE_CONTROLS.length} controls are on the screen at all`,
        missing.length === 0,
        missing.length ? `not found: ${missing.join(', ')}` : ''
      )
      const stuck = m.controls.filter((c) => c.found && !c.visibleAfterScroll)
      ok(
        `${w}x${h} every control can be clicked, scrolling if need be`,
        stuck.length === 0,
        stuck.map((c) => `${c.needle}: ${c.why}`).join(' | ')
      )
      /*
       * The two the issue is actually about, asserted without scrolling. This
       * is the difference between #418 as filed ("cannot be reached at all")
       * and #418 as it survived ("reachable, and off the top of the screen").
       */
      for (const needle of ['Start the demo', 'Connection help']) {
        const c = m.controls.find((x) => x.needle === needle)
        ok(
          `${w}x${h} "${needle}" is visible without scrolling`,
          Boolean(c?.visibleAsIs),
          c ? `top ${c.top} bottom ${c.bottom} ${c.why ?? ''}` : 'not found'
        )
      }
    } finally {
      await b.close()
    }
  }

  // A floor well under the real count, so a truncated or crashed run cannot
  // read as a pass. Six checks per size at three sizes is 18.
  const FLOOR = 15
  ok(`ran enough checks to mean anything (floor ${FLOOR})`, checked >= FLOOR, `${checked} checked`)

  console.log(`\n${checked - fails} passed, ${fails} failed, ${checked} checks`)
  if (fails > 0) process.exit(1)
}

try {
  await main()
} finally {
  stopServer()
}
