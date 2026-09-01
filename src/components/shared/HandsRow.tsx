/**
 * Who you are and what you are holding.
 *
 * Both of these were already written, correctly, in `CharacterStrip`, which
 * lives in `CharacterHeader.tsx` and is mounted by `AppHeader` — and nothing
 * has ever mounted `AppHeader`. So for the whole life of the project the app
 * has not shown a player what is in their hands, in a game where Genie keeps
 * that permanently on its status bar, and where the original code's own comment
 * says:
 *
 *   > Hands. In a fight this is the question.
 *
 * The comment is right. The feature reached nobody. That is worse than dead
 * code, because the file looks maintained and its reasoning is sound: somebody
 * had the thought, wrote it well, and it never rendered.
 *
 * Race, guild and circle were the same. Their comment notes they were in every
 * status payload and displayed nowhere — fixed, in a component that is not on
 * screen, so still not fixed.
 *
 * This is those two facts moved into the mounted path, which is the whole of
 * what was missing. Everything else `CharacterStrip` drew already had a home:
 * roundtime and situation in `StatusBoard`, location in the map header,
 * activity in `SafetyFooter`, and mode, pin, settings and the connection light
 * in `AppControls`. Checked one at a time before deleting anything, because
 * deleting first would have thrown these two away and read in the log as
 * tidying up.
 */
import type { CharacterStatus } from '../../types'

export function HandsRow({ character }: { character: CharacterStatus | null }) {
  if (!character) return null

  // Kaldar Bard 1. Filtered rather than assumed present: the bridge sends
  // 'unknown' for a guild it could not read, and printing that is worse than
  // printing nothing.
  const who = [character.race, character.guild?.replace(/_/g, ' '), character.circle]
    .filter((x) => x !== undefined && x !== null && x !== '' && x !== 'unknown')
    .join(' ')

  const hands = character.hands

  if (!who && !hands) return null

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      {who && <span className="min-w-0 max-w-36 shrink-[2] truncate capitalize text-ink-muted" title={who}>{who}</span>}
      {hands && (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1 text-ink-faint">
            R <span className="truncate text-ink-muted" title={hands.right ?? 'empty'}>{hands.right ?? 'empty'}</span>
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1 text-ink-faint">
            L <span className="truncate text-ink-muted" title={hands.left ?? 'empty'}>{hands.left ?? 'empty'}</span>
          </span>
        </div>
      )}
    </div>
  )
}
