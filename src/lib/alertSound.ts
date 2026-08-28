/**
 * Playing the sounds a highlight names.
 *
 * The corpus is deliberately quiet - 13 of 57 entries carry a sound - because
 * a client that pings constantly is a client people mute, and a muted client
 * has no alerts at all. That policy is enforced by a test in
 * `dr-genie-settings/validate.mjs`, and it only holds if this file does not
 * undo it at playback time.
 *
 * So there are two limits here that the config cannot express, and both exist
 * because of things measured in play rather than imagined.
 */
import { invokeTauri, isTauri } from './tauri'

/**
 * The same sound cannot fire more than once in this window.
 *
 * Firulf Vista produced nine arrivals in ninety seconds - one every ten. Any
 * entry that fires on a burst would, without this, play nine overlapping
 * copies of the same WAV, which is worse than nine separate ones because it
 * arrives as a single smeared noise nobody can identify.
 *
 * Per sound rather than global: a creature entering while somebody is talking
 * to you is two different facts and you want to hear both.
 */
const PER_SOUND_MS = 3000

/**
 * And a ceiling across all sounds, because several quiet rules can be loud
 * together.
 *
 * The config policy reasons about each entry alone. Nothing in it prevents
 * four different entries matching four lines of one room description.
 */
const GLOBAL_MS = 400

const cache = new Map<string, HTMLAudioElement | null>()
/**
 * A `GainNode` per loaded sound, routed `MediaElementSource -> gain ->
 * destination`, so volume can actually exceed 100%. `HTMLAudioElement.volume`
 * is spec-clamped to [0, 1] - setting it above 1 throws in a strict
 * implementation - so a slider that goes to 150% needs Web Audio to mean
 * anything past 100%, not just a bigger number nothing reads. Created once
 * per element and cached alongside it, because `createMediaElementSource`
 * can only be called once per `<audio>` element ever - calling it twice
 * throws "already connected".
 */
const gains = new Map<string, GainNode>()
let audioCtx: AudioContext | null = null
const lastPlayed = new Map<string, number>()
let lastAny = 0

/**
 * 0 to 1.5 (0% to 150%), same range as ambientSound.ts's two channels - no
 * separate mute flag, 0 silences alerts, one control instead of a slider
 * plus a button that can drift out of sync with it.
 *
 * Default lowered 0.8 -> 0.45 (28 Aug 2026, Dan: "fix the sounds... they are
 * a menace right now"), alongside cutting the alert WAVs themselves down
 * from 0 dBFS peak (maximum digital loudness, no headroom - measured with
 * `ffmpeg -af volumedetect`, every one of the six pegged at max_volume: -0.0
 * dB) to -8 dB peak. Two different problems, both real: the files were
 * mastered too hot, and the multiplier on top of them was too high. Fixing
 * only one would have still left alerts too loud most of the way to 100%.
 * Persisted by the caller (GamePane), not here: this module has no opinion
 * about storage, only about what plays right now.
 */
let volume = 0.45
export function setAlertsVolume(v: number) {
  volume = Math.max(0, Math.min(1.5, v))
}
export function alertsVolume() {
  return volume
}

/** Names that turned out not to exist, so a missing file is asked for once. */
const missing = new Map<string, string>()
export function missingSounds(): Map<string, string> {
  return missing
}

async function load(name: string): Promise<HTMLAudioElement | null> {
  if (cache.has(name)) return cache.get(name) ?? null
  if (!isTauri()) {
    cache.set(name, null)
    return null
  }

  try {
    const file = (await invokeTauri('read_sound', { name })) as {
      found: boolean
      dataUrl: string
      note: string
    }
    if (!file.found) {
      // Cached as absent so a config naming a file nobody installed does not
      // ask the disk again on every matching line.
      missing.set(name, file.note)
      cache.set(name, null)
      return null
    }
    const audio = new Audio(file.dataUrl)
    audio.preload = 'auto'
    cache.set(name, audio)

    // Web Audio routing is best-effort: a browser without it, or one that
    // refuses to create a context before a user gesture, still gets sound -
    // just capped at 100% via the element's own `volume` in `playAlert`,
    // which is a real fallback rather than a silent failure to boost.
    try {
      audioCtx ??= new AudioContext()
      const source = audioCtx.createMediaElementSource(audio)
      const gain = audioCtx.createGain()
      source.connect(gain).connect(audioCtx.destination)
      gains.set(name, gain)
    } catch {
      /* Fall back to audio.volume, capped at 100%. */
    }

    return audio
  } catch (e) {
    missing.set(name, String(e))
    cache.set(name, null)
    return null
  }
}

/**
 * Play a named alert, subject to the limits above.
 *
 * Never throws and never awaits anything the caller cares about: this is
 * called from the render path of a text pane, and a sound failing is not a
 * reason for a line of game text not to appear.
 */
export function playAlert(name: string) {
  if (volume <= 0 || !name) return

  const now = Date.now()
  if (now - lastAny < GLOBAL_MS) return
  if (now - (lastPlayed.get(name) ?? 0) < PER_SOUND_MS) return

  lastAny = now
  lastPlayed.set(name, now)

  void load(name).then((audio) => {
    if (!audio) return
    try {
      // Rewound rather than a fresh element per play. Two alerts a second
      // apart otherwise leave two objects behind, and over an evening that is
      // thousands.
      audio.currentTime = 0
      const gain = gains.get(name)
      if (gain) {
        // Routed through Web Audio: the element itself stays at full scale
        // and the GainNode carries the real level, which is what lets it
        // exceed 100%.
        audio.volume = 1
        gain.gain.value = volume
      } else {
        // No Web Audio route - the native element cap at 1.0 quietly limits
        // this to 100%, which is a real ceiling, not a bug.
        audio.volume = Math.min(1, volume)
      }
      void audio.play().catch(() => {
        /* Autoplay policy, or no audio device. Not worth interrupting play. */
      })
    } catch {
      /* Same. */
    }
  })
}

/** Forget everything, for when the config is reloaded. */
export function resetAlerts() {
  cache.clear()
  gains.clear()
  lastPlayed.clear()
  missing.clear()
  lastAny = 0
}
