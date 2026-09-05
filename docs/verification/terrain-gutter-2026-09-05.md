# The ground plane and the gutter — 5/6 September 2026

Issue #362, the half that had to be decided by looking. Captures taken the night
of 5–6 September; the filenames carry the date the work was scoped.

`godot/scripts/shared_asset_content.gd` drew every terrain, floor and water
plane as a hand-typed `5.0 x 5.0` and discarded its `cell` argument. 5 is
`CELL_PITCH_METRES` — how far apart two rooms sit — while the block is the pitch
less `CELL_GAP_METRES`, so the issue read the ground as ignoring the gutter and
proposed sizing it from the cell's published footprint like the placeholder
block now is.

Two candidates, one question, and the source cannot answer it:

| | ground plane |
|---|---|
| **A** | the cell's `board.footprint` — 4.4 m, so the gutter is empty between rooms |
| **B** | a full pitch square — 5 m, so one room's ground meets the next room's |

## How this was looked at

The procedure is the one in `board-legibility-2026-09-05.md`:
`tools/capture-godot-window.ps1` (needs `-ExecutionPolicy Bypass`, refuses
rather than photographing whatever is in front), viewer launched with
`Godot_v4.3-stable_win64.exe --path godot`, killed by PID after each shot.
3840x2071 both.

**The checked-in mock cannot be asked this question.** Its closest two rooms sit
12.5 m apart — two and a half times the pitch — so a 4.4 m plane and a 5 m plane
leave 8.1 m and 7.5 m of black between them and both look fine. That is the
issue's own caveat, and it is why it filed a claim about the code rather than a
screenshot. `tools/make-min-pitch-fixture.mjs` rewrites the real fixture's cells
onto a `CELL_PITCH_METRES` grid, changing nothing else, so the worst case can be
photographed:

```bash
node tools/make-min-pitch-fixture.mjs min-pitch-world.json 5
cp min-pitch-world.json godot/mock/crossing_mock_world.json    # restore after
```

Both captures are of that board, with the block height already coming from
`footprint.height` (the other half of #362), so the only difference between them
is the size of the ground plane.

| | |
|---|---|
| `terrain-gutter-2026-09-05-a.png` | **A**, ground = the cell's block |
| `terrain-gutter-2026-09-05-b.png` | **B**, ground = a pitch square — shipped |

## What the pictures showed

**A is much worse, and the reasoning that predicted otherwise was wrong.** With
the ground cut down to the block, a room's neighbours have nothing between them
but their own risers. Those risers are the same flat unshaded colour as the
block's top face, and at this fixed isometric camera a block standing 0.5 m
proud projects about 0.87 m sideways — more than the 0.6 m gutter — so adjacent
blocks close the gap and merge. The capture is a single unbroken gold mass with
no room boundaries anywhere in it, and the current room's exit chevrons read as
small dark notches in it.

**B keeps every room outlined.** The ground reaches 0.3 m past the block on each
side, so a strip of ground shows round each block's edge and draws it. The same
board is a legible grid of separate tiles, and the cyan chevrons sit on their
own room.

Against the goal stated in the legibility note — exits easy to find, blocks not
clipping, nodes and edges readable — B wins on the first and third and neither
loses the second, since the blocks are 0.6 m apart either way.

**So the gutter a player sees is the ground showing round the block, not a hole
in the world.** Dan's two reasons for asking for it both survive B: the seam is
what makes a room read as a place, and neighbouring geometry still cannot
intersect. Shrinking the ground removes the thing that was *drawing* the gutter.

## What shipped

B, with the dimension published rather than retyped, which was the actual defect
under the one the issue named:

- `src/lib/isometric-board-layout.mjs` publishes `board.ground` — one pitch
  square per cell — beside the block footprint it already published. One source,
  and the compiler carries it to the mock and live worlds alike.
- `shared_asset_content.gd` asks `ContentRegistry.ground_size_metres(cell)`. No
  size is written in GDScript; a cell that publishes no ground is a broken
  contract that says so with `push_error` and gets the 1 m marker, the same path
  a missing footprint takes.
- `tools/board-geometry-drift-test.mjs` now refuses a float literal equal to
  `CELL_PITCH_METRES` anywhere under `godot/scripts`, as well as the block
  literal it already refused. Sabotaged: putting `5.0` back into a plane call
  fails it, naming file and line.

## Not settled

- **The height change makes tall blocks close the gutter at the minimum pitch.**
  B hides it, because the ground still outlines each room, but the risers really
  do overlap the gap: a 1 m block projects further sideways than the 0.6 m
  gutter. On the real Crossing board nothing is closer than 12.5 m so it does not
  arise, and no live manifest has yet been photographed. If a future board packs
  rooms at the minimum, the fix is a wider gutter or a shorter drawn block, both
  of which are board-design decisions with their own captures to take.
- **These are mock-mode captures**, as the legibility note's were.
- **One camera distance.** Route only; World and Room were not captured.
- **Nobody has clicked a chevron on a 3 m block.** The Godot test asserts the
  marker sits on that block's top face; whether it is comfortable to hit there
  is a question for someone playing.
