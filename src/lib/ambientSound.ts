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

const FADE_MS = 2500
const TICK_MS = 50

/**
 * The one music layer, faded rather than cut. Loops by default; radio and
 * zone playlists both turn that off and drive `onEnded` instead.
 *
 * Volume has two parts, multiplied together. `mix` is the level the caller
 * asks for at `play()` time - kept deliberately modest (0.22, Dan's "blend
 * into the background" instruction, 28 Aug 2026) so the 100% gain position
 * is already a reasonable level rather than a starting point to find by ear.
 * `gain` is the listener's own slider, 0 to 1.5 (0% to 150%), default 1 -
 * turning gain to 0 is how this goes silent; there is no separate mute flag
 * to fall out of sync with the slider.
 */
class Layer {
  private el: HTMLAudioElement | null = null
  private mix = 0
  private gain = 1

  private get target(): number {
    return this.mix * this.gain
  }

  setGain(v: number) {
    this.gain = Math.max(0, Math.min(1.5, v))
    if (this.el) this.el.volume = this.target
  }

  /**
   * Swap to a new source, crossfading out the old and in the new. Same src is
   * a no-op - callers that want the same file to restart (radio advancing to
   * the next track happens to sometimes land on the same file in a small
   * station) should not rely on `play` for that; nothing here currently needs
   * to.
   */
  play(src: string | null, mix = 0.22, opts?: { loop?: boolean; onEnded?: () => void }) {
    if (src === (this.el?.dataset.src ?? null)) return
    this.mix = mix

    const dying = this.el
    if (dying) this.fadeOutAndStop(dying)

    if (!src) {
      this.el = null
      return
    }

    const next = new Audio(src)
    next.loop = opts?.loop ?? true
    next.volume = 0
    next.dataset.src = src
    if (opts?.onEnded) next.addEventListener('ended', opts.onEnded)
    // Autoplay policy or a missing file both land here; a background track
    // failing to start is not worth surfacing as an error to the player.
    void next.play().catch(() => {})
    this.el = next
    this.fadeIn(next)
  }

  stop() {
    if (this.el) this.fadeOutAndStop(this.el)
    this.el = null
  }

  private fadeIn(el: HTMLAudioElement) {
    const target = this.target
    const step = target / (FADE_MS / TICK_MS)
    const timer = setInterval(() => {
      el.volume = Math.min(target, el.volume + step)
      if (el.volume >= target - 0.001) clearInterval(timer)
    }, TICK_MS)
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

let currentZone: string | null = null

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

  private playCurrent() {
    const track = this.queue[this.pos]
    if (!track) return
    music.play(RADIO_FILES[track.id], 0.22, { loop: false, onEnded: () => this.advance() })
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
      return
    }
    this.queue = shuffled(ids)
    this.pos = 0
    this.playCurrent()
  }

  private playCurrent() {
    const id = this.queue[this.pos]
    const file = id ? RADIO_FILES[id] : undefined
    if (!file) return
    music.play(file, 0.22, { loop: false, onEnded: () => this.advance() })
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

const zoneMusic = new ZoneMusicPlayer()
const radio = new RadioPlayer()

/**
 * Called on every zone report from the live bridge. A no-op unless the zone
 * actually changed - see this file's header for why that matters.
 */
export function setZone(zoneId: string | null) {
  if (zoneId === currentZone) return
  currentZone = zoneId

  // Radio, once selected, keeps playing across zone changes - it is a
  // deliberate override, not a per-zone thing to interrupt.
  if (!radio.current) {
    zoneMusic.select(zoneId)
  }
}

/** id or null to go back to zone music. An id not in RADIO_STATIONS is refused, falling back to zone music. */
export function setRadioStation(id: string | null) {
  radio.select(id)
}

export function currentRadioStation(): string | null {
  return radio.current
}

/**
 * 0 to 1.5 (0% to 150%); 0 is silent, and there is no separate mute flag -
 * see `Layer`'s header for why. Default 0 (28 Aug 2026, Dan) - a first run
 * starts silent; kept in sync by hand with persistence.ts's own default.
 */
let musicGain = 0
export function setMusicVolume(v: number) {
  musicGain = Math.max(0, Math.min(1.5, v))
  music.setGain(musicGain)
}
export function musicVolume(): number {
  return musicGain
}

/** For a hard reset - leaving a character, or a settings reload. */
export function stopMusic() {
  music.stop()
  currentZone = null
  radio.select(null)
}
