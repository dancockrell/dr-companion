/**
 * The PLAY command — how Performance actually trains.
 *
 * Issue #12: PLAY has two independent, enumerable difficulty axes (song and
 * mood), both stated by the game itself rather than guessed. Verified against
 * Elanthipedia's Play command page (https://elanthipedia.play.net/Play_command,
 * checked 2026-08-27) rather than invented — DragonRealms game facts like a
 * command's exact argument list are not something to fabricate, and this list
 * matches the count issue #12 itself observed in-game (32 songs, 18 moods).
 *
 * Syntax: `PLAY (song) {mood} {ON} {instrument}`.
 */

export interface PlaySong {
  id: string
  label: string
  /** Percussion instruments use different names for the first two songs. */
  percussionLabel?: string
}

/** Easiest to hardest, exactly as the game's own PLAY USAGE lists them. */
export const PLAY_SONGS: PlaySong[] = [
  { id: 'scales', label: 'Scales', percussionLabel: 'Ruff' },
  { id: 'arpeggios', label: 'Arpeggios', percussionLabel: 'Rudiments' },
  { id: 'ditty', label: 'Ditty' },
  { id: 'folk', label: 'Folk' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'waltz', label: 'Waltz' },
  { id: 'lullaby', label: 'Lullaby' },
  { id: 'march', label: 'March' },
  { id: 'jig', label: 'Jig' },
  { id: 'lament', label: 'Lament' },
  { id: 'wedding', label: 'Wedding' },
  { id: 'hymn', label: 'Hymn' },
  { id: 'rumba', label: 'Rumba' },
  { id: 'polka', label: 'Polka' },
  { id: 'battle', label: 'Battle' },
  { id: 'reel', label: 'Reel' },
  { id: 'elegy', label: 'Elegy' },
  { id: 'serenade', label: 'Serenade' },
  { id: 'minuet', label: 'Minuet' },
  { id: 'psalm', label: 'Psalm' },
  { id: 'dirge', label: 'Dirge' },
  { id: 'gavotte', label: 'Gavotte' },
  { id: 'tango', label: 'Tango' },
  { id: 'tarantella', label: 'Tarantella' },
  { id: 'bolero', label: 'Bolero' },
  { id: 'nocturne', label: 'Nocturne' },
  { id: 'requiem', label: 'Requiem' },
  { id: 'fantasia', label: 'Fantasia' },
  { id: 'rondo', label: 'Rondo' },
  { id: 'aria', label: 'Aria' },
  { id: 'sonata', label: 'Sonata' },
  { id: 'concerto', label: 'Concerto' },
]

/**
 * The two moods that make every song easier, and the two that make every
 * song harder — stated outright by the game's own usage text. The other
 * fourteen are flavour/situational moods whose difficulty effect the game
 * does not generalize, so they are not sorted into either bucket here rather
 * than guessed.
 */
export const EASIER_MOODS = ['off-key', 'halting']
export const HARDER_MOODS = ['confident', 'masterful']

export const PLAY_MOODS: string[] = [
  'off-key',
  'halting',
  'slow',
  'loud',
  'quiet',
  'quick',
  'fierce',
  'flashy',
  'playful',
  'solemn',
  'mournful',
  'wistful',
  'excited',
  'haunting',
  'romantic',
  'cheerful',
  'confident',
  'masterful',
]

export function moodDifficulty(mood: string): 'easier' | 'harder' | 'neutral' {
  if (EASIER_MOODS.includes(mood)) return 'easier'
  if (HARDER_MOODS.includes(mood)) return 'harder'
  return 'neutral'
}

/** Builds the literal command line. Nothing here is sent until the player presses Play. */
export function buildPlayCommand(songId: string, mood: string, instrument: string): string {
  const song = PLAY_SONGS.find((s) => s.id === songId)
  const parts = ['play', song?.id ?? songId]
  if (mood) parts.push(mood)
  if (instrument.trim()) parts.push('on', instrument.trim())
  return parts.join(' ')
}
