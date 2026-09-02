/**
 * localStorage persistence for user preferences.
 * Does not store credentials or game session secrets.
 */

import type { UiMode } from '../types'
import { readJSON, writeJSON } from './storage'

const KEY = 'dr-companion-prefs-v1'

export interface PersistedPrefs {
  uiMode: UiMode
  alwaysOnTop: boolean
  bridgeMode: 'mock' | 'live'
  /** Skills the player wants to emphasize in training */
  trainFocus: string[]
  /** Auto-open healer banner actions */
  autoSuggestHealer: boolean
  huntFavorites: string[]
  huntMode: 'suggest' | 'favorites_only' | 'manual'
  /** Town the player wants to heal in, overriding the scorer. */
  preferredHealCity?: string | null
  consoleOpen?: boolean
  /**
   * Global type scale, as a multiplier on the root font size.
   *
   * A setting rather than a fixed size because this audience is squarely in the
   * band where presbyopia is near-universal, and because eyes differ enough
   * that any single number would be wrong for a lot of people. Tailwind's sizes
   * are rem-based, so scaling the root scales everything together and keeps the
   * proportions the layout was built with.
   */
  typeScale?: number
  /** Frontend id, which decides the Lich script prefix. */
  frontend?: string
  houseEntryMethod?: 'rope' | 'lockpick' | 'lockpick_ring'
  houseEntryMaxSearches?: number
  /**
   * Which invented character Mock is playing.
   *
   * Remembered because it was not, and the app went back to the barbarian on
   * every reload - so anyone testing against a different guild reset their
   * own setup several times a minute. It is also what lets the dashboard be
   * rendered without a person clicking through to it, which is how it gets
   * looked at rather than described.
   */
  demoPreset?: string
  houseEntryHide?: boolean
  /**
   * Whether first-run setup has been through once.
   *
   * Kept out here with the preferences rather than in the store, because the
   * store is rebuilt from nothing on every load and this is precisely the fact
   * that has to survive that. Without it the app opens on the setup wizard
   * forever: everything else about a returning player is remembered and the
   * one bit saying they are a returning player was not.
   */
  setupComplete?: boolean
  /**
   * Sound levels, 0 to 1.5 (0% to 150%) each, no separate mute flag - 0 is
   * silent. Four channels as of 29 Aug 2026 (System/Danger/Speech split out
   * of one "Alerts" channel, plus Music) because a listener bothered by one
   * kind of ping used to have to mute all of them together - see
   * alertSound.ts's and ambientSound.ts's headers for where these are
   * actually applied.
   *
   * Default is 0 (muted) for all four, not some tuned "reasonable" level -
   * Dan's call, 28 Aug 2026, after a night of dr-companion's own audio work
   * repeatedly surprising him and, separately, other sessions' leftover
   * Browser-pane tabs leaving it playing unattended. A first run should
   * never make noise nobody asked for; turning sound on is something a
   * listener opts into via SoundControls, not something they have to
   * discover how to turn off.
   */
  /**
   * The System channel - the idle warning, disconnects, learning cues. Kept
   * under its original name (`alertsVolume` meant "everything" before the
   * 29 Aug 2026 channel split; see alertSound.ts's header) so an existing
   * profile's saved level lands on the channel it actually used to mean,
   * rather than resetting to the new default.
   */
  alertsVolume?: number
  /** Danger channel - a creature entering, a bad wound, bleeding, something
   * lodged or attached. See alertSound.ts's CHANNEL_FOR_CLASS. */
  dangerVolume?: number
  /** Speech channel - someone waiting on you personally (whispers/tells). */
  speechVolume?: number
  musicVolume?: number
  /** Master output gate; never substitutes zero for configured channel gains. */
  masterMuted?: boolean
  /**
   * A built-in station id (see ambientSound.ts's RADIO_STATIONS) remembered
   * across restarts, so picking a station once doesn't mean re-picking it
   * every session. Mutually exclusive with `customStreamUrl` - GamePane's
   * mount effect applies whichever one is set, preferring the custom stream
   * if somehow both are (shouldn't happen; setRadioStation/setCustomStream
   * each clear the other when applied).
   */
  radioStation?: string | null
  /** A player-supplied stream URL - see ambientSound.ts's setCustomStream. */
  customStreamUrl?: string | null
  /**
   * A player's saved stations - a first-class list, not a side effect of
   * whichever one happens to be playing. Two kinds, because a favorite can
   * be either half of the radio system: `builtin` stars one of
   * `RADIO_STATIONS` by id, `custom` saves a player-named stream URL (an
   * Icecast/Shoutcast station, or anything else `setCustomStream` accepts)
   * so it doesn't have to be retyped every session. Ordered - newest last -
   * so the list has a stable, predictable order rather than jumping around
   * on every save.
   */
  favoriteStations?: FavoriteStation[]
  /**
   * How long a crossfade or a play/pause fade takes - see ambientSound.ts's
   * CROSSFADE_STYLES for the three named presets. Default 'standard' (2.5s,
   * unchanged from before this was a choice) so an existing profile's
   * transitions don't suddenly feel different.
   */
  crossfadeStyle?: 'cut' | 'standard' | 'long'
  /**
   * A player's own hand-picked playlists (30 Aug 2026) - Dan: "we have great
   * music. let people see and choose individual tracks and make playlists
   * with them too." Distinct from `favoriteStations`: a favorite stars a
   * whole station or stream someone else curated, a playlist is built one
   * track at a time from the full 178-track pool across all four stations.
   * See playlists.ts for the actual reads/writes - same
   * subscribe-and-resync shape as favorites.ts.
   */
  playlists?: Playlist[]
  /**
   * The playlist id playing right now, if any - restored on startup the
   * same way `radioStation`/`customStreamUrl` are (GamePane's mount
   * effect), and mutually exclusive with both: playing a station, a stream,
   * or a playlist all override zone music in the same slot, and only one of
   * the three occupies it at a time - see ambientSound.ts's setPlaylist.
   */
  activePlaylistId?: string | null
}

export interface Playlist {
  id: string
  name: string
  /** Track ids, in the order they were added - `ambientSound.ts`'s
   * `ALL_TRACKS` for what a track id resolves to. Shuffled at play time
   * (same convention as a radio station's own track list), not stored
   * shuffled - reordering the stored list would mean "add" silently
   * reordered every previous track too. */
  trackIds: string[]
}

export interface FavoriteStation {
  kind: 'builtin' | 'custom'
  /** A RADIO_STATIONS id for `builtin`, the stream URL itself for `custom`. */
  id: string
  /** Display name - RADIO_STATIONS' own name for `builtin`, player-chosen for `custom`. */
  name: string
}

const defaults: PersistedPrefs = {
  uiMode: 'basic',
  alwaysOnTop: false,
  bridgeMode: 'mock',
  trainFocus: [],
  autoSuggestHealer: true,
  huntFavorites: [],
  huntMode: 'suggest',
  preferredHealCity: null,
  consoleOpen: false,
  typeScale: 1,
  frontend: 'genie',
  demoPreset: 'basic_prime',
  houseEntryMethod: 'lockpick_ring',
  houseEntryMaxSearches: 3,
  houseEntryHide: true,
  setupComplete: false,
  // Kept identical to alertSound.ts's and ambientSound.ts's own defaults, by
  // hand - there is no single source of truth between them, and letting them
  // drift is exactly what happened here once already (this stood at 0.8
  // after the module's own default had already been lowered to 0.45, and
  // nothing caught it - see SoundControls.tsx's header for the read-order
  // bug that made the drift actually reach the screen). Muted by default -
  // see this field's own doc comment above for why.
  alertsVolume: 0,
  dangerVolume: 0,
  speechVolume: 0,
  musicVolume: 0,
  masterMuted: false,
  favoriteStations: [],
  playlists: [],
  activePlaylistId: null,
}

export function loadPrefs(): PersistedPrefs {
  const parsed = readJSON<Partial<PersistedPrefs>>(KEY, {})
  return { ...defaults, ...parsed, uiMode: migrateMode(parsed.uiMode) }
}

/**
 * There used to be three modes. Anyone who ran an earlier build has 'simple'
 * or 'standard' stored, and reading one of those back would leave the app
 * matching neither branch and rendering an empty window.
 */
function migrateMode(stored: unknown): UiMode {
  return stored === 'power' ? 'power' : 'basic'
}

export function savePrefs(partial: Partial<PersistedPrefs>): PersistedPrefs {
  const next = { ...loadPrefs(), ...partial }
  writeJSON(KEY, next)
  return next
}
