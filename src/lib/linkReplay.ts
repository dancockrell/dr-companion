/**
 * After a reconnect, go and get the state Lich does not replay.
 *
 * # What Lich does replay, and why it is not enough
 *
 * A detachable client that reconnects gets a fresh accept, and every accept
 * runs `detachable_client_send_init` on its own thread
 * (`global_defs.rb:2357-2361`). So the replay does come back on its own, and
 * this app is in the branch that receives it: the suppression is a raw ARGV
 * match on the Genie and Saga frontend flags, not a test of `$frontend`, and
 * this app passes neither (`src-tauri/src/lich.rs`). Measured against the installed
 * Lich 5.20.1; see `docs/LICH_NATIVE_LOGIN.md` §4 and §7.
 *
 * Two things make that insufficient, and both were read out of the source
 * rather than guessed:
 *
 * **It is late.** The replay's first statement is
 * `100.times { sleep 0.1; break if XMLData.indicator['IconJOINED'] }`
 * (`global_defs.rb:2307`), and `IconJOINED` is a GemStone indicator - every
 * setter in Lich's tree is under `lib/gemstone/`, and the generic path only
 * sets it if the game sends that id (`common/xmlparser.rb:789`). DragonRealms
 * does not. So in DR the loop always runs its full course and the dump lands
 * ten seconds after the socket comes back, behind ten seconds of live text.
 * This is the most likely reason PR #454's 22-second attach never saw it.
 *
 * **It is partial.** It is assembled from `XMLData`, not a buffer of the bytes
 * that were missed: four `<progressBar>`, `<spell>`, seven `<indicator>`,
 * `<compass>`. The hands/wounds/stance/mindstate block is gated behind
 * `XMLData.game =~ /GS/` and never arrives in DragonRealms at all. Room title,
 * room description, `<component id='room objs'>`/`'room players'`, `<prompt>`,
 * roundtime and the script list are **not in it**.
 *
 * **And it cannot be asked for.** The detachable read loop understands two
 * out-of-band verbs - `SET_FRONTEND_PID` and an exit command
 * (`global_defs.rb:2363-2379`) - and treats every other line as player input.
 * `detachable_client_send_init` has one caller in the whole tree, and it is
 * the accept. There is no request path, so "ask Lich again" is not an option
 * that exists; sending anything hoping for one would put a stray command into
 * the game.
 *
 * So the half Lich will not replay is synthesised from the bridge instead. The
 * companion bridge's `status` payload carries room, occupants, scripts,
 * roundtime and activity, the app already receives it on 7415, and asking for
 * one costs a single `get_status` frame.
 *
 * # Why this is its own module
 *
 * `gameLink.ts` owns the game socket and the tag parser and deliberately knows
 * nothing about the bridge. Reaching into the bridge from in there would put
 * two transports in one module; reaching into the game link from the bridge
 * would do the same thing the other way. This subscribes to one and calls the
 * other, which is the shape `bridgePauseRelay.ts` already uses for Pause, and
 * for the same reason: one sender, in one place, that a future caller cannot
 * forget.
 */
import { onGameReconnect } from './gameLink.ts'
import { bridge } from '../bridge/index.ts'

let installed: (() => void) | null = null

/**
 * Subscribe the bridge's state request to the game link's reconnect edge.
 * Returns the unsubscribe function; calling it twice does not subscribe twice.
 *
 * Installed once per window from `main.tsx`, same as the pause relay: every
 * window shares the Tauri event bus but not this module instance, and a
 * duplicate `get_status` is harmless where a missing one leaves a whole
 * window's panels showing the previous session.
 */
export function installLinkReplay(): () => void {
  if (installed) return installed

  const off = onGameReconnect(() => {
    // Fire-and-forget by design. `RealBridge.send` already reports a closed
    // socket to its own listeners, and a reconnect of the *game* link says
    // nothing about whether the *bridge* is up - the two drop independently.
    // Throwing here would take down the reconnect handler on the one path
    // where both are down at once, which is when it is needed most.
    bridge.send({ type: 'get_status' })
  })

  installed = () => {
    off()
    installed = null
  }
  return installed
}
