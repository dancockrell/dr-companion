# DR Companion — Fixed-Isometric World Viewer

Implements slice 0 ("Viewer contract") of `docs/THREE_D_REBUILD_HANDOFF.md`.
The foundation was contributed through PR #267 and is now maintained by Codex
as part of the same DR Companion game: Godot viewer, 3D content registration,
and asset acquisition all have one current owner. This is the foundation only
— a deliberately small, well-tested shell for the real world content to
register into, not a final art pass. No generated art, no live
DragonRealms connection, and no packaging exist yet; none of those are
required for this slice's acceptance gate.

## What's here

- `project.godot` — Godot 4.3+ project, autoloads the five system scripts below.
- `scripts/world_manifest_loader.gd` — loads a deterministic manifest (or the
  mock fixture) and is the only place that reads one. Never invents a cell or
  exit that isn't already in the JSON.
- `scripts/content_registry.gd` — the content-registration contract. Content
  packs register a factory `Callable` per primitive `kind` string (the same
  strings `tools/build-primitive-world-manifest.mjs` writes into a cell's
  `primitives[]`); an unregistered kind still renders as a visibly-flagged
  placeholder box rather than nothing.
- `scripts/bridge_client.gd` — the presentation bridge, with standalone mock
  mode and an authenticated live mode using the Rust bridge's bounded,
  newline-delimited loopback TCP protocol. Live mode reads the guarded port
  and launch token from `DR Companion Data`, authenticates before admitting
  snapshots/events or sending intents, and never logs the token. Mock mode builds
  `WorldSnapshot`-shaped dictionaries directly from the loaded manifest and
  validates every `walk` intent against the manifest's true exits before
  mutating anything. Live loopback TCP changes the transport this file uses,
  not its validation boundary or its public methods. A dropped socket or
  ordered-event gap triggers bounded backoff and a fresh authenticated
  snapshot while the last confirmed world remains visible.
- `scripts/intent_sender.gd` — the first of two validation gates a click
  passes through (see its own header comment for why there are two).
- `scripts/event_player.gd` — strict-sequence event playback with gap
  detection, ready for slice 3's live event stream; unexercised by live
  events yet, covered by its own ordering tests below.
- `scripts/camera_director.gd` — one locked orthographic isometric camera with
  three framing scales (world/route/room). Focus and scale tween; rotation does
  not. This replaces the earlier orbit-capable continuous-camera direction.
- `scripts/world_root.gd` + `scenes/WorldRoot.tscn` — wires the above into a
  running scene: loads the mock fixture, starts the mock bridge at Town Green
  North, spawns every cell's primitives through `ContentRegistry`, and turns
  a click on a neighboring cell into a validated walk intent. It also passes
  confirmed snapshot occupants and ground items to the projection layer.
- `scripts/cell_visibility_policy.gd` — limits detailed mounted geometry to
  the current room and at most two true-exit hops. The complete authoritative
  graph remains available to the viewer; this budget only controls scene
  children, never the room graph or exit truth. A later world/route layer can
  add cheap silhouettes without activating local prop geometry across a city.
- `scripts/route_graph_layer.gd` — draws all known local manifest connections
  as inexpensive static meshes grouped by typed tether family for the
  world/route camera. Roads, paths, thresholds, stairs, ladders, ferries,
  portals, warps, and unclassified links have distinct restrained materials.
  It de-duplicates reciprocal exits and omits unresolved/external links rather
  than inventing a road, bridge, or destination.
- `scripts/world_controls.gd` — the in-view World / Route / Room controls and
  compact current-room exit list. Camera choices are presentation-only and
  have matching `1` / `2` / `3` shortcuts. Exit buttons are keyboard
  reachable, preserve the manifest's exact move string, and share the 3D
  markers' stale-room validation rather than creating another map window.
- `scripts/world_inspector.gd` — one collapsible current-room inspector with a
  compact live player strip plus every confirmed occupant and ground item. It
  counts down only the real roundtime clock from its receipt moment, never
  invents a stun duration, keeps unassessed tactics explicit, includes every
  supplied tactical/lore fact in tooltips, and gives each row a keyboard-
  focusable Elanthipedia search.
- `scripts/confirmed_route_transition.gd` — validates and records a confirmed
  room-to-room change over a known manifest exit. The current static phase
  starts no travel animation; reconnects, rejects, external routes, and unknown
  jumps remain quiet. This is the seam a later truthful streak effect will use.
- `scripts/exit_anchor_layer.gd` — labels and makes each true current-room
  exit clickable. Compiled compass anchors win, then known local destinations.
  Directionless/external exits retain their exact command in a neutral,
  explicitly unpositioned stack rather than receiving invented geography.
- `scripts/entity_projection_layer.gd` — creates modest tabletop tokens only
  for bridge-confirmed entities and ground items. Each token is parented below
  its reported room's tether and gets a deterministic local display slot; it
  receives no independent world coordinate, combat range, lore-derived model,
  or authority to move anything. The character's own confirmed state gets one
  central pawn under the current room node. Creature tokens share one assessed-
  knowledge ring language (fresh / aging / stale / live-only / unassessed), and
  stale assessed facts visibly mute without changing live allegiance. Exact
  `melee` / `pole` / `missile` buckets stage tokens on three tabletop bands;
  they are visual categories, never invented metres. An engagement line appears
  only when the supplied target resolves to exactly one confirmed token (or the
  player as `you`); ambiguous, missing, dead, and disengaged targets stay
  unlinked. A click creates the documented, read-only inspect intent only for
  the exact confirmed snapshot ID.
- `scripts/combat_presentation.gd` — the single formatting and color policy for
  player urgency, health, roundtime, creature tactical facts, assess freshness,
  and Elanthipedia searches. Both 3D tokens and the accessible inspector use it,
  preventing a second interpretation of `cannotAct` or stale knowledge.
- `mock/crossing_mock_world.json` — the checked-in mock fixture the first
  acceptance gate requires: Town Green North plus its depth-2 neighborhood
  (19 cells), extracted from the real compiled Crossing manifest by
  `tools/build-primitive-world-manifest.mjs` — real room IDs, titles,
  positions, and exits, not hand-authored.
- `tests/foundation_test.gd` — the acceptance-gate test itself, runnable
  headlessly with no editor and no live connection.
- `tests/entity_projection_test.gd` — a headless contract gate for room
  tethering, the current-room player pawn, exact range bands, resolvable target
  links, assessment rings, deterministic slots, rejection of unknown rooms,
  and removal of stale tokens on the next confirmed snapshot.
- `tests/combat_presentation_test.gd` — verifies the honest distinction among
  unassessed, live-only, fresh, aging, and stale knowledge; player urgency;
  health and roundtime; and the whitelisted Elanthipedia search shape.
- `tests/route_graph_layer_test.gd` — verifies the route view is one mesh,
  covers known local connections, and excludes unknown/external destinations.
- `tests/world_controls_test.gd` — verifies the three documented camera
  requests are explicit, rejects unknown view labels, and proves the text exit
  list cannot emit an arbitrary move or a move from a stale room.
- `tests/world_inspector_test.gd` — verifies accessible entity/item actions
  expose only stable IDs confirmed in the current room and clear on the next
  snapshot.
- `tests/live_bridge_contract_test.gd` and
  `tests/live_bridge_transport_test.gd` — verify authenticated snapshots replace
  topology atomically, unauthenticated data cannot replace state, guarded
  port/token discovery reaches a real loopback socket, and live intents use
  the Rust bridge's documented newline-delimited JSON shape.
- `tests/confirmed_route_transition_test.gd` — verifies a travel ribbon needs
  a confirmed manifest connection and refuses unknown or same-room changes.
- `tests/exit_anchor_layer_test.gd` — verifies anchors expose only true moves
  for their rendered room and reject arbitrary or stale requests.

## Current presentation phase

The viewer is **static but rig-ready**. Actors use stable room-tether spawn
sockets and snap only after a confirmed graph transition. New character and
creature assets must retain skeleton/root, facing, pivot, footprint, and
attachment metadata even though no locomotion or combat animation plays yet.
The reserved later travel effect is a fast streak along the confirmed typed
tether, not conventional walking.

Environment content begins with western-fantasy, bronze-age-mythic, and
eastern/wushu-fantasy base kits. Elven, treefolk, faction, cult, guild, and
other identities are overlays. Footprints, recipes, sockets, tethers, and
state hooks may be shared with a later Pirate Island project, but DR room
topology and live state always come from the MUD graph.

## Running the test

```bash
"Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/foundation_test.gd
```

Exits 0 with `all passed` when the gate holds, exits 1 and prints every
failing assertion otherwise. The foundation gate currently has 31 checks.
Sabotage-tested: breaking `is_true_exit` to always return true correctly
fails exactly the two checks that exercise it and nothing else.

The projection gate runs separately:

```bash
"Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/entity_projection_test.gd
```

## Windows export

The checked-in `Windows Desktop` preset produces one embedded-PCK executable;
the three reviewed runtime GLBs are included explicitly because they are loaded
by path rather than through a scene dependency. Build it with a Godot 4.3+
editor and matching export templates:

```powershell
npm run godot:export -- --godot "C:\path\to\Godot_v4.x-stable_win64_console.exe"
```

The build helper refuses a missing/non-PE result and writes a local
`godot/build/viewer-build.json` receipt with the exact byte count and SHA-256.
The ignored build directory is evidence/output, not source. Tauri packaging and
process supervision remain a separate gate: they must consume a verified
export rather than silently packaging a placeholder.

## Regenerating the mock fixture

The mock fixture was extracted from a real compiled manifest, not
hand-written. To rebuild the full Crossing manifest it was extracted from
(not required to run the tests above — the extracted fixture is already
checked in):

```bash
node tools/build-primitive-world-manifest.mjs 1
```

writes `data/world/out/1-primitive-world.json` (gitignored — a generated
build artifact, not source). As of this commit it reproduces the handoff
doc's stated acceptance numbers exactly: 1,060 cells, 2,389 local routes.

## What this slice does NOT do

Everything else in the delivery sequence is unstarted. Specifically absent,
on purpose, so nobody mistakes this for further along than it is:

- **No bundled launcher yet.** The Rust authenticated loopback bridge and
  Godot TCP client now share snapshots, ordered events, and validated intents.
  Start the viewer with `-- --live-presentation` while DR Companion is running.
  Tauri does not yet launch, supervise, or package the Godot executable.
- **No embedding decision.** Whether the viewer is an embedded surface or a
  dedicated window (the brief's "Windows feasibility spike") hasn't been
  attempted. `WorldRoot.tscn` currently only runs as a normal windowed Godot
  scene.
- **Only neutral foundation content.** `SharedAssetContent` now renders matte
  terrain, interior floor, water, rough boundary scatter, and a simple bridge
  cue. It uses the pinned `godot/shared-assets` submodule when present and an
  intentionally obvious matte fallback when it is not. It does **not** turn
  any generic mesh into a named DragonRealms guild, shrine, shop, landmark,
  or room: those remain unregistered placeholders until their own description,
  composition recipe, source record, and in-engine review are ready. The
  first real visual replacement is a cheap colored floor plane and registered
  chunky set-piece meshes, not a literal cloth/felt blanket and not an
  image-to-3D scene reconstruction.
- **Mock mode does not fabricate a population.** The live presentation bridge
  supplies confirmed occupants, room items, player state, and optional assessed
  creature facts. Standalone mock snapshots remain honestly empty; focused
  tests inject explicit fixtures to exercise dense-room and combat states.
- **No character animation controller.** Premium rigged miniature models are
  a separate admission path. The future controller maps confirmed live events
  to idle, turn, short-step, attack, hit, miss, defeat, and spell-pulse clips;
  it does not own combat truth.
- **No interiors, no portals, no tactical effects, no guild/shop index.**
  Slices 2 through 5 in full.
- **No CI wiring.** The headless test command above has to be run by hand;
  it is not yet in any GitHub Actions job.

## Shared reusable asset library

The viewer consumes the common resource library through the Git submodule at
`godot/shared-assets`; it deliberately does not copy source models into DR
Companion. The first foundation roles parse their exact approved GLB sources
directly, so they do not require Godot to import the whole catalog. Initialise
the submodule after checkout with:

```bash
git submodule update --init --recursive
```

The first review ledger is `assets/shared_asset_selections.json`. Treat it as
an admission gate: a candidate must be checked at room and world zoom for
scale, ground contact, silhouette, material readability, and suitability for
its exact semantic role. Source geometry is presentation-only; map routes,
legal exits, collision, navigation, selection, and live MUD state remain
outside the asset pack.
