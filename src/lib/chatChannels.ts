/**
 * Sorting game text into channels.
 *
 * Everything the bridge sends arrives as one undifferentiated stream, and a
 * single scrolling log is the reason nobody reads it: a guild announcement, a
 * map error and forty lines of combat spam all look identical going past. The
 * tabs exist so that the line you are waiting for is somewhere you can find it
 * after it has scrolled.
 *
 * Classification is by pattern, and the patterns are DragonRealms' own output
 * formats rather than anything this app invented. Order matters — the specific
 * before the general — because a line that says "Someguy whispers" is speech
 * before it is anything else.
 *
 * Kept out of the component so it can be tested against real game lines. A
 * miscategorised line is invisible rather than wrong, which is exactly the
 * kind of failure that survives a demo.
 */

export type Channel = 'all' | 'speech' | 'combat' | 'system' | 'companion'

export interface ChatLine {
  seq: number
  at: string
  text: string
}

/**
 * Speech and anything addressed to a person.
 *
 * The bridge redacts private speech before it leaves the game, so what reaches
 * here is what the player chose to let through. Detecting it is still worth
 * doing: the whole reason someone glances at the window mid-script is that
 * somebody said something.
 */
const SPEECH =
  /\b(says?|said|whispers?|asks?|exclaims?|shouts?|yells?|tells? you|thinks? to you|speaks?)\b|^\[[^\]]+\]|"/i

/** Combat, which is most of the volume and almost none of the interest. */
const COMBAT =
  /\b(attacks?|swings?|thrusts?|lunges?|slashes?|stabs?|parr(y|ies)|dodges?|blocks?|hits?|misses|strikes?|wound|damage|roundtime|you are stunned|blood|kills?|dies|slain|retreats?|charges?)\b/i

/** The companion talking about itself, rather than the game talking. */
const COMPANION = /^(Flow:|Intent |Map:|Bridge |Stopped itself:|Script |Companion )/i

/**
 * Which channel a line belongs to.
 *
 * A line only ever lands in one place besides "all". Duplicating a line into
 * several tabs sounds helpful and means the tab counts stop being a count of
 * anything.
 */
export function channelOf(text: string): Exclude<Channel, 'all'> {
  if (COMPANION.test(text)) return 'companion'
  if (SPEECH.test(text)) return 'speech'
  if (COMBAT.test(text)) return 'combat'
  return 'system'
}

export const CHANNELS: Array<{ id: Channel; label: string; hint: string }> = [
  { id: 'all', label: 'All', hint: 'Everything, in order' },
  { id: 'speech', label: 'Speech', hint: 'Anything somebody said' },
  { id: 'combat', label: 'Combat', hint: 'Swings, wounds and roundtime' },
  { id: 'system', label: 'Game', hint: 'Rooms, movement and everything else the game printed' },
  { id: 'companion', label: 'Companion', hint: 'What this app did, not what the game did' },
]

/** Lines for one tab, oldest first. */
export function linesFor(lines: ChatLine[], channel: Channel): ChatLine[] {
  if (channel === 'all') return lines
  return lines.filter((l) => channelOf(l.text) === channel)
}

