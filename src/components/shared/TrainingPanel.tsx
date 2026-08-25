/**
 * Mindstate view: what is worth training right now.
 *
 * Every skill has a 0-34 experience pool. Training a full pool earns nothing,
 * so the useful question is not "which skills do you like" but "which skills
 * have room". This panel answers that from live state.
 * See docs/DOMAIN.md section 1.
 */
import { useMemo } from 'react'
import { Brain } from 'lucide-react'
import { useAppStore } from '../../store/useAppStore'
import {
  MINDSTATE_MAX,
  mindstateLabel,
  suggestTraining,
  nextTrainingTarget,
  urgencyFor,
  type SkillState,
  type TrainingUrgency,
} from '../../data/skills'

const URGENCY_BAR: Record<TrainingUrgency, string> = {
  ideal: 'bg-good',
  fine: 'bg-info',
  poor: 'bg-warn',
  wasted: 'bg-danger',
}

const URGENCY_TEXT: Record<TrainingUrgency, string> = {
  ideal: 'text-good',
  fine: 'text-info',
  poor: 'text-warn',
  wasted: 'text-danger',
}

function SkillRow({ skill, dense }: { skill: SkillState; dense?: boolean }) {
  const urgency = urgencyFor(skill)
  const pct = Math.round((skill.mindstate / MINDSTATE_MAX) * 100)

  return (
    <div className={dense ? 'px-2.5 py-1' : 'px-3 py-1.5'}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-ink truncate">{skill.name}</span>
        <span className="text-ink-faint shrink-0 tabular-nums">
          {skill.ranks}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="h-1.5 flex-1 rounded-full bg-surface overflow-hidden border border-border/40">
          <div
            className={`h-full rounded-full transition-all ${URGENCY_BAR[urgency]}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={`text-xs shrink-0 w-24 text-right ${URGENCY_TEXT[urgency]}`}
        >
          {mindstateLabel(skill.mindstate)}
        </span>
      </div>
    </div>
  )
}

export function TrainingPanel({ dense = false }: { dense?: boolean }) {
  const character = useAppStore((s) => s.character)
  const trainFocus = useAppStore((s) => s.trainFocus)

  // Depend on the array from the store, not on a fresh `?? []` each render,
  // which would give the memo a new reference every time and never cache.
  const rawSkills = character?.skills

  const ranked = useMemo(
    () => suggestTraining(rawSkills ?? [], { preferred: trainFocus }),
    [rawSkills, trainFocus]
  )
  const target = useMemo(
    () => nextTrainingTarget(rawSkills ?? [], { preferred: trainFocus }),
    [rawSkills, trainFocus]
  )
  const skills = rawSkills ?? []

  if (!character) return null

  if (skills.length === 0) {
    return (
      <section className="px-4 pb-2 shrink-0">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5">
          Training
        </h2>
        <p className="text-xs text-ink-faint leading-snug rounded-xl border border-border bg-surface-raised px-3 py-2">
          No skill data. The Lich bridge reports ranks and mindstate; the mock
          bridge and older payloads do not carry it.
        </p>
      </section>
    )
  }

  const locked = ranked.filter((r) => r.urgency === 'wasted').length

  return (
    <section className="px-4 pb-2 shrink-0">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider">
          Training
        </h2>
        {locked > 0 && (
          <span className="text-xs text-danger">
            {locked} at mind lock
          </span>
        )}
      </div>

      {target ? (
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 mb-2 flex items-start gap-2">
          <Brain className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm text-ink font-medium leading-tight">
              Train {target.skill.name}
            </div>
            <div className="text-xs text-ink-muted leading-snug">
              {target.reason}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 mb-2 text-xs text-danger leading-snug">
          Every tracked skill is at or near mind lock. Training now earns
          nothing. Rest, run town chores, or wait for the pools to drain.
        </div>
      )}

      <div
        className={`rounded-xl border border-border bg-surface-raised divide-y divide-border overflow-y-auto ${
          dense ? 'max-h-32' : 'max-h-44'
        }`}
      >
        {ranked.map((r) => (
          <SkillRow key={r.skill.name} skill={r.skill} dense={dense} />
        ))}
      </div>
    </section>
  )
}
