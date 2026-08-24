/**
 * Major travel destinations — public geography.
 * Used by Travel activity UI; pathing implemented later via Lich maps.
 */

export interface TravelDestination {
  id: string
  label: string
  province: string
  /** Rough F2P reachability without leaving Zoluren rules */
  zolurenReachable: boolean
  requiresPremium?: boolean
  aliases?: string[]
}

export const TRAVEL_DESTINATIONS: TravelDestination[] = [
  { id: 'crossing', label: 'Crossing', province: 'Zoluren', zolurenReachable: true, aliases: ['cross'] },
  { id: 'westgate', label: 'Crossing West Gate', province: 'Zoluren', zolurenReachable: true },
  { id: 'arthe', label: 'Arthe Dale', province: 'Zoluren', zolurenReachable: true },
  { id: 'tiger', label: 'Tiger Clan', province: 'Zoluren', zolurenReachable: true },
  { id: 'wolf', label: 'Wolf Clan', province: 'Zoluren', zolurenReachable: true },
  { id: 'knife', label: 'Knife Clan', province: 'Zoluren', zolurenReachable: true },
  { id: 'kaerna', label: 'Kaerna', province: 'Zoluren', zolurenReachable: true },
  { id: 'stone', label: 'Stone Clan', province: 'Zoluren', zolurenReachable: true },
  { id: 'dirge', label: 'Dirge', province: 'Zoluren', zolurenReachable: true },
  { id: 'leth', label: 'Leth Deriel', province: 'Zoluren', zolurenReachable: true },
  { id: 'alfren', label: "Alfren's Ferry", province: 'Zoluren', zolurenReachable: true },
  { id: 'haven', label: 'Riverhaven', province: 'Therengia', zolurenReachable: false, aliases: ['riverhaven'] },
  { id: 'theren', label: 'Therenborough', province: 'Therengia', zolurenReachable: false },
  { id: 'lang', label: 'Langenfirth', province: 'Therengia', zolurenReachable: false },
  { id: 'rossman', label: "Rossman's Landing", province: 'Therengia', zolurenReachable: false },
  { id: 'shard', label: 'Shard', province: 'Ilithi', zolurenReachable: false },
  { id: 'horse', label: 'Horse Clan', province: 'Ilithi', zolurenReachable: false },
  { id: 'fc', label: 'Fang Cove', province: 'Ilithi', zolurenReachable: true, requiresPremium: true },
  { id: 'hib', label: 'Hibarnhvidar', province: "Forfedhdar", zolurenReachable: false },
  { id: 'boar', label: 'Boar Clan', province: "Forfedhdar", zolurenReachable: false },
  { id: 'ratha', label: 'Ratha', province: "Qi'Reshalia", zolurenReachable: false },
  { id: 'aesry', label: "Aesry Surlaenis'a", province: "Qi'Reshalia", zolurenReachable: false },
  { id: 'mriss', label: "M'riss", province: "Qi'Reshalia", zolurenReachable: false },
  { id: 'merk', label: "Mer'Kresh", province: "Qi'Reshalia", zolurenReachable: false },
]

export function destinationsForTier(canLeaveZoluren: boolean, premium: boolean): TravelDestination[] {
  return TRAVEL_DESTINATIONS.filter((d) => {
    if (!canLeaveZoluren && !d.zolurenReachable) return false
    if (d.requiresPremium && !premium) return false
    return true
  })
}
