# Scene editor, S1 and S2 — 6 September 2026

Issue #445. Dan, 6 Sep 2026: *"work on the scene editor."*

Three artefacts, each covering a different half of the claim, and each saying
what it cannot cover.

| | |
|---|---|
| Worktree | `C:\Users\Admin\dev\wt-scene`, branch `feat/scene-editor` |
| Base | `feat/world-content-viewer` (#442), which is where `compileWorldSnapshot` learned to publish content at all |
| Godot | `4.3.stable.official.77dcf97d8`, `C:\Users\Admin\dev\tools\godot\bin` |

## 1. The properties, in Node

`node --experimental-strip-types tools/scene-editor-test.mjs` — **36 checks, 0
failed.** Six of them run the real `compileWorldSnapshot` against the committed
`src/data/map/1.json` and `src/data/world/1.json`, not a fixture written to
agree with it. The subject room is chosen by asking the committed content which
rooms the batch actually classifies as outdoor, so a case cannot go on passing
against a room the pipeline has stopped classifying that way: it goes red for
want of a subject instead.

The option lists are derived twice from two different statements in
`godot/scripts/shared_asset_content.gd` — the builder reads the
`ContentRegistry.register()` calls, the test reads the `registeredKinds` list
`shared_asset_status()` hands out six lines below them. Those are allowed to
disagree, which is why both are read; sabotage 5 below is that case.

`node tools/godot-tests.mjs` — 16 of 16 scripts, 279 checks.
`content_registry_test.gd` went from 27 checks to 37.

## 2. The sabotages

Seven, each aimed at one named check. `scene-sabotage.mjs` refuses to interpret
a run whose edit did not change the file, and verifies each restore with
`git diff --quiet` rather than by md5.

| # | broken | the check that went red |
|---|---|---|
| 1 | `resolveScene` stops reading the override | `FAIL an override wins over the batch` |
| 2 | the compiler stops carrying placed primitives | `FAIL a placed primitive reaches the cell` |
| 3 | `setSceneField` stops calling `isDrawable` | `FAIL an undrawable ground kind is refused` |
| 4 | the committed `sceneRegistry.json` is hand-edited | `FAIL src/data/sceneRegistry.json is not what godot/scripts/shared_asset_content.gd produces` |
| 5 | the content pack registers one kind fewer than it advertises | `advertised but not registered: bridge-span-5m` |
| 6 | `content_registry.gd::build` stops calling `_place` | `FAIL a placed primitive is drawn where the manifest put it (0, 0, 0)` |
| 7 | the placement clamp stops reading the cell | `FAIL a placement outside the cell is pulled back to the cell's own edge (40, 0, -40) against half of 4.40 x 4.40 m` |

Then the control, unsabotaged: 36 passed, registry `--check` OK, 16 of 16 Godot
scripts.

**Three faults in the harness itself, recorded because each one would have
produced a false pass and two of them nearly did.**

- The first version restored with `git checkout --` on files whose changes were
  **not committed**, which discarded real work rather than undoing the sabotage
  — three files' worth. Everything is committed before it runs now. The
  restore check caught it and said `RESTORE FAILED`, which is the only reason
  it was noticed in the same minute rather than in review.
- The md5 restore check then reported failure on a *correct* restore, because
  git normalises line endings on checkout. It compares with `git diff --quiet`
  now. The same CRLF fact was a real bug in `--check`, which compared bytes and
  so would have failed on every Windows checkout and passed on Linux CI; it
  normalises before comparing, and says why.
- Sabotage 4 was originally *removing a `register()` call*, aimed at the
  committed-JSON comparison. It never reached it: the register-vs-advertise
  drift check three lines earlier rejected it first. That is §19's "a sabotage
  that lands can still never arrive". Both are here now, aimed separately.

## 3. The panel, in a real browser

`node tools/scene-editor-shots.mjs http://127.0.0.1:5183/` — **no failures**,
18 checks, against `npx vite --port 5183`.

| | |
|---|---|
| [`scene-editor-2026-09-06-panel.png`](scene-editor-2026-09-06-panel.png) | the panel on `90-384 — Truffenyi's Green`, ground `grass` **from the batch**, the backdrop grid showing all 17 reviewed images |
| [`scene-editor-2026-09-06-chosen.png`](scene-editor-2026-09-06-chosen.png) | the same room after choosing `forest`: the label reads **yours** and a reset appears |

The dropdown is driven with the control a person uses, and the assertion is on
`localStorage['drc.scene.v1']` and on `exportSceneOverrides()` imported from the
running app — `{"90-384":{"ground":"forest"}}`, and nothing else written.

**This capture found a real bug that no Node check could see.** `setSceneField`
mutated the object `loadSceneOverrides()` had returned and handed the same
reference back, so `useSyncExternalStore` compared the snapshot against itself
and skipped the render: the choice reached localStorage and the panel did not
redraw. Every Node case passed throughout, because none of them mount a
component. Fixed by copying on write and storing a fresh object on save.

**What this capture does not cover.** Chrome is not the app: `isTauri()` is
false, so this is the mock bridge. The room is reached through the place search
rather than by following the character, because a popped-out panel is its own
webview and the mock does not deliver a `here` to it inside the wait — the main
window has one (`Room 308 · Empaths' Guild`, measured), the pop-out does not.
So the follow-the-character path is **not checked here**. What is checked is the
path that has to work with nothing connected at all, which is what
`panelDataContracts.ts` claims for this panel.

## 4. The viewer

An override compiled by the real `compileWorldSnapshot` with the real override
store, published to the Godot viewer through
`tools/viewer-snapshot-server.mjs`, exactly as
`docs/verification/token-height-2026-09-06.md` describes the rig. The rig writes
its port and token into a scratch directory and only the viewer process is
pointed at it through `LOCALAPPDATA`, so no running app's bridge files are
touched. Each viewer was killed by the pid it was launched with, and so was each
rig.

The edit, made through `setSceneField` and nothing else: room `1-14`, The
Crossing, Town Green North.

```
block      outdoor-open -> building-interior
primitives water-ribbon-5m at (-1.6, -1.6), bridge-span-5m at (1.6, 1.6)
```

which the compiler turned from

```
outdoor-open 1 m, terrain-cell-5m rough-edge-boundary-kit
```

into

```
building-interior 3 m, interior-floor-5m rough-edge-boundary-kit
                       water-ribbon-5m@-1.6,-1.6 bridge-span-5m@1.6,1.6
```

| | |
|---|---|
| [`scene-editor-2026-09-06-viewer-before.png`](scene-editor-2026-09-06-viewer-before.png) | the same room, same rig, no override |
| [`scene-editor-2026-09-06-viewer.png`](scene-editor-2026-09-06-viewer.png) | with the override |

A pair rather than one picture, deliberately: one capture of a cell drawn as an
interior cannot show that the interior came from the edit rather than from the
batch, and the batch calls this room a street.

**What changes between them.** The focused cell goes from the green terrain
plane its neighbours still have to the dark interior floor; the tokens standing
on it rise, because the block went from 1 m to 3 m and a token stands on the
block's top face; and a large water plane appears over the north-west quarter of
that cell and nowhere else, which is the placed `water-ribbon-5m` at
`(-1.6, -1.6)`. The pale blue slabs at the cell's edges are the exit chevrons
and are in both. The blue diamond to the north-east is a neighbouring water cell
the batch classified, also in both — worth naming, because it is the thing most
likely to be mistaken for the placed one.

The bridge span is behind the token cluster from this camera and is not legible
in the still. It is in the published cell and in the Godot check
(`content_registry_test.gd`); it is not visible here, and saying so is better
than pointing at the water and implying both.

## 5. What is true, and what is not yet

- An override changes what the live compiler publishes, and changes the block's
  height when it should. Checked in Node and photographed in Godot.
- A kind the viewer has no factory for cannot be stored: it is refused by name.
- The 2D backdrop override is read by `roomArtSelection` as a new
  `player-override` layer ahead of the generated pattern table.
  `docs/SCENE_ART.md` has described that tier since it was written and nothing
  could write to it.
- **Landmarks are not drawn by the viewer.** No content pack registers a
  landmark factory, `sceneRegistry.json` records `landmarksDrawn: false`, and
  the panel says so on screen. The field is real content the snapshot carries
  and the 2D map draws.
- **There is no picker and no click-to-place UI yet.** The placement path is
  proved from the store down; S3 is the control that writes to it. The two
  placeable kinds are `water-ribbon-5m` and `bridge-span-5m`, which is
  everything the registry admits that is not a cell's own base or the boundary
  kit the map decides.
- **The coverage list and export/import are S4.** The 86-room residue in
  `tools/world-content-residue.csv` is not yet reachable from the panel, and
  `tools/build-world-content.mjs` does not yet read an override file back, so a
  correction made here does not yet survive the next `npm run world:build`.
