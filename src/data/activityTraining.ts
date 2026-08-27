/**
 * Skills that train through a repeated action rather than combat.
 *
 * Issue #11: TrainingPanel's whole model is "go hunt something." That is
 * right for weapon, armor and most magic skills and it is not merely
 * incomplete for the rest — for a Bard at Circle 1 it is the entire
 * mechanic. Performance goes from 0 to 5 ranks in a town street with an
 * instrument out, no creature involved at all.
 *
 * `verb` is the in-game command that actually trains the skill, when it is
 * known and simple enough to say in one word. `null` means the skill is
 * confirmed to train through a non-combat activity but the exact command is
 * not pinned down here — see each entry's `note` for what is and is not
 * verified, and do not fill in a guess. A wrong command sent to a live
 * character is worse than an honest gap.
 */

export interface ActivityTraining {
  skill: string
  verb: string | null
  /** Short, player-facing. What the action is and how sure we are of it. */
  note: string
}

export const ACTIVITY_TRAINED_SKILLS: ActivityTraining[] = [
  {
    skill: 'Performance',
    verb: 'PLAY',
    note: 'Trains by playing music — song and mood, not a fight. See the picker below.',
  },
  {
    skill: 'Outfitting',
    verb: 'CRAFT',
    note: 'Trains through the CRAFT system (Tailoring discipline), not combat. Recipes and stages are per-item — use CRAFT in-game to see what you can make.',
  },
  {
    skill: 'Forging',
    verb: 'CRAFT',
    note: 'Trains through the CRAFT system, not combat. Recipes and stages are per-item — use CRAFT in-game to see what you can make.',
  },
  {
    skill: 'Alchemy',
    verb: 'CRAFT',
    note: 'Trains through the CRAFT system (Remedies discipline), not combat. Recipes and stages are per-item — use CRAFT in-game to see what you can make.',
  },
  {
    skill: 'Enchanting',
    verb: 'CRAFT',
    note: 'Trains through the CRAFT system (Artificing discipline), not combat. Recipes and stages are per-item — use CRAFT in-game to see what you can make.',
  },
  {
    skill: 'Scholarship',
    verb: 'TEACH',
    note: 'Trains by teaching or attending classes (TEACH / LISTEN), not combat — needs another player, so nothing here can start it for you.',
  },
]

const BY_SKILL: Record<string, ActivityTraining> = Object.fromEntries(
  ACTIVITY_TRAINED_SKILLS.map((a) => [a.skill.toLowerCase(), a])
)

export function activityTrainingFor(skillName: string): ActivityTraining | null {
  return BY_SKILL[skillName.toLowerCase()] ?? null
}
