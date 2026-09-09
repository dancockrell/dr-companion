# DR Companion — Fixed-Isometric World Viewer

Implements slice 0 ("Viewer contract"). Godot is not cancelled and is where world and route presentation is going; the *3D* rebuild it once served is. See `docs/NO-3D.md`.
The foundation was contributed through PR #267 and is now maintained by Codex
as part of the same DR Companion game: Godot viewer and asset acquisition have
one current owner. This is the foundation only — a deliberately small,
well-tested shell for the real world content to register into, not a final art
pass. No generated art, no live DragonRealms connection, and no packaging exist
yet; none of those are required for this slice's acceptance gate.

**The 3D main scene is deleted, and no main scene has replaced it yet.** PR
#517 removed `scripts/world_root.gd`, `scenes/WorldRoot.tscn`,
`scripts/content_registry.gd`, `scripts/camera_director.gd`,
`scripts/entity_projection_layer.gd` and `scripts/shared_asset_content.gd`, so
`project.godot` deliberately has no `run/main_scene`: this project runs its
headless tests but does not yet open a window. The 2D isometric main scene that
replaces it is a separate owner's work. Anything below describes the systems
that survive that deletion; where the list and the directory disagree, the
directory is right.

## What's here

- `project.godot` — Godot 4.3+ project, autoloads the four system scripts
  marked below.
- `scripts/world_manifest_loader.gd` — loads a deterministic manifest (or the
  mock fixture) and is the only place that reads one. Never invents a cell or
  exit that isn't already in the JSON.
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
- `scripts/cell_visibility_policy.gd` — limits detailed mounted geometry to
  the current room and at most two true-exit hops. The complete authoritative
  graph remains available to the viewer; this budget only controls scene
  children, never the room graph or exit truth. A later world/route layer can
  add cheap silhouettes without activating local prop geometry across a city.
- `scripts/world_controls.gd` — the in-view World / Route / Room controls and
  compact current-room exit list. Camera choices are presentation-only and
  have matching `1` / `2` / `3` shortcuts. Exit buttons are keyboard
  reachable, preserve the manifest's exact move string, and are re-checked
  against the current snapshot rather than creating another map window. Since
  issue #444 this list is the only *written* way out of a room in the viewer:
  the exit chevrons and the route-line mesh were deleted, and travel is a
  click on a tile, a click on one of these words, or a hotkey.
- `scripts/world_inspector.gd` — one collapsible current-room inspector with a
  compact live player strip plus every confirmed occupant and ground item. It
  counts down only the real roundtime clock from its receipt moment, never
  invents a stun duration, keeps unassessed tactics explicit, includes every
  supplied tactical/lore fact in tooltips, and gives each row a keyboard-
  focusable Elanthipedia search.
- `scripts/combat_presentation.gd` — the single formatting and color policy for
  player urgency, health, roundtime, creature tactical facts, assess freshness,
  and Elanthipedia searches. It has one consumer today (the accessible
  inspector); it exists as a separate policy so a second surface cannot arrive
  at a second interpretation of `cannotAct` or of stale knowledge.
- `mock/crossing_mock_world.json` — the checked-in mock fixture the first
  acceptance gate requires: Town Green North plus its depth-2 neighborhood
  (19 cells), extracted from the real compiled Crossing manifest by
  `tools/build-primitive-world-manifest.mjs` — real room IDs, titles,
  positions, and exits, not hand-authored.
- `tests/foundation_test.gd` — the acceptance-gate test itself, runnable
  headlessly with no editor and no live connection.
- `tests/combat_presentation_test.gd` — verifies the honest distinction among
  unassessed, live-only, fresh, aging, and stale knowledge; player urgency;
  health and roundtime; and the whitelisted Elanthipedia search shape.
- `tests/bridge_client_null_target_test.gd` — verifies the bridge client
  survives a snapshot whose target resolves to nothing rather than calling into
  a null instance.
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

## Current presentation phase

The viewer has **no presentation layer at the moment**. What survives is the
data and validation half: the manifest loader, the bridge client with its mock
and authenticated live modes, the two intent-validation gates, event playback,
the visibility budget, and the accessible inspector. Nothing draws a world.

The art direction for the layer that replaces it is 2D isometric sprite work,
not 3D geometry — see `docs/NO-3D.md`, which is the current direction and
outranks any surviving 3D wording elsewhere in this file. DR room topology and
live state always come from the MUD graph regardless of how they are drawn.

## Running the test

```bash
"Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/foundation_test.gd
```

Exits 0 with `all passed` when the gate holds, exits 1 and prints every
failing assertion otherwise. The foundation gate currently has 24 checks
(measured by `node tools/godot-tests.mjs`, which prints each script's count;
the whole suite is 7 scripts and 100 checks).
Sabotage-tested: breaking `is_true_exit` to always return true correctly
fails exactly the two checks that exercise it and nothing else.

Every test under `godot/tests` runs in one pass, with the same engine, through:

```bash
node tools/godot-tests.mjs
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
- **No main scene at all.** `run/main_scene` is unset and the scene that used
  to fill it is deleted; the project runs headless tests only. Whether the
  eventual viewer is an embedded surface or a dedicated window (the brief's
  "Windows feasibility spike") is still unattempted.
- **No content-registration layer.** `ContentRegistry` and
  `SharedAssetContent`, which registered and rendered world content, are
  deleted with the rest of the 3D subsystem. Nothing in this project turns a
  manifest cell into anything visible today.
- **Mock mode does not fabricate a population.** The live presentation bridge
  supplies confirmed occupants, room items, player state, and optional assessed
  creature facts. Standalone mock snapshots remain honestly empty; focused
  tests inject explicit fixtures to exercise dense-room and combat states.
- **No animation of any kind.** Whatever animates the 2D isometric art later
  maps confirmed live events onto it; it does not own combat truth. Rigged 3D
  models are not that path — see `docs/NO-3D.md`.
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
