/**
 * Task flows: the sequences a player runs over and over.
 *
 * A macro is one press and one thing happens. A flow is the shape of an
 * actual session — kill, loot, skin, tend, do it again — and that shape is
 * what a player is really asking for when they say they want the loop
 * automated. Between the two sits everything that made the Activities panel
 * useless: a single Start button that says "combat loop" and then owns the
 * character until you press Stop, with nothing on screen saying which part of
 * the loop it is in or why it is taking so long.
 *
 * So a flow is explicit. It is a list of steps you can read before you press
 * it, it says which step it is on while it runs, and every step is commands
 * you could have typed yourself. Nothing here reaches into a third-party
 * script; each step goes out through the same `run_macro` intent the macro bar
 * uses, which means the bridge waits out roundtime, refuses when it cannot
 * run, and Stop kills it.
 *
 * Every command below appears in macros.ts, which is to say every one has
 * already been used against the live game rather than invented here.
 */

export interface FlowStep {
  /** Shown while this step runs. Written as the thing happening, not a label. */
  label: string
  /** Sent verbatim, in order. */
  commands: string[]
  /**
   * Seconds to wait after the commands go out, before the next step.
   *
   * The bridge already waits out roundtime, so this is not for that. It is for
   * the cases where the game needs a beat and gives no roundtime — walking
   * through a door, a shopkeeper's reply — where firing the next step
   * immediately gets it eaten.
   */
  settle?: number
}

export interface TaskFlow {
  id: string
  title: string
  /** One line, shown under the title. Says what it does and where it stops. */
  summary: string
  steps: FlowStep[]
  /**
   * Repeat the whole flow until stopped.
   *
   * The hunting loop is the reason flows exist and it is inherently endless,
   * but an endless flow has to be obvious rather than a surprise: this drives
   * a visible marker on the button, so nobody presses "Town run" expecting it
   * to end and gets a loop.
   */
  loops?: boolean
  /** True for flows the player wrote. Built-ins cannot be deleted. */
  custom?: boolean
}

/**
 * The defaults.
 *
 * Chosen as the things a player does in a session rather than the things that
 * demo well. Each one ends somewhere sensible, and the two that never end say
 * so.
 */
export const DEFAULT_FLOWS: TaskFlow[] = [
  {
    id: 'hunt',
    title: 'Hunt cycle',
    summary: 'Attack, loot, skin, tend. Repeats until you stop it.',
    loops: true,
    steps: [
      { label: 'Attacking', commands: ['attack'] },
      { label: 'Looting', commands: ['get all', 'get coins'], settle: 1 },
      { label: 'Skinning', commands: ['skin'], settle: 1 },
      { label: 'Tending', commands: ['tend my worst'] },
    ],
  },
  {
    id: 'ambush-cycle',
    title: 'Ambush cycle',
    summary: 'Hidden opener, then loot and re-hide. Repeats until you stop it.',
    loops: true,
    steps: [
      { label: 'Setting the stance', commands: ['stance offensive'] },
      { label: 'Ambushing', commands: ['ambush'] },
      { label: 'Looting', commands: ['get all', 'get coins'], settle: 1 },
      { label: 'Back to guarded', commands: ['stance guarded'] },
    ],
  },
  {
    id: 'recover',
    title: 'Recover',
    summary: 'Check the damage, tend the worst of it, then rest. Ends when rested.',
    steps: [
      { label: 'Reading the damage', commands: ['diagnose'], settle: 1 },
      { label: 'Tending the worst', commands: ['tend my worst'] },
      { label: 'Guarded stance', commands: ['stance guarded'] },
      { label: 'Resting', commands: ['sleep'], settle: 2 },
    ],
  },
  {
    id: 'to-healer',
    title: 'Go to a healer',
    summary: 'Stow what you are holding, walk to the healer, and show the damage.',
    steps: [
      { label: 'Stowing', commands: ['stow all'], settle: 1 },
      { label: 'Walking to the healer', commands: ['go healer'], settle: 3 },
      { label: 'Showing the damage', commands: ['diagnose'] },
    ],
  },
  {
    id: 'town-run',
    title: 'Town run',
    summary: 'Bank the coins, check your wealth, then back to somewhere safe.',
    steps: [
      { label: 'Stowing', commands: ['stow all'], settle: 1 },
      { label: 'Walking to the bank', commands: ['go bank'], settle: 3 },
      { label: 'Counting it', commands: ['wealth'], settle: 1 },
      { label: 'Somewhere safe', commands: ['go safe'], settle: 3 },
    ],
  },
  {
    id: 'prep',
    title: 'Prepare to fight',
    summary: 'Refresh, harness, and set an offensive stance. Ends ready.',
    steps: [
      { label: 'Checking what is up', commands: ['spells'], settle: 1 },
      { label: 'Refreshing', commands: ['spell refresh'], settle: 2 },
      { label: 'Harnessing', commands: ['harness 20'], settle: 1 },
      { label: 'Offensive stance', commands: ['stance offensive'] },
    ],
  },
  {
    id: 'disengage',
    title: 'Break off',
    summary: 'Defensive, retreat, then flee. For when the fight has gone wrong.',
    steps: [
      { label: 'Defensive stance', commands: ['stance defensive'] },
      { label: 'Retreating', commands: ['retreat'], settle: 1 },
      { label: 'Fleeing', commands: ['flee'], settle: 1 },
      { label: 'Checking the damage', commands: ['health'] },
    ],
  },
  {
    id: 'status',
    title: 'Full status',
    summary: 'Experience, skills, health and what you are carrying. Reads nothing to the game.',
    steps: [
      { label: 'Experience', commands: ['exp'], settle: 1 },
      { label: 'Skills', commands: ['skills'], settle: 1 },
      { label: 'Health', commands: ['health'], settle: 1 },
      { label: 'Inventory', commands: ['inventory'] },
    ],
  },
]

const KEY = 'drc.flows.v1'

/** The player's own flows, kept beside the built-ins rather than replacing them. */
export function loadCustomFlows(): TaskFlow[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TaskFlow[]
    return Array.isArray(parsed) ? parsed.map((f) => ({ ...f, custom: true })) : []
  } catch {
    return []
  }
}

export function saveCustomFlows(flows: TaskFlow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(flows.filter((f) => f.custom)))
  } catch {
    // Private mode. Losing a custom flow is not worth an error dialog.
  }
}

export const allFlows = (custom: TaskFlow[]): TaskFlow[] => [...DEFAULT_FLOWS, ...custom]

/**
 * A blank flow to start editing from.
 *
 * Seeded with one step rather than none, because an empty list gives the
 * editor nothing to render and the player nothing to copy.
 */
export function newFlow(id: string): TaskFlow {
  return {
    id,
    title: 'New flow',
    summary: '',
    custom: true,
    steps: [{ label: 'Step one', commands: ['look'] }],
  }
}
