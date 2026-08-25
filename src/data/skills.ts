/**
 * Skills and mindstate — the core of how DragonRealms training actually works.
 *
 * Every skill has an experience pool ("mindstate") on a 0-34 scale. Field
 * experience fills it; timed pulses drain it into permanent ranks. Training a
 * skill whose pool is already full wastes the experience, so players rotate
 * between skills rather than grinding one.
 *
 * That makes "what should I train?" a question with a real answer, computed
 * from current mindstate rather than chosen from a checkbox list.
 *
 * Skill names, skillset grouping and the mindstate labels are game facts,
 * matching Lich's DR_LEARNING_RATES and DR_SKILLS_DATA so that anything we
 * display lines up with what the player sees in other tools.
 * See docs/DOMAIN.md section 1.
 */

export type SkillSet = 'Armor' | 'Weapon' | 'Magic' | 'Survival' | 'Lore'

export const SKILL_SETS: SkillSet[] = [
  'Weapon',
  'Armor',
  'Magic',
  'Survival',
  'Lore',
]

/** Mindstate 0-34. Index is the value; the label is what the game prints. */
export const MINDSTATE_LABELS = [
  'clear',
  'dabbling',
  'perusing',
  'learning',
  'thoughtful',
  'thinking',
  'considering',
  'pondering',
  'ruminating',
  'concentrating',
  'attentive',
  'deliberative',
  'interested',
  'examining',
  'understanding',
  'absorbing',
  'intrigued',
  'scrutinizing',
  'analyzing',
  'studious',
  'focused',
  'very focused',
  'engaged',
  'very engaged',
  'cogitating',
  'fascinated',
  'captivated',
  'engrossed',
  'riveted',
  'very riveted',
  'rapt',
  'very rapt',
  'enthralled',
  'nearly locked',
  'mind lock',
] as const

export const MINDSTATE_MAX = 34

/** Skills grouped by skillset, matching Lich's DR_SKILLS_DATA. */
export const SKILLS_BY_SET: Record<SkillSet, string[]> = {
  Armor: [
    'Shield Usage',
    'Light Armor',
    'Chain Armor',
    'Brigandine',
    'Plate Armor',
    'Defending',
    'Conviction',
  ],
  Weapon: [
    'Parry Ability',
    'Small Edged',
    'Large Edged',
    'Twohanded Edged',
    'Small Blunt',
    'Large Blunt',
    'Twohanded Blunt',
    'Slings',
    'Bow',
    'Crossbow',
    'Staves',
    'Polearms',
    'Light Thrown',
    'Heavy Thrown',
    'Brawling',
    'Offhand Weapon',
    'Melee Mastery',
    'Missile Mastery',
    'Expertise',
  ],
  Magic: [
    'Primary Magic',
    'Arcana',
    'Attunement',
    'Augmentation',
    'Debilitation',
    'Targeted Magic',
    'Utility',
    'Warding',
    'Sorcery',
    'Astrology',
    'Summoning',
    'Theurgy',
    'Inner Magic',
    'Inner Fire',
    'Lunar Magic',
    'Elemental Magic',
    'Holy Magic',
    'Life Magic',
    'Arcane Magic',
  ],
  Survival: [
    'Evasion',
    'Athletics',
    'Perception',
    'Stealth',
    'Locksmithing',
    'Thievery',
    'First Aid',
    'Outdoorsmanship',
    'Skinning',
    'Instinct',
    'Backstab',
    'Thanatology',
  ],
  Lore: [
    'Alchemy',
    'Appraisal',
    'Enchanting',
    'Engineering',
    'Forging',
    'Outfitting',
    'Performance',
    'Scholarship',
    'Tactics',
    'Empathy',
    'Bardic Lore',
    'Trading',
    'Mechanical Lore',
  ],
}

const SET_BY_SKILL: Record<string, SkillSet> = (() => {
  const out: Record<string, SkillSet> = {}
  for (const set of SKILL_SETS) {
    for (const skill of SKILLS_BY_SET[set]) out[skill.toLowerCase()] = set
  }
  return out
})()

export function skillSetFor(skill: string): SkillSet | null {
  return SET_BY_SKILL[skill.toLowerCase()] ?? null
}

/** One skill's live state, as reported by the bridge from DRSkill. */
export interface SkillState {
  name: string
  ranks: number
  /** 0-34. Higher means the pool is fuller and returns are closer to zero. */
  mindstate: number
  skillset: SkillSet
}

export function clampMindstate(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(MINDSTATE_MAX, Math.round(v)))
}

export function mindstateLabel(v: number): string {
  return MINDSTATE_LABELS[clampMindstate(v)]
}

/** How much pool is left before training this skill is wasted. */
export function headroom(skill: SkillState): number {
  return MINDSTATE_MAX - clampMindstate(skill.mindstate)
}

export function isMindLocked(skill: SkillState): boolean {
  return clampMindstate(skill.mindstate) >= MINDSTATE_MAX
}

/**
 * "Nearly locked" (33) is the point where a player switches. Treat it as
 * saturated for recommendation purposes rather than waiting for a hard 34,
 * since the pool will fill during the time it takes to act.
 */
export const SATURATED_AT = 33

export function isSaturated(skill: SkillState): boolean {
  return clampMindstate(skill.mindstate) >= SATURATED_AT
}

/** Absorbing well: enough headroom that training pays off now. */
export function isAbsorbing(skill: SkillState): boolean {
  return clampMindstate(skill.mindstate) < 25
}

export type TrainingUrgency = 'wasted' | 'poor' | 'fine' | 'ideal'

export function urgencyFor(skill: SkillState): TrainingUrgency {
  const m = clampMindstate(skill.mindstate)
  if (m >= SATURATED_AT) return 'wasted'
  if (m >= 28) return 'poor'
  if (m >= 20) return 'fine'
  return 'ideal'
}

export interface TrainingSuggestion {
  skill: SkillState
  headroom: number
  urgency: TrainingUrgency
  reason: string
}

/**
 * Rank the player's skills by how much they would gain from training right now.
 *
 * Only considers skills the character actually has. `preferred` biases toward
 * skills the player has said they care about, but never recommends a saturated
 * skill over an empty one, because that is the mistake the whole mechanic
 * punishes.
 */
export function suggestTraining(
  skills: SkillState[],
  opts?: { preferred?: string[]; skillsets?: SkillSet[] }
): TrainingSuggestion[] {
  const preferred = new Set((opts?.preferred ?? []).map((s) => s.toLowerCase()))
  const sets = opts?.skillsets

  return skills
    .filter((s) => !sets || sets.includes(s.skillset))
    .map((skill) => {
      const room = headroom(skill)
      const urgency = urgencyFor(skill)
      const isPreferred = preferred.has(skill.name.toLowerCase())

      let reason: string
      if (urgency === 'wasted') {
        reason = `${mindstateLabel(skill.mindstate)} — pool is full, training is wasted`
      } else if (urgency === 'poor') {
        reason = `${mindstateLabel(skill.mindstate)} — nearly full, switch soon`
      } else if (isPreferred) {
        reason = `${mindstateLabel(skill.mindstate)} — room to learn, and one of yours`
      } else {
        reason = `${mindstateLabel(skill.mindstate)} — room to learn`
      }

      return { skill, headroom: room, urgency, reason }
    })
    .sort((a, b) => {
      // Saturated skills always sort last, whatever the preference.
      const aDead = a.urgency === 'wasted'
      const bDead = b.urgency === 'wasted'
      if (aDead !== bDead) return aDead ? 1 : -1

      const aPref = preferred.has(a.skill.name.toLowerCase())
      const bPref = preferred.has(b.skill.name.toLowerCase())
      if (aPref !== bPref) return aPref ? -1 : 1

      return b.headroom - a.headroom
    })
}

/** The single skill to train next, or null if everything is saturated. */
export function nextTrainingTarget(
  skills: SkillState[],
  opts?: { preferred?: string[]; skillsets?: SkillSet[] }
): TrainingSuggestion | null {
  const ranked = suggestTraining(skills, opts)
  return ranked.find((s) => s.urgency !== 'wasted') ?? null
}

/** Highest ranks across a set, used for hunting-band matching. */
export function topRanksIn(skills: SkillState[], set: SkillSet): number {
  return skills
    .filter((s) => s.skillset === set)
    .reduce((max, s) => Math.max(max, s.ranks), 0)
}

export function findSkill(
  skills: SkillState[],
  name: string
): SkillState | null {
  const key = name.toLowerCase()
  return skills.find((s) => s.name.toLowerCase() === key) ?? null
}

export function ranksOf(skills: SkillState[], name: string): number {
  return findSkill(skills, name)?.ranks ?? 0
}

/**
 * Combat-relevant rank estimate for hunting-ground matching.
 *
 * Hunting advice is normally given against weapon and armor ranks rather than
 * a character-wide average, since those are what decide whether a creature can
 * hurt you. Falls back to the best skill available.
 */
export function combatRanks(skills: SkillState[]): number {
  const weapon = topRanksIn(skills, 'Weapon')
  const armor = topRanksIn(skills, 'Armor')
  const magic = topRanksIn(skills, 'Magic')
  const best = Math.max(weapon, magic)
  if (best === 0 && armor === 0) return 0
  // Armor matters but does not carry a hunt on its own.
  return Math.round(best * 0.75 + armor * 0.25)
}
