/**
 * Playing the sounds a highlight names.
 *
 * The corpus is deliberately quiet - 14 of 58 entries carry a sound, still
 * under `dr-genie-settings/validate.mjs`'s one-in-three ceiling - because a
 * client that pings constantly is a client people mute, and a muted client
 * has no alerts at all. That policy holds only if this file does not undo it
 * at playback time.
 *
 * The channel/throttle decision itself - which of System/Danger/Speech a
 * sound's highlight `class` lands on, and what cooldown gates it - lives in
 * `alertGate.ts`, split out so it has no `Audio`/Tauri dependency and can be
 * tested in plain Node. See that file's own header for the channel-split and
 * per-class-throttle reasoning; this file is the playback half only.
 */
import { invokeTauri, isTauri } from './tauri'
import { alertGate, GLOBAL_MS, type AlertChannel } from './alertGate'
import { effectiveAudioGain, masterMuted } from './audioMaster.ts'
import { DEFAULT_AUDIO_VOLUMES } from './audioDefaults.ts'
import {
  clearAlertPlaybackFailure,
  recordAlertPlaybackFailure,
  resetAlertPlaybackFailures,
} from './alertPlaybackStatus'

export type { AlertChannel } from './alertGate'

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
 * 0 to 1.5 (0% to 150%) per channel, same range as ambientSound.ts's - no
 * separate mute flag, 0 silences a channel, one control instead of a slider
 * plus a button that can drift out of sync with it.
 *
 * Default lowered 0.8 -> 0.45 (28 Aug 2026, Dan: "fix the sounds... they are
 * a menace right now"), alongside cutting the alert WAVs themselves down
 * from 0 dBFS peak (maximum digital loudness, no headroom - measured with
 * `ffmpeg -af volumedetect`, every one of the six pegged at max_volume: -0.0
 * dB) to -8 dB peak. Two different problems, both real: the files were
 * mastered too hot, and the multiplier on top of them was too high. Fixing
 * only one would have still left alerts too loud most of the way to 100%.
 *
 * Lowered again to 0 (28 Aug 2026, same day) - a first run should start
 * silent, not at a tuned "reasonable" level nobody asked for.
 *
 * Split into three channels (29 Aug 2026) - see this file's own header.
 * Persisted by the caller (GamePane), not here: this module has no opinion
 * about storage, only about what plays right now. `persistence.ts`'s
 * `alertsVolume`/`dangerVolume`/`speechVolume` are kept in sync by hand with
 * these three defaults, all 0, for the same "a first run should start
 * silent" reason.
 */
const volumes: Record<AlertChannel, number> = {
  system: DEFAULT_AUDIO_VOLUMES.system,
  danger: DEFAULT_AUDIO_VOLUMES.danger,
  speech: DEFAULT_AUDIO_VOLUMES.speech,
}

export function setChannelVolume(channel: AlertChannel, v: number) {
  volumes[channel] = Math.max(0, Math.min(1.5, v))
}
export function channelVolume(channel: AlertChannel): number {
  return volumes[channel]
}

/** System channel - kept under the old name since it's the one every
 * existing caller and persisted pref already knows, and System (idle
 * warning, disconnects, learning cues) is what "Alerts" meant before the
 * channel split. */
export function setAlertsVolume(v: number) {
  setChannelVolume('system', v)
}
export function alertsVolume() {
  return channelVolume('system')
}

export function setDangerVolume(v: number) {
  setChannelVolume('danger', v)
}
export function dangerVolume() {
  return channelVolume('danger')
}

export function setSpeechVolume(v: number) {
  setChannelVolume('speech', v)
}
export function speechVolume() {
  return channelVolume('speech')
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
 * `cls` is the matched highlight's `class` (highlights.cfg's own grouping) -
 * see `alertGate` for how it picks a channel and a throttle. Callers with no
 * class (or one this module doesn't recognize) land on the System channel
 * and the per-sound-file floor - the same behaviour this function had before
 * the channel split.
 *
 * Never throws and never awaits anything the caller cares about: this is
 * called from the render path of a text pane, and a sound failing is not a
 * reason for a line of game text not to appear.
 */
export function playAlert(name: string, cls?: string, options: { preview?: boolean } = {}) {
  const { channel, throttleMs, throttleKey } = alertGate(name, cls)
  const vol = effectiveAudioGain(volumes[channel])
  if (vol <= 0 || !name) return

  const now = Date.now()
  if (!options.preview && now - lastAny < GLOBAL_MS) return
  if (!options.preview && now - (lastPlayed.get(throttleKey) ?? 0) < throttleMs) return

  if (!options.preview) {
    lastAny = now
    lastPlayed.set(throttleKey, now)
  }

  void load(name).then((audio) => {
    if (!audio || masterMuted()) return
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
        gain.gain.value = vol
      } else {
        // No Web Audio route - the native element cap at 1.0 quietly limits
        // this to 100%, which is a real ceiling, not a bug.
        audio.volume = Math.min(1, vol)
      }
      void audio.play()
        .then(() => clearAlertPlaybackFailure(name))
        .catch((error) => recordAlertPlaybackFailure(name, error))
    } catch (error) {
      recordAlertPlaybackFailure(name, error)
    }
  })
}

/** Forget everything, for when the config is reloaded. */
export function resetAlerts() {
  cache.clear()
  gains.clear()
  lastPlayed.clear()
  missing.clear()
  resetAlertPlaybackFailures()
  lastAny = 0
}
