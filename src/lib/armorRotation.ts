/** Pick the next configured piece for a body slot, wrapping at the end. */
export function nextArmorInRotation<T extends { id: string }>(
  candidates: T[],
  current: T | undefined,
): T | undefined {
  if (candidates.length === 0) return undefined
  if (!current) return candidates[0]
  const index = candidates.findIndex((piece) => piece.id === current.id)
  return candidates[(index + 1) % candidates.length]
}
