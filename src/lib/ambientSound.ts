/**
 * The world's background: terrain ambience, per-zone music, and an optional
 * radio override, layered the way the Mud Sound Protocol has laid this out
 * for decades - room/zone music overrides area ambience, never replaces it,
 * and nothing here is game audio ripped from DragonRealms. Everything under
 * public/audio/ is sourced and licensed in data/audio/manifest.json.
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
 * # Two independent tracks, one of them optional
 *
 * Ambient (ambient.*) is the terrain texture - wind, water, cave drips -
 * looked up by the zone's biome in zone-biomes.json. It has broad coverage
 * because every zone has a biome.
 *
 * Music (music.*) is the zone's own theme - not one file but a *playlist*,
 * same shape as radio: `manifest.json`'s `zone` object maps a zone id to a
 * list of track ids (reusing the same pool of tracks radio stations draw
 * from - there is no separate zone-only file set), built to run roughly an
 * hour before it loops (Dan's ask, 28 Aug 2026 - one-hour region playlists,
 * aware of what the zone actually is rather than only its biome). A zone
 * with no playlist plays ambience only, which is silence in the music slot,
 * not an error - correct for a layer whose whole job is optional.
 *
 * # Radio is a third track, not a mode - and a station, not a track
 *
 * A Fallout-style radio, not a jukebox: selecting a station starts a
 * *playlist* that loops and advances on its own, the way Galaxy News Radio
 * does not stop after one song. `data/audio/manifest.json`'s `radio` array
 * is a flat list of tracks, each tagged with a `station` id; `RADIO_STATIONS`
 * groups them for a picker, and `RadioPlayer` below is what actually walks
 * a station's list - shuffled once per station switch so the order isn't
 * identical every time, looping the whole list rather than one track.
 *
 * Selecting a station swaps what plays in the music slot without touching
 * ambient - the terrain keeps breathing under whatever is playing on top of
 * it, same as a real radio does not turn off the wind outside.
 */
// The `with { type: 'json' }` attribute is required by plain Node ESM (which
// tools/ambient-test.mjs uses to import this file directly, the same way
// trail-test.mjs and flow-test.mjs import .ts sources elsewhere in this
// repo) even though Vite accepts a bare JSON import without it. Without the
// attribute this module fails to import outside a bundler at all.
import zoneBiomes from '../../data/audio/zone-biomes.json' with { type: 'json' }
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

type Biome = keyof typeof BIOME_FILES

const BIOME_FILES = {
  forest: '/audio/biome/forest.ogg',
  town: '/audio/biome/town.mp3',
  cave: '/audio/biome/cave.mp3',
  dungeon: '/audio/biome/dungeon.ogg',
  // Stand-ins, not yet given their own track - see docs/AUDIO.md.
  wilderness: '/audio/biome/forest.ogg',
  water: '/audio/biome/forest.ogg',
  road: '/audio/biome/forest.ogg',
  settlement: '/audio/biome/town.mp3',
  interior: '/audio/biome/town.mp3',
  badlands: '/audio/biome/forest.ogg',
  liminal: '/audio/biome/forest.ogg',
} as const

/**
 * Every biome resolves to a real file today, several of them sharing the two
 * tracks fetched so far as a stand-in. That is stated here rather than left
 * for someone to discover by ear: `data/audio/manifest.json` is where a
 * biome's own track gets added, and `BIOME_FILES` is the only other place
 * that has to change.
 */
const FALLBACK_BIOME: Biome = 'wilderness'

const ZONE_BIOMES: Record<string, { name: string; biome: string }> = zoneBiomes

const FADE_MS = 2500
const TICK_MS = 50

/**
 * One layer, faded rather than cut. Loops by default; radio turns that off
 * and drives `onEnded` instead.
 *
 * Volume has two parts, multiplied together. `mix` is the per-track balance
 * this file's own callers set - ambient always quieter than music, so the
 * two never fight for attention - and it is deliberately small: Dan's
 * instruction (28 Aug 2026) was to tune these down to blend into the
 * background rather than sit forward, so the base levels below are already
 * "quiet" before a listener touches anything. `gain` is the listener's own
 * slider, 0 to 1.5 (0% to 150%), default 1 - turning a layer's gain to 0 is
 * how it goes silent; there is no separate mute flag to fall out of sync
 * with the slider.
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
  play(src: string | null, mix = 0.2, opts?: { loop?: boolean; onEnded?: () => void }) {
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

const ambient = new Layer()
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
 * order when the list loops. A zone with no playlist plays nothing in the
 * music slot; `setZone`'s no-op-on-unchanged-id guard is what already stops
 * this from restarting on every room, so this player only has to care about
 * zone *changes*, never room changes within one.
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

/** Does this zone id have a biome we know about? Unknown zones get the fallback, quietly. */
function biomeFor(zoneId: string): Biome {
  const b = ZONE_BIOMES[zoneId]?.biome
  return b && b in BIOME_FILES ? (b as Biome) : FALLBACK_BIOME
}

/**
 * Called on every zone report from the live bridge. A no-op unless the zone
 * actually changed - see this file's header for why that matters.
 */
export function setZone(zoneId: string | null) {
  if (zoneId === currentZone) return
  currentZone = zoneId

  if (!zoneId) {
    ambient.play(null)
    if (!radio.current) zoneMusic.select(null)
    return
  }

  ambient.play(BIOME_FILES[biomeFor(zoneId)], 0.15)

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
 * Ambience (terrain texture) and music (zone playlist / radio) have their
 * own independent volumes rather than a shared mute - a listener who wants
 * the wind and birds but not a music bed, or the other way round, should be
 * able to have exactly that. 0 to 1.5 (0% to 150%); 0 is silent, and there
 * is no separate mute flag - see `Layer`'s header for why.
 */
let ambientGain = 1
export function setAmbientVolume(v: number) {
  ambientGain = Math.max(0, Math.min(1.5, v))
  ambient.setGain(ambientGain)
}
export function ambientVolume(): number {
  return ambientGain
}

let musicGain = 1
export function setMusicVolume(v: number) {
  musicGain = Math.max(0, Math.min(1.5, v))
  music.setGain(musicGain)
}
export function musicVolume(): number {
  return musicGain
}

/** For a hard reset - leaving a character, or a settings reload. */
export function stopAmbience() {
  ambient.stop()
  music.stop()
  currentZone = null
  radio.select(null)
}
