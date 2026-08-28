/**
 * Free placement: panels go where you put them.
 *
 * The column flow fixed width being wasted, but it still decides where things
 * live. This does not: a panel keeps a rectangle, you drag it anywhere, and
 * the only things that stop it are the edges of the window and the other
 * panels.
 *
 * Overlap is resolved rather than forbidden. Refusing a drop leaves you
 * holding a panel with nowhere to put it and no explanation; nudging it clear
 * of what it hit lands it where you were obviously aiming.
 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
  /**
   * Stacking order. Higher is nearer the front.
   *
   * Optional because it arrived after layouts were already being saved, and a
   * stored rect without it is not broken - it is a panel that has never been
   * raised, which is exactly what `?? 0` means. Nothing needs migrating.
   *
   * Persisted with the rest of the rect, so a window someone put on top stays
   * on top across a restart. A stacking order that resets every session is
   * one nobody bothers to arrange.
   */
  z?: number
}

/** Small enough to tuck into a corner, large enough to still read. */
export const MIN_W = 180
export const MIN_H = 90

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** Keep a rectangle inside the canvas, whatever the drag did. */
export function clampToBounds(r: Rect, bounds: { w: number; h: number }): Rect {
  const w = Math.max(MIN_W, Math.min(r.w, bounds.w))
  const h = Math.max(MIN_H, Math.min(r.h, bounds.h))
  return {
    w,
    h,
    x: Math.max(0, Math.min(r.x, bounds.w - w)),
    y: Math.max(0, Math.min(r.y, bounds.h - h)),
    // Carried through, not rebuilt away.
    //
    // This function returns a fresh object, and every drop goes through it -
    // so dropping `z` here would have reset the stacking order on every single
    // drag, silently, while looking exactly like stacking that "does not
    // stick". Nothing would have errored.
    z: r.z,
  }
}

/**
 * Push a rectangle clear of everything it overlaps.
 *
 * NOT USED BY THE CANVAS ANY MORE. Panels are allowed to overlap and stack;
 * see FreeCanvas's pointer-up handler for why that changed. Kept because it
 * is a correct pure function and a `tidy up` command is the obvious next use
 * for it - but its tests prove the arithmetic, not that anything calls it.
 *
 * Resolved along whichever axis needs the least movement, because that is the
 * direction that feels like the panel settling rather than jumping. Repeated
 * until clear or until the budget runs out: a cascade can push something into
 * something else, and an unbounded loop in a drag handler would freeze the
 * window rather than misplace a box.
 */
export function resolveCollisions(
  moving: Rect,
  others: Rect[],
  bounds: { w: number; h: number }
): Rect {
  let r = clampToBounds(moving, bounds)

  for (let pass = 0; pass < 12; pass++) {
    const hit = others.find((o) => overlaps(r, o))
    if (!hit) return r

    // How far to move in each direction to be clear of this one.
    const left = hit.x - (r.x + r.w)
    const right = hit.x + hit.w - r.x
    const up = hit.y - (r.y + r.h)
    const down = hit.y + hit.h - r.y

    const options: Array<{ dx: number; dy: number }> = [
      { dx: left, dy: 0 },
      { dx: right, dy: 0 },
      { dx: 0, dy: up },
      { dx: 0, dy: down },
    ]

    // Nearest first, but only where the result still fits on the canvas.
    options.sort((a, b) => Math.abs(a.dx + a.dy) - Math.abs(b.dx + b.dy))

    const next = options
      .map((o) => clampToBounds({ ...r, x: r.x + o.dx, y: r.y + o.dy }, bounds))
      .find((cand) => !others.some((o) => overlaps(cand, o)))

    if (next) return next

    // Nothing clean this pass. Take the smallest nudge and try again, so a
    // crowded canvas still converges instead of refusing the drop.
    const o = options[0]
    r = clampToBounds({ ...r, x: r.x + o.dx, y: r.y + o.dy }, bounds)
  }

  return r
}

/**
 * A first home for a panel that has never been placed.
 *
 * Scans left to right, top to bottom for the first gap it fits in, so opening
 * the app for the first time gives a packed layout rather than a pile in the
 * corner.
 */
export function firstFreeSlot(
  size: { w: number; h: number },
  taken: Rect[],
  bounds: { w: number; h: number },
  step = 20
): Rect {
  for (let y = 0; y + size.h <= bounds.h; y += step) {
    for (let x = 0; x + size.w <= bounds.w; x += step) {
      const cand = { x, y, w: size.w, h: size.h }
      if (!taken.some((t) => overlaps(cand, t))) return cand
    }
  }
  // Full. Put it at the origin and let the collision pass sort it out.
  return clampToBounds({ x: 0, y: 0, ...size }, bounds)
}

export { overlaps }
