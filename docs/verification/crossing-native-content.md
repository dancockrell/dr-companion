# Crossing native Town Green checkpoint — 6 September 2026

## Shadow-striping correction

The broad diagonal bands recorded in the preceding captures were primarily
shadow self-interference, not authored mud detail or an extra room base layered
over the composition. The room factory replaces the fallback geometry; source
dirt does contain two wheel tracks, which remain visible after correction.
Changing lighting alone removed the broad bands in actual viewer captures.

The previous 0.03 depth / 0.15 normal bias came from a differently configured
catalog review stage. A first trial used 0.1 / 2.0; the retained setup uses
0.1 / 1.0 with an explicit 4096 directional shadow atlas. Cast shadows and
ambient occlusion remain enabled; no meshes or texture detail were removed.
Godot documents the self-shadowing versus shadow-offset tradeoff in
[Light3D shadow bias](https://docs.godotengine.org/en/stable/classes/class_light3d.html#class-light3d-property-shadow-bias).

All seven room captures plus the overview were regenerated in Forward+ on
Godot 4.7.2 / RTX 4070. Bazaar and bower were visually inspected: broad banding
is removed and canopy shade remains, but fine shadow stippling still needs
tuning. This is not a pixel-perfect or lower-GPU performance acceptance.
Increasing atlas resolution adds GPU memory cost. The existing optional legacy
submodule fallback warning remains unrelated and unresolved.

403 checks across 18 Godot scripts pass. Three checks guard the retained shadow
configuration, not pixel quality; visual inspection remains necessary. No new
models, muddy terrain asset, service credits, or topology changes in this pass.
Earlier sections' striped-ground observations describe their historical capture
state; current image paths now show the corrected lighting.

## Bazaar furnishing continuation

Mongers' Bazaar now has two canvas shelters with tables beneath them and two
separate storage groups, replacing the single shelter and disconnected table.
Seven pieces reuse five already-packaged models with no new binary asset payload
or service credits. This is a partial interpretation of the existing hashed
room description, not a change to room topology, shop inventory or population.

The central 20 percent of room width is reserved as an unobstructed visual aisle.
Tests measure full mesh bounds, including canopy overhangs, rather than trusting
placement points. The first layout failed this check and was revised. Additional
checks ensure both tables fit inside their shelter footprints. All 400 checks
across 18 Godot scripts pass. The actual viewer capture was inspected: arrangement
is coherent, but matching shelters are too pristine for the described tattered
market, ground remains striped rather than muddy, and debug exit markers dominate.
Those defects keep the recipe `partial-authored`; this is not final art approval
or complete Crossing delivery. No live traversal or occlusion acceptance performed.

![Two-stall bazaar arrangement](crossing-native-bazaar.png)

## Support-socket placement continuation

Supply Stand supplies now sit on the trestle table's published `surface` socket,
not an independently guessed 0.42 m lift. The existing composition factory
transforms that source-local socket through the support's fitted scale and yaw.
This reuses the existing catalog metadata; no new assets, paid generation,
navigation rules, or parallel assembly system were introduced.

Optional piece field: `support: { "pieceIndex": 1, "socket": "surface" }`.
The index identifies an earlier piece in the same recipe; the socket replaces
the supported piece's center, and `lift` is world-space vertical clearance.
The supported piece keeps its independently declared envelope and yaw. Missing
sockets, self references, and forward references refuse the whole composition
and use the existing fallback. This is placement, not a collision or physics
solver; authors must still review support width, load silhouette, and overlap.

Validation: 18 Godot scripts / 389 checks passed; 27 board geometry checks passed.
Regression tests vary table scale and rotate it, measure actual mesh bounds,
and verify support contact and refusal behavior. Seven room captures and the
world overview were regenerated through the actual viewer. The new capture
shows correct table contact but also unresolved striped ground, prominent debug
markers, neighboring fallback blocks, and disconnected room platforms. It is
**not** accepted as finished district art. The optional legacy shared submodule
is unavailable in this checkout; its fallback warning remains visible, while
the packaged native furniture loads successfully. No live-character run occurred.

![Supply Stand support placement](crossing-native-supply-stand.png)

## Current expansion checkpoint

This section supersedes the six-room / mock-only scope below, which is retained
as the first checkpoint's history. **The requested complete vertical slice is
still unfinished.** Loading all rooms is not the same as finishing their art.

- The authoring viewer now loads the entire compiled Crossing graph: **1,060
  rooms and 2,389 directed local transitions**. The 19-room fixture remains for
  focused regression tests. World framing now fits the full graph's extents.
- **14 partial room compositions / 17 packaged native models**: the six Green
  rooms plus Via Iltesh (two cells), S'zella Plaza, Supply Stand, Back Lawn,
  Mongers' Bazaar, Milgrym's showroom, and Tembeg's salesroom.
- The shared catalog now contains **80 models**. New reusable assets are
  continuous turf, cut-log seating, a nailed plank approach, and display shelving.
  The first lawn's checkerboard treatment was rejected and replaced. All prior
  76 portable model hashes remain unchanged.
- Source revision: `8ef2a7d2fcf4b9485bc1f63c6e3fd030e83b8d96`.
  The packager now refuses a checkout at a different revision. The subset is
  approximately 26.4 MB. Geometry is not decimated.
- The live manifest loader now enriches a cell using world ID, exact cell ID,
  and complete title. A conflicting supplied description hash refuses enrichment.
  Only content fields are copied: live positions, board dimensions, exits and
  population remain untouched. Metadata explicitly says the description is a
  **compiled reference, not a newly confirmed live description**.
- This binding is exercised with live-shaped snapshots and the actual content
  factory in tests. No live-character session or full command-to-room-change
  acceptance run was performed. Different Lich ID namespaces do not get guessed
  matches; a mapping audit remains required for such sessions.
- Corrected two source collisions in the existing place map. Milgrym no longer
  receives Berolt's description, and Tembeg no longer receives a food-shop
  description. Paraphrased room-specific visual evidence is linked to
  [Milgrym's Weapons](https://elanthipedia.play.net/Milgrym%27s_Weapons) and
  [Tembeg's Armory](https://elanthipedia.play.net/Tembeg%27s_Armory).
- **381 Godot checks across 18 scripts pass**. Geometry-drift gate: 27 checks
  pass. Fixture contract, geometric briefs and primitive-world tests were rerun.
  The first PR's red gate was repaired; no unrelated tests were suppressed.

### Current visible results

![Expanded performance corner](crossing-native-bower.png)

![Mongers' Bazaar content study](crossing-native-bazaar.png)

![Weaponsmith furniture study](crossing-native-weaponsmith.png)

![Full graph overview; not finished city art](crossing-native-world.png)

The market is still a furnishing study, not a finished crowded market. Shop
fixtures still lack their inventory and finished enclosing architecture. The
weaponsmith's pine bench remains missing; a stone substitute seen in the first
review was removed rather than admitted as an inaccurate literal asset. Do not admit these sets
as lore-complete production scenes.

### Remaining work toward the complete vertical slice

1. Resolve district-scale composition and adjacent exterior/interior boundaries
   through the existing board compiler. The current small separated tiles are
   still visibly unlike the accepted coherent-town reference.
2. Author the remaining rooms and named landmarks. Every composition's missing
   pieces are machine-readable in the selection ledger; none is marked complete.
   This pass does not claim the other 1,046 rooms are finished.
3. Audit source identity across the city. The current catalog reports 85 rooms
   without a description; another 138 described bindings have a different full
   source title. Some may be valid place-level reuse, but cannot be treated as
   room-specific proof without review. The corrected shops demonstrate the risk.
4. Complete waterfronts, streets, civic buildings, interiors, inventory displays,
   species-specific plants, and reusable character models; retain full exterior
   geometry, not permanently half-open demonstration houses.
5. Verify dense-scene performance, exact door-facing/approach placement,
   marker and label clearance, keyboard/mouse traversal, live reconnect and
   confirmed movement with a real character. Animation remains deferred.

## Historical first checkpoint

Publication integration: the branch retained automation commit `f04ceab6` (the
coverage count reflects the two corrected shop bindings) and current main
`129e222b` (AI suggestion confirmation). Neither overlapped the scenery changes;
both histories were merged, not rewritten. After integration, the 381 Godot
checks and frontend build passed again; imported AI-suggestion and worker checks
passed with 150 and 125 checks respectively. The separate character-workshop
edits in the shared checkout were not staged or modified by this work.

This is **six partial room compositions in the actual Godot viewer**, not a finished
Crossing city, a live-game acceptance run, or the generic river-port demo renamed.
No paid generation or service credits were used.

## Delivered

| Exact room | Composition | Still missing |
| --- | --- | --- |
| 1-14 Town Green North | grass, narrow cobbles, hedges, approach strip | Milgrym exterior; specific privet; convincing bent-grass surface |
| 1-15 Town Green Southeast | vine bower, stone bench, open center | modwyn fruit; stump stools; limestone-specific material |
| 1-17 Town Green Northeast | grass and oak | ancient-tree-specific treatment |
| 1-23 Town Green Southwest | dense west/south hedges | lunat trees and species-specific thorns |
| 1-16 Town Green South | grass and divided hedge boundary | lunat trees |
| 1-225 Town Green Northwest | hedges and entrance gap | plank approach and unpainted Tembeg exterior with displayed work |

Positions within these small tiles are composition choices, **not surveyed MUD
geometry**. Species-specific omissions are explicit rather than claimed complete.
The source description for North uses “stream of customers”: the old broad
classifier selected water. This exact composition suppresses that generic water
primitive without claiming the classifier is now fixed for other rooms.
Remote civic buildings mentioned in South are not placed in that room.
The unresolved pond receives no inferred composition.

## One runtime path

`WorldRoot._mount_cell_detail → ContentRegistry.build_cell →
SharedAssetContent.build_room_composition`.
The content factory requires the exact cell ID and source description hash from
`godot/assets/shared_asset_selections.json`. A mismatch returns to the existing
primitive registry. No map positions, exits, commands, entity state, selection
bounds, camera heading, or population are fabricated or modified.
The existing two-hop detail window mounts and unloads compositions normally.
**Currently exercised in the compiled mock fixture, not live gameplay:** the live
snapshot compiler does not yet carry description hashes or authored scene bindings.
These compositions therefore correctly refuse live cells without the hash. Wiring
compiled content to confirmed live topology is still required; this pass does not
weaken the exact-description check to conceal that missing connection.

The same selection file holds both the seven source asset IDs and room recipes.
There is no second renderer or alternative topology. Native model templates are
cached once; instances share mesh/material resources. Full polygon geometry is
retained, with explicit miniature fitting to each published footprint. Horizontal
ground-strip fitting is nonuniform; props retain uniform proportions.
The packaged subset is roughly 17 MB; it is not a measured runtime performance budget.

Source: shared-game-environment-library revision
`63ccd5d1b5d61364ab789ed8c0f19631ee5cd7cd`.
`godot/assets/crossing/provenance.json` records exact model bounds, source/native
hashes, material sources and CC0 texture licenses. Native textures are preserved;
this does not use the flatter portable geometry-only GLB exports.

## Evidence

The capture script opens the actual WorldRoot and uses its mock bridge to focus
three confirmed fixture rooms. It narrows orthographic size to 12 for inspection;
the default room camera remains unchanged. It does not fabricate occupants.

![North](crossing-native-north.png)

![Southeast bower](crossing-native-bower.png)

![Northeast oak](crossing-native-oak.png)

Visual inspection found and corrected ground strips shrinking to small squares
under uniform fitting. A shared ambient/AO environment now lights the actual
viewer; this is not screenshot-only lighting.

## Verification and remaining gates

- Godot 4.7.2: 17 test scripts, 310 checks passed at the first composition checkpoint.
- Dedicated content checks: all declared pieces, full mesh XZ bounds inside the
  published footprint, changed-description refusal, wrong-room refusal, unresolved
  pond refusal, and no mutation of the source graph.
- Regenerated fixture contract: 61 checks passed; its one non-applicable committed
  live-snapshot drift check was explicitly not checked. Kit and primitive-registry
  checks passed. Dependencies were installed after the initial Node check reported
  the missing Tauri API package; the rerun passed.
- Real viewer captures: NVIDIA RTX 4070, Forward+, three room views inspected.
- Existing foundation GLB submodule is absent locally. Unauthored rooms therefore
  show the established explicit fallback warning; the bundled native subset loads.
- No live character, dense population/performance benchmark, complete city build,
  final lore approval, or installer verification is claimed.

**The main visual gap remains substantial:** the viewer's small, separated board
cells do not yet produce the coherent, richly dressed town requested by the user.
The current marker size and some non-compass labels compete with the small scenery.
Coarse turf is not yet a convincing manicured lawn, and the catalog's decorative
bower is not an exact modwyn botanical asset. Do not present these captures as the
accepted river-port quality target achieved in the client.

Next build work belongs in the existing board/recipe system: reconcile published
footprints with district-scale composition and exact route/door anchors, build the
named exteriors from room-specific evidence, and complete the listed vegetation
and seating. Do not scatter generic buildings over unresolved descriptions or
silently enlarge scenery beyond known bounds.

## Reproduce

From the repository root, using a Godot 4.3+ executable:

```text
godot --headless --path godot --script ../tools/package-crossing-content.gd -- <shared-catalog-checkout>
godot --headless --path godot --script res://tests/crossing_content_test.gd
godot --path godot --script ../tools/capture-crossing-content.gd
```

Set GODOT4 to the executable and run `node tools/godot-tests.mjs` for the full
viewer suite. Tested here on 4.7.2; a 4.3 compatibility run remains separate.
