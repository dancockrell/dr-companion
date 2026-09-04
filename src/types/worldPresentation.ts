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

export type WorldTetherKind =
  | 'road'
  | 'path'
  | 'threshold'
  | 'stairs'
  | 'ladder'
  | 'ferry'
  | 'portal'
  | 'warp'
  | 'other'

export type WorldKitFamily =
  | 'western-fantasy'
  | 'bronze-age-mythic'
  | 'eastern-wushu-fantasy'

export interface ActorSpawnPoint {
  id: string
  role: 'player' | 'occupant' | 'hostile' | 'item'
  anchor: WorldAnchor
  yawDeg: number
  /** Actors may be static now, but must enter through a skeleton-ready socket. */
  rigSocket: 'humanoid-root' | 'creature-root' | 'item-root'
}

export interface NodeTransitionProjection {
  id: string
  fromNodeId: WorldNodeId
  toNodeId: WorldNodeId
  command: string
  direction: string
  tetherKind: WorldTetherKind
  /** Phase 1 snaps only after confirmation; a later renderer may add a streak. */
  presentation: 'confirm-then-snap'
  futureTraversalEffect: 'streak-along-tether'
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
  schemaVersion: 2
  model: 'node-tethered-mud-projection'
  view: {
    projection: 'fixed-orthographic-isometric'
    rotation: 'locked'
  }
  animationPhase: 'static-rigged'
  kitContract: {
    baseFamilies: WorldKitFamily[]
    overlays: string[]
    portableConcepts: string[]
    authority: 'mud-room-graph'
  }
  nodes: WorldNodeProjection[]
  transitions: NodeTransitionProjection[]
}
