#!/usr/bin/env node
/**
 * All four cells of `pauseStatus.ts`, reached in a real browser through the
 * control a developer would use, and read back off the footer chip.
 *
 * Issue #503. `bridge.setPauseLatchMode` was added for #487 so that
 * `paused-by-bridge` and the connected form of `paused-unconfirmed` could be
 * looked at without a live bridge in a state nobody can arrange on demand -
 * and then nothing called it. The check that said the cells were reachable
 * was `/setPauseLatchMode/.test(readFileSync('src/bridge/index.ts'))`: a
 * regex over the file that *declares* the setter, asserting the producer
 * exists while its own message claimed something about the consumer. This
 * file is the consuming-side check that can fail.
 *
 * # What it drives, and why through the chooser
 *
 * Two inputs make the four cells, so both have to be driven:
 *
 *   * whether *this app* asked for a pause - the footer's Pause / Resume;
 *   * what the bridge says its latch is doing - the mock-only chooser in
 *     Settings, which is `setPauseLatchMode` by way of the store.
 *
 *   chooser  | app asked | expected chip
 *   ---------+-----------+---------------------------------
 *   follow   | no        | (no chip - `running` renders none)
 *   follow   | yes       | Paused, bridge confirmed
 *   latched  | no        | Paused by Lich
 *   clear    | yes       | Paused, bridge did not confirm
 *
 * The third row is the one that makes this a check rather than a smoke test:
 * it is a chooser being asked to pick the cell where the *wrong* answer is
 * available and plausible. Before #487 that combination rendered "Running",
 * and before #503 nothing in development could produce it at all.
 *
 * The expected labels are imported from `pauseStatus.ts` rather than typed
 * here, so this cannot drift into asserting words the app no longer shows -
 * and the four are checked to be four distinct strings first, or a source
 * that collapsed two cells would let every row pass on one label.
 *
 * # The second route, checked as a control
 *
 * `?mock-pause=latched` reaches the same setter through the same parser as
 * `?bridge=`, for a harness with no hands. Row 5 opens that URL cold and
 * requires the same chip as row 3, and row 6 opens `?mock-pause=nonsense`
 * and requires the default - so a flag that was ignored, and a flag that was
 * accepted uncritically, both go red.
 *
 * Usage: node tools/pause-cell-shots.mjs [http://127.0.0.1:5182/]
 */
import { launch } from './browser.mjs'
import { pauseStatus } from '../src/lib/pauseStatus.ts'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = process.argv[2] ?? 'http://127.0.0.1:5182/'
const out = (name) => join(root, 'docs/verification', name)
const STAMP = '2026-09-07'

let bad = 0
let checks = 0
const check = (label, cond, detail) => {
  checks += 1
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label.padEnd(56)} ${detail ?? ''}`)
  if (!cond) bad += 1
}

/** What the app itself says each cell reads, so the expectation is not a copy. */
const LABEL = {
  running: pauseStatus({ appPaused: false, bridgeConnected: true, bridgePauseLatched: false })
    .label,
  'paused-confirmed': pauseStatus({
    appPaused: true,
    bridgeConnected: true,
    bridgePauseLatched: true,
  }).label,
  'paused-by-bridge': pauseStatus({
    appPaused: false,
    bridgeConnected: true,
    bridgePauseLatched: true,
  }).label,
  'paused-unconfirmed': pauseStatus({
    appPaused: true,
    bridgeConnected: true,
    bridgePauseLatched: false,
  }).label,
}

// The denominator, asserted before anything is measured against it: four
// cells that share a label would let one chip satisfy every row.
check(
  'the four cells have four distinct labels',
  new Set(Object.values(LABEL)).size === 4,
  JSON.stringify(LABEL)
)

const CELLS = [
  { id: 'running', mode: 'follow', pause: false, state: 'running' },
  { id: 'paused-confirmed', mode: 'follow', pause: true, state: 'paused-confirmed' },
  { id: 'paused-by-bridge', mode: 'latched', pause: false, state: 'paused-by-bridge' },
  { id: 'paused-unconfirmed', mode: 'clear', pause: true, state: 'paused-unconfirmed' },
]

/** The chip, as the player reads it: its own text and the state it declares. */
const READ_CHIP = `
  const el = document.querySelector('[data-pause-state]');
  const box = el && el.getBoundingClientRect();
  // Present in the DOM and legible on the page are different claims, and the
  // second is the one a player makes. Measured the way look.js does: real
  // size, inside the window, and the topmost thing at its own centre.
  const cx = box ? box.left + box.width / 2 : 0;
  const cy = box ? box.top + box.height / 2 : 0;
  const top = box ? document.elementFromPoint(cx, cy) : null;
  return {
    present: !!el,
    state: el ? el.getAttribute('data-pause-state') : null,
    text: el ? el.textContent.trim() : '',
    footer: (document.querySelector('footer')?.innerText ?? '').slice(0, 400),
    rect: box ? { l: Math.round(box.left), t: Math.round(box.top), w: Math.round(box.width), h: Math.round(box.height) } : null,
    onScreen: !!box && box.width > 0 && box.height > 0 &&
      box.left >= -1 && box.top >= -1 &&
      box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
    covered: !!el && !(top === el || el.contains(top) || (top && top.contains(el))),
  };
`

const b = await launch({ width: 1400, height: 900, headless: true })
try {
  await b.goto(base)
  await b.run(`
    localStorage.clear();
    localStorage.setItem('dr-companion-prefs-v1', JSON.stringify({ setupComplete: true, bridgeMode: 'mock' }));
    return true;
  `)

  for (const cell of CELLS) {
    // A fresh load per cell: a chooser that only works on the second press,
    // or a latch left over from the row before, would otherwise pass here.
    await b.goto(base + '?bridge=mock', { waitFor: '#root > *' })
    await b.waitFor('header[aria-label="Character and location"]', 20000)
    await b.waitFor('footer', 10000)

    const opened = await b.click('button[aria-label="Settings"]')
    check(`${cell.id}: Settings opens`, !!opened && !opened.dead)
    await b.waitFor('[data-testid="mock-pause-latch"]', 10000)
    await b.select(cell.mode)
    const chosen = await b.run(`
      const sel = document.querySelector('[data-testid="mock-pause-latch"]');
      return sel ? sel.value : null;
    `)
    check(`${cell.id}: the chooser holds '${cell.mode}'`, chosen === cell.mode, String(chosen))
    await b.click('button[aria-label="Close"]')

    /* Resume *after* the chooser, and the order is the whole of the
     * `paused-by-bridge` row.
     *
     * `bridgePauseRelay` adopts any latch it sees into this window - press
     * Pause, relaunch, and the app comes back paused because the bridge is
     * still holding (#487). So a latch raised while the app is unpaused is
     * adopted on the next status and the cell becomes `paused-confirmed`,
     * which is correct behaviour and not the cell being asked for. Resuming
     * afterwards leaves the app unpaused with the latch still up, which is
     * the cell - and it is stable, because the mock emits a status on a
     * change rather than on a clock.
     *
     * Unconditional: `flowStop`'s flag is a module local, so "this app did
     * not ask for a pause" has to be arranged rather than assumed.
     */
    const resumed = await b.click('button', /^Resume$/)
    check(`${cell.id}: the bar offers Resume`, !!resumed && !resumed.dead)

    if (cell.pause) {
      const pressed = await b.click('button', /^Pause$/)
      check(`${cell.id}: Pause is pressable`, !!pressed && !pressed.dead)
    }

    // The mock publishes on a timer; wait for the reading rather than sleep.
    let chip = null
    for (let i = 0; i < 40; i += 1) {
      chip = await b.run(READ_CHIP)
      const settled = cell.state === 'running' ? !chip.present : chip.state === cell.state
      if (settled) break
      await new Promise((r) => setTimeout(r, 250))
    }

    await b.screenshot(out(`pause-cells-${STAMP}-${cell.id}.png`))

    if (cell.state === 'running') {
      check(`${cell.id}: no pause chip is rendered`, !chip.present, JSON.stringify(chip.text))
      check(
        `${cell.id}: and the footer claims no pause`,
        !/Paused/.test(chip.footer),
        JSON.stringify(chip.footer.slice(0, 80))
      )
    } else {
      check(`${cell.id}: the chip says so`, chip.state === cell.state, String(chip.state))
      check(
        `${cell.id}: and reads "${LABEL[cell.state]}"`,
        chip.text === LABEL[cell.state],
        JSON.stringify(chip.text)
      )
      // The wrong answer, named: this is the reading the cell had before #487
      // and the one it falls back to when the latch never arrives.
      check(
        `${cell.id}: not the Running reading`,
        chip.text !== LABEL.running,
        JSON.stringify(chip.text)
      )
      // Rule 16: reading the source is not looking. A chip the footer holds
      // and the window clips is a chip nobody reads, and every assertion
      // above passes for it.
      check(
        `${cell.id}: and it is on screen, not clipped or covered`,
        chip.onScreen && !chip.covered,
        JSON.stringify({ rect: chip.rect, covered: chip.covered })
      )
    }
  }

  /* The URL route, and its control.
   *
   * `?mock-pause=latched` reaches the same setter through the same parser as
   * `?bridge=`, for a harness with no hands - and cold, with no clicks, what
   * it produces is `paused-confirmed`, not `paused-by-bridge`: the relay sees
   * the latch on the first status and adopts it, which is exactly the
   * app-restart case #487 named. That is the honest expectation to write, and
   * it is still a check with teeth, because the control below opens the same
   * page with no flag and must show no chip at all.
   */
  await b.goto(base + '?bridge=mock&mock-pause=latched', { waitFor: '#root > *' })
  await b.waitFor('footer', 20000)
  let byUrl = null
  for (let i = 0; i < 40; i += 1) {
    byUrl = await b.run(READ_CHIP)
    if (byUrl.present) break
    await new Promise((r) => setTimeout(r, 250))
  }
  await b.screenshot(out(`pause-cells-${STAMP}-url-flag.png`))
  check(
    '?mock-pause=latched raises the latch with no clicks',
    byUrl.state === 'paused-confirmed' && byUrl.text === LABEL['paused-confirmed'],
    JSON.stringify(byUrl.state) + ' ' + JSON.stringify(byUrl.text)
  )
  const shown = await b.run(`return { search: location.search };`)
  check('and it was the URL that did it', /mock-pause=latched/.test(shown.search), shown.search)

  await b.goto(base + '?bridge=mock', { waitFor: '#root > *' })
  await b.waitFor('footer', 20000)
  await new Promise((r) => setTimeout(r, 2000))
  const noFlag = await b.run(READ_CHIP)
  check(
    'control: the same page with no flag raises nothing',
    !noFlag.present,
    JSON.stringify(noFlag.text)
  )

  await b.goto(base + '?bridge=mock&mock-pause=nonsense', { waitFor: '#root > *' })
  await b.waitFor('footer', 20000)
  await new Promise((r) => setTimeout(r, 2000))
  const bogus = await b.run(READ_CHIP)
  check(
    'control: a flag the parser does not know lands on the default',
    !bogus.present,
    JSON.stringify(bogus.text)
  )
} finally {
  await b.close()
}

console.log(`\n${checks} checked, ${bad} failed`)
if (checks < 30) {
  console.log(`FAIL only ${checks} checks ran; this file has more than that to run`)
  bad += 1
}
process.exit(bad === 0 ? 0 : 1)
