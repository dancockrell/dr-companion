# Token height — 6 September 2026

Issue #373: entity and item tokens were drawn inside their own cell's block.
This is the first capture of a token in this repository at all.

## Why there was no capture before

Every board capture in this directory is of an empty board, and not by
oversight. The viewer's mock mode cannot show a token:
`godot/scripts/bridge_client.gd:_build_snapshot` emits `"entities": []` and
`"groundItems": []` — with a comment saying why, and it is the right call —
and publishes no `player` key either, so `entity_projection_layer.gd` renders
nothing whatever in mock mode. A before/after of the mock viewer would have
been two identical pictures of a board with no tokens on it, which is worse
than no picture.

`tools/viewer-snapshot-server.mjs`, written for this, is the smallest thing
that speaks the live presentation-bridge protocol
(`bridge_client.gd`, protocol 1, newline-delimited JSON over loopback TCP): it
publishes one snapshot carrying the committed mock world plus one token of each
role the board places, all named `FIXTURE` so a capture of them cannot be
mistaken for a capture of a real room. It writes its port/token pair into a
directory given on the command line, and the viewer is pointed at that
directory through `LOCALAPPDATA` for that process alone, so the app's own
`%LOCALAPPDATA%\DR Companion Data` bridge files are untouched.

## What was run

| | |
|---|---|
| Worktree | `C:\Users\Admin\dev\wt-373`, branch `fix/373-token-height` |
| Godot | `4.3.stable.official.77dcf97d8`, `C:\Users\Admin\dev\tools\godot\bin` |
| Room | `1-14`, The Crossing, Town Green North — a 1 m block, and one of the 15 cells of 19 that draw a placeholder |
| Camera | Route distance, the viewer's default |

```
node tools/viewer-snapshot-server.mjs --config-dir "<scratch>/DR Companion Data" --room 1-14
LOCALAPPDATA=<scratch> Godot_v4.3-stable_win64.exe --path godot -- --live-presentation
powershell -ExecutionPolicy Bypass -File tools/capture-godot-window.ps1 -ProcId <pid> -OutPath <png>
```

`capture-godot-window.ps1` refuses rather than photographing whatever is in
front of it, which is why these are pictures of the thing they claim to be.
Each viewer was killed by the exact pid it was launched with. The **before**
capture is the same worktree with the four changed files stashed, so the only
difference between the two pictures is this change: `entity_projection_layer.gd`
md5 `fd859da26b3f4c9a33e8b577352d0cbc` before, `3c88948e9445dc9bbc495ae3e577d17b`
after.

| | |
|---|---|
| [`token-height-2026-09-06-before.png`](token-height-2026-09-06-before.png) | the board as issue #373 found it |
| [`token-height-2026-09-06-after.png`](token-height-2026-09-06-after.png) | tokens standing on the face their cell publishes |

## What the pictures show

**Before.** Five tokens were rendered and three of them are wholly or mostly
gone. The two occupant cylinders are cut off flat at the block's top face —
what is visible is a truncated cone, the top 0.1 m of a 0.8 m token whose
anchor sat 0.08 m under the surface. The player capsule and the hostile sphere
are sunk to roughly half their height. **Neither ground item appears at all**:
their anchors were at 0.08 against a top face at 0.5, so both 0.12 m boxes were
0.42 m inside the solid. The three range bands and the assessment rings are
likewise invisible, being drawn at the tether origin, which is the block's
centre.

**After.** All five tokens stand clear of the top face: two whole cones with
their grey assessment rings visible around the base, the player capsule and the
hostile sphere fully drawn with the green engagement line between them, and
both gold ground-item boxes now visible where they were invisible before. The
three range bands are drawn on the top face, which is the surface they measure
distance across.

Nothing else in the frame moved. The exit chevrons, the block, the ground and
the room outline are pixel-identical between the two captures, because they
were already on `ContentRegistry.block_top_y()` (#362) or on the cell's own
published footprint (#365).

## The numbers behind the picture

`godot/tests/entity_projection_test.gd` prints these on every run, measured
against blocks of two different heights so that no single typed number can
satisfy both:

```
player on a 0.30 m block: y = 0.620, top face 0.150, lift 0.47
occupant on a 3.00 m block: y = 1.900, top face 1.500, lift 0.40
range-banded hostile: y = 0.490, top face 0.150, lift 0.34
5 of 5 rendered tokens at or above their own block's top face
```

## What is still not settled

- **The interior cutaways were photographed and showed no block.** A first pair
  of captures used `1-16`, a 3 m `interior-cutaway`, and neither the before nor
  the after image shows a placeholder block at that cell at Route distance,
  although `1-16` carries four unregistered primitive kinds and should draw one.
  The tokens rise by the expected 1.5 m between the two, so this change is
  visible there too, but why nothing is drawn under them was not chased and is
  not this issue. Worth a look. **Chased, in issue #376: nothing was drawn under
  them because nothing was drawn anywhere. A null `targetCellId` raised inside
  `cell_visibility_policy.gd`, so no cell on the board mounted any content at
  all — see [`cell-1-16-2026-09-06.md`](cell-1-16-2026-09-06.md).**
- **These are fixture tokens, not game state.** The snapshot server invents one
  of each role on purpose; nothing here says anything about what a real room
  contains.
- **One camera distance.** World and Room distances were not captured.
