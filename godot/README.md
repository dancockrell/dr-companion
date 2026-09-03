# DR Companion — 3D World Viewer (Slice 0: Foundation)

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
- `scripts/camera_director.gd` — one continuous camera, three framing modes
  (world/route/room), tweened rather than cut.
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
  as one inexpensive route mesh for the world/route camera. It de-duplicates
  reciprocal exits for display and omits unresolved/external links rather than
  inventing a road, bridge, or destination.
- `scripts/world_controls.gd` — the in-view World / Route / Room controls and
  compact current-room exit list. Camera choices are presentation-only and
  have matching `1` / `2` / `3` shortcuts. Exit buttons are keyboard
  reachable, preserve the manifest's exact move string, and share the 3D
  markers' stale-room validation rather than creating another map window.
- `scripts/world_inspector.gd` — one collapsible current-room text inspector.
  It mirrors only confirmed occupants and ground items tethered to the active
  room, exposes keyboard-reachable inspect actions by stable ID, and shows an
  honest empty state when mock/live snapshot data supplies none.
- `scripts/confirmed_route_transition.gd` — a short, fading route ribbon only
  after the bridge has confirmed a room-to-room change over a known manifest
  exit. It stays silent for reconnects, rejects, external routes, and unknown
  jumps instead of implying travel that did not happen.
- `scripts/exit_anchor_layer.gd` — labels and makes each true current-room
  exit clickable. Local destinations are placed toward their real node;
  external exits retain their exact command label without invented geography.
- `scripts/entity_projection_layer.gd` — creates modest tabletop tokens only
  for bridge-confirmed entities and ground items. Each token is parented below
  its reported room's tether and gets a deterministic local display slot; it
  receives no independent world coordinate, combat range, lore-derived model,
  or authority to move anything. A click creates the documented, read-only
  inspect intent only for the exact confirmed snapshot ID; the desktop shell
  remains responsible for showing the resulting accessible inspector.
- `mock/crossing_mock_world.json` — the checked-in mock fixture the first
  acceptance gate requires: Town Green North plus its depth-2 neighborhood
  (19 cells), extracted from the real compiled Crossing manifest by
  `tools/build-primitive-world-manifest.mjs` — real room IDs, titles,
  positions, and exits, not hand-authored.
- `tests/foundation_test.gd` — the acceptance-gate test itself, runnable
  headlessly with no editor and no live connection.
- `tests/entity_projection_test.gd` — a headless contract gate for room
  tethering, deterministic slots, rejection of unknown rooms, and removal of
  stale tokens on the next confirmed snapshot.
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
- **No live entity or ground-item feed.** The renderer now has a strict
  room-tethered tabletop-token projection, but mock-mode snapshots remain
  empty until the real presentation bridge supplies confirmed occupants and
  room items. It does not fabricate a population for visual effect.
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
