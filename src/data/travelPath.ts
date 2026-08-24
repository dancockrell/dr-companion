/**
 * Travel path planner stub — Companion-owned.
 * Real paths will use Lich map room graphs; this ranks destinations
 * and produces a human-readable plan.
 */

import type { AccountTier, GameInstance } from '../types'
import {
  TRAVEL_DESTINATIONS,
  destinationsForTier,
  type TravelDestination,
} from './travelDestinations'
import { capabilitiesFor } from '../lib/accountCapabilities'

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
}): TravelPlan | null {
  const dest =
    TRAVEL_DESTINATIONS.find(
      (d) =>
        d.id === opts.destinationId ||
        d.aliases?.includes(opts.destinationId)
    ) ?? null
  if (!dest) return null

  const cap = capabilitiesFor(opts.accountTier, opts.instance)
  const reasons: string[] = []
  let ok = true

  if (!cap.canTravelOutsideZoluren && !dest.zolurenReachable) {
    ok = false
    reasons.push('Account tier cannot leave Zoluren routes')
  }
  if (
    dest.requiresPremium &&
    opts.accountTier !== 'premium' &&
    opts.accountTier !== 'platinum'
  ) {
    ok = false
    reasons.push('Requires Premium or Platinum')
  }
  if (opts.instance === 'Fallen' && dest.province === 'Zoluren' && dest.id !== 'crossing') {
    // soft note — Fallen geography differs
    reasons.push('Fallen geography may differ from Prime labels')
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

  if (opts.accountTier === 'platinum') {
    steps.unshift({
      kind: 'portal',
      label: 'Consider Platinum portal if available and faster',
    })
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
  instance: GameInstance
): TravelDestination[] {
  const cap = capabilitiesFor(accountTier, instance)
  const premium =
    accountTier === 'premium' || accountTier === 'platinum'
  return destinationsForTier(cap.canTravelOutsideZoluren, premium)
}
