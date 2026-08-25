/**
 * Major travel destinations — public geography.
 * Used by Travel activity UI; pathing implemented later via Lich maps.
 */

import type { GameInstance } from '../types'

export interface TravelDestination {
  id: string
  label: string
  province: string
  /**
   * Which game instance this geography belongs to.
   *
   * Everything below is Prime. The Fallen has its own map, and following Prime
   * directions on a Fallen character does not work, so the planner refuses
   * rather than appending a caveat to a wrong route.
   */
  instance: GameInstance
  /**
   * Reachable without leaving Zoluren.
   *
   * Note this is about geography, not entitlement. Free accounts are not
   * locked to Zoluren; they are passport-gated per province, which
   * `passportCheck` in obstacles.ts handles. See docs/DOMAIN.md section 2.
   */
  zolurenReachable: boolean
  requiresPremium?: boolean
  aliases?: string[]
}

export const TRAVEL_DESTINATIONS: TravelDestination[] = [
  { id: 'crossing', label: 'Crossing', province: 'Zoluren', instance: 'Prime', zolurenReachable: true, aliases: ['cross'] },
  { id: 'westgate', label: 'Crossing West Gate', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'arthe', label: 'Arthe Dale', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'tiger', label: 'Tiger Clan', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'wolf', label: 'Wolf Clan', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'knife', label: 'Knife Clan', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'kaerna', label: 'Kaerna', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'stone', label: 'Stone Clan', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'dirge', label: 'Dirge', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'leth', label: 'Leth Deriel', province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'alfren', label: "Alfren's Ferry", province: 'Zoluren', instance: 'Prime', zolurenReachable: true },
  { id: 'haven', label: 'Riverhaven', province: 'Therengia', instance: 'Prime', zolurenReachable: false, aliases: ['riverhaven'] },
  { id: 'theren', label: 'Therenborough', province: 'Therengia', instance: 'Prime', zolurenReachable: false },
  { id: 'lang', label: 'Langenfirth', province: 'Therengia', instance: 'Prime', zolurenReachable: false },
  { id: 'rossman', label: "Rossman's Landing", province: 'Therengia', instance: 'Prime', zolurenReachable: false },
  { id: 'shard', label: 'Shard', province: 'Ilithi', instance: 'Prime', zolurenReachable: false },
  { id: 'horse', label: 'Horse Clan', province: 'Ilithi', instance: 'Prime', zolurenReachable: false },
  { id: 'fc', label: 'Fang Cove', province: 'Ilithi', instance: 'Prime', zolurenReachable: false, requiresPremium: true, aliases: ['fangcove'] },
  { id: 'hib', label: 'Hibarnhvidar', province: "Forfedhdar", instance: 'Prime', zolurenReachable: false },
  { id: 'boar', label: 'Boar Clan', province: "Forfedhdar", instance: 'Prime', zolurenReachable: false },
  { id: 'ratha', label: 'Ratha', province: "Qi'Reshalia", instance: 'Prime', zolurenReachable: false },
  { id: 'aesry', label: "Aesry Surlaenis'a", province: "Qi'Reshalia", instance: 'Prime', zolurenReachable: false },
  { id: 'mriss', label: "M'riss", province: "Qi'Reshalia", instance: 'Prime', zolurenReachable: false },
  { id: 'merk', label: "Mer'Kresh", province: "Qi'Reshalia", instance: 'Prime', zolurenReachable: false },
]

export function destinationsForTier(canLeaveZoluren: boolean, premium: boolean): TravelDestination[] {
  return TRAVEL_DESTINATIONS.filter((d) => {
    if (!canLeaveZoluren && !d.zolurenReachable) return false
    if (d.requiresPremium && !premium) return false
    return true
  })
}
