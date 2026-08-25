/**
 * Global type scale.
 *
 * Tailwind's sizes are rem-based, so setting the root font size scales the
 * whole interface together and keeps the proportions the layout was built with.
 * One control, applied everywhere, remembered.
 *
 * This exists because of who plays this game. Presbyopia starts around forty
 * and is near-universal by the mid-fifties, and this audience is squarely in
 * that band — reading at desk distance, next to a game window they have already
 * had to size up. See docs/DESIGN.md §1.5.
 */
import { loadPrefs, savePrefs } from './persistence'

/** 16px is the browser default and the 1.0 case. */
const BASE_PX = 16

export const TYPE_SCALES = [
  { value: 1, label: 'Default' },
  { value: 1.125, label: 'Larger' },
  { value: 1.25, label: 'Large' },
  { value: 1.5, label: 'Largest' },
] as const

/**
 * Clamped rather than trusted. A bad stored value would otherwise render the
 * app either unreadable or unusable, with no way to reach the control that
 * fixes it.
 */
export function clampScale(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1
  return Math.min(2, Math.max(0.875, n))
}

export function applyTypeScale(scale: number): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.fontSize = `${BASE_PX * clampScale(scale)}px`
}

export function setTypeScale(scale: number): number {
  const next = clampScale(scale)
  savePrefs({ typeScale: next })
  applyTypeScale(next)
  return next
}

/** Called once at startup, before first paint, so nothing reflows visibly. */
export function initTypeScale(): number {
  const scale = clampScale(loadPrefs().typeScale)
  applyTypeScale(scale)
  return scale
}
