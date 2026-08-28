/**
 * The three sounds the poker table makes, synthesised rather than shipped.
 *
 * There is no chip-clink or table-thud WAV anywhere in this repo, and there
 * is no pipeline that makes one — the audio this app already ships
 * (ambientSound.ts's zone music) is real attributed recordings, and inventing
 * a fake "chips.wav" path that plays nothing would be exactly the silent gap
 * this codebase keeps finding: a feature that looks wired and is not. A short
 * tone built with the Web Audio API is honest about what it is, needs no
 * asset pipeline, and is what browsers have used for UI blips for years.
 *
 * Reuses `alertSound.ts`'s own Alerts volume rather than adding a second,
 * undocumented volume control — a player who turned Alerts down to 20% on
 * the sound panel does not want a new sound source ignoring that and
 * playing at full strength beside it. Scaled, not just gated on zero: the
 * whole point of the volume-slider rework (see alertSound.ts's own header)
 * was replacing on/off with a real level, and a chip sound that only
 * respected "off" would quietly undo that everywhere it plays.
 */
import { alertsVolume } from './alertSound'

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

/** One short tone: a frequency sweep and a fast decay, the shape of a UI blip. */
function blip(freqFrom: number, freqTo: number, durationMs: number, gain: number) {
  const level = alertsVolume()
  const c = level > 0 ? context() : null
  if (!c) return
  try {
    const osc = c.createOscillator()
    const vol = c.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freqFrom, c.currentTime)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), c.currentTime + durationMs / 1000)
    vol.gain.setValueAtTime(gain * level, c.currentTime)
    vol.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + durationMs / 1000)
    osc.connect(vol)
    vol.connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + durationMs / 1000)
  } catch {
    // Autoplay policy (no user gesture yet) or no audio device. A missed
    // chip sound is not worth interrupting anything over.
  }
}

/** A new chip lands on the table — something entered the room. */
export function playChipIn() {
  blip(900, 1400, 90, 0.05)
}

/** A chip is taken off the table — something died or left. */
export function playChipOut() {
  blip(300, 120, 160, 0.06)
}

/** Picking up or opening a chip — the light click of handling one. */
export function playChipTap() {
  blip(1200, 1000, 40, 0.03)
}
