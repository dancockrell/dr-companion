/**
 * The visual pane's four states, and where it remembers them.
 *
 * Dan, 9 September 2026, first pass: *"the godot screen should include the
 * map and the ability to easily put it into mini map mode or pop it out into
 * a big map, nice interface"*, and *"it's not best to put the screen in the
 * middle ... put it in the right corner"*. Lane O built exactly that and
 * defaulted the corner pane to a small tile (`minimap`, 380px).
 *
 * Dan, reacting to that build, 10 September 2026: *"I am quite sure I said to
 * put the main window to the right ... you are going to get a godot screen
 * with basically a modern ui ... right now you are random and broken."* The
 * correction is not "move it back to the middle" - the right corner was
 * right. It is that a *tile* is not what "the main window" means: Godot is
 * bringing its own chrome with it, and a 380px preview reads as a minimap
 * bolted to the side, not as a panel a modern UI could live in.
 *
 * So the pane now has four states and one control that cycles all of them.
 * `docked` is new and is the default; `minimap` survives as the small preview
 * a player can still choose, demoted rather than deleted (CLAUDE.md section
 * 0 - build on it, don't fork a second pane beside it):
 *
 *   `docked`   the primary panel, in the top right corner of the workspace,
 *              sized like a real panel rather than a corner tile - see
 *              `DOCKED_RAIL_W`. The default for every window wide enough to
 *              hold one;
 *   `minimap`  the old small corner tile (`MINIMAP_RAIL_W`), kept as a
 *              player's own choice for whoever wants the text wider than
 *              `docked` leaves it;
 *   `popped`   in a window of its own, through the panel-window machinery
 *              that already exists (`panelWindows.ts`, the `board` panel) -
 *              not a second pop-out implementation;
 *   `hidden`   not drawn at all, and the text gets the width back.
 *
 * # Why the state is stored per window size
 *
 * Because it is a different decision at each size, and a single stored answer
 * makes one of them wrong. A player on a 1997px monitor wants the corner
 * pane; the same player on a 1366px laptop is choosing between the pane and a
 * readable wall of game text, and at the app's own 720px minimum there is no
 * choice to make. One key for all of them means dragging the window narrow
 * once and finding the pane hidden on the big monitor afterwards.
 *
 * The bucket is coarse on purpose. Keying by exact pixels would make every
 * resize a new arrangement with no memory, which is the same as not storing
 * anything; keying by a class of size means the answer is already there the
 * next time a window of that shape opens. The classes are derived from the
 * frame constants in `columns.ts` rather than typed again here, so there is
 * one place that decides what "too narrow for the frame" means.
 */
import { FRAME_MIN_W, FRAME_MIN_H, SIDE_RIGHT_W } from './columns.ts'
import { readJSON, writeJSON } from './storage.ts'

export type ScenePaneState = 'docked' | 'minimap' | 'popped' | 'hidden'

/**
 * The order the one control cycles through.
 *
 * `docked` first so a single press from any other state is never far from
 * the primary panel, `minimap` next as the one step down from it, and
 * `hidden` last so it is never reached by accident on the way somewhere else.
 */
export const SCENE_PANE_STATES: readonly ScenePaneState[] = ['docked', 'minimap', 'popped', 'hidden']

export function nextScenePaneState(now: ScenePaneState): ScenePaneState {
  const i = SCENE_PANE_STATES.indexOf(now)
  return SCENE_PANE_STATES[(i + 1) % SCENE_PANE_STATES.length]
}

/** Above this the window has room for the corner pane and a wide transcript
 * at once; below it the two are competing. Not a mockup number - the width at
 * which `DOCKED_RAIL_W` stops being a large fraction of the window. */
export const WIDE_W = 1600

/**
 * Which stored arrangement a window of this size uses.
 *
 * Three width classes and two height classes, both cut at the frame's own
 * minimums so this cannot disagree with `frameFits` about what is narrow.
 */
export function sizeBucket(width: number, height: number): string {
  const w = width < FRAME_MIN_W ? 'narrow' : width < WIDE_W ? 'standard' : 'wide'
  const h = height < FRAME_MIN_H ? 'short' : 'tall'
  return `${w}-${h}`
}

/**
 * What a window of this size opens with before anybody has chosen.
 *
 * `hidden` on a narrow window, because that is the size at which the pane and
 * a readable transcript genuinely cannot both be had, and the transcript is
 * what makes this a MUD client. `docked` everywhere else - the primary panel,
 * not the small preview - because a corner tile is exactly the "random and
 * broken" default Dan corrected.
 */
export function defaultScenePaneState(width: number, height: number): ScenePaneState {
  return sizeBucket(width, height).startsWith('narrow') ? 'hidden' : 'docked'
}

/**
 * v2: the meaning of a stored `'minimap'` changed today from "the pane, at
 * its only size" to "the pane, deliberately shrunk" - old data under a new
 * meaning (CLAUDE.md section 12). An install that already holds `minimap`
 * from before this change was never asked for the small preview; it just
 * never touched the control. Bumping the key means every existing install
 * re-defaults to `docked` once, the same as a fresh one, rather than quietly
 * inheriting a state whose meaning moved out from under it. A player who
 * really does want the small tile chooses it again - one press.
 */
export const SCENE_PANE_KEY = 'drc.scene-pane.v2'

type Stored = Partial<Record<string, ScenePaneState>>

function isState(value: unknown): value is ScenePaneState {
  return SCENE_PANE_STATES.includes(value as ScenePaneState)
}

export function readScenePaneState(width: number, height: number): ScenePaneState {
  const stored = readJSON<Stored>(SCENE_PANE_KEY, {})
  const found = stored[sizeBucket(width, height)]
  // A stored value that is not one of the four is not a state, and reading it
  // as one would put the pane into a fifth condition nothing renders. Fall
  // back rather than repair: the next write corrects the entry anyway.
  return isState(found) ? found : defaultScenePaneState(width, height)
}

export function writeScenePaneState(width: number, height: number, state: ScenePaneState): void {
  const stored = readJSON<Stored>(SCENE_PANE_KEY, {})
  writeJSON(SCENE_PANE_KEY, { ...stored, [sizeBucket(width, height)]: state })
}

/**
 * The right rail's default width in `docked` - the primary panel, not a
 * corner tile.
 *
 * Dan measured Lane O's `minimap` default at 489px of a 1997px window - 10.2%
 * - beside game text at 52.9%, and called the result "random and broken": a
 * scene pane that small cannot read as "the main window" whatever chrome
 * Godot eventually brings to it. This is a share of the window, not a fixed
 * pixel count, because a fixed pixel default is only ever the right
 * proportion on the screen it was measured on (`columns.ts`'s own reasoning
 * for storing shares, not pixels) - a 480px panel is 40% of a 1180px window
 * and 24% of a 1997px one, and only the share is the number that means the
 * same thing on both. `App.tsx` converts this into the stored share the
 * first time the rail is ever measured, the same way it always has.
 *
 * Chosen so the text still clears `TEXT_WIDTH_FLOOR` (0.55,
 * `tools/play-first-layout-test.mjs`) at every supported size with real
 * margin, while the rail itself is now a genuine panel rather than a
 * preview: at the app's own 1180px default window this leaves the pane about
 * 480px - wider than the old 380px default and, unlike that default, large
 * enough to be the thing Dan asked for. The divider still drags either way -
 * this is a default, not a rule.
 */
export const DOCKED_RAIL_W = 480

/**
 * The right rail's width in `minimap` - the small preview, demoted from
 * being the default rather than deleted.
 *
 * This is Lane O's original `SCENE_RAIL_W`, kept at the same 380px and the
 * same reasoning (wide enough for the scene picture to be worth looking at,
 * narrow enough that the transcript still holds most of the window) - it
 * did not stop being a sound size for a preview the moment it stopped being
 * the default.
 */
export const MINIMAP_RAIL_W = 380

/**
 * What the rail asks for when the pane is not showing itself at full size -
 * `popped` and `hidden`.
 *
 * A display-time ceiling on the player's stored width, exactly like
 * `MAP_EMPTY_WANT` and `combatBattleWant` in `columns.ts`: the preference is
 * never rewritten, so putting the pane back into the corner restores the
 * width they dragged. Without this, hiding the pane would leave a wide
 * column of vitals and give the text nothing back, which is not what
 * "hidden" means to the person who pressed it.
 */
export const COMPACT_RAIL_W = SIDE_RIGHT_W

/**
 * How much wider the corner pane may get during a fight.
 *
 * `combatBattleWant` in `columns.ts` grows the combat surface to 49% of the
 * window, which was right when that surface was a board in the middle. Here
 * it is a corner pane beside the transcript, and a fight is not a reason to
 * stop being able to read the game - measured, the uncapped rule took the
 * rail to 798px of a 1997px window and the text down to 42% of the screen,
 * which is most of the way back to the arrangement this frame replaced.
 *
 * A third wider is a real, visible change and leaves the text about three
 * quarters of the window at every size. The stored preference is untouched
 * either way; this is a display-time request, same as everything else here.
 */
export const COMBAT_GROWTH = 1.3

/**
 * The rail's request at this state, given the width the player stored.
 *
 * `docked` is uncapped - it is the primary panel, and the stored width is
 * exactly what it should draw at. `minimap` is capped at its own, smaller
 * ceiling rather than at `docked`'s width, so choosing the small preview
 * actually shrinks the pane instead of drawing it at whatever the player last
 * dragged `docked` to. `popped`/`hidden` keep the original, smaller ceiling.
 */
export function railWant(state: ScenePaneState, storedPx: number): number {
  if (state === 'docked') return storedPx
  if (state === 'minimap') return Math.min(storedPx, MINIMAP_RAIL_W)
  return Math.min(storedPx, COMPACT_RAIL_W)
}
