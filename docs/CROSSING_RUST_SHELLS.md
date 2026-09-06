# Crossing: shared Rust construction integration

The city batch builder now calls Scene Forge from the shared environment
repository. It replaces the uncommitted JavaScript wall-section/ceiling experiment,
including its unsafe fallback from neighboring room position to doorway direction.
JavaScript still owns evidence selection and native furniture placement; Rust
owns shell geometry. The shared Godot adapter owns conversion into native meshes.
DR Companion consumes the resulting PackedScene through SharedAssetContent,
its existing composition owner. No copied geometry implementation or server.

## Rebuild

Run the normal `node tools/build-crossing-city-batch.mjs`.
For changed shells, set `SCENE_FORGE_ROOT` to the shared repository checkout
(default sibling `../shared-catalog`), `GODOT4` to the Godot executable,
and optionally `CARGO` to Cargo if it is not on PATH. The build invokes a
locked release build before using the compiler. Unchanged recipes and compiler
sources reuse the package only when the output hash also matches.

The receipt at `godot/assets/crossing/procedural-shells.json` records source
file hashes, repository revision, geometry estimate, definition names and package
hash. The generated package is committed; players need neither Rust nor the shared
repository to load it. Changing shell recipes requires the build tools, not a
silently stale fallback. Compiler inputs/intermediates stay in a uniquely named
OS temporary directory for diagnosis. These are local files, not a running service.

## Construction contract

Only room-specific, nonconditional description bindings are considered. Existing
authored compositions remain protected. A candidate requires interior classification
plus enclosure prose. The current rectangular operator accepts explicit cardinal
board anchors; null/diagonal anchors and vertical/special transitions are withheld.
Rejected interiors remain in the exception report. This is deliberately incomplete
coverage, not permission to remove those rooms from the completion target.

Shell interior dimensions are the published footprint minus one metre, with
0.25 m outward wall thickness, 3.2 m height and 2.4 m wide openings. These are
provisional presentation dimensions, not dimensions recovered from game prose.
Multiple actual commands on the same side can bind the same physical opening.
No connection is created from mesh proximity. Floors, finishes, ceilings,
vertical transitions, windows inferred from descriptions and cultural detail
still need production work. Shell floors sit 5 mm above the existing base surface
to avoid coplanar overlap; wall and furniture clearances use explicit bounds.

The runtime matches source-description hash, footprint and exact graph exits before
mounting a generated composition. It reads the Rust aperture metadata to place
existing exit markers. Unknown package nodes or aperture indices refuse the
composition. Geometry is shared between duplicated native MultiMesh instances.

## Current evidence and limits

The first integrated batch has 44 shell-bearing rooms using 12 distinct meshes,
59 generated compositions including furnishings, and 26 protected authored
compositions. There are still 1,060 Crossing rooms, 220 missing descriptions,
493 compass/layout mismatches and zero rooms certified complete.

The composition tests verify source evidence, caching, bounds, approach clearance,
bindings and refusal of guessed/diagonal/vertical openings. All 18 headless Godot
scripts passed, with 5,457 checks; these include actual imported shell bounds,
aperture retention, complete exit binding counts and stale-input refusal. An
earlier test run exposed an assumption that generated rooms always have exits;
the regression now also tests addition of an exit to an exitless room.

These are neutral construction prototypes, not approved finished interiors.
Standalone shell renders were inspected in the shared project. The actual viewer
capture at `docs/verification/crossing-native-room-1-197.png` is REJECTED: the
room shell is not visibly rendered. Diagnostics confirmed the node was visible,
correctly positioned and loaded, but its automatic MultiMesh rendering AABB was
empty. The shared importer now persists explicit transformed culling bounds and
native reload tests prove those bounds survive. The subsequent off-screen
capture still did not demonstrate visible shell geometry; this remaining native
rendering discrepancy is an open integration defect, not an approved result.
Do not expand shell coverage or call this production-ready until it is resolved.
The capture helper logs actual shell transforms and bounds for that investigation.

Full Crossing visual review, dense-scene performance, 8 GB VRAM measurement and
Unity execution remain unverified. Godot testing is headless; captures remain off-screen,
low-priority and frame-rate-limited to respect the user's desktop.
