/**
 * Are a panel's own header controls inside the window? (Issue #435.)
 *
 * # What this is measuring, and why it is not "is the button there"
 *
 * A control that exists and a control a mouse can reach are different facts -
 * the same distinction issue #418 turned out to be about, one panel further
 * in. `MapPanel`'s pop-out button was reported at `left: 2685` on the packaged
 * app, which is not a styling complaint: at that x it is outside every window
 * this app can open, so the only route to the map's own window was gone.
 *
 * The mechanism is a flex row in a box that does not clip. A panel header is
 * `flex` with a `shrink-0` control cluster at its right-hand end, and the
 * section around it declares no width of its own. Put that section in an
 * ancestor with `overflow: auto` (which is exactly what `PanelWindow` does -
 * `overflow-auto p-3`) and the section takes a **max-content** width: as wide
 * as its widest child, which for a map or a card deck is far wider than the
 * window. The header stretches with it and the controls ride out to the right
 * edge of a box nobody can see the end of.
 *
 * So the question asked here is the header's, not the button's: does any
 * header control's rect end past `innerWidth`? A rect is enough for this one
 * because horizontal escape has no scroll to rescue it - the boxes above these
 * headers are `overflow-x: hidden` or the window itself, and neither a wheel
 * nor a keyboard moves them sideways. (`empty-state-probe.mjs` asks the
 * harder question - would a click land - because vertical overflow *can* be
 * rescued by scrolling and a rect cannot tell.)
 *
 * # The denominator is the panel list, and it is derived
 *
 * Counting controls that are outside the window can never notice a panel whose
 * controls were not rendered at all - a header that failed to mount and a
 * header that fits produce the same zero. So the list of panels comes from
 * `PANEL_TITLES` in `src/components/dashboard/panels.tsx`, parsed from the
 * source rather than typed here, and every one of them has to be *reached* at
 * every size before any verdict is issued. A panel added tomorrow is measured
 * without anybody remembering this file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The two sizes, and why each is in the list.
 *
 * Both come from `src-tauri/src/window_size.rs`, which is the only place that
 * decides how big a window of this app may be. A control that fits the default
 * and not the minimum is still a control somebody loses by dragging a corner.
 */
export const CONTROL_SIZES = [
  [1180, 820, 'the app default (REQUESTED in window_size.rs)'],
  [720, 480, 'the declared minimum (MIN in window_size.rs)'],
]

/**
 * Every panel the app can put in a window of its own, read out of the
 * registry.
 *
 * Parsed, not imported: this is a `.mjs` tool and the registry is a `.tsx`
 * module full of JSX. The parse is deliberately narrow and it *throws* rather
 * than returning what it managed to find, because a regex that silently
 * matched nothing would hand every caller an empty list and every caller
 * would then report a clean run over no panels at all.
 */
export function panelIds(root) {
  // `DRC_PANELS_SRC` exists so the refusal below can be *run* rather than
  // reasoned about. A branch nobody can execute on purpose is a branch nobody
  // can prove they fixed - point this at a file with no registry in it and
  // the parse must abort naming the reason, never hand back a short list.
  const src = readFileSync(process.env.DRC_PANELS_SRC ?? join(root, 'src/components/dashboard/panels.tsx'), 'utf8')
  const block = /export const PANEL_TITLES[^{]*\{([\s\S]*?)\n\}/.exec(src)
  if (!block) throw new Error('PANEL_TITLES was not found in panels.tsx - this probe cannot say anything')
  const ids = [...block[1].matchAll(/^\s{2}([a-zA-Z][\w]*)\s*:/gm)].map((m) => m[1])
  if (ids.length < 8) {
    throw new Error(`only ${ids.length} panels parsed out of PANEL_TITLES; the registry has more than that, so this parse is broken`)
  }
  return ids
}

/**
 * Run in the page. Returns every control that lives inside a `<header>`,
 * with the header's own width beside it - the header being far wider than the
 * window is the tell, and reporting it turns "this button is at 2685" into
 * "this header is 2900 wide inside a 1180 window", which names the cause.
 */
export const CONTROL_PROBE = `
  const headerOf = (el) => { for (let p = el; p; p = p.parentElement) if (p.tagName === 'HEADER') return p; return null; };
  const out = [];
  for (const el of document.querySelectorAll('button, [role="button"], span[draggable="true"]')) {
    const header = headerOf(el);
    if (!header) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const hr = header.getBoundingClientRect();
    out.push({
      label: el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText || '').trim().slice(0, 30) || el.tagName,
      left: Math.round(r.left),
      right: Math.round(r.right),
      headerWidth: Math.round(hr.width),
      escapes: r.right > window.innerWidth + 0.5 || r.left < -0.5,
    });
  }
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    controls: out,
    escaped: out.filter((o) => o.escapes),
    /* Did the panel render at all? A panel that mounted nothing has no
       controls to be outside the window, and that must never read as a pass. */
    mounted: !!document.querySelector('main, section, [data-panel]'),
    text: (document.body.innerText || '').slice(0, 120),
  };
`
