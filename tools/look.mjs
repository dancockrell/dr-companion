/**
 * Look at the app the way a person does, and report what is wrong with it.
 *
 *   node tools/look.mjs                        the dashboard, 1280x860
 *   node tools/look.mjs --width 520            docked narrow, beside the game
 *   node tools/look.mjs --preset bard_prime    a particular character
 *   node tools/look.mjs --shot out.png         write the image too
 *
 * # Why this exists
 *
 * Every layout defect on this project was invisible in the source and obvious
 * on the page: a thousand-pixel black void where a column had no height, a map
 * collapsed to two pixels, a Bard's concentration reading 100 when the pool is
 * 330, a thirteen-item checklist scrolling inside a 160px box on a half-empty
 * page. Each was found by somebody looking, and mostly that somebody was Dan
 * sending a screenshot.
 *
 * Reading `innerText` is not looking. It confirms words are present and says
 * nothing about whether they are legible, clipped, overlapping or off the edge
 * - which is the entire class of thing that goes wrong here.
 *
 * # It clicks the buttons
 *
 * The first version of this could not click, so the app grew a `?demo=<preset>`
 * URL that jumped straight to a loaded dashboard, and index.html grew a
 * `?look=1` that injected the probe. Both were wrong and Dan said so: test
 * scaffolding in the product, and checks that exercise a path no player takes.
 * The setup wizard, the demo button and the settings sheet were all bypassed -
 * which is exactly where a bug would be sitting.
 *
 * Both are gone. This drives the real UI through tools/browser.mjs: click the
 * button, open settings, choose the character. If any of those controls is
 * covered, zero-sized or missing, this fails, and that failure is worth as much
 * as the layout findings.
 */
import { existsSync, readFileSync } from 'node:fs'
import { launch, findBrowser } from './browser.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const WIDTH = Number(arg('width', 1280))
const HEIGHT = Number(arg('height', 860))
const PRESET = arg('preset', null)
const SHOT = arg('shot', null)
const BASE = arg('base', 'http://localhost:1420/')

let failed = 0
const unchecked = []
const ok = (name, cond, detail = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name.padEnd(44)}${detail}`)
}
const skip = (name, why) => {
  unchecked.push(name)
  console.log(`SKIP ${name.padEnd(44)}${why}`)
}
const finish = () => {
  console.log(
    `\n${
      failed
        ? `${failed} failed`
        : unchecked.length
          ? `no failures, but ${unchecked.length} not checked: ${unchecked.join(', ')}`
          : 'all passed'
    }`
  )
  process.exit(failed ? 1 : 0)
}

/**
 * The measuring, as source that runs inside the page.
 *
 * Injected through the debugger rather than served as a file, so nothing about
 * it can reach a build. It reports rather than judges: each finding names the
 * element, what it says, and the two numbers that disagree, because "something
 * is clipped" is not actionable and "a 39px box holding 63px of text" is.
 */
const PROBE = `
(() => {
  const findings = [];
  const seen = new Set();
  // SVG elements carry an SVGAnimatedString here, which stringifies to
  // "[object SVGAnimatedString]" and made every finding inside the map read as
  // "[object". A finding nobody can locate is a finding nobody acts on.
  const nameOf = (el) =>
    typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';

  const note = (kind, el, detail) => {
    const cls = nameOf(el);
    const key = kind + '|' + cls + '|' + detail;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      kind, tag: el.tagName.toLowerCase(), cls: cls.slice(0, 50),
      text: (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      detail,
    });
  };

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const all = document.querySelectorAll('body *');

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const text = (el.innerText || '').trim();
    const leaf = !el.querySelector('*');
    const scrollsX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    const scrollsY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';

    // Deliberate truncation is not a defect. An element that opts into an
    // ellipsis is saying "this may be long, show what fits", and it carries a
    // visible affordance plus, here, a title tooltip. Flagging those buried
    // the real findings under a dozen labels that are working as designed -
    // and a check that cries wolf is one people learn to skim, which costs
    // more than the handful of true positives it would ever add.
    const truncates = cs.textOverflow === 'ellipsis';

    // Only leaves, so a clipped word is reported once at the element that
    // actually holds it rather than at every ancestor containing it.
    if (leaf && text && !scrollsX && !truncates && el.scrollWidth > el.clientWidth + 2) {
      note('clipped-x', el, el.scrollWidth + 'px of text in ' + el.clientWidth + 'px');
    }
    if (leaf && text && !scrollsY && el.scrollHeight > el.clientHeight + 2) {
      note('clipped-y', el, el.scrollHeight + 'px of text in ' + el.clientHeight + 'px');
    }
    // Inside an SVG, geometry larger than the viewport is the drawing, not a
    // layout failure: the map chart is deliberately bigger than its box and
    // scaled into it. Only the element that *holds* the SVG can escape.
    const inSvg = el.ownerSVGElement != null;

    // Nor is content inside a horizontal scroller escaping anything. The macro
    // bar scrolls sideways and fades at its right edge, so a button beyond the
    // viewport there is scrolled, not lost, and the player has an affordance
    // for it.
    //
    // Worth being exact about why this is not just silencing an inconvenient
    // finding: the question this check asks is "did the layout give up instead
    // of reflowing". A scroller is the layout answering that question on
    // purpose. Escaping is only a defect where nothing can bring it back.
    let scrollableAncestor = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (acs.overflowX === 'auto' || acs.overflowX === 'scroll') { scrollableAncestor = true; break; }
    }

    if (!inSvg && !scrollableAncestor && (r.right > vw + 1 || r.left < -1)) {
      note('off-screen-x', el, Math.round(r.left) + '..' + Math.round(r.right) + ' vs ' + vw);
    }
    // The audience is mid-forties upward reading beside a black game window at
    // two in the morning. See docs/DESIGN.md 1.5.
    if (leaf && text && parseFloat(cs.fontSize) < 11) {
      note('tiny-type', el, cs.fontSize);
    }
  }

  // A visible pane with nothing in it: the black-void bug, a column with no
  // height or content that failed to mount.
  const main = document.querySelector('main');
  if (main) {
    for (const col of main.children) {
      const r = col.getBoundingClientRect();
      if (r.width > 40 && !(col.innerText || '').trim() && !col.querySelector('svg,img,canvas')) {
        note('empty-pane', col, Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
  }

  return {
    viewport: [vw, vh],
    elements: all.length,
    scrollWidth: document.documentElement.scrollWidth,
    findings,
  };
})()
`

if (!findBrowser()) {
  // A missing instrument is the third answer. Folding it into "fine" is how a
  // check that never ran gets read as a check that succeeded.
  skip('the app was looked at', 'no Chrome or Edge found')
  finish()
}

let b
try {
  b = await launch({ width: WIDTH, height: HEIGHT })
} catch (e) {
  skip('the app was looked at', e.message)
  finish()
}

try {
  console.log(`-- ${BASE} at ${WIDTH}x${HEIGHT}${PRESET ? `, ${PRESET}` : ''} --`)

  await b.goto(BASE, { waitFor: 'body' })

  // Reached the way a player reaches it. Each of these is a real click on a
  // real control, so a button that is covered or missing fails here - which is
  // a finding in its own right, not a problem with the harness.
  await b.waitFor('button', 15000)
  await b.click('button', /demo dashboard/i)
  await b.waitFor('main', 15000)

  if (PRESET) {
    await b.click('button[title="Settings"]')
    await b.waitFor('select', 10000)
    await b.select(PRESET)
    // Close the sheet by its own control rather than by pressing Escape, so
    // the close button is exercised too.
    await b.click('.fixed.inset-0 button')
  }

  // Let the mock settle before measuring, and confirm it did rather than
  // assuming a delay was enough.
  await b.eval(`new Promise(r => setTimeout(r, 900))`)

  ok('the dashboard is reachable by clicking', await b.eval(`!!document.querySelector('main')`))
  ok(
    'it is not still the setup wizard',
    !(await b.eval(`/Open the demo dashboard/.test(document.body.innerText)`))
  )
  if (PRESET) {
    const who = await b.eval(`(document.body.innerText.match(/Phemius|Dan the Bold|Ashen Keth|Explorer Miri|Estate Lord Venn|Platinum Shade/) || [''])[0]`)
    ok('the chosen character is showing', !!who, who || 'no character name on screen')
  }

  const errors = b.consoleErrors()
  ok('the page threw nothing', errors.length === 0, errors.slice(0, 2).join(' | '))

  const v = await b.eval(PROBE)
  const by = (k) => v.findings.filter((f) => f.kind === k)
  const show = (list) =>
    list.slice(0, 4).map((f) => `${f.cls.split(' ')[0] || f.tag}${f.text ? ` "${f.text.slice(0, 24)}"` : ''} (${f.detail})`).join('; ')

  console.log(`\n-- measured ${v.elements} elements at ${v.viewport.join('x')} --`)

  // The fragile denominator. Every finding-based check below is trivially
  // clean against an empty page, which is what a failed render produces.
  ok('there was something to measure', v.elements > 100, `${v.elements} elements`)

  ok('nothing is cut off horizontally', by('clipped-x').length === 0, show(by('clipped-x')))
  ok('nothing is cut off vertically', by('clipped-y').length === 0, show(by('clipped-y')))
  ok('nothing escapes the window', by('off-screen-x').length === 0, show(by('off-screen-x')))
  ok('the page does not scroll sideways', v.scrollWidth <= v.viewport[0] + 1, `${v.scrollWidth} vs ${v.viewport[0]}`)
  ok('no type below 11px', by('tiny-type').length === 0, show(by('tiny-type')))
  ok('no visible pane is empty', by('empty-pane').length === 0, show(by('empty-pane')))

  if (SHOT) {
    await b.screenshot(SHOT)
    console.log('')
    ok('a screenshot was written', existsSync(SHOT), SHOT)
    if (existsSync(SHOT)) {
      // Not a substitute for looking at it. It catches the render that
      // produced a blank frame, which is the only part a number can answer.
      ok('the screenshot is not blank', readFileSync(SHOT).length > 12000, `${readFileSync(SHOT).length} bytes`)
    }
  }
} catch (e) {
  // A driver failure is not a clean page, and it is not a layout failure
  // either. Named as what it is.
  ok('the app could be driven', false, e.message)
} finally {
  await b.close()
}

finish()
