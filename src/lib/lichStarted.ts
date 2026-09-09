/**
 * One announcement: a Lich now exists that this app expects to talk to.
 *
 * # Why this exists (issue #532)
 *
 * The bridge used to dial eight times over two minutes from the app's mount
 * effect, whatever was or was not running. That was wrong for the reason the
 * issue is about - it labelled a connection that had never existed as one that
 * had dropped - and removing it exposes something the ladder had been covering
 * up by accident: **nothing in the app ever told the bridge that a Lich had
 * started.** Sign-in worked only because one of those eight blind re-dials
 * happened to land after Lich bound its port. Take the ladder away and sign-in
 * would connect nothing at all.
 *
 * So the trigger has to be real rather than incidental. This is it, and it is
 * one channel with one subscriber:
 *
 *   - `lichLogin.launchCharacter` publishes, because that is the single
 *     function every sign-in goes through to start a Lich;
 *   - `LichLauncher` publishes after `launch_lich` returns;
 *   - `App` subscribes once and reconnects the bridge with `'expect-lich'`,
 *     which is the intent that earns the bounded ladder - Lich takes a few
 *     seconds to bind its port, so this connect genuinely does need re-dials.
 *
 * # Why a module rather than a call in each screen
 *
 * The publishers are libraries and the subscriber is the app root, so neither
 * end has to import the other, and no screen holds an opinion about what
 * starting a Lich means for the bridge. That matters here more than usual: the
 * sign-in screen is being rewritten in a parallel lane, and a `connectBridge()`
 * dropped into `SignIn.tsx` would be rewritten away with it. `launchCharacter`
 * survives, because a rewritten screen still has to call it to start a Lich.
 *
 * Same shape as `onGameReconnect` in `gameLink.ts` - an edge with subscribers,
 * not a value anyone polls.
 *
 * No imports, deliberately. This has to be reachable from `sign-in-test.mjs`
 * and every other plain `node` suite, and one runtime import of the store or
 * the bridge facade would end that.
 */

type Handler = (lich: LichStarted) => void

export interface LichStarted {
  /**
   * The detachable-client port Lich was started with, where the publisher
   * knows it. `null` from routes that do not learn one, which is a real answer
   * and not a reason to guess 11024 - guessing a port is what `lichAttachOffer`
   * exists to have stopped doing.
   */
  port: number | null
  /** Which route started it, for the log line. Never shown to a player. */
  via: 'sign-in' | 'launcher'
}

const handlers = new Set<Handler>()

/**
 * Say that a Lich has been started and the bridge should expect it.
 *
 * Publishing is not the same as the Lich being ready: it has spawned, and it
 * binds its port some seconds later. That gap is exactly why the connect this
 * triggers is the laddered one, and why this does not wait or poll - waiting
 * here would put a second timing model beside the transport's own.
 */
export function notifyLichStarted(lich: LichStarted): void {
  // A copy, so a handler that unsubscribes itself while being called cannot
  // mutate the set mid-iteration.
  for (const fn of [...handlers]) fn(lich)
}

/** Subscribe. Returns the unsubscribe, as everything else in this app does. */
export function onLichStarted(fn: Handler): () => void {
  handlers.add(fn)
  return () => {
    handlers.delete(fn)
  }
}

/** How many subscribers there are. For tests: a channel nobody reads is the
 * absence this app has shipped before, and a count is what catches it. */
export function lichStartedSubscriberCount(): number {
  return handlers.size
}
