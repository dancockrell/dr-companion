/**
 * The frontend half of the presentation bridge's intent path: what happens
 * after Godot asks to do something and Rust has already decided it is legal.
 *
 * `presentation_bridge.rs`'s own module doc specifies this half exactly - "a
 * `walk` intent that passes validation is not executed here either - it is
 * forwarded to the frontend as a `presentation:intent` event, so the existing
 * command pipeline (`requestGameAction`, movement parsing, autowalk) is what
 * actually sends the game command." Rust emitted that event from four call
 * sites and nothing in this app listened to any of them, so a click on an
 * exit in the viewer got `intent_accepted` back on the socket - which reads
 * as "this worked" - and the character never moved. The accept was true
 * about the only thing Rust can speak for (the exit is real and current) and
 * false about the thing the player actually cares about.
 *
 * # Why this is allowed to send a game command at all
 *
 * Three checks stand in front of it, and none of them is this file:
 *
 * 1. The exit string is not free text. `validate_walk` (Rust) refuses any
 *    `exitMove` that is not one of the exits of the current room *in the
 *    snapshot this app itself compiled and published*, so what arrives here
 *    is always one of the app's own strings, echoed back.
 * 2. The socket is token-authenticated loopback (`bridge_token.rs`'s threat
 *    model), so it is not open to anything that has not read the token file.
 * 3. `requestGameAction` re-validates client-side anyway
 *    (`validateGameActionCommand`: printable ASCII only, so no separators, no
 *    control or format characters and nothing that renders as something other
 *    than itself; non-empty; length-capped) rather than trusting steps 1 and 2.
 *
 * The re-validation in 3 is deliberate duplication. Rust guarantees the
 * string came from a snapshot; it does not guarantee the snapshot's own exit
 * strings are safe to send, and those come from parsed game text.
 *
 * The decision itself (`gameCommandForIntent`) lives in `presentationBridge.ts`
 * beside this bridge's other pure decisions, so it stays testable without a
 * Tauri event loop. This file is only the wiring.
 */
import { gameCommandForIntent, travelTargetForIntent } from './presentationBridge.ts'
import type { PresentationIntentEvent } from './presentationTypes.ts'
import { requestGameAction } from './gameActions.ts'
import { bridge } from '../bridge/index.ts'
import { listenTauri } from './tauri.ts'
import { isAutomationPaused } from './flowStop.ts'
import { PAUSED_TRAVEL_REFUSAL } from './pauseStatus.ts'

/**
 * Wires the event to the command pipeline. Returns an unsubscribe function.
 *
 * Call from the main window only. A popped-out window shares the same Tauri
 * event bus, so every listening window would send the same command and one
 * click would walk the character several rooms - the same reason
 * `usePresentationBridgePublisher` takes an `enabled` flag instead of being
 * called conditionally.
 */
export function subscribePresentationIntents(
  /**
   * Where a refusal is reported. The app passes the store's `addLog`, so a
   * player who clicks a tile while paused reads the reason in the log instead
   * of watching a button do nothing. Defaults to the console so a caller
   * without a store - and every test - still gets the sentence somewhere.
   */
  report: (line: string) => void = (line) => console.info(line)
): () => void {
  return listenTauri<PresentationIntentEvent>('presentation:intent', (event) => {
    const intent = event ?? {}

    // A click on a distant tile. Not a game command - `map_walk` is a bridge
    // intent, and the bridge script decides whether it can be honoured (Stop
    // latched, no map database, no route, `go2` already running). Sent through
    // the same `bridge.requestIntent` the map panel's own click uses rather
    // than a second surface of its own.
    const travelTo = travelTargetForIntent(intent)
    if (travelTo !== null) {
      // Refused here, before the intent leaves this process, when the player
      // has paused automation. The bridge refuses it too (#462 put a Pause
      // latch beside its Stop latch, and that is the check that matters when
      // an older client or another window skips this one) - this half exists
      // so the app can say *why* without a round trip, in the bridge's own
      // words. A viewer tile click is a button, and a button that silently
      // does nothing is the failure #462 is about wearing the other face.
      if (isAutomationPaused()) {
        report(PAUSED_TRAVEL_REFUSAL)
        return
      }
      bridge.requestIntent('map_walk', { to: travelTo })
      return
    }

    const action = gameCommandForIntent(intent)
    if (!action) return
    requestGameAction(action.command, action.label, 'ui-action')
  })
}
