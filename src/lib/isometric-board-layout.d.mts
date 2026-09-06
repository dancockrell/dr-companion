export type TetherKind = 'portal' | 'warp' | 'ferry' | 'ladder' | 'stairs' | 'threshold' | 'path' | 'road' | 'other'
export type BoardTokenRole = 'player' | 'occupant' | 'hostile' | 'item'
export interface BoardAnchor { x: number; y: number; z: number; yawDeg: number }
/**
 * A token's own mesh, published beside the lift derived from it. Declared here
 * because a field the type does not mention is a field the compiler will help
 * nobody find - and this one is the other half of `anchor.y`.
 */
export interface BoardTokenMesh { shape: 'capsule' | 'cylinder' | 'sphere' | 'box'; height: number; radius?: number; topRadius?: number; bottomRadius?: number; width?: number; depth?: number }
export interface BoardSpawnPoint { id: string; role: BoardTokenRole; anchor: { x: number; y: number; z: number }; yawDeg: number; rigSocket: 'humanoid-root' | 'creature-root' | 'item-root'; token: BoardTokenMesh }
export interface BoardLayout { footprint: { width: number; depth: number; height: number; unit: 'metre' }; selectionBounds: { width: number; depth: number; height: number }; spawnPoints: BoardSpawnPoint[] }
export const TOKEN_MESHES: Record<BoardTokenRole, BoardTokenMesh>
export function tokenMeshFor(role: string): BoardTokenMesh | null
export function tokenLiftFor(role: string): number
export function classifyTether(command: string, direction: string): TetherKind
export function tetherAnchorFor(direction: string): BoardAnchor | null
export function expandCompassDirection(value: unknown): string | null
export function boardLayoutFor(cell: { classification?: { spatialMode?: string } }): BoardLayout
