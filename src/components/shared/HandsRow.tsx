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
    <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs">
      {who && <div className="capitalize text-ink-muted">{who}</div>}

      {/* Shown whenever hands were reported at all, including when both are
          empty.

          An earlier version hid this unless something was held, which made
          "you are holding nothing" look identical to "we have not been told" —
          and empty hands is not a null result, it is the answer to why the
          attack did nothing. Being disarmed is exactly the moment this has to
          be readable. */}
      {hands && (
        <div className="grid grid-cols-[1.25rem_1fr] gap-x-1.5 gap-y-0.5">
          <span className="text-ink-faint">R</span>
          <span className="min-w-0 truncate text-ink-muted" title={hands.right ?? 'empty'}>
            {hands.right ?? <span className="text-ink-faint">empty</span>}
          </span>
          <span className="text-ink-faint">L</span>
          <span className="min-w-0 truncate text-ink-muted" title={hands.left ?? 'empty'}>
            {hands.left ?? <span className="text-ink-faint">empty</span>}
          </span>
        </div>
      )}
    </div>
  )
}
