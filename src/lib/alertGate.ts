/**
 * The channel/throttle decision behind `alertSound.ts`'s `playAlert` - which
 * channel a sound named alongside a highlight `class` lands on, and what
 * cooldown/key throttles it. Pure and dependency-free on purpose: no `Audio`
 * constructor, no Tauri import, so `tools/alert-throttle-test.mjs` can
 * exercise the real decision logic in plain Node rather than duplicating it
 * into a fixture that could drift from what actually ships.
 *
 * # Channels, not one slider
 *
 * "Alerts" used to be a single volume covering everything from the idle
 * warning to a whisper to a creature entering. That meant a listener
 * bothered by one kind of ping had to give up all of them - the same
 * all-or-nothing shape that made the config itself lose sound on combat
 * entirely once (28 Aug 2026, Dan: "the alerts... way too much... a
 * cacophony of noise"). `CHANNEL_FOR_CLASS` below splits a highlight's
 * `class` (highlights.cfg's own grouping) into three channels a listener can
 * balance independently: System (the idle warning, disconnects, learning
 * cues - low frequency, high cost to miss), Danger (a creature entering, a
 * bad wound, bleeding, something lodged or attached), and Speech (someone
 * waiting on you personally). Persisted separately - see persistence.ts's
 * `alertsVolume`/`dangerVolume`/`speechVolume`.
 *
 * # Throttled per class, not just per sound file
 *
 * A sound not retriggering inside a short window (`PER_SOUND_MS`) was the
 * whole rate limit until 29 Aug 2026, and it is not enough for combat:
 * capping how often Hit.wav can *retrigger* does not cap how many times a
 * fight retriggers it, so a fight-long stream of hits re-crossing a
 * 3-second floor is still a fight-long stream of dings. That is what took
 * sound off bleeding, wound severity, lodged items and parasites entirely
 * (see highlights.cfg's own history) - trading noise for silence on
 * information a listener with alerts muted still wants.
 *
 * `THROTTLE_MS_FOR_CLASS` fixes the actual defect: the `wounds` class is
 * throttled as a *class*, one ding per 30 seconds no matter how many
 * different wounds-class lines match inside that window, rather than one
 * ding per 3 seconds per distinct sound file. A bad fight now sounds like an
 * occasional reminder instead of a metronome, and bleeding/severe
 * wounds/lodged items/parasites could all get their sound back on
 * highlights.cfg's side without reproducing the cacophony. See that file's
 * 29 Aug 2026 note for the config-side half of this change.
 */

export type AlertChannel = 'system' | 'danger' | 'speech'

/**
 * A highlight without a `class` (or one this map doesn't name) lands on
 * System - the conservative default, since System is where the one alert
 * that costs a session (the idle warning) lives, and an unrecognized class
 * should not go silent by accident.
 */
const CHANNEL_FOR_CLASS: Record<string, AlertChannel> = {
  alert: 'system',
  learning: 'system',
  danger: 'danger',
  wounds: 'danger',
  speech: 'speech',
}

function channelFor(cls: string | undefined): AlertChannel {
  return (cls ? CHANNEL_FOR_CLASS[cls] : undefined) ?? 'system'
}

/**
 * The same sound cannot fire more than once in this window - the default for
 * any class not named in `THROTTLE_MS_FOR_CLASS` below.
 *
 * Firulf Vista produced nine arrivals in ninety seconds - one every ten. Any
 * entry that fires on a burst would, without this, play nine overlapping
 * copies of the same WAV, which is worse than nine separate ones because it
 * arrives as a single smeared noise nobody can identify.
 *
 * Per sound rather than global: a creature entering while somebody is talking
 * to you is two different facts and you want to hear both.
 */
export const PER_SOUND_MS = 3000

/**
 * A class-wide floor, keyed by the highlight's `class` rather than its sound
 * file - see this file's own header for why `wounds` needs one. One ding per
 * 30 seconds regardless of which wounds-class line matched or how many
 * distinct ones fired in that window; a class not listed here falls back to
 * the per-sound-file floor above.
 */
const THROTTLE_MS_FOR_CLASS: Record<string, number> = {
  wounds: 30_000,
}

/**
 * And a ceiling across all sounds, because several quiet rules can be loud
 * together.
 *
 * The config policy reasons about each entry alone. Nothing in it prevents
 * four different entries matching four lines of one room description.
 */
export const GLOBAL_MS = 400

/**
 * Throttled classes share one cooldown key across every sound in that
 * class, on purpose - "one wounds ding per 30s" means one ding total, not
 * one per distinct wounds sound file that happens to fire in the window. A
 * class not listed there keys by sound file name instead, at the shorter
 * default floor - the behaviour this had before the channel split, for any
 * class this module doesn't specially throttle.
 */
export function alertGate(
  name: string,
  cls?: string
): { channel: AlertChannel; throttleMs: number; throttleKey: string } {
  const channel = channelFor(cls)
  const classThrottleMs = cls ? THROTTLE_MS_FOR_CLASS[cls] : undefined
  return {
    channel,
    throttleMs: classThrottleMs ?? PER_SOUND_MS,
    throttleKey: classThrottleMs !== undefined ? `class:${cls}` : name,
  }
}
