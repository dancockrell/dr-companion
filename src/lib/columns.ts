/**
 * How three columns share a window that is not always big enough for them.
 *
 * # Why this is a module and not two calls to Math.min
 *
 * The map column's width and the dashboard column's width were each stored
 * with a floor and no ceiling, independently, and neither knew the other
 * existed. The room column took `flex-1` of whatever was left, which on a
 * window that was not big enough is nothing, and `main` is `overflow-hidden`,
 * so "nothing" means the game pane is not narrow - it is off the screen.
 *
 * The app was found in that state. Attached to the running WebView2 and asked
 * what had left the window:
 *
 *     window 1180x820, document 1180 wide
 *          718px out  Attach
 *          666px out  Clear
 *          490px out  INPUT
 *          500px out  All
 *
 * Every control belonging to the game connection, unreachable, with no
 * scrollbar to reach them by. The stored map width was 1201.6px in an 1180px
 * window.
 *
 * The first fix put a ceiling on the map alone - "leave 420px for the rest" -
 * and was still wrong when measured, because the dashboard was holding 420 of
 * those 420 and the room column got zero:
 *
 *     276px out  Attach
 *     106px out  Companion
 *
 * Better and still broken, which is the argument for doing the arithmetic in
 * one place with all three columns in it rather than bounding each one against
 * a guess about the others.
 *
 * # The rule
 *
 * The room column is guaranteed `ROOM_MIN`. It holds the game text, the
 * command input and the channel tabs - the parts that make this a client
 * rather than a dashboard - so it is the one that cannot be squeezed out.
 *
 * Whatever is left over is offered to the map and the dashboard at the widths
 * they asked for. If those do not fit, both are scaled down by the same factor
 * rather than one absorbing the whole shortfall, because a player who set both
 * did not implicitly rank them. Neither goes below `COL_MIN`, which is small
 * enough to be a sliver and large enough to still be grabbable, so a column
 * squeezed by a narrow window can be dragged back when the window grows.
 *
 * Requests are never rewritten. What the player asked for stays stored, and
 * this is applied at the point of use, so dragging the window narrow and wide
 * again returns the layout they set rather than a souvenir of the narrowest
 * moment.
 */

/** Enough for the game header, the input and the channel tabs to be usable. */
export const ROOM_MIN = 380

/** A sliver, but a grabbable one. */
export const COL_MIN = 80

export interface ColumnFit {
  /** The map column's width, or 0 when it is not docked. */
  map: number
  /** The dashboard column's width. */
  dash: number
  /** What is left for the room column. Never below ROOM_MIN unless the window is. */
  room: number
  /** True when the window could not honour both requests. */
  squeezed: boolean
}

export function fitColumns({
  hostW,
  mapWant,
  dashWant,
  mapDocked,
  splitW,
}: {
  hostW: number
  mapWant: number
  dashWant: number
  mapDocked: boolean
  splitW: number
}): ColumnFit {
  // Two dividers when the map is docked, one when it is not.
  const splits = mapDocked ? splitW * 2 : splitW
  const mapAsked = mapDocked ? Math.max(COL_MIN, mapWant) : 0
  const dashAsked = Math.max(COL_MIN, dashWant)

  // Before the layout has measured itself there is nothing to fit against, and
  // returning the requests unchanged is right: the very next frame corrects it,
  // and inventing a host width would make the first paint a lie.
  if (!hostW) {
    return { map: mapAsked, dash: dashAsked, room: 0, squeezed: false }
  }

  const forColumns = hostW - splits - ROOM_MIN
  const asked = mapAsked + dashAsked

  if (asked <= forColumns) {
    return {
      map: mapAsked,
      dash: dashAsked,
      room: hostW - splits - mapAsked - dashAsked,
      squeezed: false,
    }
  }

  // Not enough. Scale both toward their minimum by the same factor.
  const floor = (mapDocked ? COL_MIN : 0) + COL_MIN
  const slack = asked - floor
  const room = Math.max(0, forColumns - floor)
  const keep = slack > 0 ? Math.max(0, Math.min(1, room / slack)) : 0

  const map = mapDocked ? COL_MIN + (mapAsked - COL_MIN) * keep : 0
  const dash = COL_MIN + (dashAsked - COL_MIN) * keep

  return {
    map: Math.round(map),
    dash: Math.round(dash),
    // On a window too narrow even for the minimums, this goes to zero rather
    // than negative. The columns are already at their floor by then; a
    // negative would set a CSS width that the browser reads as auto and the
    // overflow would come straight back.
    room: Math.max(0, hostW - splits - Math.round(map) - Math.round(dash)),
    squeezed: true,
  }
}
