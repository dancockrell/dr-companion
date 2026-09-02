# Claude Brief — DR Companion Single 3D Viewer

## Mission

Help convert DR Companion from a player-facing collection of 2D map, radar,
and battle panes into **one continuous 3D tabletop world viewer**. Codex will
provide the visual content: primitive assets, city and interior composition
recipes, special guild/shop sets, props, character/monster miniatures, and
event effects. Your job is to make the viewer reliable, data-driven, secure,
testable, and simple for that content to enter.

Do not redesign the game client or replace its authoritative systems. Keep
React/Tauri, the Lich bridge, parser, command scheduler, persistence, maps, and
text UI. Godot is a local presentation renderer only: it never owns
credentials, gameplay truth, room topology, combat decisions, or live
inventory.

## Product outcome

The player sees one spatial viewer with a continuous camera:

1. **World distance** — city/region, rivers, bridges, landmarks, routes, and
   the player's current place.
2. **Route distance** — only legal nearby exit paths and destination anchors.
3. **Room/tactical distance** — a cutaway room with creature/PC miniatures,
   ground-item clusters, exits, and confirmed combat effects.

The visual style is original cute geometric fantasy: chunky, colored,
painted-resin/plastic tabletop pieces. It is deliberately not photorealistic,
not a literal historical reconstruction, and not collision simulation.

There must not be independent map, radar, battle, and 3D windows after the
migration. A compact location strip, collapsible inspector, bottom
command/hotbar/status tray, and accessible text/list equivalents are allowed
over the one viewer.

The world is a node-tethered MUD projection. Each room is one stable world
node; live entities and floor items remain tethered to their authoritative
`roomId`. A legal movement command can animate a route or miniature departure,
but only a confirmed snapshot changes the tether to the destination node. Do
not pathfind, simulate collision, derive combat distance, or let an actor
cross a room boundary because a mesh happens to be adjacent. Use the generated
`npm run world:node-projection` artifact as the renderer-neutral expression of
this rule.

## Your ownership

### 1. Godot viewer foundation

Create a minimal Godot 4 project that runs from a checked-in mock fixture
before live integration:

```text
godot/
  project.godot
  scenes/WorldRoot.tscn
  scenes/RoomTable.tscn
  scenes/InteriorCutaway.tscn
  scenes/TacticalTheatre.tscn
  scripts/bridge_client.gd
  scripts/world_manifest_loader.gd
  scripts/camera_director.gd
  scripts/event_player.gd
  scripts/intent_sender.gd
  assets/primitives/                 # Codex-provided approved GLBs
```

Own the shell, not the content art: a single world root, smooth world/route/
room camera modes, manifest loading, scene-slot/content registration, event
dispatch, input/intent sending, mock mode, error/reconnect state, and an
integration-testable API. Expose stable slots for terrain, paths, water,
bridges, facades, rooms, props, miniatures, item clusters, labels, and effects.

Use either an embedded Godot surface or a dedicated Godot window—choose only
after a Windows feasibility spike. The acceptance criterion is one user-visible
spatial viewer, not a particular embedding technique. If it is a separate
Godot window, hide/retire the old spatial panes and make host controls compact
overlays/drawers rather than a second spatial application.

### 2. Deterministic world data and local bridge

Compile the existing room graph, room IDs, legal exits, map coordinates, room
descriptions, and content metadata into versioned deterministic manifests. Do
not hand-author topology in a Godot scene. Existing map/parser state remains
the authority.

Implement a launch-scoped, authenticated **loopback-only** bridge between
Tauri/Rust and Godot. Package and launch the Godot export with Tauri. Pass a
single-use local session token; never expose a network service and never put
game credentials into Godot.

Use full snapshots plus ordered deltas/events. At minimum implement and test:

```ts
type WorldSnapshot = {
  protocol: 1;
  sequence: number;
  worldId: string;
  currentRoomId: string;
  cells: Array<{ id: string; title: string; position: Vec3; exits: Exit[] }>;
  activeRoom: RoomSnapshot;
  entities: EntitySnapshot[];
  groundItems: GroundItemSnapshot[];
};

type PresentationEvent = {
  protocol: 1;
  sequence: number;
  roomId: string;
  kind: 'enter' | 'leave' | 'advance' | 'retreat' | 'attack' | 'hit' |
    'miss' | 'parry' | 'evade' | 'block' | 'cast' | 'death' | 'item-drop';
  sourceEntityId?: string;
  targetEntityId?: string;
  authoritativeText: string;
  range?: number;
};

type PresentationIntent =
  | { kind: 'walk'; fromRoomId: string; exitMove: string }
  | { kind: 'inspect-entity'; entityId: string }
  | { kind: 'inspect-ground-item'; itemId: string }
  | { kind: 'focus-room'; roomId: string };
```

Every click is only a request. Tauri validates the current room/entity/item or
exit, invokes the existing command pipeline if valid, and Godot waits for the
confirmed snapshot/event. Godot must never determine whether a hit landed,
whether an entity is hostile, whether an item exists, or whether an exit is
legal/secret.

### 3. Recovery, safety, and contract tests

On launch, reconnect, dropped event, or renderer crash, request a new snapshot
and rebuild only presentation state. Contract tests must reject:

- unknown room/entity IDs;
- an exit intent that is not legal in the authoritative current room;
- stale/invalid session tokens;
- unordered or missing sequence handling;
- a compiled manifest whose room graph diverges from source map data; and
- any presentation event attempting to claim an unconfirmed outcome.

Keep secret and role-restricted exits hidden unless the existing client state
permits them. The text exit list and non-3D accessibility controls must remain
reachable at every stage.

## Codex ownership — do not duplicate

Codex owns all art/content admission and scene composition within your stable
slots: GLB primitive registry, materials, terrain/path/river/bridge families,
room recipes, cutaway interiors, generic and named shops, guilds, landmarks,
miniatures, ground-item visual grouping, labels/tooltips, and animation/effect
content. I will populate the viewer through the manifest and registration
interfaces you expose; I will not fork the bridge, parser, topology compiler,
or a second camera/runtime.

## Content constraints you must preserve

- Every DR room description is meaningful source data. A composition recipe
  can reuse primitives, but it must retain the room ID, description provenance,
  true exits, and an explicit neutral/missing-content state when evidence is
  absent.
- Interiors are separate graph-backed cutaways reached through verified portal
  transitions; an exterior facade does not need to physically contain the
  interior.
- Generic shops are empty reusable families. Named/special shops receive
  source-backed dossiers. Do not bake claimed live inventory into decorative
  meshes.
- Crossing requires distinct special content for the verified Barbarian, Bard,
  Cleric, Empath, Moon Mage, Paladin, Ranger, Thief, Trader, and Warrior Mage
  guildhalls. Necromancer remains explicit unresolved/secret content until
  source evidence supports a public location.
- Battles are miniature theatre. Models may swing without physical contact;
  confirmed data drives trails, impact bubbles, block flashes, spell glyphs,
  rings, and reactions.

## Delivery slices

1. **Foundation:** project, mock fixture, loader, camera, single-viewer shell,
   bridge stub, content-registration contract.
2. **Crossing ground:** deterministic Crossing world manifest, current-room
   focus, exact exits, content slots populated by a small primitive sample.
3. **Town Green and portal:** validated walking, room changes, a real
   exterior-to-interior transition, selected entity/item intent.
4. **Tactical table:** ordered confirmed event playback with graceful recovery.
5. **Civic depth:** manifest/index support for guilds, shops, named landmarks,
   and content provenance.
6. **Packaging and migration:** Windows lifecycle, reconnect behavior, feature
   flag, and removal of duplicate legacy spatial panes only after the 3D
   viewer is demonstrably usable.

## First acceptance gate

With no DragonRealms connection, a checked-in mock Crossing fixture opens in
Godot; loads terrain, paths, water, bridge, facade, and item/entity slots;
smoothly moves world-to-room; focuses Town Green North; reveals only true exits;
and turns a valid click into a validated mock intent that updates the mock
snapshot. It must recover from a simulated reconnect without changing game
state.

Read the detailed shared contract before implementation:
[THREE_D_REBUILD_HANDOFF.md](THREE_D_REBUILD_HANDOFF.md). Content briefs and
the current primitive kit are in `CROSSING_GEOMETRIC_KIT.md`, while source-
audited guild requirements live in `CROSSING_GUILD_DOSSIERS.md`.
