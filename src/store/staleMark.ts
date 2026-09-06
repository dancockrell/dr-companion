/**
 * Whether what is on screen is still being refreshed, in one place.
 *
 * # The defect this closes (issue #506)
 *
 * The two ways the bridge can go away disagreed about the character. A
 * deliberate `disconnectBridge` or a mode switch cleared `character`,
 * `scriptStates` and `runningScripts` on the way out; an unexpected drop -
 * `reconnecting`, `gave-up`, `error` arriving through `onLiveStatus` - changed
 * only the status fields and left every one of those values in the store
 * verbatim. So a deliberate disconnect blanked the panels and an unexpected
 * one left a photograph of the moment before the drop, drawn at full contrast,
 * with nothing on the numbers saying so.
 *
 * `pauseStatus.ts` already refuses to read a latch from a bridge that has gone
 * ("a latch remembered from a bridge that has since gone away is stale, not
 * current"). That reasoning is true of everything else on the same payload and
 * was applied to nothing else.
 *
 * # Why marking rather than clearing
 *
 * Both were on the table and they lose in opposite directions. Clearing throws
 * away a reading that is genuinely useful - the health you had eight seconds
 * ago is the best answer anybody has while the socket is down, and a blank
 * cluster during a reconnect is strictly less than the truth. Leaving it
 * unmarked states it as current, which is a claim rather than a loss. So the
 * value stays and acquires a timestamp, and the panels render it dimmed with
 * its age. A dimmed cluster reading "last known, 12s ago" is information; the
 * same numbers at full contrast are a lie.
 *
 * The deliberate path still clears, and that is not an inconsistency: a
 * detach ends the session, and there is no "last known" for a character
 * nobody is watching any more.
 *
 * # Why the reconnect makes it worse rather than better
 *
 * `gameLink.ts` calls `resetStream()` on `game:reconnected`, deliberately, so
 * the tag parser's accumulated vitals go. `vitals.ts`'s `pick()` then falls
 * back to the bridge's copy for every pool the stream has not re-reported, and
 * `linkReplay.ts` measures Lich's own replay landing up to ten seconds late in
 * DragonRealms (`global_defs.rb:2307`, an indicator DR never sets). So for
 * about ten seconds after a reconnect the health bar is the bridge's
 * last-known value - and if the bridge dropped too, a value from before the
 * drop. The mark is therefore NOT cleared when the socket comes back up. It is
 * cleared when fresh data lands, which is a different and later moment.
 *
 * # Its own module, and no runtime imports
 *
 * Same reason `bridgeStatus.ts` is its own module: `bridgeLifecycle.ts`
 * imports the bridge facade, which reaches the mock bridge, the map data and
 * eventually `import.meta.glob`, so importing it outside Vite fails at load. A
 * decision about whether the app is showing the player a current number is
 * exactly the thing that has to be reachable from a plain `node` test. Nothing
 * here may import a module with a runtime side effect.
 */
import type { BridgeTransportStatus } from '../types'

/** No mark. A number rather than `null` so the store field is never nullable. */
export const FRESH = 0

/**
 * Statuses in which nothing is arriving.
 *
 * A `Record` over the whole union rather than a list of the bad ones, for the
 * reason `bridgeStatus.ts` gives: a status added to the transport tomorrow is
 * a type error here instead of silently landing on whichever side the `else`
 * happened to be - and the side it would have landed on is "fresh", which is
 * the direction that lies.
 *
 * `connecting` counts as arriving-nothing and `mock` does not. The mock has no
 * socket to drop, so its data is as current as it is ever going to be.
 */
const FEEDING: Record<BridgeTransportStatus, boolean> = {
  connected: true,
  mock: true,
  connecting: false,
  reconnecting: false,
  'gave-up': false,
  disconnected: false,
  error: false,
}

/**
 * The mark after a transport status lands.
 *
 * Four rules, and the third is the one worth reading twice:
 *
 *  1. Nothing on screen to be stale (`hasData` false) - no mark. A blank panel
 *     saying "last known, 4s ago" is furniture.
 *  2. Feeding again - the mark is **kept**, not cleared. See the module header:
 *     the socket coming back and fresh data arriving are ten seconds apart in
 *     this game. {@link clearedByFreshData} is what clears it.
 *  3. Already marked - the ORIGINAL timestamp survives. The age being rendered
 *     is the age of the data, so a run of six reconnect attempts must not
 *     reset it to zero six times. Marking on every status transition is how a
 *     forty-second-old reading gets drawn as four seconds old, which is worse
 *     than not marking it at all.
 *  4. Otherwise - marked now.
 */
export function nextStaleSince(input: {
  status: BridgeTransportStatus
  hasData: boolean
  staleSince: number
  now: number
}): number {
  const { status, hasData, staleSince, now } = input
  if (!hasData) return FRESH
  // `?? false`, not `|| false`: the fallback is for a status this build has
  // never heard of, and an unknown status is not feeding.
  if (FEEDING[status] ?? false) return staleSince
  if (staleSince !== FRESH) return staleSince
  return now
}

/**
 * What a payload landing does to the mark: it ends it.
 *
 * A named function of one line rather than a literal `0` at the call sites,
 * so the two places in `bridgeMessageHandler.ts` that clear it are provably
 * the same act as this module's own idea of clearing, and so a grep for the
 * name finds both.
 */
export function clearedByFreshData(): number {
  return FRESH
}

/** Whether anything is marked. */
export function isStale(staleSince: number): boolean {
  return staleSince !== FRESH
}

/**
 * How long the numbers beside this have gone without a refresh.
 *
 * Measured from the mark, not from `characterAt`, and they differ by at most
 * one status tick. The mark is when the feed stopped, which is the thing a
 * player needs: "nothing has updated this for twelve seconds" is true of every
 * field on the payload, where `characterAt` is true only of the character.
 * One meaning for every panel beats a more precise number in one of them.
 *
 * Floored at zero. A clock that moves backwards - and this one is the local
 * wall clock - must not be able to produce "last known, -3s ago".
 */
export function staleAgeSeconds(staleSince: number, now: number): number {
  if (!isStale(staleSince)) return 0
  return Math.max(0, Math.floor((now - staleSince) / 1000))
}

/**
 * The words, in one place so two panels cannot word it differently.
 *
 * Returns `null` when nothing is stale, so a caller with nothing to say says
 * nothing at all rather than rendering an empty badge - same shape as
 * `linkPhaseLabel` in `gameLink.ts`.
 *
 * Short on purpose. This sits beside a number in a 240px rail, and a sentence
 * there wraps to three lines and pushes the thing it is qualifying off screen.
 */
export function staleNote(staleSince: number, now: number): string | null {
  if (!isStale(staleSince)) return null
  return `last known, ${staleAgeSeconds(staleSince, now)}s ago`
}
