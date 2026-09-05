import { cn } from '../../lib/cn.ts'
import { MINDSTATE_LABELS, MINDSTATE_MAX, SKILL_SETS, type SkillState } from '../../data/skills.ts'

/**
 * Every skill at once, read for where there is room.
 *
 * This is the board the game is actually about. Reaching the cap takes about a
 * year of continuous scripting, a competent script keeps forty-odd skills in
 * rotation, and the only decision that repeats all year is *which pool has
 * room*. Training a skill whose mindstate is already full throws the
 * experience away.
 *
 * So the board is deliberately inverted against normal progress-bar thinking.
 * A full bar is not an achievement here, it is a warning: that pool is done
 * absorbing and training it now is wasted time. What the eye should catch is
 * the **dark** cells, because those are the ones worth going and filling.
 *
 * Everything fits without scrolling. Forty cells in a grid is a glance; forty
 * rows in a list is a search, and a companion you have to search is one you
 * look away from the game to use.
 */

/**
 * Mindstate runs 0-34, and 34 means the pool will not take any more.
 *
 * Was re-derived here as `MINDSTATE_LABELS.length - 1`, the same value
 * `skills.ts` already exports as `MINDSTATE_MAX` - a second implementation
 * of the one number this whole board is organized around, found while
 * settling issue #73.
 */
const LOCKED = MINDSTATE_MAX

/**
 * Mindstate as a spectrum, violet through red.
 *
 * The first version used one flat colour, which was a reaction to an earlier
 * four-step ramp that looked like a rainbow and meant nothing. Flat was the
 * wrong correction. Mindstate is an ordered scale with **two different
 * failures at opposite ends**, and a spectrum is exactly the right tool for
 * that:
 *
 *   - **Violet, near zero.** The pool is nearly empty and about to fall out of
 *     mindstate. Whatever is training this skill is about to stop earning from
 *     it, and the fix is to keep going or come back to it.
 *   - **Red, at 34.** Mind lock. The pool will not take any more and every
 *     further pulse into it is thrown away. The fix is to train something else.
 *
 * Those are opposite problems and they must not look alike. Everything between
 * is the healthy middle, where the skill is absorbing and needs no decision.
 *
 * Position in the spectrum carries the number as well, so the board can be read
 * without reading: a wash of green is a character training well, a scatter of
 * red is an hour being wasted.
 *
 * The eight stops used to be Tailwind's default violet-500 through red-600,
 * which is the "raw framework palette color" `--color-magic` in `index.css`
 * was added to stop: a saturated web rainbow in a window whose whole palette
 * is warm and aged. They are the app's own semantic colours now, and the
 * spectrum survives the swap because the app's colours are already ordered the
 * same way - magic, info, good, warn, danger is violet through red.
 *
 * The two stops with no token are genuine intermediates rather than missing
 * colours, so they are mixed from their neighbours instead of becoming two
 * near-duplicate tokens nobody else would ever use. Mind lock is a darkened
 * danger for the same reason: it has to read as worse than "nearly locked",
 * and that is a step along one colour, not a ninth colour.
 *
 * Measured in the running app, as the eight bands actually composite - 32%
 * over `--color-surface`, which is what a reader sees rather than what the
 * values say. Adjacent steps come out 10, 11, 30, 33, 10, 9, 22 against the
 * old ramp's 13, 16, 54, 70, 21, 22, 15. Two things in that worth knowing:
 *
 *   - the amber-to-red half is compressed, because `--color-warn` and
 *     `--color-danger` sit close together in a palette this warm. Both mixes
 *     are 50/50 for that reason - it is the split that makes the two halves
 *     of each gap as equal as they can be, checked at 50/40/30/25/20.
 *   - the step that got *bigger* is the last one, nearly-locked to mind lock,
 *     15 to 22. That is the one boundary this board exists to make
 *     unmissable, and Tailwind's red-500 to red-600 was the weakest step in
 *     the whole old ramp.
 */
const BANDS: Array<{ upTo: number; fill: string; why: string }> = [
  { upTo: 2, fill: 'var(--color-magic)', why: 'nearly empty, about to fall out of mindstate' },
  { upTo: 6, fill: 'color-mix(in srgb, var(--color-magic) 50%, var(--color-info))', why: 'low' },
  { upTo: 12, fill: 'var(--color-info)', why: 'filling' },
  { upTo: 20, fill: 'var(--color-good)', why: 'absorbing well' },
  { upTo: 26, fill: 'var(--color-warn)', why: 'getting full' },
  { upTo: 30, fill: 'color-mix(in srgb, var(--color-warn) 50%, var(--color-danger))', why: 'close to lock' },
  { upTo: 33, fill: 'var(--color-danger)', why: 'nearly locked' },
  {
    upTo: 34,
    fill: 'color-mix(in srgb, var(--color-danger) 72%, black)',
    why: 'mind lock, further training is wasted',
  },
]

function band(mindstate: number) {
  return BANDS.find((b) => mindstate <= b.upTo) ?? BANDS[BANDS.length - 1]
}

// `dense` is accepted and unused, same as TrainingPanel/ActionsPanel — its
// only live caller (ExperienceStrip.tsx) never passes it, and the panel
// densities it used to pick between (auto-fill grid vs a tighter one) are
// both gone now that the board is a single fixed column always. The dead
// dashboard tree (DashboardLayout.tsx, panels.tsx) still passes it, so the
// prop stays rather than becoming a type error in an already-orphaned file.
export function MindstateBoard({
  skills,
  dense: _dense = false,
}: {
  skills: SkillState[]
  dense?: boolean
}) {
  if (!skills.length) {
    return <p className="text-sm text-ink-faint">No skills reported yet.</p>
  }

  // Sorted by skillset so related skills sit together, but with no header
  // rows. Five headings cost five lines and pushed Survival and Lore out of
  // the box, which defeated the only thing the board is for: seeing every
  // pool at once. The set is in the tooltip, and clustering carries it
  // visually for anyone who already knows the order.
  const ordered = SKILL_SETS.flatMap((set) => skills.filter((s) => s.skillset === set))

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      {/* One column, always — not a grid that reflows into two or three
          depending on how much width the pane happens to have. This board
          reads top-to-bottom by skillset order (see `ordered` above); a
          multi-column wrap broke that order visually; a fixed single
          column keeps the reading order matching the layout order. */}
      <div className="flex flex-col gap-y-1">
        {ordered.map((s) => {
          const atLock = s.mindstate >= LOCKED
          return (
            <div
              key={s.name}
              title={`${s.skillset} — ${s.name}: ${MINDSTATE_LABELS[s.mindstate] ?? s.mindstate} (${s.mindstate}/${LOCKED}), rank ${Math.round(s.ranks)}
${band(s.mindstate).why}`}
              className="relative flex items-baseline justify-between gap-1 overflow-hidden rounded-sm px-1 leading-5"
            >
              <span
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${(s.mindstate / LOCKED) * 100}%`,
                  background: band(s.mindstate).fill,
                  // Low enough that the skill name reads over it. The band is
                  // the signal; the text is still the content.
                  opacity: 0.32,
                }}
              />
              <span className="relative truncate text-xs text-ink">{s.name}</span>
              <span
                className={cn(
                  'relative shrink-0 text-xs tabular-nums',
                  atLock ? 'text-danger' : 'text-ink-muted'
                )}
              >
                {s.mindstate}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
