/**
 * Whether a flow step's condition currently holds — the "big deal" workflow
 * feature: a step that only runs when the character is actually in the state
 * it was written for, the same shape as `coordinator.lic`'s `start_on`/
 * `stop_on` predicates (DESIGN.md §2.2), scaled down to what a player can
 * type in one line rather than a YAML block.
 *
 * A grammar with two shapes:
 *   health<50        a gauge (health/spirit/fatigue/mana) as a PERCENT of
 *                     its max, compared with <  >  <=  >=
 *   bleeding         a bare situation flag, present or not
 *   !bleeding        negated, either shape
 *
 * Percent rather than the raw number, because a raw health number means
 * nothing without knowing the character's max, and the whole point is a
 * condition a player can write once and reuse across characters and levels.
 *
 * Fails open on purpose, in both places it can fail: an unknown gauge name
 * or a reading with no data yet (not connected, or the first tick has not
 * landed) evaluates true, same as no condition at all. A workflow feature
 * that silently stalled a step because of a typo or a slow connection would
 * be worse than one that occasionally runs a step it should have skipped —
 * the player is watching the flow's own progress line and can always press
 * Stop, but a flow stuck forever on an unmet condition looks identical to a
 * hang.
 */
import type { CharacterStatus } from '../types'

export interface ConditionContext {
  healthPct: number | null
  spiritPct: number | null
  fatiguePct: number | null
  manaPct: number | null
  situation: ReadonlySet<string>
}

const EMPTY_CONTEXT: ConditionContext = {
  healthPct: null,
  spiritPct: null,
  fatiguePct: null,
  manaPct: null,
  situation: new Set(),
}

function pct(value: number | undefined, max: number | undefined): number | null {
  if (typeof value !== 'number' || typeof max !== 'number' || max <= 0) return null
  return (value / max) * 100
}

/** Build the context a condition is checked against, from live character state. */
export function contextFromCharacter(character: CharacterStatus | null): ConditionContext {
  if (!character) return EMPTY_CONTEXT
  return {
    healthPct: pct(character.vitals.health, character.vitals.healthMax),
    spiritPct: pct(character.vitals.spirit, character.vitals.spiritMax),
    fatiguePct: pct(character.vitals.fatigue, character.vitals.fatigueMax),
    manaPct: pct(character.vitals.mana, character.vitals.manaMax),
    situation: new Set(character.situation),
  }
}

const GAUGES: Record<string, (ctx: ConditionContext) => number | null> = {
  health: (c) => c.healthPct,
  spirit: (c) => c.spiritPct,
  fatigue: (c) => c.fatiguePct,
  mana: (c) => c.manaPct,
}

const COMPARISON = /^(\w+)\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)$/

/** The gauges a slider can drive. Order is display order in the editor. */
export const GAUGE_NAMES = ['health', 'spirit', 'fatigue', 'mana'] as const
export type GaugeName = (typeof GAUGE_NAMES)[number]
export type ComparisonOp = '<' | '>' | '<=' | '>='

export interface GaugeCondition {
  negate: boolean
  gauge: GaugeName
  op: ComparisonOp
  /** A percent of max, 0-100 — see the module comment on why percent. */
  value: number
}

/**
 * The other half of the same grammar `evaluateCondition` parses, exposed so
 * the editor can offer a slider instead of a text box for the shape that has
 * a natural dial — a situation flag like `bleeding` does not.
 *
 * Deliberately reuses `COMPARISON` and `GAUGE_NAMES` rather than a second
 * regex: a condition the slider can build must be exactly one the evaluator
 * can read back, or dragging the slider and typing the same value would mean
 * two different things.
 */
export function parseGaugeCondition(condition: string | undefined): GaugeCondition | null {
  if (!condition) return null
  const trimmed = condition.trim()
  const negate = trimmed.startsWith('!')
  const body = (negate ? trimmed.slice(1) : trimmed).trim()
  const match = body.match(COMPARISON)
  if (!match) return null
  const [, name, op, numText] = match
  const gauge = GAUGE_NAMES.find((g) => g === name.toLowerCase())
  if (!gauge) return null
  return { negate, gauge, op: op as ComparisonOp, value: Number(numText) }
}

export function formatGaugeCondition(g: GaugeCondition): string {
  return `${g.negate ? '!' : ''}${g.gauge}${g.op}${g.value}`
}

/**
 * `undefined` (no condition at all) is not the same input as an condition
 * string that happens to fail open — both return `true`, but only one of
 * them is "unconditional" for display purposes. See `describeCondition`.
 */
export function evaluateCondition(condition: string | undefined, ctx: ConditionContext): boolean {
  if (!condition) return true
  const trimmed = condition.trim()
  if (!trimmed) return true

  const negate = trimmed.startsWith('!')
  const body = (negate ? trimmed.slice(1) : trimmed).trim()

  const match = body.match(COMPARISON)
  let result: boolean
  if (match) {
    const [, name, op, numText] = match
    const gauge = GAUGES[name.toLowerCase()]
    const value = gauge ? gauge(ctx) : null
    if (value === null) {
      result = true // unknown gauge, or no reading yet — fail open
    } else {
      const n = Number(numText)
      result = op === '<' ? value < n : op === '>' ? value > n : op === '<=' ? value <= n : value >= n
    }
  } else {
    result = ctx.situation.has(body)
  }
  return negate ? !result : result
}

/** A short, honest label for the editor and the running-step display. */
export function describeCondition(condition: string | undefined): string | null {
  if (!condition || !condition.trim()) return null
  return `only while ${condition.trim()}`
}
