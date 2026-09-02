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
- `scripts/bridge_client.gd` — the presentation bridge, in mock mode. Builds
  `WorldSnapshot`-shaped dictionaries directly from the loaded manifest and
  validates every `walk` intent against the manifest's true exits before
  mutating anything. The live-bridge swap (a real loopback WebSocket to
  Tauri/Rust) changes the transport this file uses, not its validation
  boundary or its public methods.
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
  a click on a neighboring cell into a validated walk intent.
- `mock/crossing_mock_world.json` — the checked-in mock fixture the first
  acceptance gate requires: Town Green North plus its depth-2 neighborhood
  (19 cells), extracted from the real compiled Crossing manifest by
  `tools/build-primitive-world-manifest.mjs` — real room IDs, titles,
  positions, and exits, not hand-authored.
- `tests/foundation_test.gd` — the acceptance-gate test itself, runnable
  headlessly with no editor and no live connection.

## Running the test

```bash
"Godot_v4.7.2-stable_win64_console.exe" --headless --path godot --script res://tests/foundation_test.gd
```

Exits 0 with `all passed` when the gate holds, exits 1 and prints every
failing assertion otherwise. As of this commit: 22 checks, 0 failed.
Sabotage-tested: breaking `is_true_exit` to always return true correctly
fails exactly the two checks that exercise it and nothing else.

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

- **No real bridge.** `bridge_client.gd`'s `mock_mode` flag exists but there
  is no loopback WebSocket, no session token, and no
  `src-tauri/src/presentation_bridge.rs` yet. Nothing in Rust talks to Godot.
- **No embedding decision.** Whether the viewer is an embedded surface or a
  dedicated window (the brief's "Windows feasibility spike") hasn't been
  attempted. `WorldRoot.tscn` currently only runs as a normal windowed Godot
  scene.
- **No content.** Every primitive is `ContentRegistry`'s flat-colored
  placeholder box — that's the intended state for this slice, not a bug, but
  it means nothing here should be shown to anyone as a visual preview of the
  product.
- **No entities or ground items.** `WorldSnapshot.entities`/`.groundItems`
  are hard-coded empty arrays; there is no source to populate them from yet.
- **No interiors, no portals, no tactical effects, no guild/shop index.**
  Slices 2 through 5 in full.
- **No CI wiring.** The headless test command above has to be run by hand;
  it is not yet in any GitHub Actions job.
