/**
 * What Pause is actually holding right now, as all four cells of a two-by-two.
 *
 * # Who owns "paused"
 *
 * The bridge does. That is a correction, and it is the whole of issue #487.
 *
 * This file used to say "the app owns the decision and the bridge reports
 * whether it heard it", and wrote that asymmetry into the code: `pauseStatus`
 * asked "is *this window* paused?" first and consulted the bridge only to
 * qualify a pause the app already believed in. Two things follow from that
 * ordering, and both were shipped:
 *
 *   * `flowStop`'s flag is a module local in one window's module graph. The
 *     bridge's latch is a Ruby module ivar in a process that outlives every
 *     app restart, and nothing clears it on client disconnect. Press Pause,
 *     relaunch: the bridge is still refusing travel and the chip said
 *     "Running", because `appPaused` was false and the bridge's answer could
 *     not be reached.
 *   * the app cannot make the bridge's answer true. `map_walk` starts `go2`
 *     inside Lich; a Lich script or a person at the `;` prompt can pause and
 *     unpause it with the app never hearing. An owner that cannot enforce its
 *     own decision is not the owner - it is a client with an opinion.
 *
 * So the bridge is the owner and this app is the mirror: `bridgePauseRelay.ts`
 * adopts `status.pauseLatched` on connect, and the app's Pause button sends the
 * intent and waits for the status to confirm rather than declaring victory.
 * The bridge, for its part, no longer answers this question from a flag alone -
 * it reconciles the latch against the scripts it suspended, so a `;unpause go2`
 * lowers it within one poll (`reconcile_pause!`, bridge 0.14.0).
 *
 * # Why four cells and not a boolean, and not three
 *
 * Two independent facts come in - did this app ask for a pause, and is the
 * bridge holding one - so there are four combinations, and every one of them
 * happens. The previous three-state reading named three of them and folded the
 * fourth (bridge holding, app did not ask) into `running`, which rendered no
 * chip at all while travel was being refused: the player got a bare refusal
 * sentence with nothing on screen explaining it, and no hint that Resume was
 * the way out. A reader that collapses a cell is the same defect as a boolean,
 * one cell later.
 *
 *   appAsked | bridgeLatched | state              | what it means
 *   ---------+---------------+--------------------+----------------------------
 *   false    | false/absent  | running            | nothing is held
 *   true     | true          | paused-confirmed   | both halves are holding
 *   true     | false/absent  | paused-unconfirmed | this app is holding what it
 *            |               |                    | can; the half that walks
 *            |               |                    | the character has not said
 *            |               |                    | it heard
 *   false    | true          | paused-by-bridge   | Lich is holding travel,
 *            |               |                    | macros and script starts;
 *            |               |                    | this app did not ask for it
 *
 * `undefined` for the latch stays a real third answer for that input, not a
 * `false`: a bridge older than 0.13.0 does not send the field, and a
 * disconnected bridge sends nothing. Unknown must never read as confirmed -
 * same shape as `implementedIntents` and `auth` on the same frame.
 *
 * The unconfirmed state is deliberately not an error. It is the honest reading
 * of "this app is holding what it can hold, and something that can move your
 * character has not said it heard you", which is a thing a player can act on
 * (press Stop, or update the bridge) in a way that a bare "Paused" is not.
 */

export type PauseState =
  | 'running'
  | 'paused-confirmed'
  | 'paused-unconfirmed'
  | 'paused-by-bridge'

export interface PauseInputs {
  /**
   * Whether *this app* asked for a pause - `flowStop.isAutomationPaused()`.
   *
   * Named `appPaused` for the callers that already read it, but it is a
   * request, not the answer: the field below is the answer. See the header.
   */
  appPaused: boolean
  /** Whether the bridge socket is up at all. */
  bridgeConnected?: boolean
  /**
   * The bridge's own latch, from `status.pauseLatched`. `undefined` is a real
   * answer - a bridge that predates the field - and must not read as `false`
   * meaning "it told us no".
   */
  bridgePauseLatched?: boolean
}

export interface PauseReading {
  state: PauseState
  /** Short enough for a footer chip. */
  label: string
  /** Why, in one sentence, for a tooltip. */
  detail: string
}

export function pauseStatus(inputs: PauseInputs): PauseReading {
  // The bridge's answer is only an answer while the socket is up. A latch
  // remembered from a bridge that has since gone away is stale, not current.
  const bridgeLatched = inputs.bridgeConnected === true && inputs.bridgePauseLatched === true

  if (!inputs.appPaused) {
    if (bridgeLatched) {
      return {
        state: 'paused-by-bridge',
        label: 'Paused by Lich',
        detail:
          'The bridge is holding travel, macros and script starts - this app did not ask for that, so something else did: another window, or a Pause from before this app restarted. Press Resume to lift it.',
      }
    }
    return {
      state: 'running',
      label: 'Running',
      detail: 'Automation is not paused.',
    }
  }

  if (bridgeLatched) {
    return {
      state: 'paused-confirmed',
      label: 'Paused, bridge confirmed',
      detail:
        'Automation is held here and the bridge has latched Pause too, so a travel click or a script start is refused rather than run.',
    }
  }

  return {
    state: 'paused-unconfirmed',
    label: 'Paused, bridge did not confirm',
    detail:
      inputs.bridgeConnected === true
        ? // Two causes, and the old wording named only one of them - it told the
          // player to update a bridge that may be perfectly current. A bridge at
          // 0.14.0 reports `false` here when a `;unpause` on the Lich side
          // lifted the pause it was holding, which is a different situation with
          // a different remedy, and the old sentence sent that player looking
          // for a download.
          'Automation is held here, but the bridge is not holding a pause: either something unpaused it in Lich, or the bridge predates the latch (before 0.13.0). Either way a tile click could still start a walk - press Stop if something is moving.'
        : 'Automation is held here. The bridge is not connected, so nothing has confirmed that Lich-side travel and scripts are held.',
  }
}

/**
 * The one sentence the app refuses a travel click with while paused.
 *
 * Shared with `presentationIntents.ts` so the refusal a player sees before the
 * intent leaves this process reads the same as the bridge's own
 * (`PAUSE_HELD['map_walk']` in `companion_bridge.lic`). Two places produce this
 * refusal - the app, so it can say why without a round trip, and the bridge, so
 * a client that skipped the check is still held - and they must not have two
 * different vocabularies for one state.
 */
export const PAUSED_TRAVEL_REFUSAL = 'Paused - press Resume before travelling.'
