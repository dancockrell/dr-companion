import { cn } from '../../lib/cn'
import { MINDSTATE_LABELS, MINDSTATE_MAX, SKILL_SETS, isMindLocked, type SkillState } from '../../data/skills'

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
 * `skills.ts` already exports as `MINDSTATE_MAX` and checks via
 * `isMindLocked` - a second implementation of the one number this whole
 * board is organized around, found while settling issue #73.
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
 */
const BANDS: Array<{ upTo: number; fill: string; why: string }> = [
  { upTo: 2, fill: '#8b5cf6', why: 'nearly empty, about to fall out of mindstate' },
  { upTo: 6, fill: '#6366f1', why: 'low' },
  { upTo: 12, fill: '#3b82f6', why: 'filling' },
  { upTo: 20, fill: '#22c55e', why: 'absorbing well' },
  { upTo: 26, fill: '#eab308', why: 'getting full' },
  { upTo: 30, fill: '#f97316', why: 'close to lock' },
  { upTo: 33, fill: '#ef4444', why: 'nearly locked' },
  { upTo: 34, fill: '#dc2626', why: 'mind lock, further training is wasted' },
]

function band(mindstate: number) {
  return BANDS.find((b) => mindstate <= b.upTo) ?? BANDS[BANDS.length - 1]
}

export function MindstateBoard({
  skills,
  dense = false,
}: {
  skills: SkillState[]
  dense?: boolean
}) {
  if (!skills.length) {
    return <p className="text-sm text-ink-faint">No skills reported yet.</p>
  }

  const room = skills.filter((s) => s.mindstate < LOCKED * 0.4).length
  const locked = skills.filter(isMindLocked).length

  // Sorted by skillset so related skills sit together, but with no header
  // rows. Five headings cost five lines and pushed Survival and Lore out of
  // the box, which defeated the only thing the board is for: seeing every
  // pool at once. The set is in the tooltip, and clustering carries it
  // visually for anyone who already knows the order.
  const ordered = SKILL_SETS.flatMap((set) => skills.filter((s) => s.skillset === set))

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 items-baseline gap-3 text-xs">
        {locked > 0 && <span className="text-danger">{locked} at mind lock</span>}
        <span className="text-good">{room} with room</span>
      </div>

      <div
        className={cn(
          'grid gap-x-1.5 gap-y-1',
          dense
            ? '[grid-template-columns:repeat(auto-fill,minmax(--spacing(26),1fr))]'
            : '[grid-template-columns:repeat(auto-fill,minmax(--spacing(30),1fr))]'
        )}
      >
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
