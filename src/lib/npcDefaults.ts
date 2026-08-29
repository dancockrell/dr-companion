/**
 * A guessed default portrait for a named NPC (a shopkeeper, a guard, a clan
 * member) by role and gender - referenced from `CombatRadar.tsx`'s "people"
 * deck art fallback but never actually built: no wiki-researched name list,
 * no default-art directory, neither committed anywhere in this repo.
 *
 * Rather than invent a name list this app has no real source for - the
 * comment at the CombatRadar.tsx call site is explicit that the guess is
 * meant to come from research, not a guess of a guess - `npcRoleGuessFor`
 * honestly matches nothing, so the fallback chain there lands on the
 * lettered placeholder every unrecognised person already gets. That is the
 * correct behaviour for "not built yet," not a bug to paper over with
 * fabricated data.
 */

export type NpcRoleGuess = { role: string; gender: string }
export type NpcDefaultArt = { url: string }

/** Always empty until a real, sourced name/role list exists - see this
 * file's own header. */
export function npcRoleGuessFor(_name: string): NpcRoleGuess | undefined {
  return undefined
}

/** Always empty until real default art exists for each role/gender - see
 * this file's own header. Never reached while `npcRoleGuessFor` returns
 * nothing, but kept as a real function so the call site needs no change
 * the day this is actually built. */
export function npcDefaultFor(
  _role: string,
  _gender: string,
  _name: string
): NpcDefaultArt | undefined {
  return undefined
}
