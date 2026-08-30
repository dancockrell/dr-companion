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
  suggestTraining,
  nextTrainingTarget,
} from '../../data/skills'
import { activityTrainingFor } from '../../data/activityTraining'
import { PLAY_SONGS, PLAY_MOODS, moodDifficulty, buildPlayCommand } from '../../data/performance'

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
    <div className="mt-1.5 space-y-1 rounded-lg border border-border/60 bg-surface px-2 py-1.5">
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
    <div className="rounded-xl border border-accent/30 bg-accent/10 px-2 py-1.5 mb-1.5">
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

// `dense` is accepted and unused: every panel in this dashboard takes it, and
// dropping it from the signature would make this the one that does not. It
// stopped being read when the skill list went - what is left is a single
// recommendation card, which is the same size either way.
export function TrainingPanel({ dense: _dense = false }: { dense?: boolean }) {
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
    /*
     * Two reasons for an empty list, and they need different words.
     *
     * `skillsReady` is false only while DRInfomon's post-login startup is
     * still filling skills in - about a second. The bridge has sent that flag
     * since it was written (companion_bridge.lic:636) and the type has carried
     * it with a comment saying exactly what it is for. Nothing read it, so
     * this panel blamed the bridge either way, and during that window the
     * message below was not merely vague but wrong: the bridge is current, it
     * does report ranks and mindstate, and the data is a second out.
     *
     * Undefined means a bridge or mock predating the field, which the type's
     * own comment says to treat as the old always-ready behaviour rather than
     * as a third state. So only an explicit `false` is the waiting case.
     */
    const waiting = character.skillsReady === false
    return (
      <section className="pb-1.5 shrink-0">
        <h2 className="text-xs font-medium text-ink-faint uppercase tracking-wider mb-1.5">
          Training
        </h2>
        <p className="text-xs text-ink-faint leading-snug rounded-xl border border-border bg-surface-raised px-2 py-1.5">
          {waiting
            ? 'Waiting for skills. DRInfomon fills these in just after login, which takes about a second.'
            : 'No skill data. The Lich bridge reports ranks and mindstate; the mock bridge and older payloads do not carry it.'}
        </p>
      </section>
    )
  }

  const locked = ranked.filter((r) => r.urgency === 'wasted').length

  return (
    <section className="pb-1.5 shrink-0">
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
        <div className="rounded-xl border border-accent/30 bg-accent/10 px-2 py-1.5 mb-1.5 flex items-start gap-2">
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
        <div className="rounded-xl border border-danger/30 bg-danger/10 px-2 py-1.5 mb-1.5 text-xs text-danger leading-snug">
          Every tracked skill is at or near mind lock. Training now earns
          nothing. Rest, run town chores, or wait for the pools to drain.
        </div>
      )}
    </section>
  )
}
