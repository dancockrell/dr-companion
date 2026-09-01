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
 * The room column (map + chat/functions, stacked) is guaranteed `ROOM_MIN`
 * the same as the other two are guaranteed their own floors - it holds the
 * game text, the command input and the channel tabs, the parts that make
 * this a client rather than a dashboard, so its floor is real rather than
 * negotiable. Past that floor it is a genuine third preference now
 * (`roomWant`), not a leftover: "one column for map, one for battle, one for
 * skills" - three peer requests, not two requests and a remainder.
 *
 * Whatever the three ask for together is honoured exactly when it fits. Any
 * width nobody asked for is shared equally by Room and Battle: both are
 * visual play surfaces, and handing all ultrawide growth to Room produced a
 * wall-sized map beside a cramped battle board. Experience stays compact.
 * If the three do not fit, all three are scaled toward their own floor by
 * the same factor, rather than one absorbing the whole shortfall - the same
 * fairness rule this module has used since it was two columns, extended to
 * three. Neither `map` nor `dash` goes below `COL_MIN`/its own floor, which
 * is small enough to be a sliver and large enough to still be grabbable, so
 * a column squeezed by a narrow window can be dragged back when the window
 * grows.
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

/**
 * The width below which the "dash" slot stops reflowing and starts hiding.
 *
 * COL_MIN is one number for two columns whose content behaves nothing alike.
 * The map is a canvas: squeeze it and it shows less map, which is a smaller
 * version of the same thing. This slot is a single fixed column of text rows
 * (`ExperienceStrip`/`MindstateBoard`) that scrolls vertically rather than
 * reflowing at all, so its floor is simply the width its longest row needs
 * to render without truncating - the longest real skill name plus a
 * two-digit mindstate number, measured against the actual rendered font
 * (`ctx.measureText`, not guessed) at 120px.
 *
 * Was 382, sized for the old two-column dashboard grid this slot used to
 * hold (`[grid-template-columns:1fr_minmax(15rem,22rem)]` in
 * DashboardLayout.tsx, cut by 3e95ae7d - see mounted-test.mjs's ALLOWED
 * entry for it). That grid's right column truly could not go under 15rem
 * without hiding controls behind a hover-only scrollbar; today's slot has
 * no such column to protect, so the number moved to describe what actually
 * lives here now.
 */
export const DASH_MIN = 120

/**
 * What an empty map column asks for, instead of the player's stored width.
 *
 * "Empty" here means literally nothing to look at - no bridge, or connected
 * but no zone fetched yet. Measured from Dan's own "see a map?": a black
 * rectangle at 495px, 38% of an 1180px window, while the game pane - the
 * actual reason this app exists - sat at 380px, its bare floor. The stored
 * preference is not wrong and is not discarded; it is only honoured while
 * there is something in the column to spend it on. The moment `mapEmpty`
 * goes false again, `mapWant` applies exactly as it did before.
 */
export const MAP_EMPTY_WANT = 220

/** Same reasoning, for the dashboard's "waiting for a character" state. */
export const DASH_EMPTY_WANT = 300

/** The widths the app ships with. The map's matches `DEFAULT` in mapDock.ts. */
export const DEFAULT_MAP_W = 300
export const DEFAULT_DASH_W = 420
/** Room's own default - enough over `ROOM_MIN` to not look like a floor the
 * moment the app opens, matched to what the map + chat/functions stack
 * actually asked for in practice before room had a stored width of its own. */
export const DEFAULT_ROOM_W = 460

export interface ResetPlan {
  /** New width to set, or null to leave that column's stored preference alone. */
  room: number | null
  map: number | null
  dash: number | null
}

/**
 * What "Reset widths" should actually change - see issue #63.
 *
 * It used to reset both columns unconditionally, on the reasoning that the
 * banner only shows when something doesn't fit, so something must be wrong
 * with both. Measured live: a stored map of 1728.8px and a dashboard of
 * 510px in a 1518px window. The room floor leaves 1138px for the pair; the
 * dashboard's 510 fits inside that on its own and only the map does not.
 * Resetting both took a deliberately-set dashboard width back to default
 * for a drag made on the *other* divider.
 *
 * So: try putting the biggest overshoot back to default on its own first. If
 * that alone fits, the other columns' preferences were never the problem and
 * are kept. Only when that is not enough does the next-biggest overshoot join
 * it, and so on - and on a window too narrow even for all three defaults,
 * that still won't fit, which is correct: there is no width to be found, and
 * the banner staying up says so rather than a button that appears to have
 * done nothing.
 *
 * A column already at (or under) its own default cannot be "the one that
 * overshot", which is why this ranks by how far over default each one is
 * rather than by raw width - now extended from two columns to three (room
 * joined map and dash as a real preference rather than a leftover).
 */
export function pickReset({
  hostW,
  mapDocked,
  roomWant,
  mapWant,
  dashWant,
  splitW,
}: {
  hostW: number
  mapDocked: boolean
  roomWant: number
  /** dock.width - only meaningful while mapDocked. */
  mapWant: number
  dashWant: number
  splitW: number
}): ResetPlan {
  // The map is not on screen to be blamed for anything, and with no map
  // column sharing the window, room's own floor was never in question -
  // only dash's overshoot against room's ask could be.
  if (!mapDocked) {
    const forColumns = hostW - splitW - ROOM_MIN
    return roomWant + dashWant <= forColumns
      ? { room: null, map: null, dash: null }
      : { room: null, map: null, dash: DEFAULT_DASH_W }
  }

  const forColumns = hostW - splitW * 2
  const cols = [
    { key: 'room' as const, want: roomWant, def: DEFAULT_ROOM_W },
    { key: 'map' as const, want: mapWant, def: DEFAULT_MAP_W },
    { key: 'dash' as const, want: dashWant, def: DEFAULT_DASH_W },
  ]
  const byOvershoot = [...cols].sort((a, b) => b.want - b.def - (a.want - a.def))

  // Nobody reset, then the single biggest overshoot, then the two biggest,
  // then all three - stopping the moment a combination actually fits.
  for (let resetCount = 0; resetCount <= cols.length; resetCount++) {
    const reset = new Set(byOvershoot.slice(0, resetCount).map((c) => c.key))
    const total = cols.reduce((sum, c) => sum + (reset.has(c.key) ? c.def : c.want), 0)
    if (total <= forColumns || resetCount === cols.length) {
      return {
        room: reset.has('room') ? DEFAULT_ROOM_W : null,
        map: reset.has('map') ? DEFAULT_MAP_W : null,
        dash: reset.has('dash') ? DEFAULT_DASH_W : null,
      }
    }
  }
  // Unreachable - the loop above always returns by resetCount === cols.length.
  return { room: DEFAULT_ROOM_W, map: DEFAULT_MAP_W, dash: DEFAULT_DASH_W }
}

export interface ColumnFit {
  /** The map column's width, or 0 when it is not docked. */
  map: number
  /** The dashboard column's width. */
  dash: number
  /** The room column's width. Never below ROOM_MIN unless the window is. */
  room: number
  /** True when the window could not honour all three requests. */
  squeezed: boolean
}

export function fitColumns({
  hostW,
  roomWant,
  mapWant,
  dashWant,
  mapDocked,
  splitW,
  mapEmpty = false,
  dashEmpty = false,
  mapGrowthMax,
  dashGrowthMax,
}: {
  hostW: number
  /** Room's own stored preference - map + chat/functions, stacked. A real
   * request now, same as map and dash, not whatever is left over. */
  roomWant: number
  mapWant: number
  dashWant: number
  mapDocked: boolean
  splitW: number
  /** The map has nothing to show right now - see MAP_EMPTY_WANT. */
  mapEmpty?: boolean
  /** The dashboard has nothing to show right now - see DASH_EMPTY_WANT. */
  dashEmpty?: boolean
  /** Ceiling for automatic Battle growth only. An explicit request above it
   * is still honoured; this prevents surplus width creating gutters around
   * a height-limited square scene. */
  mapGrowthMax?: number
  /** Optional contextual ceiling for the Experience rail. During combat the
   * battle board is the active work surface and a very wide saved skill rail
   * adds longer bars, not more information. The stored preference is never
   * rewritten; omitting this ceiling restores it immediately. */
  dashGrowthMax?: number
}): ColumnFit {
  // Two dividers when the map is docked, one when it is not.
  const splits = mapDocked ? splitW * 2 : splitW
  // A ceiling, not a rewrite: a player who dragged the map narrower than the
  // empty allowance is still asking for exactly that, and gets it. Only a
  // *larger* stored width is capped, and only while there is nothing behind
  // it to justify the space.
  const mapWantEffective = mapEmpty ? Math.min(mapWant, MAP_EMPTY_WANT) : mapWant
  const dashWantVisible = dashGrowthMax == null ? dashWant : Math.min(dashWant, dashGrowthMax)
  const dashWantEffective = dashEmpty ? Math.min(dashWantVisible, DASH_EMPTY_WANT) : dashWantVisible
  // An empty dashboard has nothing to hide, so it keeps the grabbable sliver.
  // A populated one may not go under DASH_MIN: below that it stops reflowing
  // and starts concealing controls behind a hover-only scrollbar.
  const dashFloor = dashEmpty ? COL_MIN : DASH_MIN
  const roomAsked = Math.max(ROOM_MIN, roomWant)
  const mapAsked = mapDocked ? Math.max(COL_MIN, mapWantEffective) : 0
  const dashAsked = Math.max(dashFloor, dashWantEffective)

  // Before the layout has measured itself there is nothing to fit against, and
  // returning the requests unchanged is right: the very next frame corrects it,
  // and inventing a host width would make the first paint a lie.
  if (!hostW) {
    return { map: mapAsked, dash: dashAsked, room: roomAsked, squeezed: false }
  }

  const forColumns = hostW - splits
  const asked = roomAsked + mapAsked + dashAsked

  if (asked <= forColumns) {
    // Share unclaimed ultrawide space between the two visual play surfaces.
    // Experience is a vertical watch rail and gains nothing from surplus.
    const surplus = forColumns - asked
    // An absent/empty Battle surface has nothing to spend growth on. In that
    // state Room receives the surplus exactly as before; the split begins as
    // soon as Battle has content worth enlarging.
    const desiredBattleSurplus = mapDocked && !mapEmpty ? Math.floor(surplus / 2) : 0
    const growthRoom = mapGrowthMax == null ? desiredBattleSurplus : Math.max(0, mapGrowthMax - mapAsked)
    const battleSurplus = Math.min(desiredBattleSurplus, growthRoom)
    return {
      map: mapAsked + battleSurplus,
      dash: dashAsked,
      room: roomAsked + surplus - battleSurplus,
      squeezed: false,
    }
  }

  // Not enough. Scale all three toward their own floor by the same factor.
  //
  // Same factor, different floors. Equal scaling is the right fairness rule
  // between preferences nobody ranked, and it was being applied as though
  // every column could absorb it equally. They cannot: the map degrades into
  // less map, the dashboard degrades into hidden buttons, and room degrades
  // into a game pane with no room to read it in - which is why room's floor
  // is the one this module has always refused to let anyone cross. Each
  // column scales from its own floor, and the dashboard's floor is the width
  // its content actually needs rather than the width a divider needs to be
  // grabbable.
  const floor = ROOM_MIN + (mapDocked ? COL_MIN : 0) + dashFloor
  const slack = asked - floor
  const available = Math.max(0, forColumns - floor)
  const keep = slack > 0 ? Math.max(0, Math.min(1, available / slack)) : 0

  const map = mapDocked ? COL_MIN + (mapAsked - COL_MIN) * keep : 0
  const dash = dashFloor + (dashAsked - dashFloor) * keep
  const mapRounded = Math.max(0, Math.round(map))
  const dashRounded = Math.max(0, Math.round(dash))

  return {
    // On a window too narrow even for the minimums, these go to zero rather
    // than negative. The columns are already at their floor by then; a
    // negative would set a CSS width that the browser reads as auto and the
    // overflow would come straight back.
    map: mapRounded,
    dash: dashRounded,
    // Room absorbs whatever rounding map and dash left over, the same way
    // it does in the fits-without-squeezing branch above, rather than being
    // rounded independently - three independently-rounded floats can each
    // drift up to half a pixel over, and summed that is enough to push the
    // total a full pixel past the window. Found live: a 3440px window came
    // back one pixel over. room already carries the "whatever nobody else
    // claimed" job; matching it here keeps the sum exact instead of merely
    // close.
    room: Math.max(0, forColumns - mapRounded - dashRounded),
    squeezed: true,
  }
}
