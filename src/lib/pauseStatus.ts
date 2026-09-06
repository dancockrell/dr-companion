/**
 * What Pause is actually holding right now, in three states rather than two.
 *
 * Pause has two halves and they can disagree. The app owns the decision - the
 * Rust lane (`command_gate.rs`) holds every automated command it can see - and
 * the bridge owns the half the lane cannot reach: `map_walk` starts Lich's
 * `go2` inside the Lich process, so a travel click never enters the lane at
 * all. Issue #462 is what happens when only one half knows: the button read
 * "paused" and the character walked across a zone.
 *
 * The bridge now latches Pause itself and reports it back (`pauseLatched`, on
 * `status` and on `hello`, bridge 0.13.0). This is the reader for that field,
 * and the reason it is a pure function in `lib/` is that the interesting part
 * is the classification, not the rendering.
 *
 * # Why three states
 *
 * A boolean here would have to fold "the bridge says it is holding travel too"
 * together with "nothing has confirmed that", and those are exactly the two
 * situations #462 is about. The absent case is not hypothetical either: a
 * bridge older than 0.13.0 does not send the field at all, and a disconnected
 * bridge sends nothing. Same three-state shape as `implementedIntents` and
 * `auth` on the same frame - absent means unknown, and unknown is never
 * rendered as confirmed.
 *
 * The unconfirmed state is deliberately not an error. It is the honest reading
 * of "this app is holding what it can hold, and something that can move your
 * character has not said it heard you", which is a thing a player can act on
 * (press Stop, or update the bridge) in a way that a bare "Paused" is not.
 */

export type PauseState = 'running' | 'paused-confirmed' | 'paused-unconfirmed'

export interface PauseInputs {
  /** Whether this app has paused automation - `flowStop.isAutomationPaused()`. */
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
  if (!inputs.appPaused) {
    return {
      state: 'running',
      label: 'Running',
      detail: 'Automation is not paused.',
    }
  }

  if (inputs.bridgeConnected === true && inputs.bridgePauseLatched === true) {
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
        ? 'Automation is held here, but the bridge has not reported a pause latch. An older bridge (before 0.13.0) does not have one: a tile click could still start a walk. Press Stop if something is moving.'
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
