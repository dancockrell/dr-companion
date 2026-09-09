/**
 * The visual pane's three states, and where it remembers them.
 *
 * Dan, 9 September 2026: *"the godot screen should include the map and the
 * ability to easily put it into mini map mode or pop it out into a big map,
 * nice interface"*, and *"it's not best to put the screen in the middle ...
 * put it in the right corner"*.
 *
 * So the pane has three states and exactly one control that moves between
 * them:
 *
 *   `minimap`  small, in the top right corner of the workspace, beside the
 *              text rather than instead of it;
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

export type ScenePaneState = 'minimap' | 'popped' | 'hidden'

/**
 * The order the one control cycles through.
 *
 * `minimap` first so a single press from any state is never far from the one
 * that shows the pane, and `hidden` last so it is never reached by accident
 * on the way somewhere else.
 */
export const SCENE_PANE_STATES: readonly ScenePaneState[] = ['minimap', 'popped', 'hidden']

export function nextScenePaneState(now: ScenePaneState): ScenePaneState {
  const i = SCENE_PANE_STATES.indexOf(now)
  return SCENE_PANE_STATES[(i + 1) % SCENE_PANE_STATES.length]
}

/** Above this the window has room for the corner pane and a wide transcript
 * at once; below it the two are competing. Not a mockup number - the width at
 * which `SCENE_RAIL_W` stops being a large fraction of the window. */
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
 * what makes this a MUD client. `minimap` everywhere else.
 */
export function defaultScenePaneState(width: number, height: number): ScenePaneState {
  return sizeBucket(width, height).startsWith('narrow') ? 'hidden' : 'minimap'
}

export const SCENE_PANE_KEY = 'drc.scene-pane.v1'

type Stored = Partial<Record<string, ScenePaneState>>

function isState(value: unknown): value is ScenePaneState {
  return SCENE_PANE_STATES.includes(value as ScenePaneState)
}

export function readScenePaneState(width: number, height: number): ScenePaneState {
  const stored = readJSON<Stored>(SCENE_PANE_KEY, {})
  const found = stored[sizeBucket(width, height)]
  // A stored value that is not one of the three is not a state, and reading it
  // as one would put the pane into a fourth condition nothing renders. Fall
  // back rather than repair: the next write corrects the entry anyway.
  return isState(found) ? found : defaultScenePaneState(width, height)
}

export function writeScenePaneState(width: number, height: number, state: ScenePaneState): void {
  const stored = readJSON<Stored>(SCENE_PANE_KEY, {})
  writeJSON(SCENE_PANE_KEY, { ...stored, [sizeBucket(width, height)]: state })
}

/**
 * The right rail's default width when it is holding the corner pane.
 *
 * Wide enough for the scene picture to be worth looking at and narrow enough
 * that the transcript still holds most of the window: at Dan's 1997px this
 * leaves the text about 1600px, and at 1366px about 980px, both well above
 * `ROOM_MIN`. It is a default, not a rule - the divider still drags.
 */
export const SCENE_RAIL_W = 380

/**
 * What the rail asks for when the pane is not in it.
 *
 * A display-time ceiling on the player's stored width, exactly like
 * `MAP_EMPTY_WANT` and `combatBattleWant` in `columns.ts`: the preference is
 * never rewritten, so putting the pane back into the corner restores the
 * width they dragged. Without this, hiding the pane would leave a 380px
 * column of vitals and give the text nothing back, which is not what "hidden"
 * means to the person who pressed it.
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

/** The rail's request at this state, given the width the player stored. */
export function railWant(state: ScenePaneState, storedPx: number): number {
  return state === 'minimap' ? storedPx : Math.min(storedPx, COMPACT_RAIL_W)
}
