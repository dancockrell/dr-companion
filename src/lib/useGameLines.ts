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
import { useMemo, useSyncExternalStore } from 'react'
import {
  gameLines,
  gameStreams,
  gameVersion,
  subscribeGame,
  type GameLine,
} from './gameLink.ts'

/**
 * The whole buffer, newest last, with an identity that changes when it does.
 *
 * Subscribes on your behalf — there is no way to get the array from here
 * without also being subscribed to it, which is the half that kept going
 * wrong.
 */
export function useGameLines(): GameLine[] {
  const version = useSyncExternalStore(subscribeGame, gameVersion, gameVersion)
  // Keyed on the version counter, not on the array: see this file's header.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => gameLines().slice(), [version])
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
