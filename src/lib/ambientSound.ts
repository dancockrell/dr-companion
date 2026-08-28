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
 * Music (music.*) is the zone's own theme, one file per zone id, tried by
 * convention (`/audio/zone/<id>.*`) rather than looked up in a bundled
 * manifest - the same "try it, degrade if it is not installed" shape as
 * `roomArtUrl` in roomText.ts. Most zones do not have one yet. That is not a
 * bug to hide: `zoneHasMusic()` reports it so a settings panel can say so
 * instead of a silent gap nobody can tell from "muted".
 *
 * # Radio is a third track, not a mode
 *
 * Selecting a station swaps what plays in the music slot without touching
 * ambient - the terrain keeps breathing under whatever is playing on top of
 * it, same as a real radio does not turn off the wind outside.
 */
import zoneBiomes from '../../data/audio/zone-biomes.json'

type Biome = keyof typeof BIOME_FILES

const BIOME_FILES = {
  forest: '/audio/biome/forest.ogg',
  town: '/audio/biome/town.mp3',
  wilderness: '/audio/biome/forest.ogg',
  water: '/audio/biome/forest.ogg',
  road: '/audio/biome/forest.ogg',
  settlement: '/audio/biome/town.mp3',
  interior: '/audio/biome/town.mp3',
  dungeon: '/audio/biome/forest.ogg',
  cave: '/audio/biome/forest.ogg',
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

/** One looping layer, faded rather than cut. */
class Layer {
  private el: HTMLAudioElement | null = null
  private targetVolume = 0
  private fadeTimer: ReturnType<typeof setInterval> | null = null
  private muted = false

  setMuted(v: boolean) {
    this.muted = v
    if (this.el) this.el.volume = v ? 0 : this.targetVolume
  }

  /** Swap to a new source, crossfading out the old and in the new. Same src is a no-op. */
  play(src: string | null, volume = 0.35) {
    if (src === (this.el?.dataset.src ?? null)) return
    this.targetVolume = volume

    const dying = this.el
    if (dying) this.fadeOutAndStop(dying)

    if (!src) {
      this.el = null
      return
    }

    const next = new Audio(src)
    next.loop = true
    next.volume = 0
    next.dataset.src = src
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
    if (this.fadeTimer) clearInterval(this.fadeTimer)
    const step = (this.muted ? 0 : this.targetVolume) / (FADE_MS / TICK_MS)
    this.fadeTimer = setInterval(() => {
      el.volume = Math.min(this.muted ? 0 : this.targetVolume, el.volume + step)
      if (el.volume >= (this.muted ? 0 : this.targetVolume) - 0.001 && this.fadeTimer) {
        clearInterval(this.fadeTimer)
        this.fadeTimer = null
      }
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
let radioStation: string | null = null

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
    if (!radioStation) music.play(null)
    return
  }

  ambient.play(BIOME_FILES[biomeFor(zoneId)], 0.3)

  // Radio, once selected, keeps playing across zone changes - it is a
  // deliberate override, not a per-zone thing to interrupt.
  if (!radioStation) {
    music.play(`/audio/zone/${zoneId}.mp3`, 0.4)
  }
}

/** id or null to go back to zone music. Unknown stations are refused, silently falling back. */
export function setRadioStation(id: string | null) {
  radioStation = id
  if (id) {
    music.play(`/audio/radio/${id}.mp3`, 0.4)
  } else if (currentZone) {
    music.play(`/audio/zone/${currentZone}.mp3`, 0.4)
  } else {
    music.play(null)
  }
}

export function currentRadioStation(): string | null {
  return radioStation
}

let muted = false
export function setAmbienceMuted(v: boolean) {
  muted = v
  ambient.setMuted(v)
  music.setMuted(v)
}
export function ambienceMuted(): boolean {
  return muted
}

/** For a hard reset - leaving a character, or a settings reload. */
export function stopAmbience() {
  ambient.stop()
  music.stop()
  currentZone = null
}
