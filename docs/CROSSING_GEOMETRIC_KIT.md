# The Crossing Geometric World Kit

Status: **production brief**
Style: original, cute, block-built tabletop fantasy; **not photorealism**
Purpose: give an environment artist or Asset Maker a repeatable catalogue of
pieces from which The Crossing can be assembled around the existing room graph.

This is a city kit, not a set of room pictures. A room is made by combining
several pieces. Repetition is desirable; sameness is not.

---

## 1. Visual contract

Think of a beautifully painted tabletop game assembled from chunky, intentional
pieces. Ground, streets, walls, buildings, foliage and props use simple
silhouettes, a restrained palette, clean color blocks, modest bevels, and
pleasant toy-like material reads.

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

### A. Ground, grass, banks, and water — 16 pieces

| ID | Brief | Footprint / connectors |
|---|---|---|
| G01 | Flat soft-grass square with tiny broad color patches and a gently uneven outer edge. | 5×5, soft all sides |
| G02 | Flat soft-grass square, cleaner central lawn variant. | 5×5, soft all sides |
| G03 | Grass square with one low root rise and shallow depression; still traversable. | 5×5, soft all sides |
| G04 | Grass square with irregular scalloped hedge-ready edge. | 5×5, soft/hedge boundary |
| G05 | Grass rectangle with a shallow swale/drain line. | 10×5, soft all sides |
| G06 | Slightly raised green mound, 0.5 m high at centre. | 5×5, soft all sides |
| G07 | Small grassy slope up/down, one metre total elevation. | 5×5, open opposite sides |
| G08 | Grass-to-packed-earth transition, broad soft edge. | 5×5, soft/open |
| G09 | Grass-to-cobble transition with no curb. | 5×5, soft/hard |
| G10 | Grass border strip with room for a bench/prop. | 10×2.5, soft/open |
| G11 | Rounded stream bank, shallow water channel at one side. | 5×5, water/open |
| G12 | Straight stream bank segment. | 10×5, water/open |
| G13 | Garden soil bed, raised 0.25 m with broad simple flowers. | 5×5, soft all sides |
| G14 | Gravel/paving patch with irregular grass intrusion. | 5×5, soft all sides |
| G15 | Low stone edging / planter lip. | 5×1, soft/open |
| G16 | Generic crossing terrain transition wedge. | 5×5, three soft/open sides |

### B. Paths, cobbles, lanes, and intersections — 18 pieces

| ID | Brief | Footprint / connectors |
|---|---|---|
| P01 | Straight packed-earth footpath, rounded edges. | 5×5, open N/S |
| P02 | Rough packed-earth footpath with grass intruding at one side. | 5×5, open N/S |
| P03 | Short packed-earth path segment with a small stone/root offset. | 2.5×5, open N/S |
| P04 | Packed-earth 90-degree bend. | 5×5, open N/E |
| P05 | Packed-earth three-way junction. | 5×5, open N/E/S |
| P06 | Packed-earth four-way junction. | 5×5, open all sides |
| P07 | Narrow stepping-stone spur through grass. | 5×5, open N/S |
| P08 | Straight narrow warm cobble lane. | 5×5, open N/S |
| P09 | Rough narrow cobble lane with a few larger offset stones. | 5×5, open N/S |
| P10 | Narrow cobble 90-degree bend. | 5×5, open N/E |
| P11 | Narrow cobble T-junction. | 5×5, open N/E/S |
| P12 | Narrow cobble crossroad. | 5×5, open all sides |
| P13 | Broader civic cobble strip / small plaza. | 10×5, open long sides |
| P14 | Cobble-to-packed-earth transition. | 5×5, open opposite sides |
| P15 | Cobble-to-grass edge transition. | 5×5, hard/soft |
| P16 | Gentle 0.5 m cobble ramp. | 5×5, open opposite sides |
| P17 | Two broad chunky stone steps. | 5×5, open opposite sides |
| P18 | Quiet side alley paving, narrow and crooked-edged. | 10×3, open ends |

### C. Hedges, fences, trees, and green boundaries — 20 pieces

| ID | Brief | Footprint / connectors |
|---|---|---|
| H01 | Low clipped privet hedge straight run, clean ends. | 5×1, hedge ends |
| H02 | Low clipped privet hedge rough run, one bowed face. | 5×1, hedge ends |
| H03 | Low clipped privet hedge short run. | 2.5×1, hedge ends |
| H04 | Low clipped privet hedge outer corner. | 5×5, hedge N/E |
| H05 | Low clipped privet hedge inner corner. | 5×5, hedge N/E |
| H06 | Low privet hedge with a 2 m walk-through breach. | 5×1, hedge/OPEN/hedge |
| H07 | Low privet hedge breach with two simple planks at the opening. | 5×2.5, hedge/OPEN/hedge |
| H08 | Hedge with small rounded root/stone interruption. | 5×1, hedge ends |
| H09 | Low shaped flowering hedge accent, no overly detailed petals. | 5×1, hedge ends |
| H10 | Thin garden rail / low painted wood fence. | 5×1, hard ends |
| T01 | Small faceted crossing shade tree, 3–4 m canopy. | 2.5×2.5 |
| T02 | Medium rounded/faceted tree, 5–6 m canopy. | 5×5 |
| T03 | Tall narrow lunat-tree style tree, 2 m footprint. | 2.5×2.5 |
| T04 | Lunat-tree pair with a natural 2 m walking gap. | 5×5, OPEN centre |
| T05 | Ancient oak landmark, broad low canopy, roots kept outside walking corridor. | 10×10 |
| T06 | Small decorative sapling / garden tree. | 2.5×2.5 |
| T07 | Shrub cluster, low enough not to hide a miniature. | 2.5×2.5 |
| T08 | Vined pergola / modwyn bower frame, empty except for chunky vine foliage. | 5×5, open front |
| T09 | Greenery corner cluster for masking joins. | 2.5×2.5 |
| T10 | Hedge-and-tree transition group, sparse enough for clear pathing. | 5×5 |

### D. Street facades, roofs, walls, and civic massing — 24 pieces

These are exterior shells with no baked neighbour, shop identity, readable sign,
or furnished interior. They must be compatible with different named uses.

| ID | Brief | Footprint / connectors |
|---|---|---|
| B01 | Low unpainted timber shed/armory shell, one door opening, broad roof. | 5×5, building front |
| B02 | Unpainted timber facade, 5 m, blank awning rail and a door. | 5×2.5, street front |
| B03 | Unpainted timber facade, 10 m, two uneven bays. | 10×2.5, street front |
| B04 | Warm plaster-and-dark-timber small house facade, 5 m. | 5×2.5, street front |
| B05 | Warm plaster-and-dark-timber medium house facade, 10 m. | 10×2.5, street front |
| B06 | Narrow two-storey facade with overhang. | 5×2.5, street front |
| B07 | Broad two-storey facade with two roof heights. | 15×2.5, street front |
| B08 | Quiet rear/alley facade with bins/doors deliberately omitted. | 10×2.5, alley front |
| B09 | Corner facade, two street-facing walls. | 5×5, street N/E |
| B10 | Small covered porch facade. | 5×3, street front |
| B11 | Blank market-storefront shell, large open face. | 10×3, street front |
| B12 | Simple town office/civic facade, low formal steps. | 10×5, civic front |
| B13 | One-storey low stone/plaster service building. | 10×5, street front |
| B14 | Gabled roof cap, 5 m. | 5×5, building top |
| B15 | Gabled roof cap, 10 m, slightly asymmetric. | 10×5, building top |
| B16 | Lean-to / side-roof attachment. | 5×2.5, building side |
| B17 | Chimney pair, chunky stylized ceramic. | 2.5×2.5, building top |
| B18 | Low town wall straight segment with walk-free inner edge. | 10×2, hard ends |
| B19 | Low town wall rough segment, stepped cap. | 10×2, hard ends |
| B20 | Town wall inner corner. | 5×5, hard N/E |
| B21 | Simple arched wall gate, 3 m opening. | 5×2, OPEN centre |
| B22 | Small bridge/covered culvert shell. | 5×5, open opposite sides |
| B23 | Freestanding columned arcade strip. | 10×3, open front/back |
| B24 | Roofline filler wedge / rear massing cap. | 5×5, building connectors |

### E. Entrances, exits, and navigation anchors — 10 pieces

| ID | Brief | Footprint / connectors |
|---|---|---|
| E01 | Simple wooden town door in a wall/facade, closed but interactable anchor. | 2.5×1, one OPEN anchor |
| E02 | Broad double-door opening under simple lintel. | 5×1, one OPEN anchor |
| E03 | Stone arch / wide arch route marker, no text. | 5×2.5, open through |
| E04 | Wrought-iron garden gate, friendly rounded bars. | 5×1, open through |
| E05 | Market tent-flap opening, bright canvas trim. | 5×2.5, open through |
| E06 | Low hedge breach with no structure. | 2.5×2.5, open through |
| E07 | Plank footbridge / narrow raised walk. | 5×2.5, open ends |
| E08 | Small stone stair portal / cellar descent. | 5×5, down anchor |
| E09 | Dock gangplank / water-route marker. | 5×2.5, open ends |
| E10 | Directional landmark plinth with blank inset panel. | 2.5×2.5, no route |

### F. Town Green, market, and ordinary-city props — 16 pieces

| ID | Brief | Footprint |
|---|---|---|
| R01 | Limestone bench, chunky single-piece base. | 2.5×1 |
| R02 | Rough cut stump stool. | 1×1 |
| R03 | Three-stump loose cluster. | 2.5×2.5 |
| R04 | Plain wooden bench. | 2.5×1 |
| R05 | Small fish fountain, broad simple bowl and water surface. | 5×5 |
| R06 | Small round civic fountain, stylized central figure omitted until lore supports it. | 5×5 |
| R07 | Market table, empty top. | 2.5×1.5 |
| R08 | Market stall shell with striped canvas canopy, empty counter. | 5×2.5 |
| R09 | Market stall shell with solid colour canopy, empty counter. | 5×2.5 |
| R10 | Stacked crates / sacks group, clear but low. | 2.5×2.5 |
| R11 | Decorative barrel pair, broad toy proportions. | 1×1 |
| R12 | Exterior equipment hook rack, empty attachments are added separately. | 2.5×0.5 |
| R13 | Stylized armour/weapon sample rack, deliberately generic silhouette. | 2.5×0.5 |
| R14 | Simple lantern post, soft warm emissive cap. | 1×1 |
| R15 | Blank hanging shop plaque on a bracket. | 1×0.5 |
| R16 | Planter / flower box with chunky seasonal colour. | 2.5×1 |

### G. Special-building sets, made only after description review — 10 sets

These are **sets**, not generic city filler. Each begins with its own dossier
and produces 3–7 compatible components. Do not build all immediately.

| Set | Description-backed first pieces |
|---|---|
| S01 Town Green armory | hedge breach, plank approach, unpainted facade, exterior hook rack, sample rack |
| S02 Town Green weaponsmith | privet edge, cobble strip, restrained frontage, small service doorway |
| S03 Performance bower | modwyn bower, limestone bench, five stump seats, low garden edge |
| S04 Empaths’ Guild exterior | whitewashed stone wall, traced ivy, wrought gate, cedar arbor, willow, courtyard fountain |
| S05 Empaths’ Guild infirmary | pearl/cream tile wall module, white marble floor, cot, examination table, skylight light well |
| S06 Empaths’ Guild office | dark mahogany wall, lacquered desk, tufted wing chair, glass-front cabinet, short stone antechamber |
| S07 Mongers’ Square | plaza cobbles, simple fountain base, pennant poles, market approach, canvas edge |
| S08 Traders’ Market | large tent roof, wind-friendly canvas wall, tent-flap anchor, central table rows, hanging pennants |
| S09 City gate / customs | gate arch, wall sections, guard-post shell, road transition, banner pole blank |
| S10 Dock/riverfront | water edge, quay wall, gangplank, bollard, modest cargo group |

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
- Motion: idle bob, turn, small step, attack anticipation, hit wobble, miss
  follow-through, spell pulse. Use reduced-motion instant alternatives.
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
