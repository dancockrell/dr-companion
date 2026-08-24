/**
 * Companion-owned combat state machine (sketch).
 */

export type CombatState =
  | 'idle'
  | 'buffing'
  | 'engaging'
  | 'fighting'
  | 'looting'
  | 'retreating'
  | 'escaping'
  | 'paused'
  | 'stopped'

export type CombatEvent =
  | 'start'
  | 'buffs_ready'
  | 'target_found'
  | 'target_dead'
  | 'loot_done'
  | 'low_health'
  | 'safe'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'escape'

export interface CombatContext {
  healthPct: number
  retreatHealth: number
  inCombat: boolean
  hasTarget: boolean
  lootPending: boolean
}

export interface CombatTransition {
  from: CombatState
  event: CombatEvent
  to: CombatState
  note?: string
}

export const COMBAT_TRANSITIONS: CombatTransition[] = [
  { from: 'idle', event: 'start', to: 'buffing' },
  { from: 'buffing', event: 'buffs_ready', to: 'engaging' },
  { from: 'engaging', event: 'target_found', to: 'fighting' },
  { from: 'fighting', event: 'target_dead', to: 'looting' },
  { from: 'looting', event: 'loot_done', to: 'engaging' },
  { from: 'fighting', event: 'low_health', to: 'retreating' },
  { from: 'looting', event: 'low_health', to: 'retreating' },
  { from: 'engaging', event: 'low_health', to: 'retreating' },
  { from: 'retreating', event: 'safe', to: 'escaping' },
  { from: 'escaping', event: 'safe', to: 'stopped' },
  { from: 'fighting', event: 'pause', to: 'paused' },
  { from: 'engaging', event: 'pause', to: 'paused' },
  { from: 'looting', event: 'pause', to: 'paused' },
  { from: 'buffing', event: 'pause', to: 'paused' },
  { from: 'paused', event: 'resume', to: 'engaging' },
  { from: 'idle', event: 'stop', to: 'stopped' },
  { from: 'buffing', event: 'stop', to: 'stopped' },
  { from: 'engaging', event: 'stop', to: 'stopped' },
  { from: 'fighting', event: 'stop', to: 'stopped' },
  { from: 'looting', event: 'stop', to: 'stopped' },
  { from: 'retreating', event: 'stop', to: 'stopped' },
  { from: 'paused', event: 'stop', to: 'stopped' },
  { from: 'escaping', event: 'stop', to: 'stopped' },
]

export function nextCombatState(
  state: CombatState,
  event: CombatEvent
): CombatState | null {
  const hit = COMBAT_TRANSITIONS.find((t) => t.from === state && t.event === event)
  return hit ? hit.to : null
}

export function autoEvent(state: CombatState, ctx: CombatContext): CombatEvent | null {
  const danger =
    ctx.healthPct <= ctx.retreatHealth &&
    !['retreating', 'escaping', 'stopped', 'idle', 'paused'].includes(state)
  if (danger) return 'low_health'
  if (state === 'buffing') return 'buffs_ready'
  if (state === 'engaging' && ctx.hasTarget) return 'target_found'
  if (state === 'fighting' && !ctx.hasTarget) return 'target_dead'
  if (state === 'looting' && !ctx.lootPending) return 'loot_done'
  if (state === 'retreating' && !ctx.inCombat) return 'safe'
  if (state === 'escaping' && !ctx.inCombat) return 'safe'
  return null
}

export function describeCombatState(state: CombatState): string {
  const labels: Record<CombatState, string> = {
    idle: 'Ready',
    buffing: 'Preparing buffs',
    engaging: 'Looking for target',
    fighting: 'In combat',
    looting: 'Looting',
    retreating: 'Retreating',
    escaping: 'Escaping to safety',
    paused: 'Paused',
    stopped: 'Stopped',
  }
  return labels[state]
}

export function simulateCombatLoop(
  steps: number,
  start: CombatContext
): { state: CombatState; log: string[] } {
  let state: CombatState = 'idle'
  const log: string[] = []
  const ctx: CombatContext = { ...start }

  const push = (e: CombatEvent) => {
    const n = nextCombatState(state, e)
    if (n) {
      log.push(`${state} --${e}→ ${n}`)
      state = n
    } else {
      log.push(`${state} ✕ ${e} (no transition)`)
    }
  }

  push('start')
  for (let i = 0; i < steps; i++) {
    const auto = autoEvent(state, ctx)
    if (auto) {
      push(auto)
      if (auto === 'target_dead') ctx.hasTarget = false
      if (auto === 'loot_done') ctx.lootPending = false
      continue
    }
    const s: string = state
    if (s === 'engaging') {
      ctx.hasTarget = true
      push('target_found')
    } else if (s === 'fighting') {
      ctx.hasTarget = false
      push('target_dead')
    } else if (s === 'looting') {
      ctx.lootPending = false
      push('loot_done')
    } else {
      break
    }
  }
  return { state, log }
}
