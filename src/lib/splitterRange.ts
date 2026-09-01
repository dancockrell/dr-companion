export interface SplitterRange {
  min: number
  max: number
}

const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/** Return one valid, ordered range even when a caller supplies bad bounds. */
export function splitterRange(min: number, max: number): SplitterRange {
  const a = unit(min)
  const b = unit(max)
  return { min: Math.min(a, b), max: Math.max(a, b) }
}

export function clampSplitterValue(value: number, range: SplitterRange): number {
  return Math.min(range.max, Math.max(range.min, unit(value)))
}
