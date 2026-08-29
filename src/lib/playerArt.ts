/**
 * A player's own submitted portrait, by character name - referenced from
 * `CombatRadar.tsx` (the "people" deck's own art branch) but never actually
 * built: no submission pipeline, no asset manifest, no directory of
 * pictures anywhere in this repo. Rather than invent a scheme this app does
 * not have, `playerArtFor` honestly returns nothing, which is exactly the
 * "no submitted picture" path `CombatRadar.tsx` already falls through
 * safely - the guessed NPC default, then the lettered placeholder every
 * other person without art already gets. No band-aid pretending the
 * feature exists.
 */

export type PlayerArt = { name: string; url: string }

/** Always empty until a real submission pipeline exists - see this file's
 * own header. */
export function playerArtFor(_name: string): PlayerArt | undefined {
  return undefined
}

/**
 * Called when a submitted picture's URL 404s, so a broken link is not
 * retried on every render. A no-op for now: with `playerArtFor` never
 * returning a URL, nothing here can 404 yet. Kept as a real function
 * (not deleted from the call site) so `CombatRadar.tsx` needs no change
 * the day a real cache is built behind it.
 */
export function notePlayerArtMissing(_name: string): void {}
