# DR Companion Fixed-Isometric World Board Strategy

Status: **approved replacement direction; supersedes the orbiting continuous-camera concept**
Scope: a scalable primary 3D city/world and tactical presentation for
DragonRealms room, route, and combat data. This is the contract for replacing
the current map/radar/battle presentation, not an assertion that a
three-dimensional world is already playable.

---

## Authority and implementation status

This is the current visual design authority, reaffirmed 5 September 2026. The [working plan](PLAN_TO_1_0.md) tracks implementation; the [handoff](THREE_D_REBUILD_HANDOFF.md) specifies integration. Earlier companion-panel and separate battlespace designs are historical. Detailed animation examples below describe a later stage, not prerequisites for the static-board milestone.

Rooms are authoritative nodes; region groupings organize their presentation without replacing room identity. Typed tethers distinguish the actual exit/transition semantics supplied by the graph. Drawing two nodes close together never creates a legal route. The fixed-view RTS-style board uses reusable isometric tile and structure kits, with rigged actors now and animation later.

## 1. The player promise

The companion should make a familiar place feel like a place.

A player opens one coherent, fixed-view isometric tabletop world: zoomed far out it is a
city or region, zoomed closer it becomes a route through that world, and zoomed
all the way in it becomes the current room and its battle space. The normal experience uses one board; the existing 2D map and text remain
explicit recovery/accessibility fallbacks over the same data. The 3D view is the primary
presentation of the same authoritative world state; it never invents a route,
declares a combat outcome, or replaces the game's prose.

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

### 1.1 One fixed isometric camera, three distances

Pan, focus, and zoom change the board framing. Camera rotation does not: a
locked orthographic isometric view gives every tile, footprint, tether, prop,
and actor socket one dependable screen-language at every distance.

| Distance | Player sees | Player can do |
|---|---|---|
| **World** | a whole district/city assembled from chunky colored blocks, roofs, water, bridges, major landmarks, and a current-position beacon | pan, zoom, select a known destination or route |
| **Route** | the connected streets, paths, bridges, docks, thresholds, and named destination silhouettes between nearby rooms | follow the legal route, preview the next exit, inspect known services |
| **Room / tactical** | the active room cell with inhabitants, ground items, exits, range bands, and battle events | use real commands, inspect entities/items, follow live combat |

Every view is the same scene graph at a different level of detail. The route
graph is still present beneath it, but it is an implementation truth—not a
second visual product for players to learn.

### 1.2 Primitive-first production rule

The first playable city uses deliberately basic colored 3D primitives: clear
footprints, roof wedges, wall blocks, arches, water ribbons, bridges, doors,
trees, and miniature stand-ins. Those models are the editable substrate. Only
after traversal, sight lines, scale, exits, battle placement, and reuse have
been validated do we paint them with materials, decals, selected hero props,
and expressive character/creature treatments. A pretty generated scene is not
allowed to lock the world into an unusable topology.

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
            text and accessible command UI remain independently usable
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

### 2.3 Static first, rigged from the start

The current production phase has no character locomotion, idle cycles, combat
performance, or environmental animation. Actors snap between confirmed room
nodes and display in stable spawn sockets. Character and creature assets must
still ship with clean skeletons, root bones, pivots, facing conventions,
attachment sockets, and footprint metadata so later animation does not require
rebuilding the board or asset library.

The later traversal language is a very fast directional streak across the
actual graph tethers. It communicates the distance covered without claiming
continuous walking. That effect begins only after the MUD confirms each graph
transition. Until that phase is implemented, confirmation produces a snap.

---

## 3. Ownership boundary

| Fact or behavior | Owner | 3D layer may do | 3D layer must not do |
|---|---|---|---|
| Current room and available exits | game bridge + room graph | highlight exit anchors and animate the player reaching one | add an exit or turn a blocked exit into an open path |
| LOOK description and named landmark | room data | select a reviewed recipe and place supported set dressing | make unsupported architecture canonical |
| Encounter list, allegiance, range, engagement | combat state | position tokens, orient actors, show range/readiness | decide hostility or range from screen geometry |
| Attack result / hit / miss / wound | parsed game event | play an event after receipt | predict success or make damage authoritative |
| Ground items | room contents | show grouped, clickable item tokens or piles | hide items from the accessible item browser |
| Weather and time cues | game text/state when available | alter approved material/lighting parameters | pretend a weather condition was reported when it was not |
| Camera, quality, animation preference | local client preference | persist and recover visual settings | affect the game command stream |

Textual exits, entity lists, ground items, and command controls remain complete
accessible fallbacks. The legacy 2D map is retained only as a migration,
diagnostic, and data-validation tool; it is not the player-facing navigation
product of this rebuild.

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
cell points to the same target room as the distant route ribbon and the same
edge in the authoritative room graph.

### 5.1 Tactical language: miniature theatre, not collision simulation

Combat figures do not need to make physical contact. Trying to force
text-derived distance and attack events into literal hitboxes creates false
precision, expensive animation work, and awkward misses. The tactical table is
instead a readable, D&D-like miniature theatre: opponents hold positions and
facing, while the game-reported event supplies the spectacle.

| Authoritative event | Presentation response |
|---|---|
| attack begins | weapon-ready pose, directional arc or projectile trail |
| hit | target flinch, colored impact burst, damage/status bubble, brief camera emphasis |
| miss / evade / parry / block | trail breaks, sidestep or guarded pose, matching readable bubble/effect |
| spell | clear school-colored cast glyph, travel effect, target response after the bridge result |
| advance / retreat / enter / leave | miniature slides along its legal range lane; no inferred collision |
| death / item drop | simple state change, fallen/token treatment, then a clickable pile or item marker |

The layer may use deliberately cartoon-like bubbles, starbursts, floating
icons, shock rings, and particles because they make event meaning immediate at
the zoomed-out tabletop scale. They are communication, not claims of a
physics simulation. Every effect starts only after its matching bridge event
arrives.

**Recommended runtime boundary:** use Godot for the 3D scene graph, camera,
miniature animation, material palette, UI-adjacent effects, and deterministic
event playback. Keep parsing, commands, room truth, entity truth, and combat
truth in the existing client/bridge boundary. Godot receives a small ordered
presentation-event stream and can always recover from a snapshot if it falls
behind.

---

## 6. Building kit strategy

### 6.0 Broad kit families, specialized overlays

Initial content is organized around three broad fantasy archetypes, not literal
historical reconstructions:

| Base family | Purpose |
|---|---|
| **Western fantasy** | familiar town, forest, keep, village, road, and guild silhouettes |
| **Bronze-age mythic mashup** | monumental stone, sun-baked settlements, temples, ports, and heroic civic forms |
| **Eastern / wushu fantasy mashup** | layered roofs, mountain paths, courtyards, gardens, bridges, and martial-fantasy silhouettes |

Special identities are composable overlays—elven, treefolk, cult, faction,
guild, climate, corruption, occupation—not separate world systems. Each kit
piece declares a grid footprint, connection faces, height/occlusion bounds,
prop sockets, actor spawn sockets, palette/material roles, allowed overlays,
evidence state, and provenance.

The reusable vocabulary may later serve Pirate Island: footprints, tile
recipes, props, spawn sockets, typed tethers, influence/state hooks, and review
metadata are portable concepts. DR Companion's topology and live state are not
portable content; its MUD graph remains authoritative and is never reshaped to
fit another game's world model.

We start with components that make many rooms more truthful, not glamorous
hero buildings that only work once.

### 6.0 Art direction: designed geometry, not synthetic realism

The 3D world deliberately does **not** try to reproduce photography, realistic
foliage, or a simulation-grade medieval town. That direction makes generated
materials look dated and artificial while adding cost without improving play.

The target is an original, contemporary **block-built tabletop world**:

- clear, chunky silhouettes and deliberately simple construction;
- a restrained palette with strong district color blocking;
- faceted trees, shaped hedges, modular roofs, arches, cobbles, and props;
- readable scale, modular joins, and playful physical detail;
- warm, expressive player and creature miniatures that carry personality;
- lighting and small material accents that add charm without pretending to be
  photoreal.

The tabletop read comes from the high three-quarter camera, miniature scale,
clean color-blocked terrain bases, and a limited painted-resin material palette.
It does **not** mean putting the city on a literal felt or cloth blanket. The
world root starts with a cheap colored floor/ground plane; terrain, roads, and
sets sit on it as deliberately assembled geometry.

This takes inspiration from the legibility and toy-like confidence common to
popular block-built games, but must remain an original DragonRealms world: no
copied branded figures, textures, logos, or named visual systems.

**Explicitly rejected:** AI-grown realism, simulated leaf clutter, detailed
photographic stone, generic half-timber beauty shots, and a city whose visual
language depends on generated noise rather than constructed geometry.

All new asset briefs must specify a simple silhouette, intended grid/footprint,
palette role, and visual read at the tactical camera distance before adding
surface detail.

### 6.0.1 Tool ownership: geometry first, personality second

The city/world layer is built directly from deterministic geometry in the
client's world assembler. It owns the ground grid, roads, exit openings,
building footprints, walls, roofs, foliage volumes, collision, level of detail,
and palette. Those facts must be editable and repeatable; they are not
outsourced to an image-to-3D reconstruction service.

Magnific is used where its strengths add value without owning topology:

| Use Magnific for | Do not use Magnific for |
|---|---|
| Cute expressive character/creature concepts and miniature variants | The underlying city layout or room connectivity |
| Portrait, emblem, cloth-pattern, and prop-detail ideation | Full-scene image-to-3D city conversions |
| Carefully isolated hero-prop experiments that pass turntable review | Roads, walls, buildings, hedges, or trees whose footprint must be exact |
| Stylized material/decal references applied to authored geometry | Simulated photoreal foliage/stone/timber as the world style |

The intended result is a readable, charming geometric world populated by
expressive miniatures. Character is added through silhouette, palette,
animation, sound, interaction, and a small number of authored details—not
through uncontrolled scene realism.

### 6.0.2 Acquisition split: chunky world sets, premium animated figures

The environment and the characters have deliberately different acquisition
standards:

| Family | Acquisition target | Admission bar |
|---|---|---|
| Terrain, paths, simple facades, trees, hedges, flowers, benches, crates, barrels, and other scatter | Many inexpensive or licensed-store **geometric set pieces**, then palette-normalized in Godot. Imperfect joins are acceptable because a room recipe mixes several pieces and scatter hides simple seams. | Correct footprint, simple colors/materials, stable import, known license, no baked scene/background, and clear tactical readability. |
| Guilds, shrines, landmarks, bridges, and interiors | Small project-made component sets assembled from room evidence; purchased generic pieces may dress them but cannot invent their identity. | Room facts, legal graph exits, no-invention review, connector/portal anchors, and readable silhouette. |
| Player and monster miniatures | Fewer, higher-quality **paid rigged models** or approved riggable character outputs; use Magnific for concept/proportion studies and only isolated model experiments. | Shippable license, clean skeleton/rest pose, attachment sockets, known scale/material slots, and board-scale readability now. Importable animation data and action-clip review are later gates; clips are not required for static admission. |

The live MUD remains authoritative: an animation is presentation selected after
the bridge reports an event. It may make a miss expressive, but cannot make a
hit happen, move a character to a room, or imply a result before confirmation.

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
real exits, remain legible at the fixed isometric heading, host interiors, accept dynamic
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

- **District table:** fixed-heading pan/zoom; current room stays locatable;
  reset returns to the player.
- **Local cell:** the same readable isometric heading at a closer scale. Exit
  anchors and active combat remain in frame.
- **Tactical table:** the same heading locks to the encounter grammar; inspect
  changes focus or zoom, never board orientation.
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
