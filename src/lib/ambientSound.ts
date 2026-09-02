import { effectiveAudioGain, onMasterMuteChange } from './audioMaster.ts'
import { DEFAULT_AUDIO_VOLUMES } from './audioDefaults.ts'

/**
 * Music: per-zone playlists and an optional radio override. No ambient
 * terrain-texture layer - it shipped once (28 Aug 2026) and was pulled back
 * out the same day, Dan's call, after it caused exactly the overlap it was
 * built to avoid: "the idea for that ambiance is bad anyways. pull out that
 * kind of stuff. lets not." Then, immediately after: "i do want music. not
 * ambiant...just the music...lots of songs we had." One layer, not two -
 * nothing here fights anything else here for attention, because there is
 * only ever one thing playing in the `music` slot at a time. Nothing here is
 * game audio ripped from DragonRealms; everything under `public/audio/` is
 * sourced and licensed in `data/audio/manifest.json`.
 *
 * # Why zone, not room
 *
 * The live bridge reports a room on every step. Crossfading on every room
 * would restart the track eighteen times in ninety seconds in a room like
 * Firulf Vista (see GamePane.tsx's own header for that measurement) - the
 * exact thing background music must never do. A zone is stable for as long as
 * a hunting ground is, which is the granularity a "does this region feel
 * distinct" design actually wants. `setZone` is a no-op unless the zone id it
 * is given differs from the one already playing.
 *
 * # Zone music is a playlist, not one file
 *
 * `manifest.json`'s `zone` object maps a zone id to a list of track ids
 * (reusing the same pool of tracks radio stations draw from - there is no
 * separate zone-only file set), built to run roughly an hour before it loops
 * (Dan's ask, 28 Aug 2026 - one-hour region playlists, aware of what the
 * zone actually is, not just its biome). A zone with no playlist plays
 * nothing, which is silence, not an error.
 *
 * # Radio is a station, not a track
 *
 * A Fallout-style radio, not a jukebox: selecting a station starts a
 * *playlist* that loops and advances on its own, the way Galaxy News Radio
 * does not stop after one song. `data/audio/manifest.json`'s `radio` array
 * is a flat list of tracks, each tagged with a `station` id; `RADIO_STATIONS`
 * groups them for a picker, and `RadioPlayer` below is what actually walks
 * a station's list - shuffled once per station switch so the order isn't
 * identical every time, looping the whole list rather than one track.
 * Selecting a station overrides zone music in the same slot; deselecting it
 * goes back to whatever the current zone's playlist is.
 */
// The `with { type: 'json' }` attribute is required by plain Node ESM (which
// tools/ambient-test.mjs uses to import this file directly, the same way
// trail-test.mjs and flow-test.mjs import .ts sources elsewhere in this
// repo) even though Vite accepts a bare JSON import without it. Without the
// attribute this module fails to import outside a bundler at all.
import manifest from '../../data/audio/manifest.json' with { type: 'json' }

export interface RadioTrack {
  id: string
  title: string
  composer: string
}

export interface RadioStation {
  id: string
  name: string
  description: string
  tracks: RadioTrack[]
}

const STATION_META: Record<string, { name: string; description: string }> =
  manifest.radioStations ?? {}

/** Every station the manifest actually names, in first-appearance order, for a picker to list. */
export const RADIO_STATIONS: RadioStation[] = (() => {
  const byId = new Map<string, RadioStation>()
  for (const t of manifest.radio ?? []) {
    let s = byId.get(t.station)
    if (!s) {
      const meta = STATION_META[t.station]
      s = {
        id: t.station,
        name: meta?.name ?? t.station,
        description: meta?.description ?? '',
        tracks: [],
      }
      byId.set(t.station, s)
    }
    s.tracks.push({ id: t.id, title: t.title, composer: t.composer })
  }
  return [...byId.values()]
})()

const RADIO_FILES: Record<string, string> = Object.fromEntries(
  (manifest.radio ?? []).map((r) => [r.id, `/audio/${r.file}`])
)

/** Track id -> display metadata, for the "now playing" line - radio and zone
 * playlists both draw from this same pool, so one lookup covers both. */
const TRACK_META: Record<string, { title: string; composer: string }> = Object.fromEntries(
  (manifest.radio ?? []).map((r) => [r.id, { title: r.title, composer: r.composer }])
)

/**
 * Track id -> linear gain multiplier, from `tools/measure-loudness.mjs`'s
 * `gainDb` (0 for a track it hasn't measured yet, or measured as already at
 * the target). Sourced from a dozen-plus uploaders across Wikimedia and
 * OpenGameArt with no consistent mastering between them - a real sample
 * measured a 25+ dB spread in mean volume before this existed, meaning the
 * quietest track in that sample was roughly a nineteenth the perceived
 * loudness of the loudest at an identical slider position. This is the
 * per-track correction; `Layer.play()`'s `trackGain` param is where it's
 * actually applied, multiplied together with `mix` and the listener's own
 * gain the same way alertSound.ts corrected the alert WAVs on 28 Aug 2026,
 * just per-track instead of once for a handful of shared files.
 */
const TRACK_GAIN: Record<string, number> = Object.fromEntries(
  (manifest.radio ?? []).map((r) => [r.id, 10 ** ((r.gainDb ?? 0) / 20)])
)

/** Track id -> station id, for jumping straight to one track by search
 * rather than only ever entering the pool through a station pick. */
const TRACK_TO_STATION: Record<string, string> = Object.fromEntries(
  (manifest.radio ?? []).map((r) => [r.id, r.station])
)

/**
 * Every searchable track, flat, id + title + composer + which station it's
 * on - what a search box filters over. Built once from the same manifest
 * `RADIO_STATIONS` already reads, not a second copy of the pool that could
 * drift from it.
 */
export interface SearchableTrack {
  id: string
  title: string
  composer: string
  stationId: string
  stationName: string
}
export const ALL_TRACKS: SearchableTrack[] = buildSearchableTracks()
function buildSearchableTracks(): SearchableTrack[] {
  const stationName: Record<string, string> = Object.fromEntries(
    Object.entries(STATION_META).map(([id, meta]) => [id, meta.name])
  )
  return (manifest.radio ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    composer: r.composer,
    stationId: r.station,
    stationName: stationName[r.station] ?? r.station,
  }))
}

interface ZoneManifestEntry {
  tracks?: string[]
  character?: string
}

const ZONE_MANIFEST = manifest.zone as Record<string, ZoneManifestEntry>

/** Zone id -> the track ids its playlist names, in the order authored. */
const ZONE_TRACKS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ZONE_MANIFEST).map(([zoneId, z]) => [zoneId, z.tracks ?? []])
)

function shuffled<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * How long a crossfade or a play/pause fade takes - one knob, not a
 * separate one per event type (skip vs. pause vs. zone change), on purpose:
 * "a few templates to choose from" (Dan, 29 Aug 2026) is a listener
 * preference about *how transitions feel*, not a per-context tuning
 * problem, and a single style keeps the mental model to "fast, normal, or
 * slow" rather than a settings screen. `CROSSFADE_STYLES` is what a picker
 * renders; `setCrossfadeStyle` changes `FADE_MS` for every future fade
 * (mid-fade ones finish at whatever speed they started at - see
 * `fadeMusicVolume`'s own note on why a *new* fade always starts fresh from
 * the current level, but nothing here needs to reach into one already
 * running to change its speed).
 */
export const CROSSFADE_STYLES = {
  cut: { label: 'Cut', ms: 400, description: 'Snappy - barely a fade' },
  standard: { label: 'Standard', ms: 2500, description: 'A couple of seconds' },
  long: { label: 'Long', ms: 6000, description: 'A slow, cinematic bleed' },
} as const
export type CrossfadeStyle = keyof typeof CROSSFADE_STYLES

let FADE_MS: number = CROSSFADE_STYLES.standard.ms
let crossfadeStyle: CrossfadeStyle = 'standard'
// Two pickers read this now - the Sound panel's row and SafetyFooter's own
// compact cycle button (29 Aug 2026) - so a change made in one has to reach
// the other the same way musicVolume/nowPlaying already do, or the second
// picker silently disagrees with the style actually in effect until its own
// component happens to re-render for an unrelated reason.
const crossfadeStyleListeners = new Set<(style: CrossfadeStyle) => void>()
export function setCrossfadeStyle(style: CrossfadeStyle) {
  crossfadeStyle = style
  FADE_MS = CROSSFADE_STYLES[style].ms
  for (const l of crossfadeStyleListeners) l(style)
}
export function currentCrossfadeStyle(): CrossfadeStyle {
  return crossfadeStyle
}
export function onCrossfadeStyleChange(fn: (style: CrossfadeStyle) => void): () => void {
  crossfadeStyleListeners.add(fn)
  return () => crossfadeStyleListeners.delete(fn)
}

const TICK_MS = 50

/**
 * The one music layer, faded rather than cut. Loops by default; radio and
 * zone playlists both turn that off and drive `onEnded` instead.
 *
 * Volume has three parts, multiplied together. `mix` is the level the caller
 * asks for at `play()` time - kept deliberately modest (0.22, Dan's "blend
 * into the background" instruction, 28 Aug 2026) so the 100% gain position
 * is already a reasonable level rather than a starting point to find by ear.
 * `gain` is the listener's own slider, 0 to 1.5 (0% to 150%), default 1 -
 * turning gain to 0 configures this channel silent. The independent master
 * gate is applied only to the final target and never changes `gain`.
 * `trackGain` (29 Aug 2026) corrects
 * for the source material itself - see `TRACK_GAIN`'s own header - and is
 * the only one of the three that changes with every track rather than
 * staying fixed for a whole listening session.
 *
 * The product of all three is clamped to 1.0 before ever reaching
 * `el.volume` - `HTMLAudioElement.volume` is spec-clamped to [0, 1] and
 * throws in a strict implementation past that, the same ceiling
 * alertSound.ts already documented and worked around with a GainNode for
 * alerts. Music doesn't get that route (its volume never needed to exceed
 * 100% before `trackGain` existed), so the honest ceiling here is simpler:
 * state the cap and clamp to it, same as alertSound.ts's Web-Audio-less
 * fallback path does.
 */
interface LayerOptions {
  loop?: boolean
  onEnded?: () => void
  trackGain?: number
  onLoading?: () => void
  onPlaying?: () => void
  onWaiting?: () => void
  onFailure?: (reason: string) => void
}

class Layer {
  private el: HTMLAudioElement | null = null
  private mix = 0
  private gain = 1
  private trackGain = 1
  private options: LayerOptions | null = null
  private failed = false

  private get target(): number {
    return effectiveAudioGain(Math.min(1, this.mix * this.gain * this.trackGain))
  }

  setGain(v: number) {
    this.gain = Math.max(0, Math.min(1.5, v))
    if (this.el) this.el.volume = this.target
  }

  refreshMasterGain() {
    if (this.el) this.el.volume = this.target
  }

  /**
   * Swap to a new source, crossfading out the old and in the new. Same src is
   * a no-op - callers that want the same file to restart (radio advancing to
   * the next track happens to sometimes land on the same file in a small
   * station) should not rely on `play` for that; nothing here currently needs
   * to.
   */
  play(
    src: string | null,
    mix = 0.22,
    opts?: LayerOptions
  ) {
    if (src === (this.el?.dataset.src ?? null)) {
      // A normal duplicate selection is still a no-op. Selecting the source
      // that just failed is the one exception: that is an intuitive Retry.
      if (this.failed) this.retry()
      return
    }
    this.mix = mix
    this.trackGain = opts?.trackGain ?? 1
    this.options = opts ?? null
    this.failed = false

    const dying = this.el
    if (dying) this.fadeOutAndStop(dying)

    if (!src) {
      this.el = null
      this.options = null
      emitProgress(null)
      return
    }

    const next = new Audio(src)
    next.loop = opts?.loop ?? true
    next.volume = 0
    next.dataset.src = src
    if (opts?.onEnded) next.addEventListener('ended', opts.onEnded)
    // A fresh track starts at 0/unknown, not whatever the previous one's
    // position happened to be - the progress bar has to reset the instant a
    // new track is chosen, not wait for this element's first `timeupdate`.
    emitProgress({ position: 0, duration: NaN })
    next.addEventListener('timeupdate', () => {
      if (this.el === next) emitProgress({ position: next.currentTime, duration: next.duration })
    })
    next.addEventListener('durationchange', () => {
      if (this.el === next) emitProgress({ position: next.currentTime, duration: next.duration })
    })
    this.el = next
    let fadedIn = false
    next.addEventListener('playing', () => {
      if (this.el !== next) return
      this.failed = false
      this.options?.onPlaying?.()
      if (!fadedIn) {
        fadedIn = true
        this.fadeIn(next)
      }
    })
    next.addEventListener('waiting', () => {
      if (this.el === next) this.options?.onWaiting?.()
    })
    next.addEventListener('stalled', () => {
      this.fail(next, 'The audio stream stalled.')
    })
    next.addEventListener('error', () => {
      const code = next.error?.code
      const reason =
        code === 2
          ? 'The audio source could not be reached.'
          : code === 3
            ? 'The audio could not be decoded.'
            : code === 4
              ? 'This audio format or source is not supported.'
              : 'The audio source failed.'
      this.fail(next, reason)
    })
    this.attempt(next)
  }

  retry() {
    if (this.el) this.attempt(this.el)
  }

  stop() {
    if (this.el) this.fadeOutAndStop(this.el)
    this.el = null
    this.options = null
    this.failed = false
    emitProgress(null)
  }

  /**
   * Jump to a position in the current track. No-op with nothing loaded or a
   * duration that isn't known yet (NaN/Infinity - a live stream, or the very
   * first tick before metadata arrives) - there is nothing to seek within.
   */
  seek(seconds: number) {
    if (!this.el || !Number.isFinite(this.el.duration)) return
    this.el.currentTime = Math.max(0, Math.min(this.el.duration, seconds))
  }

  private fadeIn(el: HTMLAudioElement) {
    const timer = setInterval(() => {
      const target = this.target
      const step = target / (FADE_MS / TICK_MS)
      el.volume = Math.min(target, el.volume + step)
      if (el.volume >= target - 0.001) clearInterval(timer)
    }, TICK_MS)
  }

  private attempt(el: HTMLAudioElement) {
    if (this.el !== el) return
    this.failed = false
    this.options?.onLoading?.()
    try {
      void el.play().catch((error) => {
        this.fail(
          el,
          error instanceof Error && error.name === 'NotAllowedError'
            ? 'Playback was blocked. Press Retry to start it.'
            : 'The audio source could not start.'
        )
      })
    } catch {
      this.fail(el, 'The audio source could not start.')
    }
  }

  private fail(el: HTMLAudioElement, reason: string) {
    if (this.el !== el) return
    this.failed = true
    el.pause()
    this.options?.onFailure?.(reason)
    // Never log the custom URL: it may contain a private query token. The UI
    // already identifies the selected source without leaking it to reports.
    console.warn(`Music playback failed: ${reason}`)
  }

  private fadeOutAndStop(el: HTMLAudioElement) {
    const step = el.volume / (FADE_MS / TICK_MS)
    const timer = setInterval(() => {
      el.volume = Math.max(0, el.volume - step)
      if (el.volume <= 0.001) {
        clearInterval(timer)
        el.pause()
        el.src = ''
      }
    }, TICK_MS)
  }
}

const music = new Layer()
onMasterMuteChange(() => music.refreshMasterGain())

let currentZone: string | null = null

/**
 * What's actually in the `music` slot right now, for a "now playing" line in
 * the panel - a bare volume slider doesn't tell a listener what they're
 * hearing or let them skip it. `title`/`composer` come from `TRACK_META`;
 * a custom stream has neither, so it carries its URL as `title` instead.
 */
export type PlaybackStatus = 'loading' | 'playing' | 'failed'

export interface NowPlaying {
  title: string
  composer: string
  source: 'radio' | 'zone' | 'custom' | 'playlist'
  status: PlaybackStatus
  error?: string
}
let nowPlayingState: NowPlaying | null = null
const nowPlayingListeners = new Set<(np: NowPlaying | null) => void>()
function setNowPlaying(np: NowPlaying | null) {
  nowPlayingState = np
  for (const l of nowPlayingListeners) l(np)
}
export function nowPlaying(): NowPlaying | null {
  return nowPlayingState
}
/** Subscribe to now-playing changes. Returns an unsubscribe function. */
export function onNowPlayingChange(fn: (np: NowPlaying | null) => void): () => void {
  nowPlayingListeners.add(fn)
  return () => nowPlayingListeners.delete(fn)
}

type PlayingMeta = Omit<NowPlaying, 'status' | 'error'>

/** Publish what the media element confirms, not merely what was requested. */
function playMusic(src: string, meta: PlayingMeta, opts?: LayerOptions) {
  music.play(src, 0.22, {
    ...opts,
    onLoading: () => setNowPlaying({ ...meta, status: 'loading' }),
    onWaiting: () => setNowPlaying({ ...meta, status: 'loading' }),
    onPlaying: () => setNowPlaying({ ...meta, status: 'playing' }),
    onFailure: (error) => setNowPlaying({ ...meta, status: 'failed', error }),
  })
}

/** Retry the selected failed/stalled source without rebuilding its playlist. */
export function retryMusic() {
  music.retry()
}

/**
 * Where the current track is, for a real progress bar rather than a bare
 * title. `duration` is `NaN` until the browser has parsed enough of the file
 * to know it (right after a track change, or for a live stream that never
 * reports one at all) - a consumer treats a non-finite duration as "nothing
 * to show a bar for," not zero.
 */
export interface Progress {
  position: number
  duration: number
}
let progressState: Progress | null = null
const progressListeners = new Set<(p: Progress | null) => void>()
function emitProgress(p: Progress | null) {
  progressState = p
  for (const l of progressListeners) l(p)
}
export function playbackProgress(): Progress | null {
  return progressState
}
/** Subscribe to playback position changes - fires on the browser's own
 * `timeupdate` cadence (roughly 4x/second), not a bespoke timer. */
export function onProgressChange(fn: (p: Progress | null) => void): () => void {
  progressListeners.add(fn)
  return () => progressListeners.delete(fn)
}
/** Jump to a position in the current track - see `Layer.seek`'s own header
 * for why this is a no-op on a live stream or before metadata arrives. */
export function seekMusic(seconds: number) {
  music.seek(seconds)
}

/**
 * Walks one station's playlist in the `music` slot: shuffles once on
 * selection, advances on `ended`, loops the whole list rather than one
 * track. This is the difference between a radio station and a jukebox
 * repeating a single song - Galaxy News Radio does not loop "Way Back Home"
 * forever, it works through its library and comes back around.
 */
class RadioPlayer {
  private stationId: string | null = null
  private queue: RadioTrack[] = []
  private pos = 0

  get current(): string | null {
    return this.stationId
  }

  select(stationId: string | null) {
    if (stationId === this.stationId) return
    this.stationId = stationId

    if (!stationId) {
      zoneMusic.select(currentZone)
      return
    }

    const station = RADIO_STATIONS.find((s) => s.id === stationId)
    // An id that isn't a real station falls back to zone music rather than
    // silently doing nothing - the same "refuse, don't guess" the old
    // single-track lookup did.
    if (!station || !station.tracks.length) {
      this.stationId = null
      zoneMusic.select(currentZone)
      return
    }

    this.queue = shuffled(station.tracks)
    this.pos = 0
    this.playCurrent()
  }

  /** Clears the selection without falling back to zone music - for when a
   * custom stream is about to take the slot instead. */
  clearSilently() {
    this.stationId = null
  }

  /** Jump forward or back one track in the current station's playlist. A
   * no-op with no station selected. */
  skip(dir: 1 | -1) {
    if (!this.stationId || !this.queue.length) return
    this.pos = (this.pos + dir + this.queue.length) % this.queue.length
    this.playCurrent()
  }

  /**
   * Jump straight to one specific track by id, for search - "play this
   * song" rather than "play this station and hope it comes up." Loads that
   * track's own station's full queue (so skip/advance afterward still walk
   * the whole station, shuffled, the same as picking the station normally
   * would) but starts *at* the requested track instead of a random point in
   * it. A no-op if the id isn't in the pool at all - refuse, don't guess.
   */
  playTrackDirectly(trackId: string) {
    const stationId = TRACK_TO_STATION[trackId]
    const station = stationId ? RADIO_STATIONS.find((s) => s.id === stationId) : undefined
    if (!station) return

    this.stationId = station.id
    this.queue = shuffled(station.tracks)
    const idx = this.queue.findIndex((t) => t.id === trackId)
    if (idx > 0) {
      const [chosen] = this.queue.splice(idx, 1)
      this.queue.unshift(chosen)
    }
    this.pos = 0
    this.playCurrent()
  }

  private playCurrent() {
    const track = this.queue[this.pos]
    if (!track) return
    playMusic(
      RADIO_FILES[track.id],
      { title: track.title, composer: track.composer, source: 'radio' },
      {
      loop: false,
      onEnded: () => this.advance(),
      trackGain: TRACK_GAIN[track.id],
      }
    )
  }

  private advance() {
    this.pos++
    if (this.pos >= this.queue.length) {
      // Loop the list - reshuffle rather than replaying the identical order,
      // so a long play session does not have an audibly fixed cycle.
      this.queue = shuffled(this.queue)
      this.pos = 0
    }
    this.playCurrent()
  }
}

/**
 * Walks the current zone's playlist, same shape as `RadioPlayer` - shuffle
 * on entry, advance on `ended`, reshuffle rather than repeat the identical
 * order when the list loops. A zone with no playlist plays nothing; `setZone`'s
 * no-op-on-unchanged-id guard is what already stops this from restarting on
 * every room, so this player only has to care about zone *changes*, never
 * room changes within one.
 */
class ZoneMusicPlayer {
  private zoneId: string | null = null
  private queue: string[] = []
  private pos = 0

  select(zoneId: string | null) {
    this.zoneId = zoneId
    const ids = zoneId ? (ZONE_TRACKS[zoneId] ?? []) : []
    if (!ids.length) {
      music.play(null)
      setNowPlaying(null)
      return
    }
    this.queue = shuffled(ids)
    this.pos = 0
    this.playCurrent()
  }

  /** Jump forward or back one track in the current zone's playlist. */
  skip(dir: 1 | -1) {
    if (!this.queue.length) return
    this.pos = (this.pos + dir + this.queue.length) % this.queue.length
    this.playCurrent()
  }

  private playCurrent() {
    const id = this.queue[this.pos]
    const file = id ? RADIO_FILES[id] : undefined
    if (!file) return
    const meta = id ? TRACK_META[id] : undefined
    if (!meta) return
    playMusic(file, { ...meta, source: 'zone' }, {
      loop: false,
      onEnded: () => this.advance(),
      trackGain: id ? TRACK_GAIN[id] : undefined,
    })
  }

  private advance() {
    // `Layer.play()` pauses the outgoing element before the new one starts,
    // which stops a superseded track's `ended` from firing under normal use
    // - this guard is defense against the case where it does anyway (a zone
    // left to no playlist at all), not a claim the race is fully closed.
    if (this.zoneId === null) return
    this.pos++
    if (this.pos >= this.queue.length) {
      this.queue = shuffled(this.queue)
      this.pos = 0
    }
    this.playCurrent()
  }
}

/**
 * Walks a player's own hand-picked playlist (30 Aug 2026) - same shape as
 * `RadioPlayer`/`ZoneMusicPlayer` (shuffle on entry, advance on `ended`,
 * reshuffle rather than repeat when the list loops), the only real
 * difference being where the track list comes from: a station's is a fixed
 * slice of `manifest.json`, a playlist's is whatever a player added, so the
 * track ids arrive as a parameter at `select()` time rather than being
 * looked up from a module-level table the way `RadioPlayer` looks up
 * `RADIO_STATIONS`. This module owns no persisted state of its own -
 * playlists.ts does (same split as favorites.ts owning the favorites list
 * while this file only ever plays what it's told to).
 */
class PlaylistPlayer {
  private playlistId: string | null = null
  private queue: string[] = []
  private pos = 0

  get current(): string | null {
    return this.playlistId
  }

  select(playlistId: string | null, trackIds: string[]) {
    if (playlistId === this.playlistId) return
    this.playlistId = playlistId

    if (!playlistId || !trackIds.length) {
      this.playlistId = null
      return
    }

    this.queue = shuffled(trackIds)
    this.pos = 0
    this.playCurrent()
  }

  /** Clears the selection without playing anything else - the caller
   * decides what happens next (zone music, a station, a stream), same
   * division of responsibility as RadioPlayer.clearSilently. */
  clearSilently() {
    this.playlistId = null
  }

  /** Jump forward or back one track in the current playlist. */
  skip(dir: 1 | -1) {
    if (!this.playlistId || !this.queue.length) return
    this.pos = (this.pos + dir + this.queue.length) % this.queue.length
    this.playCurrent()
  }

  private playCurrent() {
    const id = this.queue[this.pos]
    const file = id ? RADIO_FILES[id] : undefined
    if (!file) return
    const meta = id ? TRACK_META[id] : undefined
    if (!meta) return
    playMusic(file, { ...meta, source: 'playlist' }, {
      loop: false,
      onEnded: () => this.advance(),
      trackGain: id ? TRACK_GAIN[id] : undefined,
    })
  }

  private advance() {
    if (this.playlistId === null) return
    this.pos++
    if (this.pos >= this.queue.length) {
      this.queue = shuffled(this.queue)
      this.pos = 0
    }
    this.playCurrent()
  }
}

const zoneMusic = new ZoneMusicPlayer()
const radio = new RadioPlayer()
const playlist = new PlaylistPlayer()

/**
 * Called on every zone report from the live bridge. A no-op unless the zone
 * actually changed - see this file's header for why that matters.
 */
export function setZone(zoneId: string | null) {
  if (zoneId === currentZone) return
  currentZone = zoneId

  // Radio, a custom stream, and a playlist, once selected, keep playing
  // across zone changes - all three are a deliberate override, not a
  // per-zone thing to interrupt.
  if (!radio.current && !customStreamUrl && !playlist.current) {
    zoneMusic.select(zoneId)
  }
}

/**
 * id or null to go back to zone music. An id not in RADIO_STATIONS is
 * refused, falling back to zone music.
 *
 * The `id === null` branch used to just call `radio.select(null)` and stop.
 * That's correct only when a *station* was the thing overriding zone music:
 * `RadioPlayer.select`'s own early-return ("already this value") also fires
 * when radio was never the active source at all - a custom stream or a
 * playlist was - because `radio.current` had been null the whole time.
 * "Zone music" then looked like it worked (the row highlighted, no error)
 * while the stream or playlist kept playing right through the click. Fixed
 * by deciding the fallback here, based on what was actually overriding,
 * rather than delegating entirely to a player that only knows its own
 * state. The already-on-zone-music case still does nothing, same as
 * before - a redundant click must not restart the current zone track from
 * a fresh shuffle.
 */
export function setRadioStation(id: string | null) {
  if (id !== null) {
    customStreamUrl = null
    playlist.clearSilently()
    radio.select(id)
    return
  }

  const radioWasActive = radio.current !== null
  const somethingWasOverriding = radioWasActive || customStreamUrl !== null || playlist.current !== null
  customStreamUrl = null
  playlist.clearSilently()
  if (radioWasActive) {
    radio.select(null) // clears radio's own state and falls back to zone music itself
  } else if (somethingWasOverriding) {
    zoneMusic.select(currentZone) // radio was never the override - fall back directly
  }
}

/** Play one specific track by id (search's "play this song" - see
 * RadioPlayer.playTrackDirectly). Clears a custom stream and a playlist
 * the same way picking a station does; a no-op if the id isn't in the
 * pool. */
export function playTrack(trackId: string) {
  customStreamUrl = null
  playlist.clearSilently()
  radio.playTrackDirectly(trackId)
}

export function currentRadioStation(): string | null {
  return radio.current
}

/**
 * id or null to go back to zone music, plus the playlist's own track ids -
 * this module has no persisted playlist state of its own (see
 * `PlaylistPlayer`'s header), so the caller (playlists.ts's own reader, or
 * GamePane's restore-on-mount effect) hands them over rather than this
 * function looking them up itself. Mutually exclusive with a station and a
 * custom stream, same as those are with each other - only one thing ever
 * occupies the `music` slot.
 */
export function setPlaylist(id: string | null, trackIds: string[] = []) {
  // Same top-level guard setCustomStream has, for the same reason: without
  // it, calling setPlaylist(null) while no playlist is even playing would
  // still fall through to zoneMusic.select(currentZone) and restart the
  // current zone track from a freshly shuffled position - a redundant
  // click producing an audible interruption.
  if (id === playlist.current) return
  if (id) {
    customStreamUrl = null
    radio.clearSilently()
    playlist.select(id, trackIds)
  } else {
    playlist.clearSilently()
    zoneMusic.select(currentZone)
  }
}

export function currentPlaylistId(): string | null {
  return playlist.current
}

/**
 * A player-supplied stream URL - an Icecast/Shoutcast station, or any other
 * direct audio URL - played in the same `music` slot the built-in radio
 * stations use. This is the literal "plug in other radio sources" ask: it
 * covers any station whose raw stream URL someone hands the app, not just
 * the four curated ones. Mutually exclusive with a built-in station, a
 * playlist, and zone music, same as those are with each other - only one
 * thing ever occupies the slot. `null` goes back to zone music.
 *
 * No licence/attribution bookkeeping here, unlike the curated `manifest.json`
 * pool - a player pointing this at their own stream is responsible for what
 * they play, the same way plugging a physical radio into a speaker is.
 */
let customStreamUrl: string | null = null
export function setCustomStream(url: string | null) {
  if (url === customStreamUrl) return
  customStreamUrl = url
  if (url) {
    radio.clearSilently()
    playlist.clearSilently()
    playMusic(url, { title: url, composer: '', source: 'custom' }, { loop: true })
  } else {
    zoneMusic.select(currentZone)
  }
}

export function currentCustomStream(): string | null {
  return customStreamUrl
}

/** Skip a track forward (1) or back (-1) in whatever's currently in the
 * `music` slot. A no-op on a custom stream - a live stream has no track to
 * skip to. */
export function skipTrack(dir: 1 | -1) {
  if (customStreamUrl) return
  if (radio.current) radio.skip(dir)
  else if (playlist.current) playlist.skip(dir)
  else zoneMusic.skip(dir)
}

/**
 * 0 to 1.5 (0% to 150%); 0 configures the music channel silent. The master
 * gate is separate; see `Layer`'s header. Default 0 (28 Aug 2026, Dan) - a first run
 * starts silent; kept in sync by hand with persistence.ts's own default.
 */
let musicGain: number = DEFAULT_AUDIO_VOLUMES.music
const musicVolumeListeners = new Set<(v: number) => void>()
export function setMusicVolume(v: number) {
  musicGain = Math.max(0, Math.min(1.5, v))
  music.setGain(musicGain)
  for (const l of musicVolumeListeners) l(musicGain)
}
export function musicVolume(): number {
  return musicGain
}
/**
 * Subscribe to volume changes made anywhere, not just by the caller's own
 * slider - needed once something other than SoundControls' own slider can
 * change this number, which `initMediaSession` below is: an OS-level pause
 * has to be visible on the panel too, or the slider would silently disagree
 * with what's actually playing, the exact bug class this file's own
 * configured-gain design was built to avoid.
 */
export function onMusicVolumeChange(fn: (v: number) => void): () => void {
  musicVolumeListeners.add(fn)
  return () => musicVolumeListeners.delete(fn)
}

/**
 * Ramp `musicGain` to `target` over `ms` instead of jumping - a track-to-
 * track switch already crossfades (`Layer.fadeIn`/`fadeOutAndStop`, both
 * `FADE_MS`), and play/pause landing instantly while skip fades smoothly
 * read as a real inconsistency once both exist in one panel (29 Aug 2026,
 * Dan: "there should be a fade in and out... a couple of seconds"). Reuses
 * `setMusicVolume` for every step rather than touching `music`/`musicGain`
 * directly, so every subscriber (the slider, the media session's
 * `playbackState`) sees the same smooth ramp a listener hears, not a jump
 * they'd have to explain.
 *
 * A second call cancels whatever ramp was already running and starts fresh
 * from the current (possibly mid-fade) level - rapid play/pause taps should
 * chase the latest tap, not queue up stale ones.
 */
let fadeTimer: ReturnType<typeof setInterval> | null = null
function fadeMusicVolume(target: number, ms = FADE_MS) {
  if (fadeTimer) clearInterval(fadeTimer)
  const start = musicGain
  const clamped = Math.max(0, Math.min(1.5, target))
  const steps = Math.max(1, Math.round(ms / TICK_MS))
  let step = 0
  fadeTimer = setInterval(() => {
    step++
    setMusicVolume(start + (clamped - start) * (step / steps))
    if (step >= steps) {
      if (fadeTimer) clearInterval(fadeTimer)
      fadeTimer = null
    }
  }, TICK_MS)
}

/**
 * Pause/resume for the media-session play/pause buttons (initMediaSession
 * below) - remembers the level muted from and restores exactly that, same
 * "0% is the only mute state, but something has to remember where to go
 * back to" contract as SoundControls' own per-channel mute buttons. Kept at
 * the module level rather than in a component so it works regardless of
 * which UI, if any, is mounted when the OS sends the action.
 */
let preMuteMusicGain: number | null = null
export function pauseMusic() {
  if (musicGain <= 0) return
  preMuteMusicGain = musicGain
  fadeMusicVolume(0)
}
export function resumeMusic() {
  fadeMusicVolume(preMuteMusicGain ?? 0.45)
  preMuteMusicGain = null
}

/** For a hard reset - leaving a character, or a settings reload. */
export function stopMusic() {
  music.stop()
  currentZone = null
  customStreamUrl = null
  playlist.clearSilently()
  radio.select(null)
  setNowPlaying(null)
}

/**
 * Wire the app's own music into the OS's media controls - Windows' Now
 * Playing UI/taskbar thumbnail, and physical/software media keys - so
 * DR Companion is a citizen of the same system it can already send media
 * keys *to* (see externalMedia.ts). WebView2 is Chromium-based and
 * `navigator.mediaSession` works the same way it does in a browser, but this
 * still guards on the API's presence rather than assuming a Tauri build
 * implies it: `ambient-test.mjs` imports this module in plain Node, where
 * `navigator` does not exist at all, and a browser without the API should
 * fail this check the same quiet way it falls back for Web Audio elsewhere
 * in this file.
 *
 * Call once, from a mount effect - not at module scope, which is exactly
 * where a Node-imported top-level `navigator` reference would throw before
 * `ambient-test.mjs` ever got to the parts of this file it actually tests.
 */
export function initMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return

  const ms = navigator.mediaSession
  onNowPlayingChange((np) => {
    ms.metadata = np
      ? new MediaMetadata({ title: np.title, artist: np.composer || 'DR Companion', album: 'DR Companion' })
      : null
    ms.playbackState = np ? (np.status === 'playing' && musicGain > 0 ? 'playing' : 'paused') : 'none'
  })
  onMusicVolumeChange((v) => {
    ms.playbackState = nowPlayingState
      ? nowPlayingState.status === 'playing' && v > 0
        ? 'playing'
        : 'paused'
      : 'none'
  })
  ms.setActionHandler('play', resumeMusic)
  ms.setActionHandler('pause', pauseMusic)
  ms.setActionHandler('previoustrack', () => skipTrack(-1))
  ms.setActionHandler('nexttrack', () => skipTrack(1))
}
