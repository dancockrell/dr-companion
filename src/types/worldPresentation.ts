/**
 * The 3D world is a presentation of DragonRealms' discrete MUD room graph.
 * It deliberately has no free-world position for an actor: live actors are
 * tethered to the authoritative room node until the game confirms a move.
 */
export type WorldNodeId = string

export interface WorldAnchor {
  x: number
  y: number
  z: number
}

export interface WorldNodeProjection {
  id: WorldNodeId
  roomId: number
  title: string
  anchor: WorldAnchor
  /** The map/room compiler's stable room identity, not renderer state. */
  tetherPolicy: 'authoritative-room-node'
}

export interface NodeTransitionProjection {
  id: string
  fromNodeId: WorldNodeId
  toNodeId: WorldNodeId
  command: string
  direction: string
  /** A visual bridge only; it never claims elapsed game travel time. */
  presentation: 'animate-then-confirm-node-teleport'
  /** Derived only for camera/animation framing, never combat distance. */
  visualDistanceMetres: number
}

export interface RoomTether {
  entityId: string
  roomId: number
  nodeId: WorldNodeId
  /** Rendering may choose a local slot, but may not cross a room boundary. */
  attachment: 'room-node'
}

export interface WorldProjection {
  schemaVersion: 1
  model: 'node-tethered-mud-projection'
  nodes: WorldNodeProjection[]
  transitions: NodeTransitionProjection[]
}
