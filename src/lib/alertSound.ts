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
const lastPlayed = new Map<string, number>()
let lastAny = 0

/**
 * 0 to 1, no separate mute flag - 0 silences alerts the same way it silences
 * ambience in ambientSound.ts, one control instead of a slider plus a
 * button that can drift out of sync with it. Alerts default louder than the
 * ambience layers do, because they are short one-shots meant to be noticed,
 * not a background bed. Persisted by the caller (GamePane), not here: this
 * module has no opinion about storage, only about what plays right now.
 */
let volume = 0.8
export function setAlertsVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
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
      audio.volume = volume
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
  lastPlayed.clear()
  missing.clear()
  lastAny = 0
}
