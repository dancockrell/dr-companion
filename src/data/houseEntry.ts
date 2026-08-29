/**
 * House-entry (in-game burgle system) — Companion-owned design.
 * Mechanics any player can know; implementation will be ours in Lich.
 */

export type EntryMethod = 'rope' | 'lockpick' | 'lockpick_ring'

export interface HouseEntryPrefs {
  method: EntryMethod
  /** Max surface searches before leaving */
  maxSearches: number
  hideBeforeSearch: boolean
  skipRooms: string[]
  packName: string
}

export const DEFAULT_HOUSE_ENTRY: HouseEntryPrefs = {
  method: 'lockpick_ring',
  maxSearches: 3,
  hideBeforeSearch: true,
  skipRooms: [],
  packName: 'backpack',
}

export interface GuildEntryPrep {
  guild: string
  buffs: string[]
  note: string
}

/** Observable guild tools often used before entry — not a script copy */
export const GUILD_ENTRY_PREP: GuildEntryPrep[] = [
  {
    guild: 'thief',
    buffs: ['Khri Silence', 'Khri Plunder', 'Khri Slight', 'Khri Hasten'],
    note: 'Stealth-focused prep before entry',
  },
  {
    guild: 'necromancer',
    buffs: ['Rite of Contrition', 'Eyes of the Blind'],
    note: 'Reduce profile / manage visibility; justice risk remains high',
  },
  {
    guild: 'moon_mage',
    buffs: ['Refractive Field'],
    note: 'Invisibility support when available',
  },
]

export function prepForGuild(guild: string | undefined): GuildEntryPrep | null {
  if (!guild) return null
  return GUILD_ENTRY_PREP.find((g) => g.guild === guild.toLowerCase()) ?? null
}

export function describeEntryPlan(prefs: HouseEntryPrefs, guild?: string): string[] {
  const lines: string[] = [
    `Method: ${prefs.method}`,
    `Max searches: ${prefs.maxSearches}`,
    prefs.hideBeforeSearch ? 'Hide before extra searches' : 'No extra hide',
  ]
  if (prefs.skipRooms.length) lines.push(`Skip rooms: ${prefs.skipRooms.join(', ')}`)
  const prep = prepForGuild(guild)
  if (prep) lines.push(`Prep: ${prep.buffs.join(', ')}`)
  lines.push('Abort if guard present · leave on footsteps · respect cooldown')
  return lines
}
