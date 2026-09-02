# DR Companion 3D Rebuild: Implementation Handoff

Status: **approved direction; ready for parallel implementation**

## 1. Product decision

Retire the player-facing 2D map/radar/battle presentation. Keep its room graph,
room IDs, exits, map coordinates, parser state, command pipeline, and text UI
as authoritative data/fallbacks. The player-facing replacement is one 3D
tabletop world with a continuous camera:

1. **World distance:** a whole city/region made from simple colored primitive
   models, landmarks, water, bridges, and route ribbons.
2. **Route distance:** the legal connected path between nearby rooms, with real
   exit anchors and destination silhouettes.
3. **Room/tactical distance:** a cutaway room table with occupants, clickable
   items, exit anchors, range/readiness state, and event-driven battle effects.

This is intentionally a cute, original geometric tabletop fantasy world. It is
not photorealistic, historical reconstruction, simulated collision combat, or
a copy of another game's visual system.

## 2. Ownership split

### Claude — systems, data, bridge, packaging, testable contracts

Claude should own the work that makes the renderer safe, repeatable, and easy
to feed:

- Extend the world compilers from room/map/description data into versioned,
  deterministic manifest files; never place hand-authored topology in a scene.
- Build a small local presentation bridge from the existing Tauri/Rust client
  to Godot. Publish full snapshots and ordered deltas; receive click intents,
  validate them against the authoritative room state, then send the existing
  command pipeline the exact approved command.
- Define and test the schema for `WorldSnapshot`, `RoomSnapshot`,
  `EntitySnapshot`, `GroundItemSnapshot`, `PresentationEvent`, and
  `PresentationIntent`.
- Preserve secret/role-restricted routes: the renderer receives only exits the
  client is currently allowed to expose.
- Package the Godot binary/project with the Tauri release and launch it with a
  loopback URL plus single-use local session token. Do not open a network-facing
  service or put game credentials in Godot.
- Own reconnect/recovery: on launch, refresh, dropped event, or renderer crash,
  Godot requests a fresh snapshot and rebuilds presentation without changing
  game state.
- Add contract tests that reject an event with an unknown room/entity, an
  intent for a non-exit, stale session token, unordered sequence number, or a
  manifest whose room graph does not match source map data.

### Codex — player-facing Godot world, interaction, and visual language

Codex should own the front end inside Godot:

- World/route/room camera behavior, smooth focus transitions, current-room
  beacon, route affordances, and zoom-level LOD.
- Primitive scene assembly from the manifest: colored ground, roads, water,
  bridges, facades, cutaway interiors, landmarks, miniatures, and effects.
- Clickable room exits, entity cards/tooltips, ground-item piles, inventory
  affordances, and accessible non-3D companion controls.
- Tactical theatre: stances and positional tokens, then confirmed event
  effects—arc trails, block flashes, comic impact bubbles, spell glyphs,
  status rings, reaction poses, departure/arrival and item-drop states.
- The visual quality bar: no repeated generic building where a guild/shop/room
  dossier has stronger evidence; no clutter that hides a route, miniature,
  item, or command result.

## 3. Runtime and port plan: Godot without porting the client

**Do not rewrite DR Companion in Godot.** Keep React/Tauri, the Lich bridge,
the parser, persistence, command scheduling, maps, and accessibility controls.
Godot is a local dedicated 3D presentation process/window, not the owner of
gameplay or credentials.

```text
existing game + Lich/Ruby bridge
              |
      existing Tauri/Rust authoritative client
              |
    local versioned presentation bridge
    snapshot + ordered events / validated intents
              |
        Godot 4 world presentation
  scene graph + camera + effects + clickable geometry
```

Suggested repository boundary:

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
  assets/primitives/                 # approved GLBs only
src-tauri/src/presentation_bridge.rs # Claude-owned local bridge
data/world/out/                      # deterministic generated manifests
```

The Godot project must run against a checked-in mock snapshot before the live
bridge exists. This makes camera, loading, route, interiors, clicking, and
effects testable without a DragonRealms session.

## 4. Versioned bridge contract

The first protocol is JSON over authenticated loopback WebSocket. It is
local-only and launch-scoped. A later optimized transport is acceptable only if
it preserves the same semantic messages and test fixtures.

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

Godot never decides whether an attack hits, whether an entity is hostile, how
far combatants are, whether a room exit exists, or whether an item is present.
It plays confirmed events and renders confirmed state. A click is always a
request; Tauri validates and confirms/rejects it through the normal command
and snapshot path.

## 5. Interiors: presentation without false building geometry

An interior does not have to physically fit inside its exterior shell. A city
facade is a world-distance silhouette; a building entrance is a **verified
portal** to one or more room-graph cells. When the player takes a real `go
door`/`enter` exit, the camera moves to the threshold, fades/zooms through it,
then loads a separate compact cutaway cluster whose floor plan follows the
actual interior room graph.

Interior rules:

1. Each interior cell has a floor plate, low cutaway walls, ceiling/roof removed
   at tactical distance, and a real anchor for every exposed exit.
2. A shared room family has reusable walls/furniture, but every described room
   gets a specific placement recipe from its source description.
3. Door, stair, cellar, balcony, portal, and outdoor anchors are one-way only
   when the graph says so; do not imply a return route because a model has one.
4. Shops, guilds, inns, temples, caves, sewers, and houses use the same portal
   pattern but have different material and prop families.
5. At all times, the text exit list remains reachable outside the 3D view.

## 6. Shops: generic families first, specific dossiers second

The city needs both, and neither should masquerade as the other.

### Generic shop families — build once, reuse by evidence

Start with twelve neutral storefront/interior families: dry-goods, tools,
weapons/armor, leather/cloth, alchemy/remedies, books/scribes, food/drink,
jewelry/gems, repair/workshop, warehouse/wholesale, inn/tavern, and civic
service/bank. Each family gets:

- 2–3 exterior shell footprints (5 m, 10 m, corner);
- one neutral portal/door threshold;
- one compact cutaway counter/floor/shelf family;
- empty display fixtures; and
- a material-slot/palette variation, **not** baked goods or signage.

### Specific shop dossiers — admit only when named source exists

For every named or structurally unusual shop, compile a room-specific dossier:
exact title/room IDs, exterior evidence, interior evidence, real exits,
inventory display constraints, special work surfaces, source links, and a
prohibited-invention list. A named weaponsmith should not become a copy of a
generic dry-goods shell; conversely, a generic shelf must not claim it stocks
the current live inventory. Item thumbnails/tooltips come from the actual item
data and Elanthipedia lookup layer, not from permanent decorative product mesh.

## 7. Guilds: non-negotiable civic special list

Every verified Crossing guildhall is a separate special destination. The
full source-audited set is maintained in
[CROSSING_GUILD_DOSSIERS.md](CROSSING_GUILD_DOSSIERS.md): Barbarian, Bard,
Cleric, Empath, Moon Mage, Paladin, Ranger, Thief, Trader, and Warrior Mage.
Necromancer is tracked explicitly as unresolved/secret rather than rendered as
an invented public facility. This is in addition to the High Temple, banks,
gates, markets, docks, bridges, public squares, named civic sites, and
description-backed shops.

## 8. Delivery sequence and acceptance gates

| Slice | Claude delivers | Codex delivers | Exit gate |
|---|---|---|---|
| 0. Contract | schema, fixture, bridge stub, launcher contract | Godot mock scene loading a fixture | no live game required; snapshot/event recovery passes |
| 1. Crossing ground | deterministic Crossing primitive manifest with all exits | pan/orbit/zoom world and current-room focus | 1,060 cells and 2,389 local routes remain exact |
| 2. Town Green + portals | intent validation and room snapshot updates | Green route, exterior/interior portal transition, clickable exit | invalid exit never sends game command; valid exit follows confirmed snapshot |
| 3. Tactical table | parsed event publisher and sequence/recovery tests | actor tokens, range lanes, hit/miss/block/cast bubbles | effects never claim a result before confirmed event |
| 4. Civic depth | guild/shop index and asset-manifest pipeline | first full guild and first generic/specific shop interiors | source review proves each special presentation |
| 5. Packaging | Windows bundled Godot export, lifecycle/reconnect | settings/accessibility UX and renderer-failure fallback | client remains usable if Godot is absent/crashed |

## 9. Definition of done for the first front-end slice

The first slice is done only when a mocked Crossing manifest opens in Godot,
renders primitive terrain/path/water/bridge/facade cells, supports smooth
world-to-room zoom, focuses Town Green North, shows only its real exits, and
allows a click to create a validated intent that changes the local mock snapshot.
No generated art, real network connection, collision simulation, or complete
city texture pass is required for that milestone.
