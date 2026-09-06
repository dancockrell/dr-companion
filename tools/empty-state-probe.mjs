/**
 * Is every control on the empty state actually reachable, at every size the
 * window can be? (Issue #418.)
 *
 * # Why this measures clicking rather than coordinates
 *
 * The first version of this probe compared each control's rect against
 * `window.innerHeight` and reported everything fine while the defect was on
 * screen. It was measuring the wrong box: nothing clips at the window edge
 * here, the app's `<main>` does, and a control 60px below `main`'s bottom sits
 * comfortably inside the viewport and is invisible. An element's rect is not a
 * claim about whether a person can see it.
 *
 * So the question asked is the one that matters - would a click land on it -
 * and it is asked the way `browser.mjs`'s own `click` asks it:
 * `document.elementFromPoint` at the control's centre. That answers "clipped
 * by an ancestor", "covered by something else" and "scrolled out of view" at
 * once, and it cannot be right by accident about any of them.
 *
 * # And reachability is tested by actually scrolling
 *
 * A control below the fold is fine if the container scrolls, so the probe
 * scrolls to it and re-asks. It restores every scroll position afterwards, so
 * one control's answer cannot depend on the previous control's.
 *
 * `scrollIntoView` is deliberately not used for that. It scrolls an
 * `overflow: hidden` box just as happily as an `auto` one - script can, a
 * person cannot - so it reported the broken screen as reachable. The probe
 * moves only ancestors whose computed `overflow-y` is `auto` or `scroll`,
 * which is the same set the mouse wheel and the keyboard can move. That
 * distinction is the whole subject of the issue, so a probe that could not
 * make it was measuring nothing.
 *
 * # What this cannot tell you
 *
 * Chrome is not the app. `isTauri()` is false, so `LichLauncher` - roughly
 * 350px of the real panel, and the reason it overflows at all - renders
 * nothing here. That is why the sizes below include one shorter than the
 * app's own minimum: it is the only way this stand-in can reach the overflow
 * condition the real app is in at 1180x820. The three real sizes assert the
 * property; the fourth is the one that exercises the scrolling.
 */

/** Window sizes to check, and why each one is in the list. */
export const EMPTY_STATE_SIZES = [
  [1180, 820, 'the app default (REQUESTED in lib.rs)'],
  [992, 711, 'a 1024x768 screen after the clamp'],
  [720, 480, 'the declared minimum (MIN in lib.rs)'],
  [
    720,
    300,
    'shorter than the app allows, to force in Chrome the overflow the real app has at every size (LichLauncher does not render here)',
  ],
]

/**
 * Controls a first-time user must be able to reach, and how to find each.
 * Matched on the text a person reads, not on a class name, so restyling the
 * screen cannot quietly make this pass.
 */
export const EMPTY_STATE_CONTROLS = [
  ['Nothing is connected yet', 'text'],
  ['Attach to Lich', 'text'],
  ['Start the demo', 'button'],
  ['Connection help', 'button'],
  // The last prose block on the panel, and the only entry here that is not a
  // control. It is the one that has to be reached by *scrolling* once the
  // reorder has pulled the buttons above the fold, so without it a pass would
  // only be evidence that the panel got shorter - not that anything scrolls.
  // Rule: never answer a bad-looking screen by deleting information; this
  // asserts the information is still gettable.
  ['This keeps Genie as your window', 'text'],
]

export const EMPTY_STATE_PROBE = `
  const want = ${JSON.stringify(EMPTY_STATE_CONTROLS)};
  const root = document.querySelector('main') ?? document.body;
  const all = [...root.querySelectorAll('*')];

  // Every ancestor whose scroll position we are about to disturb, so it can
  // be put back. A control found reachable only because a previous control
  // left the box scrolled is a false pass.
  const scrollers = new Set();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, why: 'zero-sized' };
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (y < 0 || y > window.innerHeight || x < 0 || x > window.innerWidth) {
      return { ok: false, why: 'centre outside the viewport' };
    }
    const top = document.elementFromPoint(x, y);
    if (!top) return { ok: false, why: 'nothing at its centre - clipped away' };
    if (el === top || el.contains(top) || top.contains(el)) return { ok: true };
    return { ok: false, why: 'covered by ' + top.tagName.toLowerCase() };
  };

  const out = [];
  for (const [needle, kind] of want) {
    const els = all.filter((e) => {
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
      return own.includes(needle);
    });
    const el = kind === 'button' ? (els.find((e) => e.tagName === 'BUTTON') ?? els[0]) : els[0];
    if (!el) { out.push({ needle, found: false }); continue; }

    // Only boxes a person can move: overflow-y auto or scroll. Script can
    // scroll a hidden box, which is exactly the false pass being avoided.
    const mine = [];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll') { mine.push(p); scrollers.add(p); }
    }
    const saved = [...scrollers].map((p) => [p, p.scrollTop]);

    const asIs = visible(el);
    const r = el.getBoundingClientRect();
    let after = asIs;
    if (!asIs.ok) {
      for (const p of mine) {
        const pr = p.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        p.scrollTop += er.top + er.height / 2 - (pr.top + pr.height / 2);
      }
      after = visible(el);
      if (!after.ok && mine.length === 0) after = { ok: false, why: 'no scrollable ancestor - ' + asIs.why };
    }
    for (const [p, t] of saved) p.scrollTop = t;

    out.push({
      needle,
      found: true,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      visibleAsIs: asIs.ok,
      visibleAfterScroll: after.ok,
      why: after.ok ? null : after.why,
    });
  }

  // The box the empty state actually lives in: the first ancestor of the
  // heading that establishes a vertical scroll of its own, falling back to
  // <main> when nothing does. Reporting <main> unconditionally was wrong once
  // the fix moved the scroll one level in - it said "overflow hidden, nothing
  // overflowing" about a container that was no longer the one being asked
  // about, which reads exactly like a pass.
  const anchor = all.find((e) =>
    [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
      .includes('Nothing is connected yet')
  );
  let hostEl = root;
  for (let p = anchor?.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') { hostEl = p; break; }
    if (p === root) break;
  }
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    hostOverflowY: getComputedStyle(hostEl).overflowY,
    hostScrollHeight: hostEl.scrollHeight,
    hostClientHeight: hostEl.clientHeight,
    hostOverflows: hostEl.scrollHeight > hostEl.clientHeight + 1,
    controls: out,
  };
`
