export type TetherKind = 'portal' | 'warp' | 'ferry' | 'ladder' | 'stairs' | 'threshold' | 'path' | 'road' | 'other'
export interface BoardAnchor { x: number; y: number; z: number; yawDeg: number }
export interface BoardSpawnPoint { id: string; role: 'player' | 'occupant' | 'hostile' | 'item'; anchor: { x: number; y: number; z: number }; yawDeg: number; rigSocket: 'humanoid-root' | 'creature-root' | 'item-root' }
export interface BoardLayout { footprint: { width: number; depth: number; height: number; unit: 'metre' }; selectionBounds: { width: number; depth: number; height: number }; spawnPoints: BoardSpawnPoint[] }
export function classifyTether(command: string, direction: string): TetherKind
export const ROOM_HORIZONTAL_SCALE: number
export const CELL_PITCH_METRES: number
export const CELL_GAP_METRES: number
export const CELL_BLOCK_METRES: number
export function packedRoomPositions(rooms: Array<{ id: number; x?: number | null; y?: number | null; z?: number | null }>): Map<number, { x: number; y: number; z: number }>
export function tetherAnchorFor(direction: string): BoardAnchor | null
export function expandCompassDirection(value: unknown): string | null
export function boardLayoutFor(cell: { classification?: { spatialMode?: string } }): BoardLayout
