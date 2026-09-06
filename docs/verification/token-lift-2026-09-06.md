# Token lift — 6 September 2026

Issue #385: a token's lift above its block and the token mesh's own height were
two statements of one rule, in two languages, tied by nothing. The fix moves the
token dimensions into `src/lib/isometric-board-layout.mjs`, publishes them on
each spawn point, and has the viewer build the mesh the cell published. The lift
is then derived from the height in one expression, `tokenLiftFor()`.

**This capture exists to show that the refactor moved nothing on screen.** The
placement was already correct after #373/#375; what changed is where the numbers
live. So the interesting result here is a *null* one, and it is measured rather
than eyeballed: over the board, the two captures are pixel-identical.

## What was run

| | |
|---|---|
| Worktree | `C:\Users\Admin\dev\wt-385`, branch `fix/385-token-lift` |
| Godot | `4.3.stable.official.77dcf97d8`, `C:\Users\Admin\dev\tools\godot\bin` |
| Room | `1-14`, The Crossing, Town Green North — a 1 m block |
| Procedure | `docs/verification/token-height-2026-09-06.md`, unchanged |

```
node tools/viewer-snapshot-server.mjs --config-dir "<scratch>/DR Companion Data" --room 1-14
LOCALAPPDATA=<scratch> Godot_v4.3-stable_win64.exe --path godot -- --live-presentation
powershell -ExecutionPolicy Bypass -File tools/capture-godot-window.ps1 -ProcId <pid> -OutPath <png>
```

Both viewers were killed by the exact pid they were launched with, and the
snapshot server by its own. The **before** capture is this same worktree with
the two changed source files and the regenerated fixture stashed, so the only
difference between the two runs is this change:
`godot/scripts/entity_projection_layer.gd` md5
`3c88948e9445dc9bbc495ae3e577d17b` before (which is #375's recorded "after"
hash), `3be4a74a0083a25bb67713619d6f0d8c` after.

| | |
|---|---|
| [`token-lift-2026-09-06.png`](token-lift-2026-09-06.png) | after: every token built from the dimensions its cell published |

The before capture is not committed: it is byte-for-byte the same board, and it
carries an NVIDIA overlay toast in one corner that has nothing to do with the
viewer. The measurement below is what it was taken for.

## What was measured

Over the board — pixels `(1550, 700)` to `(2400, 1350)`, 552,500 of them, which
is the block, all seven token slots, the range bands and the exit chevrons:

| Comparison | Pixels differing by more than 30 |
|---|---|
| after (this change) vs before (stashed) | **0 of 552,500** |
| before (this worktree, today) vs `token-height-2026-09-06-after.png` (#375, wt-373) | 4,665 |

The first row is the result: the player capsule, the two occupant cylinders, the
range-banded hostile sphere and the ground-item boxes are drawn at exactly the
same size, in exactly the same place, from published dimensions as they were
from typed ones.

The second row is stated so that the first is not read for more than it says.
This board does **not** match #375's committed capture pixel for pixel, and the
difference is present in the before capture too — so it is environmental, not
this change. Two things differ: the props drawn on a neighbouring cell (a
`godot/shared-assets` submodule checkout that wt-373 did not have in the same
state), and the hostile's assessment ring, which is visible in #375's image and
sits inside the block in both of today's. Neither is a token placement, both
predate this branch, and the assessment ring is worth a look on its own — it is
drawn `ASSESSMENT_RING_DROP_METRES` below its token, which for a hostile at a
0.34 m lift lands 0.05 m *under* the top face. Not filed here, and not fixed
here, because it is a different rule from the one this branch owns.

## The numbers behind the picture

Measured on the committed fixture and on a live-compiled snapshot by
`tools/godot-fixture-contract-test.mjs`, which now checks the property the old
rule only claimed:

```
mock fixture: every spawn point publishes the token height its lift is half of   133 of 133
mock fixture: every token's bottom face is at or above its own cell's block top  133 of 133
live snapshot: every spawn point publishes the token height its lift is half of  14 of 14
live snapshot: every token's bottom face is at or above its own cell's block top 14 of 14
```

And in the engine, by `godot/tests/entity_projection_test.gd`, which measures the
built mesh rather than the token's origin:

```
[current room crossing-1] 7 of 7 token meshes seated on their own block's top face, 4 mesh kinds across 2 block heights
[current room crossing-2] 7 of 7 token meshes seated on their own block's top face, 4 mesh kinds across 2 block heights
hostile republished at 1.60 m: drawn 1.600 m, bottom 1.500, top face 1.500
```

The third line is the chooser: one kind's published height is changed in the
fixture and its bottom face still lands on the surface, so the lift followed the
height. A viewer holding a mesh height of its own fails it by 0.46 m, which is
the exact drift issue #385 demonstrated.
