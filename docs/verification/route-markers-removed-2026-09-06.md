# Route markers removed — 6 September 2026

Issue #444. Dan, 6 September 2026, verbatim:

> remove the route markers. you travel by clicking on another tile or by
> clicking on the words in the interface or by hotkey.

## What was run

| | |
|---|---|
| Worktree | `C:\Users\Admin\dev\wt-travel`, branch `feat/travel-by-tile-word-hotkey` |
| Godot | `4.3.stable.official.77dcf97d8`, `C:\Users\Admin\dev\tools\godot\bin` |
| Room | `1-14`, The Crossing, Town Green North |
| Camera | Route distance, the viewer's default |
| Rig | `tools/viewer-snapshot-server.mjs` + `tools/capture-godot-window.ps1`, as `token-height-2026-09-06.md` describes them |

```
node tools/viewer-snapshot-server.mjs --config-dir "<scratch>/DR Companion Data" --room 1-14
LOCALAPPDATA=<scratch> Godot_v4.3-stable_win64.exe --path godot -- --live-presentation
powershell -ExecutionPolicy Bypass -File tools/capture-godot-window.ps1 -ProcId <pid> -OutPath <png>
```

Both viewers were killed by the exact pid they were launched with, and the
snapshot server with them.

**The before capture is not this worktree with the change stashed.** It is a
separate detached worktree at `origin/main` (`ce099f4e`) with
`godot/shared-assets` initialised, because the first attempt at a stashed
before was taken *before* `npm run worktree:init` had checked that submodule
out, and the two pictures then differed in the props on the green cell as well
as in the markers. Two differences in a two-picture comparison is no
comparison. The pair below share their content and differ only in what this
change removed.

The rig also has a refusal worth recording. The first run of it produced a
picture of an empty board reading "Bridge unavailable — is DR Companion
running?", because the snapshot server had failed to start and written no port
file. An empty board shows no chevrons, which is precisely the answer this
capture is meant to establish, for entirely the wrong reason. The capture
helper now aborts if the port file is absent rather than photographing that.

| | |
|---|---|
| [`route-markers-removed-2026-09-06-before.png`](route-markers-removed-2026-09-06-before.png) | `origin/main`: eight cyan chevrons round the current block, two floating labels, route lines across the board |
| [`route-markers-removed-2026-09-06-after.png`](route-markers-removed-2026-09-06-after.png) | this branch: none of them |

## What the pictures show

**Before.** Eight cyan `PrismMesh` chevrons lie in the gutter around `1-14`,
two `Label3D` billboards float above it reading `go green pond` and
`go weaponsmith's`, and thin white route lines run out of the block in every
direction and on across the board between the other cells.

**After.** No chevron, no label, no route line anywhere in the frame.

**And the current room is still identifiable**, which is the thing that had to
survive. Four cues, none of them a marker, all of them visible in the after
capture:

1. the blue outline under the centre block — `ContentRegistry`'s own current-cell
   selection ring, not part of either deleted layer;
2. the tokens standing on it: the player capsule, the hostile sphere, two
   occupant cones, and the range bands drawn on the block's top face;
3. the camera, which `world_root.gd::_focus_room` centres on the confirmed room
   on every snapshot;
4. the two panels — `Current room / The Crossing, Town Green North / 1-14` on
   the right, and the `Current exits` word list on the left, which is one of
   the three ways to travel and was deliberately kept.

The rest of the board is unchanged: same blocks, same colours, same props on
the green cell, same gutter.

## What was deleted, and the consuming side of each

| Deleted | What it drew | Who else read it |
|---|---|---|
| `godot/scripts/exit_anchor_layer.gd` | the chevrons and their labels | `world_root.gd` (`$ExitAnchors`), its own test, `godot/README.md`. Nothing else. |
| `godot/scripts/route_graph_layer.gd` | the tether-coloured route lines | `world_root.gd` (`$RouteGraph`), its own test, `godot/README.md`. Nothing else. |
| `godot/scripts/confirmed_route_transition.gd` | **nothing** — `is_playing()` returned `false` unconditionally | `world_root.gd` called `play_confirmed_route` and ignored the result; `last_route()` had no consumer outside its own test. |

`world_root.gd`'s `_last_confirmed_room_id` went with them: its only reader was
the `play_confirmed_route` call, so it would have been left write-only.

**`boardAnchor` stays.** It fed the chevron's placement, and it is not only
that: `src/lib/aiJobProducers.ts::validateTetherCandidate` reads it and forces
it to `null` for a directionless exit, with its own cases in
`tools/ai-worker-test.mjs`, its own plan increment, and a paragraph in
`docs/LOCAL_AI_BACKGROUND_WORKER.md`. A field with a live consumer in another
lane is not an absence with more steps, so it stays in `presentationTypes.ts`,
`presentationBridge.ts` and `tools/build-primitive-world-manifest.mjs`.

## The three ways to travel, before and after

| | Before | After |
|---|---|---|
| **Tile** | a neighbour walked its exit; the room you were standing on emitted an intent; anything further emitted `focus-room`, which reached the frontend and was dropped there | the current tile sends nothing; a neighbour walks its exit; anything further sends `travel-to-room`, which the frontend turns into `bridge.requestIntent('map_walk', { to })` — the same call `MapPanel` makes, which starts Lich's `go2` |
| **Words** | `ExitButtons.tsx` already rendered each parsed compass exit as a button through `useMacroRunner`. Untested. | unchanged in behaviour; the list moved into `exitControls()` so it can be asserted, and `tools/exit-controls-test.mjs` asserts it |
| **Hotkey** | `keybindings.ts` already bound all eleven numpad moves. The table was tested; the count was not. | unchanged; `tools/keybindings-test.mjs` now asserts 11 of 11 resolve, to 11 distinct moves |

The Rust intent variant was **renamed** rather than added beside the old one,
and a test asserts the superseded `focus-room` wire kind is now rejected. A
viewer built before this change fails loudly instead of clicking into silence.

## Tests

| | Before | After |
|---|---|---|
| `node tools/godot-tests.mjs` | 16 scripts, 271 checks, at the branch point `db0cab4e` | 14 scripts, 269 checks, after rebasing onto `7eafd42e` |

The two totals are not a clean pair, and saying so is cheaper than pretending:
`origin/main` moved under this branch during the work and the rebase brought
in checks this change did not write. The part both numbers agree on is the
delta from this change alone: three scripts deleted taking 24 checks
(`exit_anchor_layer_test` 11, `confirmed_route_transition_test` 7,
`route_graph_layer_test` 6), and `godot/tests/tile_travel_test.gd` arriving
with 19. The suite is smaller by five and that is correct: it no longer
asserts anything about drawing that no longer happens.

`cargo test --lib presentation` — 15 passed, including the two new ones.

## Sabotage

Three, each aimed at a line that had to run, each applied to a byte copy and
restored with the md5 compared either side.

| Sabotage | Named check that went red |
|---|---|
| remove the `cell_id == current_room` guard in `world_root.gd` | `FAIL clicking the room you are already in sends nothing at all` — and nothing else |
| make `request_travel_to_room` build a `walk` intent | `FAIL and it is a travel request, not a walk`, plus the two checks that read the same intent's fields |
| split the cell id at its **first** hyphen instead of its last | `FAIL a hyphen in the zone id does not change which half is the room` |

md5s, identical before and after each run: `world_root.gd`
`f7c9d01c69a8ce2b3a021df507fd3f46`, `intent_sender.gd`
`82155fb889e43ca8d5cde48664197a7a`, `presentationBridge.ts`
`aa0ac635301cfd9fbd5fc22e3f0eca57`.

## Not checked

**No human has clicked a tile in the running viewer.** Every claim above about
the click is made against `_on_cell_clicked` called directly, plus the Rust
side's own deserialisation tests — which is where the decision lives, and is
not the same as a mouse landing on a collision shape and the character
arriving. `cell_click_target_test.gd` covers the other half (a ray hits the box
the cell published) and the two together still do not add up to a played
session. That is L6's line 2, and it stays open.

**`map_walk` was not exercised end to end.** It needs a live Lich with `go2`
installed and a character standing somewhere. `lich-scripts/test/map_walk_test.rb`
covers the bridge script's own half against stand-ins.
