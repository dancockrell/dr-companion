# DR Companion 3D World Strategy

Status: **proposed production contract; no implementation implied**
Scope: a scalable optional 3D city/world presentation and tactical layer for
DragonRealms room, map, and combat data. This is a production strategy, not an
assertion that a three-dimensional world is already playable.

---

## 1. The player promise

The companion should make a familiar place feel like a place.

A player can open a city or region as a coherent, navigable tabletop world,
see their current room in context, and watch a battle resolve spatially without
losing the game's text-first precision. The 3D view is an optional
presentation of the same world state; it never invents a route, declares a
combat outcome, or replaces the game's prose.

The promise has four non-negotiable parts:

1. **The game and the room graph remain true.**  Room IDs, exits, live LOOK
   text, player positions, combat events, and game-reported results are the
   source of truth.
2. **A city is assembled, not painted room by room.**  A limited set of
   description-backed buildings, streets, terrain, and furnishing modules is
   composed across the existing map graph.
3. **A battle is a visualization, not a simulator.**  The client renders an
   event only after the bridge has received it. "Hit", "miss", range, death,
   arrival, and departure are not inferred from animation.
4. **Uncertainty stays visible.**  A generic but region-appropriate segment
   may be shown for an unreviewed room. It must never be named or framed as a
   bespoke canonical reconstruction.

---

## 2. The scalable model: world cells, not one scene per room

The room graph becomes a **world-cell graph**. A cell is the smallest authored
piece that may need a unique spatial arrangement. Most cells do not need a
unique asset.

```text
Authoritative DragonRealms data
   room ID + place + LOOK + exits + map coordinates + live entities
                             |
                             v
                 City/world assembly manifest
       district + cell recipe + exit anchors + evidence + confidence
                             |
                             v
              streamed 3D presentation (optional)
    modular terrain + buildings + props + actors + camera + VFX
                             |
                             v
            text/map/battle UI remains independently usable
```

### 2.1 Three kinds of cell

| Cell | Use | Production cost | Examples |
|---|---|---:|---|
| **Route segment** | Repeated street, road, alley, forest path, dock, tunnel, or shore connection. | Low | one block of Magen Road, a town-wall lane, a cobbled green edge. |
| **Place cluster** | Several connected rooms that share one spatial set and recognizable identity. | Medium | Town Green, Mongers' Bazaar, Empaths' Guild courtyard system. |
| **Hero interior / landmark** | A distinct destination where recognition changes play or navigation. | High | Guildleader's Office, infirmary, provincial bank hall, a named gate. |

The default is **route segment**. A room only receives a hero treatment when
the description, player behavior, or navigation value justifies it.

### 2.2 What "build the city" means

For a settlement such as The Crossing, we build one regional kit and place it
across the existing coordinates. Roads, hedges, walls, roofs, frontage types,
market tents, docks, trees, gates, and district props are reused. The map tells
us how those pieces connect; room descriptions tell us which pieces are allowed.

This gives the city continuity without requiring 1,000 bespoke scenes.

---

## 3. Ownership boundary

| Fact or behavior | Owner | 3D layer may do | 3D layer must not do |
|---|---|---|---|
| Current room and available exits | game bridge + map graph | highlight exit anchors and animate the player reaching one | add an exit or turn a blocked exit into an open path |
| LOOK description and named landmark | room data | select a reviewed recipe and place supported set dressing | make unsupported architecture canonical |
| Encounter list, allegiance, range, engagement | combat state | position tokens, orient actors, show range/readiness | decide hostility or range from screen geometry |
| Attack result / hit / miss / wound | parsed game event | play an event after receipt | predict success or make damage authoritative |
| Ground items | room contents | show grouped, clickable item tokens or piles | hide items from the accessible item browser |
| Weather and time cues | game text/state when available | alter approved material/lighting parameters | pretend a weather condition was reported when it was not |
| Camera, quality, animation preference | local client preference | persist and recover visual settings | affect the game command stream |

The existing 2D map and the text battle layout are always complete fallback
interfaces. Switching off 3D changes presentation, never capability.

---

## 4. The world assembly manifest

Each cell has a small, versioned record. It is reviewed data, not an opaque
prompt embedded in a texture file.

```ts
type Evidence = {
  roomId: number;
  title: string;
  place: string;
  descriptionHash: string;
  citedFacts: string[];       // short facts extracted from LOOK text
  source: 'description' | 'curated' | 'map';
};

type ExitAnchor = {
  move: string;               // exact command, e.g. "go armory"
  direction: string;
  targetRoomId: number;
  localTransform: { x: number; y: number; z: number; yawDeg: number };
  visible: boolean;
};

type WorldCell = {
  id: string;                 // "crossing/town-green"
  zoneId: string;
  roomIds: number[];
  kind: 'route' | 'cluster' | 'hero';
  district: string;
  recipeId: string;           // modular scene recipe, not a raster image
  evidence: Evidence[];
  exits: ExitAnchor[];
  assetRefs: string[];        // curated GLB/material references
  confidence: 'reviewed' | 'regional' | 'generic' | 'unresolved';
  reviewState: 'draft' | 'art-review' | 'approved' | 'retired';
};

type CombatPresentationEvent = {
  id: string;
  eventTime: number;
  sourceEntityId?: string;
  targetEntityId?: string;
  kind: 'enter' | 'leave' | 'advance' | 'retreat' | 'attack' | 'hit' |
    'miss' | 'parry' | 'evade' | 'block' | 'cast' | 'death' | 'item-drop';
  authoritativeText: string;
  range?: number;
  result?: 'hit' | 'miss' | 'unknown';
};
```

### Manifest admission rule

A description-backed cell may include only what its evidence supports. For
example, the Town Green dossier supports the oak, tended grass, hedges, lunat
trees, cobbles, armory breach, planks, exterior samples, and performance bower.
It does **not** license an invented palace, guild crest, or cathedral facade.

---

## 5. Level of detail: one city, three presentations

The same assembly data is rendered at three different scales.

| Level | When used | Rendered content | Required interaction |
|---|---|---|---|
| **District table** | Player opens the city or zooms out. | Streets, roof masses, greenery, major landmarks, district overlays, current-room beacon. | select a room/place, pan, zoom, inspect known services. |
| **Local cell** | Player arrives or selects a nearby room. | The current cluster and immediate connected exits; distinct props, doorways, routes, terrain. | choose a real exit, inspect items/entities, follow the player token. |
| **Tactical table** | Combat or a focused local encounter. | One measured encounter floor, cover/obstacle language only where supported, player/enemy miniatures, event effects. | inspect range/allegiance, follow real events, retain the normal command UI. |

No level owns a different version of the world. A Town Green exit on the local
cell points to the same target room as its district-table pin and the same map
edge in the established 2D graph.

---

## 6. Building kit strategy

We start with components that make many rooms more truthful, not glamorous
hero buildings that only work once.

### 6.1 The Crossing kit, first release

1. **Terrain and streets:** grass, packed earth, granite/cobble variants,
   curbs, path joins, wall base, drainage, hedge borders.
2. **Vegetation:** privet hedge runs/corners/breaches, lunat tree variants,
   ancient oak, modwyn bower, small planting and seasonal dressing.
3. **Settlement massing:** low/mid-height Crossing street façades, roof
   variants, alley backfaces, chimneys, wall-and-gate modules.
4. **Service frontage:** restrained armory/weaponsmith modules, market canvas,
   bank/civic placeholder masses only until their descriptions are reviewed.
5. **Place props:** plank walkway, exterior equipment hooks, limestone bench,
   stump stools, fountain kit, cedar arbor, gate, signboard *blank by default*.
6. **Interior kit:** mahogany office, white-tile/marble infirmary, cedar
   courtyard. These are separate interior cells rather than exterior geometry
   hidden behind a loading door.

Every module needs three records: its evidence category, materials/scale, and
where it may be used. A `crossing:town-wall` module must not quietly migrate to
Ratha just because it is convenient.

### 6.2 The Town Green image-to-3D experiment: reject as a city asset

The first Asset Maker Town Green GLB is a useful **art-direction experiment**:
it establishes a desired material and tabletop-composition language. It is
rejected for the runtime city library because image-to-3D has fused the scene
into a single source-angle sculpture. That shape cannot reliably represent
real exits, support multiple camera angles, host interiors, accept dynamic
actors, or let the map graph change the scene.

Keep the experiment in the raw Asset Maker project with its generation record;
do not ship it, name it a canonical reconstruction, or convert it into a
runtime fallback. It answered the important question: whole-scene
image-to-3D is the wrong production lane for this client.

### 6.3 Corrected Asset Maker lane: reusable pieces, not room pictures

Asset Maker is appropriate for isolated assets with a stable silhouette and
clear reuse value. We produce a kit of roughly 20--35 pieces for a district,
not 20--35 rooms:

| Family | First Crossing components | Asset Maker target |
|---|---|---|
| Terrain | cobble strip, packed path, grass edge, hedge base, curb, drainage | tileable material/mesh or simple authored plane |
| Vegetation | privet hedge straight/corner/breach, lunat tree, ancient oak, modwyn bower | isolated object, neutral background, complete silhouette |
| Architecture | unpainted armory facade, restrained weaponsmith frontage, low street facade, alley backface, town wall/gate segment | facade module with known width, depth, ground contact, and blank signage |
| Props | plank run, exterior hook rack, weapon/armor samples, limestone bench, stump stools, market table | isolated prop, real pivot, no baked scene shadow |
| Landmark parts | cedar arbor, fish fountain, wrought-iron gate, office desk/chair, infirmary cot/exam table | isolated hero object, only after evidence review |

Each Asset Maker request must use an **asset contract**: one subject, an
orthogonal or controlled three-quarter view, neutral background, full ground
contact, known intended footprint, no surrounding scenery, no people, no text,
and no unrequested duplicates. The resulting 3D file is inspected in a
turntable and admitted only if it works from more than its source angle.

The city itself is then assembled by the client from these modules and the
manifest. That assembly owns exit anchors, collision, streaming, material
variation, entity slots, and camera behavior. Asset Maker supplies carefully
curated pieces; it does not secretly become the level designer.

---

## 7. Map-to-world placement

The existing map coordinates are layout evidence, not a promise of literal
real-world metres. The assembly transform must preserve adjacency and exits
before it pursues realism.

```text
map room coordinate
  -> district-local coordinate (stable transform per zone)
  -> cell origin and orientation
  -> named exit-anchor transforms
  -> player/entity placements relative to the current cell
```

Rules:

- The map graph owns connectivity. All placed exit anchors must resolve to a
  real outgoing edge.
- A distance exaggeration is allowed only in the presentation transform; it is
  never written back to map data or shown as measured gameplay range.
- `go` exits are explicit anchors: an arch, gate, tent flap, hedge breach, or
  door becomes visually distinct only if the description/command supports it.
- A room with no approved 3D recipe remains a valid selectable map node and
  receives a quiet generic regional cell, not a broken void.

---

## 8. Battle on the 3D city

The battle scene becomes a temporary tactical lens over the active local cell.
It is not a separate city map and not an alternate combat engine.

### 8.1 Event-driven presentation

```text
game/bridge parses result
       -> store writes authoritative combat event
       -> 3D event adapter looks up current visible entities
       -> short animation/VFX plays
       -> persistent state remains readable in the normal battle UI
```

Examples:

- `miss` produces a restrained weapon swing, spell trace, or dodge beat and
  keeps the result label as **Miss**.
- `hit` produces an impact reaction appropriate to the event family. It does
  not invent gore, exact wound placement, or damage numbers not sent by game.
- `advance` or `retreat` moves an entity among **presentation slots** defined
  by real range/allegiance data; it does not pathfind an arbitrary attack.
- `death` removes or marks an actor only when the game reports the transition.

### 8.2 Presentation slots, not fake physics

The local tactical cell exposes a small number of stable, camera-readable
slots: player center, engaged near left/right, near, middle, far, arrivals,
and exits. The adapter distributes entities within an appropriate slot with
collision spacing. When crowded, entities group as miniatures with an explicit
count badge; no one silently disappears.

### 8.3 Ground-item scale

Fifty items on a floor must not create fifty full-size meshes.

- The world view renders material-aware **group piles** or small visible
  representatives, each marked with the real item count.
- The battle loot glance and floor browser remain the complete, keyboard- and
  screen-reader-accessible source for each clickable item.
- Grouping never changes the underlying item list; selecting a pile opens the
  exact grouped names and actions.

---

## 9. Camera and controls

- **District table:** constrained orbit/pan/zoom; current room stays locatable;
  reset returns to the player.
- **Local cell:** a readable elevated three-quarter camera, with a modest
  orbit range. Exit anchors and active combat remain in frame.
- **Tactical table:** camera locks to the encounter grammar by default, with
  optional inspect/orbit only when it cannot obscure status/accessibility.
- **Reduced motion:** replaces travel sweeps and attack animation with immediate
  position updates plus a short, non-flashing state cue.
- **Performance fallback:** a clear “2D map” control is always present. A failed
  model/texture load retains the map and text battle view, then offers retry.

---

## 10. Production pipeline and gates

1. **Evidence extraction:** build/refresh a dossier from room title, LOOK,
   map graph, exits, place grouping, and live observations. Record unknowns.
2. **Recipe design:** decide whether the place is a route, cluster, or hero
   cell; choose only approved regional modules.
3. **Anchor creation:** make one purpose-labeled concept/3D anchor. It proves
   scale, materials, lighting, and composition; it is not shipped automatically.
4. **Modularization:** make the reusable kit pieces and documented pivots,
   collision bounds, scale, material names, and variation rules.
5. **World assembly:** place the kit via manifests, validate all exit anchors
   against the map graph, and test transition continuity.
6. **Tactical overlay:** adapt real entity and event data into presentation
   slots; test hit/miss/arrival/departure/dense-item cases.
7. **Curation and admission:** review semantic correctness, topology,
   performance, accessibility, provenance, and bundle budget before shipping.

### Non-negotiable admission checks

- Every visible exit maps to a real command/target room.
- Every landmark claim has cited description or curated evidence.
- No `unknown` scene is labeled a named location.
- A 3D failure cannot prevent moving, commanding, reading room prose, finding
  inventory, or using the 2D map.
- Dense entity/item conditions retain all entities in accessible text lists.
- The asset manifest records creation source, prompt/brief, date, license,
  evidence links, review state, and shipped reachability.

---

## 11. Vertical slices

| Slice | Demonstrable outcome | Exit criteria |
|---|---|---|
| **A. Town Green assembly** | Six connected Town Green rooms share a 3D district/local cell with real exits. | Map adjacency and all visible exits validate; approved kit is modular; 2D fallback works. |
| **B. Guild transition** | Magen Road -> Empaths' Guild courtyard -> office/infirmary has exterior/interior continuity. | Exact `go` exits, loading/recovery, and landmark evidence pass review. |
| **C. Market district** | Mongers' Square and Traders' Market share a market kit, tent-flap transition, and density controls. | Repeated tents/props vary without contradicting descriptions; dense items remain usable. |
| **D. Tactical encounter** | A mock invasion plays input combat events over a local cell. | Hit/miss/advance/depart/death are event-driven; crowded roster and 50-item conditions stay readable. |
| **E. Streaming crossing** | District table moves among approved clusters and generic regional connectors. | Budget, frame-time, loading/error state, and manifest reachability gates pass. |

---

## 12. Approval ledger

| Decision | Status | Consequence |
|---|---|---|
| 3D is an optional layer over real text/map/combat data. | **Accepted** | No duplicated game simulation. |
| Build cities from reusable modules, not one image or mesh per room. | **Accepted** | Asset work begins with regional kits and cells. |
| First visual anchor: The Crossing Town Green. | **Accepted** | Existing Asset Maker scene is reference-only until curated. |
| Whole-scene image-to-3D conversion as a runtime city asset. | **Rejected** | Preserve the Town Green GLB as an experiment; use isolated modular assets for city assembly. |
| The 3D tactical layer reacts to incoming hit/miss events. | **Accepted** | Requires a typed event adapter and slot system. |
| Exact engine/runtime for client-side 3D. | **Unresolved** | Decide after browser/Tauri budget and input-accessibility spike. |
| Canonical visual treatment for every major Crossing landmark. | **Unresolved** | Requires room dossier review, not generic generation. |
| Player-created 3D/portrait asset admission and Git workflow. | **Unresolved** | Must be authenticated, reviewed, manifest-backed, and revertible. |

## Immediate next decision

Approve **Slice A: Town Green assembly** as the first implementation target.
The first engineering deliverable is not a renderer. It is the data contract and
manifest validator that proves six real rooms and their exits can assemble into
one reliable cell before any broad 3D rollout.
