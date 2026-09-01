/**
 * What you are holding, in the room header where it matters in a fight.
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
 * Race, guild and circle belong in character/skills information, not beside a
 * room name. "Gor'Tog Barbarian 18" is not a tactical status and consumes the
 * exact line that needs to keep both hands readable. Everything else
 * `CharacterStrip` drew already had a home:
 * roundtime and situation in `StatusBoard`, location in the map header,
 * activity in `SafetyFooter`, and mode, pin, settings and the connection light
 * in `AppControls`. Checked one at a time before deleting anything, because
 * deleting first would have thrown these two away and read in the log as
 * tidying up.
 */
import type { CharacterStatus } from '../../types'

export function HandsRow({ character }: { character: CharacterStatus | null }) {
  if (!character) return null

  const hands = character.hands

  if (!hands) return null

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1 text-ink-faint">
          R <span className="truncate text-ink-muted" title={hands.right ?? 'empty'}>{hands.right ?? 'empty'}</span>
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1 text-ink-faint">
          L <span className="truncate text-ink-muted" title={hands.left ?? 'empty'}>{hands.left ?? 'empty'}</span>
        </span>
      </div>
    </div>
  )
}
