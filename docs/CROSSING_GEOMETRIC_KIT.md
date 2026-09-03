# The Crossing Geometric World Kit

Status: **supporting prop-and-grammar brief**
Style: original, cute, block-built tabletop fantasy; **not photorealism**
Purpose: give an environment artist, asset store curator, or Asset Maker a
repeatable prop vocabulary for scene plates assembled around the existing room
graph.

> **Production reset (2026-09-03):** the primary visual unit is a coherent
> 20–30m tabletop *assembly* on a cheap, matte colored ground plane, with broad
> environment masses and loose scatter props. It uses a tabletop camera and
> painted-resin material language—not a literal felt, cloth, blanket, or mat
> mesh. A Magnific scene plate is an
> **art-direction reference**, not geometry that Godot can safely ship. Godot
> renders reviewed licensed-store meshes and project-made meshes assembled to
> the room recipe. This kit is the vocabulary for those props, connectors,
> replacement pieces, and store acquisitions; a city must not look like every
> card below was tiled by a machine. See `CROSSING_TTRPG_SCENE_PROMPTS.md` for
> the composition references that guide assembly.

This is a city kit, not a set of room pictures. A room is made by combining
several pieces. Repetition is desirable; sameness is not.

## Non-negotiable: every room description drives an individual recipe

Reusable blocks do **not** mean generic rooms. Every DragonRealms room has an
authored description, and every room must receive an individual geometry recipe
derived from that description before it is rendered in 3D.

The kit is merely the vocabulary. The room description decides the sentence.

For each room, make and retain a `RoomAssemblyRecipe`:

```ts
type RoomAssemblyRecipe = {
  roomId: number;
  title: string;
  lookText: string;                 // authored source; never discarded
  descriptionHash: string;
  exits: Array<{
    move: string; direction: string; targetRoomId: number;
    anchor: string;                 // e.g. cobble-north, hedge-breach-nw
  }>;
  requiredFacts: string[];          // visible things the prose actually says
  prohibitedAssumptions: string[];  // tempting but unsupported additions
  spatialRead: {
    surface: string; boundaries: string[]; landmarks: string[];
    routeShape: string; light?: string; weather?: string;
  };
  blockPlacements: Array<{
    assetId: string; variant: string; x: number; z: number; yawDeg: number;
    role: 'ground' | 'route' | 'boundary' | 'building' | 'landmark' | 'prop';
  }>;
  confidence: 'reviewed' | 'description-derived' | 'needs-review';
};
```

The recipe must name the exact description facts transferred to geometry and
the exact block instances used. It must also state what remains unknown. A
room without a usable description remains a neutral unresolved cell; it is
never silently filled with a plausible-looking city scene.

### Example: Town Green North is a room, not a generic lawn

The prose calls for bent grass leading to a narrow cobblestone strip between
the grass and a privet hedge before the Weaponsmith, with the facing greensward
remaining tranquil. Therefore its recipe contains a grass/packed-path
transition, narrow north-edge cobbles, a privet hedge run, restrained
weaponsmith frontage, and an open green. It does **not** inherit a bower,
armory breach, performance stools, ancient oak, or grand civic building merely
because those belong in other Town Green rooms.

The neighbouring rooms use shared blocks but different recipes:

- **Town Green Southeast:** modwyn-vine bower, limestone bench, stump seats.
- **Town Green Northeast:** larger open green, ancient oak, gathering space.
- **Town Green Southwest:** dense hedge and lunat-tree living boundary.
- **Town Green Northwest:** armory hedge breach, planks, unpainted exterior,
  exterior work samples.

Only their actual links, edges, and shared boundary blocks cause those rooms to
form one coherent Green.

---

## 1. Visual contract

Think of a beautifully painted tabletop game assembled from chunky, intentional
pieces. Ground, streets, walls, buildings, foliage and props use simple
silhouettes, a restrained palette, clean color blocks, modest bevels, and
pleasant toy-like material reads.

### 1.1 The Crossing: exact setting, era, and translation target

**Era and genre.** The Crossing is a DragonRealms **late-medieval urban-fantasy
trade city**, not generic rural Europe and not a Renaissance/industrial city.
Use the pressure, roofline variety, narrow lanes, civic routes, market frontage,
walls, thresholds, and service buildings of a fantasy-medieval London-like
river city—without recreating London, introducing real English heraldry, or
turning it into historical simulation. It should feel old, busy, practical,
and layered by trade, while remaining cheerful and legible as a tabletop game.

**Place-specific geography.** The Crossing began where the Oxenwaithe meets
the massive Segoltha and grew as a major shipping/crossing point and central
city of Zoluren. That means its 3D world needs substantial river presence,
working crossings, quays/docks, wet low edges, drainage and irregular green
verges—not an everywhere-swamp biome. The central Green, routes, gates, guilds,
market spaces, and civic buildings are comparatively maintained. River or dock
cells may have darker green bank material and shallow muddy margin variations;
they do not receive random reeds, marsh cabins, fog, boats, or cargo unless
their room description supports them. The geographic basis is documented in
[Elanthipedia's Crossing entry](https://elanthipedia.play.net/River_Crossing)
and [Segoltha River entry](https://elanthipedia.play.net/Segoltha_River).

**Deliberate style translation.** Build an original cute geometric tabletop
interpretation: broad painted-resin material planes, friendly bevels, chunky
silhouettes, high readability from a three-quarter camera, and a little
storybook character in the massing. It is not photoreal, gritty, grimdark,
hyper-detailed, historically exact, "AI-grown," or an imitation of another
game's branded models. Characters and monsters may be glossier/more saturated
plastic miniatures; the city remains calm, matte, constructed geometry.

**Library scale and delivery count.** This Crossing starter library contains
**104 base primitive briefs** plus **10 reviewed special-building sets**. It is
not a command to generate 114 isolated models. A card can be satisfied by a
reviewed store asset or a simple project-made mesh. A generated scene plate may
inform silhouette, composition, and palette but is never harvested or converted
into runtime geometry by default. Only a reusable piece that survives review is
delivered as an isolated GLB with its pivot, collision shape, connectors, and
low-detail companion. The target is a small controlled library of genuinely
useful scatter/connector pieces, not unbounded generated clutter.

**Complexity budget.** The primitive pass uses 1–3 flat or lightly graduated
materials per asset, no texture atlas requirement, no text, and no baked
lighting. Small terrain/prop modules: **under 120 rendered triangles**;
trees, facade shells, and route anchors: **under 450**; a special landmark
component: **under 900**. These are budgets for clean silhouette geometry, not
permission to spend the count on noise. Every asset must have a 5 m-grid pivot,
a `y = 0` ground contact plane, named connector empties, and a second simple
LOD used at city distance.

**Per-card reading rule.** Every asset card below states the specific object,
exact footprint, visible geometry, material language, required clear space or
connector, allowed purpose, and exclusions. The city/era/style/complexity
contract in this section applies to every card and is intentionally part of
each brief; an artist must not interpret a terse table label as permission to
invent the missing decisions.

### 1.2 Regional boundary: Riverhaven is a separate kit, not a Crossing reskin

The universal primitive grammar—5 m terrain, route anchors, simple facades,
clear miniatures, and honest room evidence—travels to other cities. The
**Crossing palette and special sets do not.** Riverhaven is a northern-bank
Faldesu commercial city with salt yards at its south end and a substantial
Halfling quarter to the west. Its later regional dossier must decide its own
river edge, street density, trade frontage, roof/palette language, and special
building sets from Riverhaven room text before it reuses anything beyond generic
primitive families. That distinction follows [Riverhaven's setting
description](https://elanthipedia.play.net/Riverhaven) and prevents a single
pretty river-town kit from erasing local character.

The world should feel **made**, not generated:

- grass is a soft shaped green surface, not a field of tiny individual blades;
- stone is a few clear block shapes with color variation, not noisy texture;
- trees are faceted/rounded volumes with readable trunks and canopies;
- buildings are compact silhouettes with roof, wall, and opening language;
- props have expressive proportions and one clear job at a glance;
- player and monster miniatures are slightly more saturated and expressive
  than the environment, so they always read first in a battle.

Never include logos, text, real-world labels, copied branded figure styles,
photographic foliage, simulated grime, dense AI surface noise, or background
scenery baked into a reusable asset.

---

## 2. The 5-metre rhythm and irregularity rules

Use a hidden **5 m macro-grid**. It is a placement rhythm, not a visible square
tile grid. Most city pieces have a 5 m, 10 m, or 15 m planning footprint, but
their visible boundary deliberately wobbles around that rhythm.

### Units

| Rule | Standard |
|---|---|
| Small modelling increment | 0.5 m |
| Standard terrain cell | 5 m × 5 m |
| Standard long segment | 10 m × 5 m |
| Typical footpath width | 1.5–2.0 m |
| Typical lane width | 3.0–4.0 m |
| Low hedge / rail height | 0.8–1.2 m |
| Town wall height | 4–6 m |
| Small street facade | 5 m / 10 m / 15 m frontage |
| Gameplay-clear route | at least 2.0 m wide |

### How to avoid a tiled world

Every repeated family needs at least three variants:

1. **Clean span:** mostly square/rectangular footprint for reliable joining.
2. **Rough span:** one or two edges bow, chip, step, or taper by 0.25–0.75 m.
3. **Broken / transition span:** a gap, intrusion, low step, planter, drain,
   root, pile, or turn that disguises the join.

Do not make every piece a bespoke blob. The *underlying* pieces remain standard
and easy to place. A scene becomes irregular by mixing normal, rough, short,
corner, and transition pieces.

### Connector contract

Every reusable block has:

- an origin centered on its nominal 5 m-grid footprint;
- a level ground plane at `y = 0` unless clearly marked slope/stair;
- north/east/south/west connector edges, tagged `open`, `soft`, `hard`, or
  `building`;
- no permanent neighbour baked into the asset;
- an intended palette family, footprint, height, and collision footprint;
- a simple empty pivot/anchor at every traversable opening.

An asset may be rotated by 90 degrees only if its silhouette and connector
tags still make sense.

---

## 3. Shared palette and materials

Use color as navigation language. Exact shades remain tunable, but preserve
these roles:

| Role | Read |
|---|---|
| Green ground | moss/leaf green, one lighter highlight band, one darker edge |
| Crossing stone | warm limestone, muted ochre-gray, never photographic gray noise |
| Cobble / paved civic routes | warm gray-blue, cream seams, occasional slate accent |
| Timber | deep umber or espresso, broad matte/plastic faces, minimal grain |
| Plaster | warm ivory, pale clay, or buttercream |
| Roof clay | terracotta / brick red / muted russet, broad chunky courses |
| Metal | friendly enamel blue-gray, bronze, or dark charcoal—not realistic rust |
| Magic / active cue | saturated jewel color reserved for interaction and spells |

Surface finish is mostly matte painted-resin. A few intentional accents may be
glossy: water, potion glass, enamel shield, gemstone, magical effect.

---

## 4. Delivery rules for every block

For every Asset Maker/model delivery, include:

1. **One isolated asset or one explicit set of variants.** No full scene.
   Whole-scene images are composition references only; they are never a direct
   image-to-3D source for shipped world geometry.
2. **Clean neutral background** if generated from an image; no other buildings
   or landscape hiding behind it.
3. **Turntable-friendly form:** recognisable from front, side, and rear.
4. **Ground contact:** no floating feet, roots, foundation, or props.
5. **No text/signage.** Sign plaques are separate blank pieces; the client
   supplies any readable label.
6. **Named footprint and connector types.** Example:
   `crossing_hedge_5m_rough_a — 5×1 m — soft/soft/open/open`.
7. **At least one low-detail companion** for very wide city views.

Do not send 100 assets as one giant batch. Send coherent sets of 4–8, review
them together, and only then continue.

---

## 5. The Crossing base library — 104 pieces

The numbers are a target catalogue, not 104 unique artistic themes. Many are
small variations in the same family, which is exactly what makes a city feel
alive.

### A. Ground, grass, banks, and water — 16 complete build briefs

Every terrain piece is a shallow, watertight, painted-resin volume with a flat
`y = 0` traversable top unless the card specifies a slope. It must look good
from the elevated tactical camera, have no baked scenery, and carry only broad
color planes—never grass-blade noise, decals, or photographic texture.

| ID | Complete build brief | Footprint / connectors |
|---|---|---|
| G01 | Make a 5 m square of gently undulating lawn: a broad moss-green top, one slightly lighter patch and one darker edge band, with four subtly rounded corners. Keep the center empty for figures and props. This is the default open greensward; it must join any soft terrain edge without a seam. | 5×5, level, soft all sides |
| G02 | Make the cleaner companion lawn for squares, guild greens, and gathering areas: flatter than G01, with a calm central oval of lighter green and only a 0.1 m edge wobble. Do not add paths, flowers, benches, or trees; the assembler supplies those. | 5×5, level, soft all sides |
| G03 | Make a usable lawn cell with one low, broad root swell on a corner and a shallow saucer depression on the opposite side. Both must be less than 0.15 m deep/high so a miniature can stand anywhere; this breaks repeated lawn without becoming an obstacle. | 5×5, level/traversable, soft all sides |
| G04 | Make a lawn square whose one designated boundary edge has three large scallops cut into the grass silhouette for a hedge to sit behind. The other three edges stay compatible with G01; leave the hedge itself out so H-series pieces can be swapped independently. | 5×5, soft on three sides, hedge-ready on one |
| G05 | Make a 10 m by 5 m lawn strip with a shallow, 0.1 m-wide drainage swale crossing the long direction. The swale is a broad darker green groove, not a realistic ditch, and must remain walkable; use it to make long greens feel made rather than tiled. | 10×5, level/traversable, soft all sides |
| G06 | Make a small rounded grass rise with a single broad crown no more than 0.5 m above its perimeter. Its slopes must be gentle enough for tokens and paths; it is a silhouette variation for a park or green, not a hill, rock pile, or cover object. | 5×5, soft all sides, 0.5 m peak |
| G07 | Make one clean grassy grade: 0 m on one connector edge and 1 m on the opposite edge, with a broad convex slope between. Keep the two cross edges blendable and leave the surface clear; it is the reliable vertical connector, not a scenic embankment. | 5×5, open on opposite sides, 1 m rise |
| G08 | Make the handoff from open grass to packed earth. One half is G01-style lawn; the other becomes a 1.5–2 m-wide warm-brown path with a feathered, chunky boundary. Keep both opposite connectors straight enough for G/P pieces; no stones or fence. | 5×5, grass soft to path open |
| G09 | Make a grass-to-cobble handoff with lawn fading into a warm gray-blue cobble field over one broad irregular line. The cobbles are large, 3–5 cm raised toy blocks rather than a texture; no curb, gutter, sign, or planted border. | 5×5, grass soft to cobble hard |
| G10 | Make a shallow grass verge strip: a 10 m run of lawn with a deliberately quiet 2.5 m-deep shoulder that can accept one bench, lantern, planter, or sign later. Keep the entire strip clear and flat; it is a placement reserve, not pre-dressed scenery. | 10×2.5, soft/open long sides |
| G11 | Make a rounded near bank for a narrow stream. The land occupies roughly three quarters of the cell; the remaining edge is a shallow inset channel with a glossy blue-green water plane 0.15 m below ground. Shape the bank as chunky curves and leave the water continuation edge exact. | 5×5, water connector on one side, open/soft opposite |
| G12 | Make a 10 m straight continuation of G11: two coherent bank shoulders around a 2 m-wide shallow water ribbon. The water is a single clean resin surface with only two or three broad highlight shapes; do not add reeds, boats, rocks, or a bridge. | 10×5, water/open long direction |
| G13 | Make a low rectangular garden bed, 0.25 m above lawn, with a dark soil top and 6–10 chunky flower/leaf clusters in two restrained colors. Preserve a clear border around it and make the planted forms low enough not to obscure miniatures. | 5×5, soft all sides, 0.25 m raised bed |
| G14 | Make a compact maintenance patch where tan gravel or flat paving fragments interrupt grass in one irregular central island. Use eight to twelve large pieces, not noisy scatter; all outer edges remain soft grass so it can quietly vary yards and alleys. | 5×5, level, soft all sides |
| G15 | Make a freestanding 5 m low stone edging line: three or four oversized warm-stone blocks, 0.2–0.3 m tall, with a subtle inward bow. It can border a bed or path but must not block a 2 m route or include plants, pots, or labels. | 5×1, soft/open sides |
| G16 | Make a universal terrain wedge for hiding otherwise straight joins: one 5 m square whose visible grass edge steps, narrows, and rounds across three sides while one side stays cleanly compatible. It is a transition underlay only—no path, tree, fence, or landmark. | 5×5, one clean connector; three soft/rough edges |

### B. Paths, cobbles, lanes, and intersections — 18 complete build briefs

Every route piece reserves a **minimum 2 m unobstructed walking corridor** and
has an empty anchor at each declared opening. Its route surface is a real
shallow mesh/volume—not a painted line—so Godot can select, highlight, and
animate a legal exit without reading a texture.

| ID | Complete build brief | Footprint / connectors |
|---|---|---|
| P01 | Make a straight 2 m-wide packed-earth footpath running north to south through an otherwise G01-like lawn cell. The path is warm muted brown with rounded, hand-shaped edges and a slightly concave central wear band; keep both end connectors centered and clear. | 5×5, open N/S |
| P02 | Make P01 with one 0.5–0.75 m grass tongue intruding from either long edge and a slightly uneven outer rim. The walking corridor stays 2 m wide; rotate/mirror variants must remain compatible with P01 rather than becoming a blocked trail. | 5×5, open N/S |
| P03 | Make a short, narrow packed-earth continuation for offset joins. Use one low root nub *or* one flat stone beside the path, never in its middle, and keep the open ends precisely centered to the 2.5 m width. | 2.5×5, open N/S |
| P04 | Make a quarter-turn packed-earth path with the same 2 m corridor curving from north to east. Use a broad rounded inside corner and a grass wedge in the unused corner; do not make it a square road intersection. | 5×5, open N/E |
| P05 | Make a packed-earth T-junction connecting north, east, and south through one open, readable meeting pad. The central pad may be subtly wider but must have no tree, stone, sign, or puddle that makes route selection ambiguous. | 5×5, open N/E/S |
| P06 | Make a packed-earth four-way crossing with four centered 2 m corridors and a small rounded central wear patch. Keep every quadrant low lawn and leave the center visibly open; this is the neutral routing primitive, not a plaza. | 5×5, open all sides |
| P07 | Make a quiet grass crossing of 5–7 large, flat, warm-stone stepping blocks, each slightly offset but forming an unmistakable north/south walking line. Stones sit almost flush with grass and do not imply a bridge, creek, or magical path. | 5×5, open N/S |
| P08 | Make a straight narrow civic cobble lane, 2.5–3 m wide, using large warm gray-blue cobble blocks with pale seams and gently broken outer edges. Its top must feel like chunky tabletop masonry, not a photographic street texture; keep both openings centered. | 5×5, open N/S |
| P09 | Make P08 with 3–4 intentionally larger cobbles shifted near the lane edges and one slight grass intrusion at a corner. The main route remains straight and open; this is the anti-repetition variant, not rubble or difficult terrain. | 5×5, open N/S |
| P10 | Make a narrow cobble quarter-turn from north to east. Follow the exact width and palette of P08, with a broad inside curve and a clear empty turning radius; do not add a curb, doorway, or lamp. | 5×5, open N/E |
| P11 | Make a cobble T-junction with north/east/south exits and a slightly widened central cluster of large stones. All three anchors must be visually equal and unobstructed so the route graph, not art, determines which way is usable. | 5×5, open N/E/S |
| P12 | Make a cobble crossroad with four equal directions and a square-ish but softly rounded central patch. Use enough stone variation to read at distance, but no fountain, post, market stall, or fixed ornament: it remains a generic routing cell. | 5×5, open all sides |
| P13 | Make a broad, low civic cobble apron suitable for a square, gate, market edge, or service frontage. It is a 10 m by 5 m field of 15–25 chunky warm stones with two clear long-side walking connections and empty center space for later props. | 10×5, open long sides |
| P14 | Make a deliberate packed-earth-to-cobble handoff: each material occupies about half the cell and meets in a crooked but traversable band. The two opposite route connectors must share centerline and width; no curb, gate, sign, or elevation change. | 5×5, open opposite sides |
| P15 | Make a cobble lane that decays into lawn at one edge. The cobble side has a firm hard connector, while the grass side has 3–4 softened stones spreading out; use it for paths ending at greens, never as an invented entrance. | 5×5, cobble hard to grass soft |
| P16 | Make a gentle cobble incline from one end to the other, exactly 0.5 m total rise over the 5 m length. The large stones follow the slope cleanly and the side edges remain low; it is a reliable level connector, not stairs. | 5×5, open opposite sides, 0.5 m rise |
| P17 | Make two broad, friendly stone steps spanning the route width, each 0.25 m high with deep treads and rounded outer corners. Use it only where a room graph/lore supports an elevation change; no rail, doorway, or architectural facade attached. | 5×5, open opposite sides, 0.5 m rise |
| P18 | Make a narrow 3 m side-alley surface running along 10 m, using a mix of flat paving slabs and compressed earth with one crooked edge. Leave both ends fully open and all walls/facades absent so it can sit between different building shells. | 10×3, open ends |

### C. Hedges, fences, trees, and green boundaries — 20 complete build briefs

All greenery is low-poly painted geometry with clean, deliberate masses. It
must create a readable boundary at tactical distance without hiding characters,
exits, ground items, or route anchors. No individual leaves, photoreal bark,
wildlife, hanging signs, or baked background should appear on any piece.

| ID | Complete build brief | Footprint / connectors |
|---|---|---|
| H01 | Make a 5 m straight run of clipped privet, 0.9 m tall and about 0.7 m thick, shaped as three broad rounded green volumes on a low dark base. Both ends are flat vertical hedge connectors; the road-facing side is gently convex and contains no flowers, gate, or stone. | 5×1, hedge ends |
| H02 | Make the irregular companion to H01: keep the same end heights and thickness but let one face bow outward by 0.4–0.6 m in the middle. It must still line up with straight runs and look intentionally trimmed, not like wild brush. | 5×1, hedge ends |
| H03 | Make a half-length privet run matching H01 precisely at both cut ends. Its purpose is to break long boundary cadence and close small gaps; it must not include a breach, planter, post, or different hedge species. | 2.5×1, hedge ends |
| H04 | Make an outside/right-angle privet corner that turns north to east with a single rounded cap at the corner. Each leg must accept H01/H02 cleanly and the outside corner must remain broadly visible, not a dense knot of foliage. | 5×5, hedge N/E |
| H05 | Make an inside/right-angle hedge corner that wraps a lawn or garden corner while preserving a usable inner 2 m pocket. Match H01 on both legs; do not add a path or a gate because the assembler decides whether the interior is accessible. | 5×5, hedge N/E |
| H06 | Make a straight privet boundary deliberately interrupted by a centered 2 m walking gap. Two clipped hedge halves frame the opening at the H01 height; there is no gate, arch, debris, or implied destination in the gap. | 5×1, hedge/OPEN/hedge |
| H07 | Make a broader hedge breach that contains two low, rough wooden planks bridging a shallow, non-hazardous ground dip. The 2 m opening must remain navigable and centered; planks are simple brown boards, not a full bridge or a named armory prop. | 5×2.5, hedge/OPEN/hedge |
| H08 | Make an H01 run interrupted near one end by one small rounded exposed root *or* one warm stone, each lower than 0.25 m. It is a visual join-breaker only; keep the hedge line and all connectors intact. | 5×1, hedge ends |
| H09 | Make a low decorative hedge with a few broad flower-color blocks embedded at sparse intervals. Keep the silhouette trimmed and the flowers abstract, larger than a miniature’s hand; use it only for gardens and bower borders, never as generic wild vegetation. | 5×1, hedge ends |
| H10 | Make a 1 m-high garden rail: two simple painted-wood horizontal rails on three chunky posts, with squared connectors at both ends. It is a transparent visual boundary, not a barricade; never attach rope, sign, flowers, or a gate. | 5×1, hard ends |
| T01 | Make a compact Crossing shade tree with a single tapered brown trunk and 3–4 m canopy made from 3–5 faceted or rounded green lobes. Its trunk base stays inside the 2.5 m footprint and its canopy is high enough that figures beneath remain visible. | 2.5×2.5 |
| T02 | Make a medium general-purpose tree: a thick, slightly bent trunk and a 5–6 m balanced canopy of six to eight clean green masses. The silhouette should read from all sides, with no exposed roots extending into adjacent connector lanes. | 5×5 |
| T03 | Make a tall, narrow lunat-tree-inspired accent: slim pale-brown trunk, vertically stacked dark-green teardrop canopy masses, and a maximum 2 m ground footprint. It is a boundary/vertical rhythm piece, not a Christmas tree or realistic conifer. | 2.5×2.5 |
| T04 | Make two T03-style lunat trees as one 5 m module, deliberately leaving a centered 2 m gap between trunks and canopy masses for a route. The gap must remain fully visible from the camera and use no rail, gate, or hedge. | 5×5, OPEN centre |
| T05 | Make the Town Green ancient oak as a specific landmark: one broad, low, gnarled trunk with three root buttresses kept inside its footprint, and a 9–10 m asymmetrical canopy built from large friendly lobes. Keep a clear 2 m ring for figures and no swing, plaque, animals, or fantasy glow unless a reviewed room says so. | 10×10 |
| T06 | Make a young ornamental tree with a thin trunk, compact 2–3 m canopy, and a clean circular base. It adds garden scale between H-series boundaries and must be visibly distinct from the mature trees without becoming a flowering cherry or a real species claim. | 2.5×2.5 |
| T07 | Make a low shrub grouping of three to five overlapping rounded green volumes, all under 0.8 m high. Its sole job is to soften corners and cover terrain joins while leaving line-of-sight to a miniature; no flowers, rocks, wildlife, or path obstruction. | 2.5×2.5 |
| T08 | Make a 5 m modwyn-bower-ready pergola: four simple warm-wood posts, two crossbeams, and a sparse chunky green vine layer across the upper frame. Keep the front and back open with a 2 m clear passage; do not add furniture, lanterns, curtains, or an attached building. | 5×5, open front/back |
| T09 | Make a compact corner-masking foliage group: one low shrub, one narrow sapling or hedge cap, and one small rock-free grass rise. It must fit entirely inside a 2.5 m square and hide a visual seam without suggesting a collectible, hazard, or entrance. | 2.5×2.5 |
| T10 | Make a transition cluster in which a short H01-compatible hedge end yields to one T01-sized tree and two low shrubs. Preserve a clear 2 m path around the tree; this is a boundary-to-open-ground connector, not a dense thicket. | 5×5 |

### D. Street facades, roofs, walls, and civic massing — 24 complete build briefs

These are deliberately modular exterior shells. Each must have a plain rear,
no baked neighboring house, no readable text, no unique shop inventory, and no
furnished interior. Use broad plaster/timber/stone color blocks and shallow
openings that read at distance; the reviewed room recipe later supplies a name,
door state, props, interior portal, and service identity.

| ID | Complete build brief | Footprint / connectors |
|---|---|---|
| B01 | Make a one-storey 5 m timber shed shell with unpainted medium-brown plank walls, one centered blank door recess, and a broad low-pitched roof wedge. It is the base for armory/workshop-like exteriors but must contain no weapons, racks, forge, sign, smoke, or shop name. | 5×5, building front |
| B02 | Make a 5 m unpainted-timber street frontage: two broad wall bays, a shallow centered door opening, and a thin blank awning rail above. Keep all ornament generic and removable; it is a frontage segment, not a complete shop. | 5×2.5, street front |
| B03 | Make a 10 m timber frontage with two uneven bays—a wider quiet wall bay and a narrower door/awning bay—under one simple roof edge. The asymmetry prevents repetition, but all door and rail features remain blank and unbranded. | 10×2.5, street front |
| B04 | Make a compact 5 m house frontage of warm ivory plaster framed by three broad dark-timber bars, a simple lower door recess, and one square dark window block. Keep the roof separate and omit curtains, flowers, people, signage, and detailed timber grain. | 5×2.5, street front |
| B05 | Make a 10 m companion house frontage with two plaster-and-timber bays, one offset door recess, and two deliberately different window-block placements. It should feel like a reusable city mass, not a historically exact half-timber building or a named residence. | 10×2.5, street front |
| B06 | Make a narrow two-storey 5 m facade whose upper floor projects 0.4 m over the ground level on simple timber brackets. Use one door recess, two dark window shapes, and a separate roof connector; no balcony, sign, goods, or person. | 5×2.5, street front |
| B07 | Make a 15 m two-storey frontage broken into three broad bays, with a lower roof mass over one end and a taller roof connector over the other. It is district silhouette variation only: keep every window blank and do not attach a guild crest, shopfront, or neighbor. | 15×2.5, street front |
| B08 | Make a quiet 10 m rear/alley wall in muted plaster or timber, with two shallow blank wall panels and no doors, bins, crates, vents, graffiti, or windows that imply a particular business. It fills back-of-block views without inventing private facts. | 10×2.5, alley front |
| B09 | Make a 5 m right-angle facade with two equally finished street faces and a simple chamfered or timber-framed outside corner. Keep one possible door recess on only one face and leave the other quiet; it must rotate cleanly for any street corner. | 5×5, street N/E |
| B10 | Make a small 5 m frontage with a simple covered porch: two chunky timber posts, a shallow roof slab, and a blank doorway behind it. The porch leaves a 2 m clear street-side approach and contains no seating, hanging sign, plants, or character. | 5×3, street front |
| B11 | Make a 10 m open market-storefront shell with two sturdy side posts, a high blank lintel/awning beam, and a wide recessed counter zone. It must be empty—no goods, vendor, fabric color, text, or market ownership—so it can become many locations. | 10×3, street front |
| B12 | Make a modest civic frontage: 10 m wide, warm pale stone/plaster face, centered broad double-door recess, and three low formal steps. Keep the symmetry friendly rather than grand and leave the facade blank of seal, banner, guard, clock, or official lettering. | 10×5, civic front |
| B13 | Make a low one-storey 10 m service building with a simple pale-stone lower band, warm plaster wall above, two broad service bays, and a low roof connector. It is a neutral mass for shops, offices, or workshops; no goods, furnace, symbol, or sign. | 10×5, street front |
| B14 | Make a separate 5 m gable roof cap: chunky terracotta/russet planes, shallow overhang, simple ridge, and clean lower sockets for B01/B02/B04/B06. Use 3–5 large tile-course bands rather than individual roof tiles; no chimney or dormer. | 5×5, building top |
| B15 | Make a 10 m gable cap with one roof plane slightly longer or lower than the other, preserving clean attachment sockets along both long edges. It adds asymmetry to B03/B05/B13 but must not include dormers, weather vanes, attached chimneys, or backgrounds. | 10×5, building top |
| B16 | Make a 5 m by 2.5 m lean-to roof add-on with one high attachment edge, one lower free edge, and plain timber support blocks. It can dress a facade side or back, but contains no stall counter, tools, water barrel, or distinct business clue. | 5×2.5, building side |
| B17 | Make two chunky ceramic chimney blocks on a compact shared base, each with a square dark opening and slightly different height. The piece attaches to a roof but emits no smoke; it is roofline variation, not evidence of an occupied named building. | 2.5×2.5, building top |
| B18 | Make a 10 m low town-wall run, 4–5 m high on its outer face, with broad pale stone blocks and a flat/very simple cap. Keep the inner edge free of walkway detail and give both ends precise hard connectors; do not add banners, guards, torches, or crenellation clutter. | 10×2, hard ends |
| B19 | Make the rough alternative to B18: same height and end connectors, but use a two-level stepped cap and one broad offset block near the middle. It remains a clean defensive boundary, not ruined masonry, rubble, or an impassable obstacle. | 10×2, hard ends |
| B20 | Make the inside corner for B18/B19, with two 5 m wall legs meeting at a crisp right angle and a simple continuous cap. Keep the interior floor clear and leave no tower, stair, postern, or guard platform unless a special set calls for one. | 5×5, hard N/E |
| B21 | Make a wall gate module with a warm-stone arch, 3 m clear central opening, and low simple cap continuing to both side connectors. The opening stays empty and passable; do not include doors, portcullis, guards, crest, torch, or banner. | 5×2, OPEN centre |
| B22 | Make a compact 5 m bridge/covered-culvert shell: a shallow arched stone side profile or simple covered roof can flank a centered 2 m route. It must attach to G11/G12 or a route surface without baking in a river direction, named bridge, toll, or occupant. | 5×5, open opposite sides |
| B23 | Make a freestanding 10 m arcade strip with four chunky pale columns, a shallow beam/roof slab, and fully open front and back. The back must not be a wall; leave out tables, merchants, signs, lanterns, flags, and statue so it can frame a market or civic edge. | 10×3, open front/back |
| B24 | Make a plain 5 m roofline/rear-massing wedge with clean bottom connectors and one sloped upper plane. It only repairs city silhouettes behind visible facades; no window, chimney, door, object, or texture should assign it a specific address. | 5×5, building connectors |

### E. Entrances, exits, and navigation anchors — 10 complete build briefs

An anchor represents a legal route only after the room graph assigns one. Each
model therefore has a clean empty `exit_anchor` transform at its opening, a
visible approach, and no text. It must never make a closed decorative feature
look like a confirmed DragonRealms exit.

| ID | Complete build brief | Footprint / connectors |
|---|---|---|
| E01 | Make a 2.5 m wooden door insert for a facade or wall: broad warm boards, a simple dark handle suggestion, and a shallow frame. It is visibly closed but has an `exit_anchor` immediately in front; no number, crest, peephole, hanging sign, or magical glow. | 2.5×1, one OPEN anchor |
| E02 | Make a 5 m broad double-door threshold beneath a chunky wood or stone lintel, with two plain door slabs and a shallow 0.1 m step. Keep the central approach completely clear and leave identity/door state to the room recipe. | 5×1, one OPEN anchor |
| E03 | Make a freestanding 5 m stone wide arch: two short warm-stone piers, a broad rounded arch, and a 2.5–3 m clear route under it. It is a reusable visual marker for a verified passage, not a gateway building; no lettering, gate leaf, banner, or statue. | 5×2.5, open through |
| E04 | Make a friendly 5 m garden gate with two low squared posts and simple rounded dark-metal bars, visibly open enough to leave a 2 m passage. It must look light and welcoming, with no lock, emblem, hedge attached, flowers, or private-property styling. | 5×1, open through |
| E05 | Make a 5 m market tent-flap threshold: two canvas side folds framing a 2.5 m clear opening and a removable bright trim band. The tent roof/walls are supplied separately; leave the counter, products, vendor, and lettering out. | 5×2.5, open through |
| E06 | Make a pure 2.5 m hedge opening: clipped hedge ends recede just enough to make the passage obvious, with grass continuing naturally through it. No planks, gate, arch, rubble, or sign; use it whenever the graph says a route crosses a hedge. | 2.5×2.5, open through |
| E07 | Make a narrow 2 m plank footbridge with four to six broad brown boards, low side rims no higher than 0.1 m, and simple support blocks hidden below. It spans a small gap/water only when paired with relevant terrain; no rail, rope, toll, or riverbank baked in. | 5×2.5, open ends |
| E08 | Make a small descending stone portal: three broad chunky steps sinking from the cell surface into a dark-but-readable rectangular lower opening. Provide a `down_anchor` at the top; do not add a door, torch, crate, dungeon skull, or unsupported masonry complexity. | 5×5, down anchor |
| E09 | Make a 5 m dock gangplank with a low sloped warm-wood deck, two simple end beams, and a clearly open route center. It is a water-route cue, not a complete dock: no boat, ropes, cargo, pier complex, sailor, or fishing gear. | 5×2.5, open ends |
| E10 | Make a compact 2.5 m landmark plinth: a low warm-stone pedestal with one inset rectangular panel deliberately blank. It gives the UI a safe optional label attachment point but does not itself claim direction, a monument, or a readable sign. | 2.5×2.5, no route |

### F. Town Green, market, and ordinary-city props — 16 complete build briefs

Props are optional set dressing, never the source of room truth. They must be
low enough for a player to see and select miniatures/items around them, have no
readable writing, and ship separately from their ground cell. Every "empty"
surface remains empty until a live or reviewed room recipe adds content.

| ID | Complete build brief | Footprint |
|---|---|---|
| R01 | Make a limestone bench as one chunky, slightly weather-softened pale-stone block: thick slab seat, two broad supports, and a gently curved front edge. It seats two miniatures visually but carries no plaque, cushions, vines, or personal belongings. | 2.5×1 |
| R02 | Make one low rough-cut stump stool with a faceted warm-brown top, darker bark-colored side band, and a flat stable base. Keep it under 0.6 m high and do not add axe marks, mushrooms, carvings, or a person. | 1×1 |
| R03 | Make a loose three-stump cluster using three R02 variants of different height arranged around a small open center. The group reads as informal performance/garden seating but leaves 1 m clear gaps and does not include a fire, instrument, table, or crowd. | 2.5×2.5 |
| R04 | Make a plain wooden bench: two broad dark-brown legs, simple seat slab, and low back rail. It is a universal quiet-city prop; no metal plaque, cushions, litter, flower pot, or district-specific ornament. | 2.5×1 |
| R05 | Make a small fish-fountain basin only for rooms whose text supports it: a shallow 5 m circular pale-stone bowl, clean glossy blue water disk, and a single abstract fish-like central spout. Keep the fish stylized and anonymous; no statue scene, coins, labels, or realistic water spray. | 5×5 |
| R06 | Make a neutral civic fountain: a 5 m round low warm-stone bowl with a short central block intended to accept a later approved figure or finial. Ship the central block blank and the water as one clear resin plane; no civic seal, sculpture, fish, or text. | 5×5 |
| R07 | Make an empty market table: thick warm-wood top, four chunky legs, and one low cross brace, with a deliberately flat 2.5 m by 1.5 m placement surface readable from above. It is the universal display primitive, so it ships with no cloth, product, scale, money, vendor, lower shelf, label, or permanent market ownership. | 2.5×1.5 |
| R08 | Make a 5 m market stall shell with four simple posts, a shallow striped canvas canopy in two muted colors, and an empty front counter. Keep the back open/blank and do not include goods, price signs, flags, vendor, or a named color scheme. | 5×2.5 |
| R09 | Make the solid-canopy companion stall: same post/counter geometry as R08, but one single interchangeable canvas color panel rather than stripes. It remains empty and reusable, with no fabric logo, goods, person, or wall attached. | 5×2.5 |
| R10 | Make a low cargo dressing group of two chunky crates and one tied sack, all under 0.8 m high and clustered inside a 2.5 m square. Surfaces have no stamps or readable markings; it is generic visual mass, not a claim about live ground items. | 2.5×2.5 |
| R11 | Make a friendly pair of broad wooden barrels—one upright, one slightly offset—with flat simple hoops represented by two dark bands. Keep both sealed and unlabeled; no tap, spilled liquid, fish, brand, or merchant implication. | 1×1 |
| R12 | Make a 2.5 m exterior equipment hook rail: one dark timber backboard and four widely spaced blank pegs. It is an attachment point for separately reviewed tools/gear and must ship empty, with no weapons, armor, leather, sign, or shop identity. | 2.5×0.5 |
| R13 | Make a generic sample rack for an armory/workshop frontage: a low dark-wood frame holding three abstract silhouette placeholders that read as equipment without resolving into named weapons or armor. The silhouettes are removable and must not claim an inventory or displayed item. | 2.5×0.5 |
| R14 | Make a simple 2.5–3 m lantern post: a slim dark-metal or wood pole with a squat warm-yellow emissive cap inside a clear geometric housing. It is a soft navigation accent, not a realistic lamp; no flame animation, banner, hook, sign, or wires. | 1×1 |
| R15 | Make one small blank hanging plaque on a right-angle bracket. The plaque face is a single empty material slot for UI/reviewed text later; no lettering, pictogram, crest, weathering, or shop cue is baked into the model. | 1×0.5 |
| R16 | Make a 2.5 m low planter/flower box: simple dark timber or warm stone container, soil band, and 5–7 chunky seasonal color blocks. Keep it below 0.7 m and distinct from G13; no plant species claim, label, watering can, or decorative sign. | 2.5×1 |

### G. Special-building sets, made only after description review — 10 complete set briefs

These are **sets**, not generic city filler. Each set begins with a room
dossier, builds 3–7 separately placeable components, and is admitted only when
the quoted source facts, exact legal exits, room scope, and a no-invention
review are recorded. A special set may share the universal kit, but must never
turn an unverified detail into a city-wide asset.

| Set | Complete build brief and admission boundary |
|---|---|
| S01 Town Green armory | Build a small set for the northwest Green evidence: an H07-style hacked hedge breach, two-plank approach, B01/B02 unpainted timber exterior, R12 empty hook rail, and R13 generic sample rack. The room description supports breach, planks, unpainted exterior, and work samples; it does **not** support a forge, named weapons, banners, proprietor, interior, or stock. Place the breach only on the exact Green boundary anchored by its room recipe. |
| S02 Town Green weaponsmith | Build a restrained service-frontage set for the north Green: G09/P15-style narrow cobble strip, H01 privet boundary, B02/B13 low blank frontage, and E01 small service door. Preserve the described calm grass/cobbles/hedge relationship and leave the facade unbranded; do not borrow the armory breach, performance bower, ancient oak, working forge, visible merchandise, or a shop sign. |
| S03 Performance bower | Build the southeast Green performance corner as T08 modwyn bower, R01 limestone bench, five individually placeable R02 stump stools, G13/low H09 garden edge, and clear grass approach. It must read as a modest outdoor gathering nook with open circulation, not a stage building: no audience, instruments, curtains, lighting rig, signage, or magic effects unless a live/reviewed scene specifically supplies them. |
| S04 Empaths’ Guild exterior | Build a reusable exterior cluster of whitewashed pale-stone wall panels, a sparsely traced ivy overlay, E04 wrought gate, a separate warm-cedar arbor, one willow-like geometric tree, and a small approved courtyard fountain base. Keep all components separable and the gate route truthful; no guild emblem, healer NPC, medical supplies, interior windows, glowing magic, or grand cathedral silhouette without the exact room evidence. |
| S05 Empaths’ Guild infirmary | Build a compact interior-cutaway kit: pearl/cream tile wall segments, white marble floor plate, one empty cot, one simple examination table, and a skylight/light-well module. Use broad clean surfaces and a calm clinical palette, preserving clear movement lanes; omit patients, blood, instruments, bottles, guild symbols, curtains, and medical labels so live/entity data can populate the room later. |
| S06 Empaths’ Guild office | Build an intimate cutaway office set from dark mahogany wall panels, a lacquered desk, one tufted wing chair, glass-front cabinet with opaque/blank contents, and short pale-stone antechamber transition. The room prose justifies material and furniture language, not ownership details: no readable papers, books, portraits, named guildleader, crest, weapon, or scenery outside the room shell. |
| S07 Mongers’ Square | Build a square kit around P13 civic cobbles, R06 neutral fountain base, removable blank pennant poles, P14 market approach transitions, and R08/R09 canvas-edge modules. Keep the central circulation broad and fountain identity unresolved unless a reviewed description names it; do not fill the square with vendor goods, crowds, prices, banners with text, or a fixed festival scene. |
| S08 Traders’ Market | Build a large tented-market interior/exterior threshold set: a broad removable low-pitch tent roof, wind-friendly canvas wall panels, E05 flap anchor, rows of empty R07 tables, and sparse blank hanging pennant tabs. It should feel like an open framed market that can breathe in the camera, never a sealed warehouse; omit vendors, merchandise, coin, labels, branded stripe colors, and crowds. |
| S09 City gate / customs | Build the city-gate cluster from B18/B19 wall runs, B21 open gate arch, one modest blank guard-post shell, P13/P14 road transition, and an empty vertical banner-pole attachment. The graph determines passage and the description determines any customs-specific detail; do not add guards, portcullis, crest, toll booth text, weapons, or a closed obstacle by default. |
| S10 Dock/riverfront | Build a modular river edge from G11/G12 banks or a simple quay wall, E09 gangplank, two low blank bollards, and optional R10 generic cargo mass. Keep water movement and walking lanes clear, with cargo deliberately non-specific; no ship, fishing nets, sailor, warehouse, regional flag, cargo labels, or harbor skyline is included until that location’s authored description confirms it. |

---

## 6. Production order

Build and approve in this order. The early sets let us make a believable city
before any named building consumes time.

### Pass 1 — universal geometry (first 22 assets)

`G01–G10`, `P01–P06`, `H01–H08`.

Success means we can lay down a grassy block, make an irregular path through it,
and shape a hedge boundary with a credible break. No building is necessary.

### Pass 2 — Town Green identity (next 18 assets)

`T01–T05`, `T08–T10`, `R01–R04`, `R12–R13`, `B01–B03`.

Success means Town Green reads as a green, an armory breach is recognisable, and
the bower/performance corner is distinct without needing room-specific art.

### Pass 3 — city traversal (next 24 assets)

`P08–P18`, `B04–B11`, `E01–E07`.

Success means we can make streets, alleys, shop fronts, and all common exit
types without falling into a repeated grid.

### Pass 4 — landmarks and districts

Only then build approved special sets `S01–S10`, one dossier at a time.

---

## 7. Character and monster miniature contract

Environment blocks intentionally stay calm. Characters do the emoting.

- Stance: broad, readable, toy-miniature proportions; feet on a circular or
  soft polygon base only when useful for selection.
- Identity: clear silhouette for race/species, hair/horns/tail/ears, guild or
  armour category, held weapon/shield, and a few bold colours.
- Scale: 1.4–1.7 m player miniatures against 5 m blocks; big creatures may
  consume 2×2 or 5×5 tactical slots without becoming visual clutter.
- Runtime source: player and monster figures are the one asset family that
  merits high-quality paid, **rigged** miniature models. A candidate is not
  admitted as a character merely because it is attractive: it needs a usable
  humanoid/creature skeleton, a clean rest pose, known scale, separate material
  slots where recolouring is promised, a license that permits the shipped game,
  and an export that Godot can import.
- Motion: bind the approved rig to a shared Godot animation controller with
  idle, turn, short room-node step, attack anticipation, hit wobble, miss
  follow-through, defeat, and spell pulse states. The live MUD event chooses
  the state; animation never claims an outcome the bridge has not confirmed.
  Use reduced-motion instant alternatives.
- No literal portrait duplication: an identity reference controls a miniature
  family, while its pose/accessories vary by entity and state.

---

## 8. First handoff package

When handing back the first batch, include:

1. A top/down and three-quarter contact sheet showing all 22 Pass-1 pieces.
2. One assembled 20 m × 20 m test square mixing every rough/clean/transition
   piece; no two adjacent ground/hedge/path pieces may be identical.
3. Asset names, nominal footprint, height, connector tags, palette role, and
   low-detail counterpart.
4. A short note listing which pieces need a second variation before release.
5. Nothing labeled as a named DragonRealms place until it is assembled against
   that place's room map and description dossier.

This kit is intentionally large enough to build a city but regular enough to
remain practical. The irregularity comes from combination, not from making the
world impossible to edit.
