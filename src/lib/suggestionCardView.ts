/**
 * What the suggestion card should be showing, decided away from React.
 *
 * This exists because of #399, and the shape of that bug is worth keeping in
 * front of whoever edits this next. The card held its refusal sentence in
 * local state with no idea which suggestion it belonged to, and the store
 * settles a suggestion on the two refusals that matter most - expiry, and a
 * state version that moved - so `live()` returned null in the same commit that
 * produced the sentence. The card took its `if (!suggestion) return null` and
 * the explanation was never painted. It was not discarded, though: the
 * component stays mounted, so the string sat in state until the worker
 * proposed something else, and then rendered underneath *that* card, telling a
 * player that a perfectly valid command had been refused.
 *
 * Two rules follow, and they are the whole of this module:
 *
 * 1. **A refusal is shown with the suggestion it refers to.** It carries the
 *    id it was produced for, and nothing renders it beside a different one.
 * 2. **A settled suggestion stays on screen until it is read.** The record the
 *    refusal is about is terminal, not gone, so the card keeps showing it - in
 *    a state that offers no Confirm, because there is nothing left to confirm -
 *    until the player dismisses it or a new suggestion takes the slot.
 *
 * Nothing here decides whether a command may run. That is `aiSuggestions.ts`,
 * every time, and this module cannot reach the store at all: it is handed two
 * records and a string and returns which of them to draw.
 */
import type { Suggestion } from './aiSuggestions.ts'

/** A refusal, and the suggestion it is about. The pairing is the fix: a bare
 * string cannot be checked against anything. */
export interface KeyedRefusal {
  suggestionId: string
  reason: string
}

export type SuggestionCardView =
  /** Nothing to draw. */
  | { kind: 'none' }
  /** A suggestion that can still be acted on. `refusal` is present only for a
   * refusal that did not settle it - a wrong confirmation, a paused client -
   * and only when it names this suggestion. */
  | { kind: 'offer'; suggestion: Suggestion; refusal: string | null }
  /** A suggestion that is over, kept on screen to say why. */
  | { kind: 'settled'; suggestion: Suggestion; refusal: string }

export interface SuggestionCardInput {
  /** `store.live()`. */
  live: Suggestion | null
  /** `store.lastSettled()`. */
  lastSettled: Suggestion | null
  /** What the last Confirm was refused with, and for which suggestion. */
  refusal: KeyedRefusal | null
}

export function suggestionCardView(input: SuggestionCardInput): SuggestionCardView {
  const { live, lastSettled, refusal } = input

  if (live) {
    // A live suggestion always wins the slot, and it clears any earlier
    // refusal by construction: the ids cannot match, because a settled
    // suggestion is not the live one. This is the half of #399 that put one
    // card's red line under another card's command.
    return {
      kind: 'offer',
      suggestion: live,
      refusal: refusal !== null && refusal.suggestionId === live.id ? refusal.reason : null,
    }
  }

  // No live suggestion. The only thing worth drawing is a refusal that names
  // the record it is about and can be shown next to it.
  if (refusal !== null && lastSettled !== null && refusal.suggestionId === lastSettled.id) {
    return { kind: 'settled', suggestion: lastSettled, refusal: refusal.reason }
  }

  return { kind: 'none' }
}
