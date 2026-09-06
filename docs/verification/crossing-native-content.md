# Crossing native Town Green checkpoint — 6 September 2026

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
