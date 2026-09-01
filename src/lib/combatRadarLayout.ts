export interface RadarSlot {
  key: string
  angleDeg: number
  radiusPct: number
}

export interface RadarPoint {
  x: number
  y: number
}

/** Convert the radar's compass convention (0 degrees is up, clockwise) to a point. */
export function pointOnRadar(cx: number, cy: number, angleDeg: number, radiusPct: number): RadarPoint {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radiusPct * Math.cos(rad), y: cy + radiusPct * Math.sin(rad) }
}

/**
 * Keep every assessed combatant on its real range ring. Only actors that
 * occupy the exact same direction and range need separating. Those actors
 * spread along the ring's tangent, centered on the assessed point.
 */
export function fanRadarSlots(
  slots: RadarSlot[],
  centerX: number,
  centerY: number,
  gapPct: number,
): Map<string, RadarPoint> {
  const groups = new Map<string, RadarSlot[]>()
  for (const slot of slots) {
    const groupKey = `${slot.angleDeg}:${slot.radiusPct}`
    const group = groups.get(groupKey)
    if (group) group.push(slot)
    else groups.set(groupKey, [slot])
  }

  const points = new Map<string, RadarPoint>()
  for (const group of groups.values()) {
    // Stable ordering prevents shared-slot tokens from jumping when the
    // bridge reports the same combatants in a different array order.
    const ordered = [...group].sort((a, b) => a.key.localeCompare(b.key))
    ordered.forEach((slot, index) => {
      const base = pointOnRadar(centerX, centerY, slot.angleDeg, slot.radiusPct)
      const offset = (index - (ordered.length - 1) / 2) * gapPct
      const angleRad = (slot.angleDeg * Math.PI) / 180
      points.set(slot.key, {
        x: base.x + offset * Math.cos(angleRad),
        y: base.y + offset * Math.sin(angleRad),
      })
    })
  }
  return points
}
