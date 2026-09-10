/**
 * What the bridge to Lich is doing, in the words a player needs, decided once.
 *
 * # What was wrong (issue #532)
 *
 * `SafetyFooter` read the transport status itself and folded two of them
 * together:
 *
 *     bridgeStatus === 'reconnecting' || bridgeStatus === 'connecting'
 *       ? 'Bridge reconnecting' + (attempt ? ` ${attempt}/${max}` : '')
 *       : ...
 *
 * `connecting` is the status of the very first dial of the session, so before
 * anybody had signed in - when there is no Lich, and so nothing on the port,
 * and so nothing that has ever been connected - the footer said the bridge had
 * dropped and was dialling again. Measured in the running app on 9 September
 * 2026: an amber chip reading exactly "Bridge reconnecting", no attempt
 * number, indefinitely, on a screen whose own largest sentence is "Sign in
 * below and the app starts Lich for you".
 *
 * Two separate defects sat behind that one chip and this module answers the
 * first: **a state that is not an error was displayed as one**. The second -
 * that the reconnect ladder ran at all before there was ever anything to
 * connect to - is fixed in `realBridge.ts` (`ConnectIntent`), because a phrase
 * chosen here cannot stop a socket dialling.
 *
 * # Why a module and not a few lines in the footer
 *
 * The same argument PR #514 made for `linkPhase` and the game socket. A
 * component that decides for itself what a status means is one opinion per
 * component, and they drift: the footer's fold above is exactly what a second
 * opinion looks like once it is a year old. `tools/bridge-phase-test.mjs`
 * derives the consumer set from the tree and asserts that every component
 * rendering bridge state reads it from here, so a second reading added
 * tomorrow fails rather than merely disagreeing.
 *
 * Type-only imports, for the same reason `bridgeStatus.ts` has them: this must
 * be reachable from a plain `node` test, and one runtime import of the bridge
 * facade would drag in `import.meta.glob` and end that.
 */
import type { BridgeTransportStatus } from '../types'

/**
 * The four things a player can be told, and they are four because folding any
 * two of them loses the answer to "so what do I do".
 */
export type BridgePhase =
  /** Up. Nothing to say. */
  | 'connected'
  /**
   * Not connected, and nothing was lost: no Lich has been reached yet, or the
   * player detached. The action is to sign in, never to wait.
   */
  | 'not-connected'
  /**
   * Dialling, and never connected yet: the startup probe looking for a Lich
   * that is already running, or the run that follows sign-in while Lich boots
   * and binds its port.
   *
   * Separate from `not-connected` because the action differs - wait, versus go
   * and sign in - which is the same argument that separates `reconnecting`
   * from `gave-up`, and the whole reason this issue was not just a wording
   * change. Separate from `reconnecting` because nothing has been lost: saying
   * "reconnecting" here is precisely the lie that was on Dan's screen.
   */
  | 'connecting'
  /**
   * A connection existed and dropped, and a bounded run of re-dials is under
   * way. The action is to wait. Only reachable after a real connection - that
   * is the whole point of `everConnected`.
   */
  | 'reconnecting'
  /**
   * The re-dials are spent and stopped. The action is to start Lich again or
   * attach from Setup, and the count is named so it is clear it stopped rather
   * than is still going.
   */
  | 'gave-up'

/** What the phase is read from. A plain object so a test can state every cell. */
export interface BridgeReading {
  status: BridgeTransportStatus
  attempt: number
  maxAttempts: number
  /** Has a socket ever opened this session. See `RealBridge.getEverConnected`. */
  everConnected: boolean
}

/**
 * The phase, and `everConnected` is the fact that does the work.
 *
 * It cannot be derived from the status, which is why the old fold was wrong
 * rather than merely terse: `disconnected` is what a fresh app, a failed first
 * probe and a deliberate detach all look like, and `connecting` is the first
 * dial of a session as well as the fourth re-dial of a drop. One bit separates
 * them and nothing else does.
 *
 * The demo has no socket, so it has no phase here. `'mock'` reads as connected
 * because that is what it is - a bridge that answers - and the demo banner is
 * what tells the player it is invented. A `'mock'` falling to `not-connected`
 * would put "sign in to start" under a screen full of working data.
 */
export function bridgePhase(r: BridgeReading): BridgePhase {
  if (r.status === 'connected' || r.status === 'mock') return 'connected'
  /*
   * `gave-up` first, and before the `everConnected` test, which is the arm
   * this table got wrong on the first pass.
   *
   * A run that gives up without ever having connected is a real case and the
   * important one: sign-in started a Lich, the app dialled eight times, and
   * Lich never came up. `everConnected` is false throughout. Testing it first
   * folded that into "not connected", which is true and drops the only fact
   * the player needs - that the app tried and has stopped trying, so waiting
   * longer will not help.
   */
  if (r.status === 'gave-up') return 'gave-up'
  if (r.status === 'connecting' || r.status === 'reconnecting') {
    // The one bit that decides which of the two dialling states this is.
    // Before the first open nothing has been lost, whatever the transport is
    // doing at this instant, and calling it a reconnect is the defect.
    return r.everConnected ? 'reconnecting' : 'connecting'
  }
  // `disconnected` either way, and `error` with no dial in flight: a failed
  // probe, a detach, or a fault nobody is retrying. None of them may claim a
  // run is under way - a chip that says reconnecting while nothing is dialling
  // is the permanent spinner this issue was opened about.
  return 'not-connected'
}

/** How loud the chip is. The phase decides, so colour cannot disagree with words. */
export type BridgeTone = 'quiet' | 'warn' | 'danger'

export interface BridgeChip {
  /** The words on the chip, or null when there is nothing worth saying. */
  label: string | null
  tone: BridgeTone
  /** The hover text. Always says what to do, never only what happened. */
  title: string
}

/**
 * The chip, from the phase and nothing else.
 *
 * One function returns label, tone and tooltip together so a relabelled state
 * cannot keep an old colour or an old explanation - the defect the pause chip
 * fixed the same way by deriving its `data-` attribute from the reading that
 * picks its colour.
 *
 * Wording rules this obeys, from the app's own: a player's words, no internal
 * identifiers (`companion_bridge` used to be in the give-up tooltip), no em
 * dashes, and the sentence says what to do. "Lich" rather than "the bridge",
 * because Lich is the thing the player installed and signed into; the bridge
 * is a script inside it that they never asked about.
 */
export function bridgeChip(r: BridgeReading): BridgeChip {
  const phase = bridgePhase(r)
  switch (phase) {
    case 'connected':
      // No chip. A badge that is always on screen is furniture and gets
      // skimmed on the day it changes, which is the same rule the rest of this
      // status row follows.
      return { label: null, tone: 'quiet', title: '' }
    case 'not-connected':
      return {
        label: 'Not connected',
        // Quiet, and this is the point of the whole issue. Amber said
        // something had gone wrong. Nothing has: no character is signed in
        // yet. The chip stays rather than disappearing because a player who
        // has scrolled away from the sign-in screen still needs to know the
        // app is not reading their game.
        tone: 'quiet',
        title:
          'Nothing reaches the game yet. Sign in to start Lich, or attach to one that is already running.',
      }
    case 'connecting':
      return {
        label: 'Connecting to Lich',
        // Quiet, not amber. Looking for a Lich is the ordinary thing this app
        // does at startup and just after sign-in. An alarm colour for it is
        // how "the app is working" came to look like "something is broken".
        tone: 'quiet',
        title: 'Looking for Lich. This takes a few seconds after you sign in.',
      }
    case 'reconnecting':
      return {
        // The attempt count is in the title, not on the chip (9 Sep 2026).
        // It is kept - which rung of the ladder this is on is exactly what a
        // maintainer wants, and `link-reconnect-test.mjs` reads the ladder
        // through the title so the progression is still asserted rung by
        // rung - but "3/8" on a badge in permanent chrome is a retry counter
        // in front of somebody trying to play, and it changes every few
        // seconds. The chip says the fact; the hover says the number.
        label: 'Lich reconnecting',
        tone: 'warn',
        title: `The link to Lich dropped and the app is dialling again. Nothing reaches the game until it is back. Stop your scripts in Lich itself if this is urgent. Attempt ${r.attempt} of ${r.maxAttempts}.`,
      }
    case 'gave-up':
      return {
        label: 'Lich is not answering',
        tone: 'danger',
        title: `The app stopped dialling after ${r.attempt} tries. Start Lich again, or attach to a running one from Setup.`,
      }
  }
}
