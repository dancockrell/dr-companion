/**
 * Mindstate view: what is worth training right now.
 *
 * Every skill has a 0-34 experience pool. Training a full pool earns nothing,
 * so the useful question is not "which skills do you like" but "which skills
 * have room". This panel answers that from live state.
 * See docs/DOMAIN.md section 1.
 */
import { useMemo, useState } from 'react'
import { Brain, Music } from 'lucide-react'
import { useAppStore, isIntentImplemented } from '../../store/useAppStore'
import {
  MINDSTATE_MAX,
  mindstateLabel,
  suggestTraining,
  nextTrainingTarget,
  urgencyFor,
  type SkillState,
  type TrainingUrgency,
} from '../../data/skills'
import { activityTrainingFor } from '../../data/activityTraining'
import { PLAY_SONGS, PLAY_MOODS, moodDifficulty, buildPlayCommand } from '../../data/performance'

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

/**
 * The PLAY picker (issue #12).
 *
 * Song and mood are the game's own two difficulty axes (see data/performance
 * for the source), not a guess dressed up as a control. Instrument defaults
 * to whatever the character is holding, since a Bard training Performance is
 * playing an instrument by definition — see the Bard preset's held txistu.
 * Nothing is sent until Practice is pressed; this only builds the command.
 */
function PlayPicker({ instrumentGuess }: { instrumentGuess: string }) {
  const requestIntent = useAppStore((s) => s.requestIntent)
  const addLog = useAppStore((s) => s.addLog)
  const bridgeIntents = useAppStore((s) => s.bridgeIntents)
  const [song, setSong] = useState(PLAY_SONGS[0].id)
  const [mood, setMood] = useState('')
  const [instrument, setInstrument] = useState(instrumentGuess)

  const difficulty = mood ? moodDifficulty(mood) : 'neutral'
  // run_macro has no handler in companion_bridge.lic as of this writing (see
  // MOCK_UNIMPLEMENTED_INTENTS in mockBridge.ts, #34) - this button sends
  // literal commands through it, so it is exactly as unreal against a live
  // bridge as Start Training until #34 lands. Gated the same way SafetyFooter
  // and ScriptLauncher gate everything else in #30.
  const macroAvailable = isIntentImplemented(bridgeIntents, 'run_macro')

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border/60 bg-surface px-2.5 py-2">
      <div className="flex gap-1.5">
        <select
          value={song}
          onChange={(e) => setSong(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface-raised px-1.5 py-1 text-xs text-ink"
          title="Song — easiest first"
        >
          {PLAY_SONGS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
              {s.percussionLabel ? ` (${s.percussionLabel} on percussion)` : ''}
            </option>
          ))}
        </select>
        <select
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface-raised px-1.5 py-1 text-xs text-ink"
          title="Mood — off-key/halting are easier, confident/masterful are harder"
        >
          <option value="">(no mood)</option>
          {PLAY_MOODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <input
        value={instrument}
        onChange={(e) => setInstrument(e.target.value)}
        placeholder="Instrument (e.g. lute)"
        className="w-full rounded border border-border bg-surface-raised px-1.5 py-1 text-xs text-ink"
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-xs ${
            difficulty === 'easier'
              ? 'text-good'
              : difficulty === 'harder'
                ? 'text-warn'
                : 'text-ink-faint'
          }`}
        >
          {difficulty === 'easier' && 'Easier than plain'}
          {difficulty === 'harder' && 'Harder than plain'}
          {difficulty === 'neutral' && (mood ? 'No stated effect on difficulty' : ' ')}
        </span>
        <button
          type="button"
          disabled={!instrument.trim() || !macroAvailable}
          title={macroAvailable ? undefined : 'Not yet implemented in the connected bridge.'}
          onClick={() => {
            const cmd = buildPlayCommand(song, mood, instrument)
            addLog(`Practicing: ${cmd}`)
            requestIntent('run_macro', { commands: [cmd] })
          }}
          className="shrink-0 rounded border border-accent/40 bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Practice
        </button>
      </div>
      {!macroAvailable && (
        <p className="text-xs text-warn leading-snug">
          The connected bridge doesn't run commands yet (run_macro isn't implemented) — this builds the
          right command but can't send it until that lands.
        </p>
      )}
    </div>
  )
}

/**
 * The card shown instead of "Start Training" for a skill that trains through
 * a repeated action rather than a fight (issue #11). `start_training` bakes
 * in hunting-ground selection, which has no meaning for a Bard's Performance
 * or a crafter's CRAFT recipes — offering it here would be the same "control
 * that looks live and does something else" defect issue #30 exists to close,
 * just from the other direction.
 */
function ActivityTrainingCard({
  skillName,
  instrumentGuess,
}: {
  skillName: string
  instrumentGuess: string
}) {
  const training = activityTrainingFor(skillName)
  if (!training) return null

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 mb-2">
      <div className="flex items-start gap-2">
        <Music className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-sm text-ink font-medium leading-tight">
            {skillName} trains by {training.verb ?? 'a non-combat action'}, not by fighting
          </div>
          <div className="text-xs text-ink-muted leading-snug">{training.note}</div>
        </div>
      </div>
      {training.verb === 'PLAY' && <PlayPicker instrumentGuess={instrumentGuess} />}
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
  const targetActivity = target ? activityTrainingFor(target.skill.name) : null
  const instrumentGuess = character?.hands?.right ?? character?.hands?.left ?? ''

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

      {target && targetActivity ? (
        <ActivityTrainingCard skillName={target.skill.name} instrumentGuess={instrumentGuess} />
      ) : target ? (
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
