import { cn } from '../../lib/cn'
import { MINDSTATE_LABELS, SKILL_SETS, type SkillState } from '../../data/skills'

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

/** Mindstate runs 0-34, and 34 means the pool will not take any more. */
const LOCKED = MINDSTATE_LABELS.length - 1

/**
 * One colour, varying only in how much of the cell it covers.
 *
 * The first version ramped through green, amber, orange and red, which made
 * forty cells into a rainbow: every cell lit, nothing standing out, and the
 * names fighting the fill behind them. That is decoration pretending to be
 * information.
 *
 * The signal is emptiness. A pool with room is what you go and train, so a
 * dark cell is the thing worth seeing and the fill is deliberately quiet.
 * Only mind lock gets a colour of its own, because it is the one state that
 * means stop.
 */
function fill(mindstate: number): string {
  return mindstate >= LOCKED ? 'bg-danger/25' : 'bg-ink/10'
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
  const locked = skills.filter((s) => s.mindstate >= LOCKED).length

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
              title={`${s.skillset} — ${s.name}: ${MINDSTATE_LABELS[s.mindstate] ?? s.mindstate} (${s.mindstate}/${LOCKED}), rank ${Math.round(s.ranks)}`}
              className="relative flex items-baseline justify-between gap-1 overflow-hidden rounded-sm px-1 leading-5"
            >
              <span
                className={cn('absolute inset-y-0 left-0', fill(s.mindstate))}
                style={{ width: `${(s.mindstate / LOCKED) * 100}%` }}
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
