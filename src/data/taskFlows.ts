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
  /**
   * Only run this step while the condition holds — a gauge percent
   * (`health<50`), a situation flag (`bleeding`), either negated (`!spirit>80`,
   * `!stunned`). Unset means unconditional, same as before this existed.
   * See lib/flowConditions.ts for the grammar and why it fails open.
   */
  condition?: string
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
      // The first real use of a step condition: tending a fresh kill's
      // corpse when there is nothing bleeding just spends a command doing
      // nothing. `bleeding` is a live situation flag the bridge already
      // reports every tick, so this is real state, not a guess.
      { label: 'Tending', commands: ['tend my worst'], condition: 'bleeding' },
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

/**
 * What the last `loadCustomFlows()` had to throw away, and why.
 *
 * A guard that silently returns fewer flows than were saved is the failure
 * this whole codebase keeps finding: the player sees a flow missing from the
 * list and has no way to learn it was rejected rather than never saved. Read
 * by TaskFlowPanel and put in the log.
 */
let loadNote: string | null = null

/** Null when the last load took everything it found. */
export function customFlowNote(): string | null {
  return loadNote
}

/**
 * Where the line is drawn between repairing and rejecting.
 *
 * **Repair what cannot reach the game; reject what can.** A missing `title` is
 * a caption, and substituting one costs nothing and loses nothing. A malformed
 * `commands` is a decision about what this app types into a live character's
 * session, and guessing at that is not a repair, it is an invention.
 *
 * The case that fixes the line in place: `commands` holding a bare string
 * rather than an array. It throws nothing, produces no empties, and looks
 * entirely healthy from outside — and it puts an unintended command on the
 * wire. It was scored as *passing* by the harness that found it, because that
 * harness was checking for exceptions and empty strings rather than asking
 * whether what went out was what the player meant.
 */
function validFlow(f: unknown): TaskFlow | string {
  if (typeof f !== 'object' || f === null) return 'not an object'
  const o = f as Record<string, unknown>

  const id = typeof o.id === 'string' && o.id.trim() ? o.id : null
  if (!id) return 'no id'

  if (!Array.isArray(o.steps)) return `"${id}": steps is not a list`
  if (o.steps.length === 0) return `"${id}": no steps`

  const steps: FlowStep[] = []
  for (const [i, raw] of o.steps.entries()) {
    if (typeof raw !== 'object' || raw === null) return `"${id}": step ${i + 1} is not an object`
    const s = raw as Record<string, unknown>

    // The whole reason this function exists. A string here is iterable and
    // truthy, so every cheaper check waves it through.
    if (!Array.isArray(s.commands)) return `"${id}": step ${i + 1} commands is not a list`

    const commands = s.commands.filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0
    )
    if (commands.length !== s.commands.length) {
      return `"${id}": step ${i + 1} has a command that is blank or not text`
    }
    if (commands.length === 0) return `"${id}": step ${i + 1} sends nothing`

    // Cosmetic, so repaired rather than rejected - see this function's note.
    const label = typeof s.label === 'string' && s.label.trim() ? s.label : `Step ${i + 1}`
    const settle =
      typeof s.settle === 'number' && Number.isFinite(s.settle) && s.settle >= 0
        ? s.settle
        : undefined
    // Also cosmetic in the sense that matters here: a malformed condition
    // string already evaluates to "always run" (see flowConditions.ts's
    // fail-open rule), so dropping a non-string value changes nothing about
    // what reaches the game — it only removes a gate that could not have
    // gated anything.
    const condition = typeof s.condition === 'string' && s.condition.trim() ? s.condition : undefined

    steps.push({ label, commands, ...(settle !== undefined && { settle }), ...(condition && { condition }) })
  }

  return {
    id,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : id,
    summary: typeof o.summary === 'string' ? o.summary : '',
    steps,
    loops: o.loops === true,
    custom: true,
  }
}

/**
 * The player's own flows, kept beside the built-ins rather than replacing them.
 *
 * Everything here came out of `localStorage`, which is to say out of whatever
 * a previous version of this app wrote, whatever a player hand-edited, and
 * whatever a future import-a-flow feature accepts. It was previously trusted
 * on `Array.isArray` alone, and a flow with no `steps` threw straight out of
 * `driver.start()` - which is called from an onClick, so the result was a dead
 * panel rather than a logged failure.
 *
 * Bad flows are dropped individually rather than failing the whole load: one
 * corrupt entry must not cost a player the other six.
 */
export function loadCustomFlows(): TaskFlow[] {
  loadNote = null
  let parsed: unknown
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    parsed = JSON.parse(raw)
  } catch {
    loadNote = 'Saved flows could not be read and were not loaded.'
    return []
  }

  if (!Array.isArray(parsed)) {
    loadNote = 'Saved flows were not a list and were not loaded.'
    return []
  }

  const good: TaskFlow[] = []
  const bad: string[] = []
  for (const f of parsed) {
    const r = validFlow(f)
    if (typeof r === 'string') bad.push(r)
    else good.push(r)
  }

  if (bad.length) {
    loadNote = `${bad.length} saved flow${bad.length === 1 ? '' : 's'} could not be loaded: ${bad.join('; ')}`
  }
  return good
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
