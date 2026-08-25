/**
 * Travel path planner stub — Companion-owned.
 * Real paths will use Lich map room graphs; this ranks destinations
 * and produces a human-readable plan.
 */

import type { AccountTier, GameInstance } from '../types'
import {
  TRAVEL_DESTINATIONS,
  type TravelDestination,
} from './travelDestinations'
import {
  passportCheck,
  canUsePlatinumPortals,
  type PassportState,
  type Province,
} from './obstacles'

export interface TravelPlanStep {
  kind: 'walk' | 'ferry' | 'portal' | 'gate' | 'wait'
  label: string
}

export interface TravelPlan {
  destination: TravelDestination
  ok: boolean
  reasons: string[]
  steps: TravelPlanStep[]
  /** Rough hop count for UI */
  estimatedHops: number
}

export function planTravel(opts: {
  destinationId: string
  instance: GameInstance
  accountTier: AccountTier
  fromArea?: string
  /** F2P passport state per province. Absent means "unknown", so be careful. */
  passports?: PassportState[]
  /** Platinum cross-world portals need six months of tenure, not just the tier. */
  monthsSubscribed?: number
}): TravelPlan | null {
  const dest =
    TRAVEL_DESTINATIONS.find(
      (d) =>
        d.id === opts.destinationId ||
        d.aliases?.includes(opts.destinationId)
    ) ?? null
  if (!dest) return null

  const reasons: string[] = []
  let ok = true

  // The Fallen has its own geography. Running Prime routes against a Fallen
  // session was previously a soft note appended to a Prime plan, which is not
  // the rule the bridge contract states. Refuse instead.
  if (opts.instance === 'Fallen' && dest.instance !== 'Fallen') {
    return {
      destination: dest,
      ok: false,
      reasons: [
        'This is Prime geography and you are on The Fallen. Fallen routes are ' +
          'not mapped yet, and following Prime directions there will not work.',
      ],
      steps: [],
      estimatedHops: 0,
    }
  }

  // F2P is passport-gated per province, not locked to Zoluren. An expired
  // passport is the case that strands people, so it is checked explicitly.
  const passport = passportCheck(
    dest.province as Province,
    opts.accountTier,
    opts.passports
  )
  if (!passport.ok) {
    ok = false
    reasons.push(passport.reason)
  } else if (passport.reason) {
    reasons.push(passport.reason)
  }

  if (
    dest.requiresPremium &&
    opts.accountTier !== 'premium' &&
    opts.accountTier !== 'platinum'
  ) {
    ok = false
    reasons.push('Requires Premium (Estate Holder) or Platinum')
  }

  const steps: TravelPlanStep[] = []
  const from = opts.fromArea || 'current room'

  if (!ok) {
    return { destination: dest, ok: false, reasons, steps: [], estimatedHops: 0 }
  }

  steps.push({ kind: 'walk', label: `Leave ${from}` })

  if (dest.zolurenReachable && dest.province === 'Zoluren') {
    steps.push({ kind: 'walk', label: `Overland to ${dest.label}` })
  } else if (dest.province === 'Therengia') {
    steps.push({ kind: 'ferry', label: 'Northern trade / ferry segment' })
    steps.push({ kind: 'walk', label: `Approach ${dest.label}` })
  } else if (dest.province === 'Ilithi') {
    steps.push({ kind: 'walk', label: 'South toward gondola / Ilithi routes' })
    steps.push({ kind: 'gate', label: `Enter ${dest.label}` })
  } else if (dest.province === "Qi'Reshalia") {
    steps.push({ kind: 'ferry', label: 'Island transport' })
    steps.push({ kind: 'walk', label: `Arrive ${dest.label}` })
  } else if (dest.province === 'Forfedhdar') {
    steps.push({ kind: 'walk', label: 'West / mountain routes' })
    steps.push({ kind: 'gate', label: `Enter ${dest.label}` })
  } else {
    steps.push({ kind: 'walk', label: `Travel to ${dest.label}` })
  }

  // Cross-world portals are a Platinum benefit that unlocks after six months,
  // so the tier alone does not entitle you to them.
  if (canUsePlatinumPortals(opts.accountTier, opts.instance, opts.monthsSubscribed)) {
    steps.unshift({
      kind: 'portal',
      label: 'Consider a Platinum cross-world portal if it is faster',
    })
  } else if (opts.accountTier === 'platinum') {
    reasons.push(
      'Platinum cross-world portals unlock after six months of subscription. ' +
        'Not offering one without knowing your tenure.'
    )
  }

  reasons.push('Stub plan — replace hops with Lich map path when bridge is live')

  return {
    destination: dest,
    ok: true,
    reasons,
    steps,
    estimatedHops: steps.length,
  }
}

export function listReachable(
  accountTier: AccountTier,
  instance: GameInstance,
  passports?: PassportState[]
): TravelDestination[] {
  const premium = accountTier === 'premium' || accountTier === 'platinum'
  return TRAVEL_DESTINATIONS.filter((d) => {
    if (instance === 'Fallen' && d.instance !== 'Fallen') return false
    if (d.requiresPremium && !premium) return false
    return passportCheck(d.province as Province, accountTier, passports).ok
  })
}
