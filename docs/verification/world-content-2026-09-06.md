# World content, two zones that had never been rendered — 6 September 2026

Issue #436. Dan, looking at the hand-built 19-cell Crossing mock: *"wow are you
going to do this for 17000 rooms? how many years? figure out how to batch."*

These are the first captures of any DragonRealms zone other than the Crossing
in this repository, and the first of a zone nobody has written a word of prose
about.

## Why there were none before

`tools/build-primitive-world-manifest.mjs` built its cell list by filtering
`data/art/out/geometric-room-briefs.json` for the zone. Those briefs are keyed
to authored place descriptions — 1,067 of them against 17,750 rooms — so the
tool produced a board for the Crossing (975 of its 1,060 rooms) and threw
`No mapped room cells found for zone <n>` for 83 of the 85 zones. There was
nothing to point a viewer at.

It reads `src/data/map/<zone>.json` for the rooms and `src/data/world/<zone>.json`
for the classification now. Both exist for every zone, so every zone builds.

## What was run

| | |
|---|---|
| Worktree | `C:\Users\Admin\dev\wt-world2`, branch `feat/world-content-viewer` |
| Godot | `4.3.stable.official.77dcf97d8`, `C:\Users\Admin\dev\tools\godot\bin` |
| Rig | `tools/viewer-snapshot-server.mjs`, as `docs/verification/token-height-2026-09-06.md` describes it |

```
node tools/build-primitive-world-manifest.mjs 127     # 666 cells
node tools/build-primitive-world-manifest.mjs 116     # 513 cells
node tools/viewer-snapshot-server.mjs --config-dir "<scratch>/DR Companion Data" \
    --fixture data/world/out/127-primitive-world.json --room 127-186
LOCALAPPDATA=<scratch> Godot_v4.3-stable_win64.exe --path godot -- --live-presentation
powershell -ExecutionPolicy Bypass -File tools/capture-godot-window.ps1 -ProcId <pid> -OutPath <png>
```

The rig writes its port/token pair into a scratch directory and the viewer alone
is pointed at it through `LOCALAPPDATA`, so a running app's own bridge files are
untouched. `capture-godot-window.ps1` refuses rather than photographing whatever
is in front of it — it aborted three times here with *"window did not take
foreground; the capture would be of something else"* before the cave capture
succeeded, which is why these are pictures of the thing they claim to be. Each
viewer was killed by the exact pid it was launched with, and so was the rig.

The five tokens in each picture are the rig's own fixture, named `FIXTURE` for
that reason. They are not game content and no live character was involved.

## The pictures

| | |
|---|---|
| [`world-content-2026-09-06-boar-clan-forest.png`](world-content-2026-09-06-boar-clan-forest.png) | zone 127, Boar Clan, room `127-186` — Paasvadh Forest, Understory |
| [`world-content-2026-09-06-hibarnhvidar-cave.png`](world-content-2026-09-06-hibarnhvidar-cave.png) | zone 116, Hibarnhvidar, room `116-114` — Inner Hibarnhvidar, Upper Cavern |

## What they show

**Boar Clan** is a flat green board. Every cell is a 5 m terrain plane at the
pitch with a 1 m block on it, which is what `blockKind: outdoor-open` draws, and
the batch calls 199 of that zone's 666 rooms `forest` and 123 `grass`. The
lattice of thin orange lines between the tiles is the route graph; the blue
chevrons lying in the gutter around the focused room are its eight exits. The
brown slab on each tile is the `rough-edge-boundary-kit`, drawn as the honest
matte fallback because the shared-asset submodule is not initialised in this
worktree — the viewer says so on the console rather than drawing nothing.

**Hibarnhvidar** is a different board from the same pipeline, and that is the
point of showing both. Its cells are brown 3 m cutaway blocks, because the batch
calls 296 of its 513 rooms `interior` and 95 `cave`, and both map to a block kind
the viewer draws as a floor plane inside a raised shell rather than as open
terrain. Nothing in the viewer changed between the two captures; the two zones
look different because the content says they are different.

The focused room's exit list reads north, northeast, east, southeast — the real
`116-114` exits — and one of its tethers is labelled `go moongate`, which is a
real exit of that room and not something this pipeline invented. Topology comes
from the map, as it always did; only the ground under it is new.

## What they do not show

Neither picture proves the classification is *right* for these two rooms. Nobody
on this machine has stood in Paasvadh Forest. What they prove is that the batch
reaches the screen and that two zones with different content render differently
— the classification's accuracy is argued separately, by the exit-graph
adjudication `tools/build-world-content.mjs --control` prints (283 of 302
disputed Crossing rooms are behind a door, siding with the batch against the
older lore classifier).

The shared-asset submodule is not initialised here, so the boundary kit is a
fallback slab in both pictures rather than the reviewed stone scatter. That is a
missing asset, not a missing classification.
