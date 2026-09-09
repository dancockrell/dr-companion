/**
 * localStorage persistence for user preferences.
 * Does not store credentials or game session secrets.
 */

import type { UiMode } from '../types'
import { readJSON, writeJSON } from './storage.ts'
import { DEFAULT_AUDIO_VOLUMES } from './audioDefaults.ts'
import { DEFAULT_FRONTEND } from './frontends.ts'

/**
 * The localStorage key these preferences live under.
 *
 * Exported because `bridgeModeSync.ts` has to watch it for a `StorageEvent`
 * from another window, and a second copy of the string is a second thing to
 * get wrong on the day it changes.
 */
export const PREFS_STORAGE_KEY = 'dr-companion-prefs-v1'
const KEY = PREFS_STORAGE_KEY

export interface PersistedPrefs {
  uiMode: UiMode
  alwaysOnTop: boolean
  /**
   * Which bridge the app opens on. `'live'` on a fresh install - see the
   * default below, and `bridgeModeSelect.ts` for the one function that turns
   * this plus the URL flag into the mode the store starts in.
   */
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
  /**
   * The Play.net account name last signed in with, so a returning player types
   * it once rather than every session.
   *
   * There is deliberately no `lichPassword` beside these four, and no
   * commented-out one either. The password is remembered - by default, since
   * 9 September 2026 - but it goes to Windows Credential Manager and never to
   * this file: a password in a JSON preferences file is a plaintext password
   * whatever it is spelled with. See `src/lib/rememberSignIn.ts` and
   * `docs/LICH_NATIVE_LOGIN.md` §8.
   *
   * The line that stood here said remembering was "increment N8, opt-in and
   * not built". N8 built it the next day and Dan reversed the default the day
   * after; a comment describing a plan two decisions out of date is worse than
   * none, because it reads as the current position.
   */
  lichAccount?: string
  /** DR, DRX, DRF or DRT - see `GAME_CODES` in `lichLogin.ts`. */
  lichGameCode?: string
  /** The character last launched, so the picker can preselect it. */
  lichCharacter?: string
  /**
   * Whether the player wants their sign-in remembered.
   *
   * Absent means they have never said, which is what
   * `REMEMBER_SIGN_IN_DEFAULT` answers (on). Stored so that unticking survives
   * a restart: a preference that reverts to the default on the next launch is
   * not a preference.
   */
  lichRemember?: boolean
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
  /**
   * Has this listener ever asked for music? Zone music is the one source
   * nobody picks - a zone report arrives and a playlist starts - so without
   * this a first run plays a track nobody asked for, which is how issue #383
   * put a failed track and a dead Retry button on the first painted screen.
   * False on a machine that has never run this app; set by any deliberate
   * start (Play, a station, a playlist, a stream, a skip). Distinct from
   * `musicVolume`, which is a level, not an answer to "do you want music".
   */
  musicStarted?: boolean
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
  /**
   * The first screen is honest.
   *
   * This was `'mock'` until 6 Sep 2026, which meant a machine that had never
   * connected to anything opened on "In combat, 84 of 100 health", a character
   * called Dan the Bold, room 308 in the Empaths' Guild and eighteen people
   * present - all of it invented, all of it the first thing a new user ever
   * saw of this product. It was labelled, with a badge and an indicator, and
   * the labels were small relative to the fiction. Recorded as defect 3 of
   * `docs/verification/first-run-2026-09-05.md`, from a real first run on a
   * clean VM; see issue #382.
   *
   * With `'live'` here the app opens on the empty state it already had -
   * `WaitingForCharacter`, which offers the attach control and the demo - and
   * the invented world is something a person asks for rather than something
   * they have to recognise and dismiss.
   */
  bridgeMode: 'live',
  trainFocus: [],
  autoSuggestHealer: true,
  huntFavorites: [],
  huntMode: 'suggest',
  preferredHealCity: null,
  consoleOpen: false,
  typeScale: 1,
  frontend: DEFAULT_FRONTEND,
  demoPreset: 'basic_prime',
  houseEntryMethod: 'lockpick_ring',
  houseEntryMaxSearches: 3,
  houseEntryHide: true,
  setupComplete: false,
  alertsVolume: DEFAULT_AUDIO_VOLUMES.system,
  dangerVolume: DEFAULT_AUDIO_VOLUMES.danger,
  speechVolume: DEFAULT_AUDIO_VOLUMES.speech,
  musicVolume: DEFAULT_AUDIO_VOLUMES.music,
  musicStarted: false,
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
