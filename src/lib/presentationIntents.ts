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
 *    (`validateGameActionCommand`: no separators, no control characters,
 *    non-empty, length-capped) rather than trusting steps 1 and 2.
 *
 * The re-validation in 3 is deliberate duplication. Rust guarantees the
 * string came from a snapshot; it does not guarantee the snapshot's own exit
 * strings are safe to send, and those come from parsed game text.
 *
 * The decision itself (`gameCommandForIntent`) lives in `presentationBridge.ts`
 * beside this bridge's other pure decisions, so it stays testable without a
 * Tauri event loop. This file is only the wiring.
 */
import { gameCommandForIntent } from './presentationBridge.ts'
import type { PresentationIntentEvent } from './presentationTypes.ts'
import { requestGameAction } from './gameActions.ts'
import { listenTauri } from './tauri.ts'

/**
 * Wires the event to the command pipeline. Returns an unsubscribe function.
 *
 * Call from the main window only. A popped-out window shares the same Tauri
 * event bus, so every listening window would send the same command and one
 * click would walk the character several rooms - the same reason
 * `usePresentationBridgePublisher` takes an `enabled` flag instead of being
 * called conditionally.
 */
export function subscribePresentationIntents(): () => void {
  return listenTauri<PresentationIntentEvent>('presentation:intent', (event) => {
    const action = gameCommandForIntent(event ?? {})
    if (!action) return
    requestGameAction(action.command, action.label)
  })
}
