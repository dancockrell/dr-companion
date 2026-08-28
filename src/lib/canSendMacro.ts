/**
 * Whether a macro can be sent right now, and if not, what to tell the player.
 *
 * A predicate rather than a condition inlined into JSX, because keyboard
 * macros are being built in parallel and will need the same answer. A rule
 * that lives in one component has to be reimplemented by the second caller,
 * and two implementations of "can I send" is how they drift.
 *
 * # Why the reason is returned, not just the boolean
 *
 * The defect this exists to fix is not that a blocked macro runs - the bridge
 * already refuses it correctly, with `ok: false` and "stopped — press Resume".
 * The defect is that the button looks exactly as available as it did a second
 * earlier, so the player learns the rule by pressing and being refused.
 *
 * A bare `false` would let a caller disable the button and say nothing, which
 * is the same failure wearing a different coat: a control that is dead for
 * reasons the screen never gives. So the reason comes back with the verdict
 * and callers are expected to show it.
 */

export interface MacroSendState {
  /** False when a macro must not be sent right now. */
  canSend: boolean
  /**
   * Why not, in words meant for the player, or null when it can send.
   *
   * Phrased as the way out rather than the diagnosis - "press Resume" beats
   * "stop is latched", because the second tells somebody what is wrong and
   * leaves them to work out what to do about it.
   */
  reason: string | null
}

export function canSendMacro(opts: {
  /**
   * The bridge's stop latch. `undefined` means a bridge that predates the
   * field, and `false` is the correct read for one - see `stopLatched`'s doc
   * comment on CharacterStatus. Deliberately not treated as a third
   * "unknown" state: an older bridge behaves exactly as an unlatched one, so
   * an extra branch would describe nothing that happens.
   */
  stopLatched?: boolean
  /** A macro this app sent is still outstanding. */
  inFlight?: boolean
  /** No character at all - nothing to send to. */
  connected?: boolean
}): MacroSendState {
  if (opts.connected === false) {
    return { canSend: false, reason: 'Not connected to a character.' }
  }

  // Checked before in-flight on purpose. Both can be true at once - press a
  // macro, then press Stop while it is still outstanding - and the latch is
  // the one that needs a deliberate action to clear. Reporting "still
  // running" there would send somebody to wait for something that Resume is
  // actually required to release.
  if (opts.stopLatched === true) {
    return { canSend: false, reason: 'Stopped — press Resume first.' }
  }

  if (opts.inFlight === true) {
    return { canSend: false, reason: 'A macro is still running.' }
  }

  return { canSend: true, reason: null }
}
