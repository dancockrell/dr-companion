#!/usr/bin/env node
/**
 * Print where every control on the empty state actually is, at every size the
 * window can be. Measures, prints, decides nothing (issue #418).
 *
 * The pass/fail half of this is `tools/first-screen-shots.mjs` section e, and
 * both read the same probe from `empty-state-probe.mjs` rather than each
 * having their own - one asserts, one shows its working, and they cannot
 * disagree about what "reachable" means.
 *
 * This exists because a before/after comparison needs the *before*, and a
 * harness that exits 1 on the broken revision cannot produce a table. Check
 * out the revision in question, run this, and read the numbers.
 *
 * Usage: node tools/empty-state-measure.mjs [base] [label]
 *   e.g. npm run dev -- --port 5191
 *        node tools/empty-state-measure.mjs http://127.0.0.1:5191/ before
 */
import { launch } from './browser.mjs'
import { EMPTY_STATE_PROBE, EMPTY_STATE_SIZES } from './empty-state-probe.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:5191/'
const label = process.argv[3] ?? 'run'

const b = await launch({ width: 1280, height: 900, headless: true })
try {
  await b.goto(base + '?bridge=live')
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'live' }));
    return true;
  `)
  await b.goto(base + '?bridge=live')

  for (const [w, h, note] of EMPTY_STATE_SIZES) {
    const got = await b.resize(w, h)
    await new Promise((r) => setTimeout(r, 400))
    const m = await b.run(EMPTY_STATE_PROBE)
    console.log(`\n== ${label} ${w}x${h} (${note}) - page reports ${got.w}x${got.h}`)
    console.log(
      `   host overflow-y: ${m.hostOverflowY}  scrollHeight ${m.hostScrollHeight} / client ${m.hostClientHeight}`
    )
    for (const c of m.controls) {
      if (!c.found) {
        console.log(`   ${c.needle.padEnd(26)} NOT FOUND`)
        continue
      }
      const verdict = c.visibleAsIs
        ? 'visible'
        : c.visibleAfterScroll
          ? 'reachable by scrolling'
          : 'UNREACHABLE'
      console.log(
        `   ${c.needle.padEnd(26)} top ${String(c.top).padStart(5)} bottom ${String(c.bottom).padStart(5)}  ${verdict}${c.why ? ' (' + c.why + ')' : ''}`
      )
    }
    if (w === 992) await b.screenshot(`docs/verification/empty-state-2026-09-06-${label}.png`)
  }
} finally {
  await b.close()
}
