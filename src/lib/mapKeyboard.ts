import type { MapZoneRoom } from '../bridge/types'

export type MapDirection = 'left' | 'right' | 'up' | 'down'

export function initialMapRoomId(rooms: MapZoneRoom[], here: number | null | undefined): number | null {
  if (here != null && rooms.some((room) => room.id === here)) return here
  return rooms.find((room) => room.id != null)?.id ?? null
}

/** Connected rooms win; geometry keeps every authored room reachable. */
export function nextMapRoomId(rooms: MapZoneRoom[], currentId: number | null, direction: MapDirection): number | null {
  const current = rooms.find((room) => room.id === currentId) ?? rooms[0]
  if (!current || current.id == null || current.x == null || current.y == null) return null
  const linked = new Set([...(current.to ?? []), ...(current.links ?? []).map((link) => link.to)])
  const candidates = rooms.flatMap((room) => {
    if (room.id == null || room.id === current.id || room.x == null || room.y == null) return []
    const dx = room.x - current.x!
    const dy = room.y - current.y!
    const forward = direction === 'left' ? -dx : direction === 'right' ? dx : direction === 'up' ? -dy : dy
    if (forward <= 0) return []
    const cross = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx)
    return [{ id: room.id, linked: linked.has(room.id), angle: cross / forward, distance: Math.hypot(dx, dy) }]
  })
  candidates.sort((a, b) => Number(b.linked) - Number(a.linked) || a.angle - b.angle || a.distance - b.distance || a.id - b.id)
  return candidates[0]?.id ?? current.id
}

export function mapRoomAccessibleName(room: MapZoneRoom, canPin: boolean): string {
  const action = room.gateway ? `Open ${room.gateway.name}` : 'Choose route'
  const unresolved = room.leaves?.length
    ? `; ${room.leaves.length} unresolved ${room.leaves.length === 1 ? 'exit' : 'exits'}`
    : ''
  return `${room.title ?? 'Unknown room'}, Lich room ${room.id ?? 'unknown'}; ${action}${unresolved}${canPin ? '; Shift F10 or Context Menu to pin' : ''}`
}
