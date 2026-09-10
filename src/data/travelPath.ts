/**
 * Travel destination menu — Companion-owned.
 *
 * `planTravel` (a client-side step-by-step route simulator) lived here until
 * R3 (`docs/PLAN_TO_1_0.md` §6b, Lane R). It reimplemented exactly what
 * `docs/DOMAIN.md:1059-1060` warns against: "A companion that drives `;go2`
 * inherits every fix anyone makes to it. One that reimplements pathfinding
 * owns every bug forever." The real `travel` intent (`companion_bridge.lic`)
 * passes the destination straight to `go2` and lets Lich's own map graph do
 * the routing; there is nothing left for a client-side planner to do, so it
 * was deleted rather than left unused — see `src/bridge/mockBridge.ts`'s
 * `travel` case, which now mirrors `map_walk`'s honest "no real Lich in demo
 * mode" pattern instead of simulating a route.
 *
 * `listReachable` survives: it is a menu filter (which destinations are even
 * offerable, given tier/instance/passport state), not a route planner, and
 * `ScriptLauncher.tsx` still calls it to build the Travel view before a
 * bridge is connected.
 */

import type { AccountTier, GameInstance } from '../types'
import { TRAVEL_DESTINATIONS, type TravelDestination } from './travelDestinations.ts'
import { passportCheck, type PassportState, type Province } from './obstacles.ts'

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
