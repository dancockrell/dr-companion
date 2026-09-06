/**
 * The only way a component should read the game buffer.
 *
 * # Why this file exists rather than a comment
 *
 * `gameLines()` returns the live buffer, and `buffer.push(...)` mutates it in
 * place, so its array reference never changes. Anything comparing that
 * reference — `useSyncExternalStore`'s snapshot check, a `useEffect` dep array,
 * a `useMemo` key — sees "nothing changed" forever. Nothing throws. The
 * subscriber simply never runs again, and the UI looks fine because some
 * *other* subscription usually drags the render along with it.
 *
 * `gameVersion()` was added as the counter to subscribe to instead, with a
 * long comment on it explaining exactly this. **The defect then recurred twice
 * more**, most recently in `GamePane`'s alert-sound effect — in a file that
 * imports `gameVersion` at the top of the very same import statement. Sound
 * carried by highlighted lines never played once, for as long as the feature
 * had existed, and it was found by someone measuring `Audio.play()` calls
 * against a replay fixture rather than by anyone reading the code.
 *
 * Three occurrences with the explanation already written down is the point at
 * which a comment has been proven not to work. A comment on the *producer*
 * cannot reach the person writing a dep array in a consumer, because they are
 * not reading the producer. So:
 *
 * > **The naive thing has to be the correct thing.**
 *
 * These hooks hand back an array whose identity changes exactly when the
 * contents do. `[lines]` in a dep array is now right, `useMemo(..., [lines])`
 * is now right, and there is no longer a trap to remember.
 *
 * # The cost, stated
 *
 * One shallow copy per version bump, per mounted consumer — a copy of
 * pointers, not of lines, recomputed once per render rather than once per
 * line. The buffer is capped at `MAX_LINES` and there are two consumers. This
 * is deliberately paid at the hook boundary rather than inside `gameLink.ts`,
 * so the store keeps its cheap mutable buffer for the reader thread and the
 * copy only happens where React actually needs a stable identity.
 *
 * `tools/gamelines-test.mjs` fails the build if a component imports the raw
 * accessors instead — because a rule that only lives in this comment is the
 * thing that already failed three times.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  gameLines,
  gameStreams,
  gameVersion,
  subscribeGame,
  type GameLine,
} from './gameLink.ts'
import { applyLineRules } from './lineRules.ts'
import { loadPlayerConfig, subscribePlayerConfig } from './playerConfig.ts'
import { readJSON, writeJSON } from './storage.ts'

/**
 * A line as it is shown, which is not always a line as it arrived.
 *
 * Extends `GameLine` rather than replacing it, so every consumer that types
 * its own state as `GameLine[]` keeps compiling and gains the two extra
 * fields only if it asks for them.
 */
export interface DisplayLine extends GameLine {
  /** A gag matched this line. Only ever `true` on a line that is being shown
   *  because "show gagged lines" is on - otherwise it is filtered out. */
  gagged?: boolean
  /** Ids of the substitute and gag rules that fired. */
  matched?: string[]
}

/**
 * Whether hidden lines are shown anyway.
 *
 * A per-listener display preference, in its own key rather than in the rule
 * itself, for the same reason `offClasses.ts` keeps muted classes out of the
 * shared highlight file: someone peeking at what a gag is hiding should not
 * change the config they might later share.
 *
 * This exists because a gag is otherwise the one feature in this client that
 * can make a line the player needed disappear with no way back. The line is
 * always in the buffer; this is the switch that puts it on screen.
 */
const SHOW_GAGGED_KEY = 'drc.show-gagged-lines.v1'
let showGagged: boolean | null = null
const gaggedListeners = new Set<() => void>()

export function showGaggedLines(): boolean {
  if (showGagged === null) showGagged = readJSON<boolean>(SHOW_GAGGED_KEY, false) === true
  return showGagged
}

export function setShowGaggedLines(next: boolean) {
  showGagged = next
  writeJSON(SHOW_GAGGED_KEY, next)
  for (const l of gaggedListeners) l()
}

export function useShowGaggedLines(): boolean {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    gaggedListeners.add(fn)
    return () => {
      gaggedListeners.delete(fn)
    }
  }, [])
  return showGaggedLines()
}

/**
 * What `useGameLines()` returns, without being a hook.
 *
 * Exported so a check can push real lines into the buffer, write real rules
 * into the store, and observe what the game pane would draw - rather than
 * calling `applyLineRules` itself and calling that the same thing. The hook
 * below is this function plus its subscriptions, so there is nothing the two
 * can disagree about.
 */
export function currentGameLines(): DisplayLine[] {
  const { substitutes, gags } = loadPlayerConfig()
  // The empty case is the common one and it must be a genuine no-op: a player
  // with no rules gets the buffer's own objects back, not copies that differ
  // from it in some field nobody thought about.
  if (substitutes.length === 0 && gags.length === 0) return gameLines().slice()

  const show = showGaggedLines()
  const out: DisplayLine[] = []
  for (const line of gameLines()) {
    const result = applyLineRules(line.text, { substitutes, gags })
    if (result.gagged && !show) continue
    if (!result.gagged && result.matched.length === 0) {
      out.push(line)
      continue
    }
    out.push({ ...line, text: result.text, gagged: result.gagged, matched: result.matched })
  }
  return out
}

/**
 * The whole buffer, newest last, with an identity that changes when it does.
 *
 * Subscribes on your behalf — there is no way to get the array from here
 * without also being subscribed to it, which is the half that kept going
 * wrong.
 *
 * **The one place substitutes and gags are applied.** The buffer underneath
 * is untouched; see `lineRules.ts`. Three subscriptions, not one, because a
 * rule change and a toggle change have to re-apply to lines that arrived
 * before them - which is the whole reason the rewrite happens on read.
 */
export function useGameLines(): DisplayLine[] {
  const version = useSyncExternalStore(subscribeGame, gameVersion, gameVersion)
  const [rulesVersion, bumpRules] = useState(0)
  useEffect(() => subscribePlayerConfig(() => bumpRules((n) => n + 1)), [])
  const show = useShowGaggedLines()
  // Keyed on the version counter, not on the array: see this file's header.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => currentGameLines(), [version, rulesVersion, show])
}

/**
 * What `useRawGameLines()` returns, without being a hook.
 *
 * Exported for the same reason `currentGameLines` is: a check that wants to
 * ask what the raw-reading consumers see should call the function they call,
 * rather than writing `gameLines().slice()` out a second time and calling
 * that the same thing.
 */
export function currentRawGameLines(): GameLine[] {
  return gameLines().slice()
}

/**
 * The buffer with no rules applied.
 *
 * Two kinds of consumer need this, and they are not the same kind:
 *
 * - the config panel's preview, whose whole job is to show before and after,
 *   so it needs the before - and the sanctioned hook hands back the after;
 * - **anything that makes a noise or raises an alert** - today that is
 *   `GameSignals`'s alert-sound effect, which read `useGameLines()` until
 *   issue #484. A gag is a display preference and not a delete
 *   (`lineRules.ts`), so hiding a line from the pane must not also silence
 *   the chime somebody bound to it, and a substitute that rewrites the words
 *   a highlight matched must not either. `tools/line-rules-test.mjs` checks
 *   both halves: that a gagged danger line still paints its sound off this
 *   reading, and that every alert-playing component takes this hook rather
 *   than `useGameLines()`.
 *
 * Subscribed exactly like the others, and here rather than in the consumer
 * because `tools/gamelines-test.mjs` says the raw accessors are this file's
 * business and only this file's, which is the rule that stopped the same bug
 * three times.
 */
export function useRawGameLines(): GameLine[] {
  const version = useSyncExternalStore(subscribeGame, gameVersion, gameVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => currentRawGameLines(), [version])
}

/**
 * Which channels have actually been seen.
 *
 * A UI offering channels the game has never produced is guessing; this is the
 * list it is allowed to offer. Subscribed for the same reason as the others —
 * a tab strip built once at mount would never gain the channel that arrives
 * on the first spell cast.
 */
export function useGameStreams(): string[] {
  const version = useSyncExternalStore(subscribeGame, gameVersion, gameVersion)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => gameStreams(), [version])
}
