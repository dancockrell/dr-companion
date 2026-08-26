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

function fill(mindstate: number): string {
  const share = mindstate / LOCKED
  if (mindstate >= LOCKED) return 'bg-danger/70'
  if (share >= 0.75) return 'bg-warn/60'
  if (share >= 0.4) return 'bg-accent/45'
  if (share > 0) return 'bg-good/40'
  return 'bg-surface-overlay'
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

  return (
    <div className="flex flex-col gap-2">
      {/* The two counts that decide what to do next. Locked first only because
          it is the one that costs you if ignored. */}
      <div className="flex items-baseline gap-3 text-xs">
        {locked > 0 && (
          <span className="text-danger">{locked} at mind lock</span>
        )}
        <span className="text-good">{room} with room</span>
      </div>

      {SKILL_SETS.map((set) => {
        const inSet = skills.filter((s) => s.skillset === set)
        if (!inSet.length) return null

        return (
          <div key={set} className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-ink-faint">{set}</span>
            <div
              className={cn(
                'grid gap-1',
                dense
                  ? '[grid-template-columns:repeat(auto-fill,minmax(--spacing(24),1fr))]'
                  : '[grid-template-columns:repeat(auto-fill,minmax(--spacing(28),1fr))]'
              )}
            >
              {inSet.map((s) => {
                const atLock = s.mindstate >= LOCKED
                return (
                  <div
                    key={s.name}
                    title={`${s.name}: ${MINDSTATE_LABELS[s.mindstate] ?? s.mindstate} (${s.mindstate}/${LOCKED}), rank ${Math.round(s.ranks)}`}
                    className={cn(
                      'relative overflow-hidden rounded-sm px-1.5 py-1',
                      atLock ? 'ring-1 ring-danger/60' : 'ring-1 ring-border'
                    )}
                  >
                    {/* The pool, drawn as how much of the cell is spent. */}
                    <span
                      className={cn('absolute inset-y-0 left-0', fill(s.mindstate))}
                      style={{ width: `${(s.mindstate / LOCKED) * 100}%` }}
                    />
                    <span className="relative flex items-baseline justify-between gap-1">
                      <span className="truncate text-xs text-ink">{s.name}</span>
                      <span
                        className={cn(
                          'shrink-0 text-xs tabular-nums',
                          atLock ? 'text-danger' : 'text-ink-muted'
                        )}
                      >
                        {s.mindstate}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
