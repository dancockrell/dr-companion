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
- The two placeable kinds are `water-ribbon-5m` and `bridge-span-5m`, which is
  everything the registry admits that is not a cell's own base or the boundary
  kit the map decides.
- **The picker, the coverage list and export/import landed later the same day**,
  after everything above was measured. Sections 5 to 8 record them. Where those
  sections and anything above disagree, the later measurement is the true one:
  section 3's `no failures` was against a panel that did not yet contain half of
  what section 5 drives.

---

# S3 and S4 — the same day, after the above

The sections above are left as they were measured rather than rewritten.

## 5. The picker, the coverage list and transfer, in a real browser

`node tools/scene-editor-shots.mjs http://127.0.0.1:5195/` — **no failures, 33
checks** (18 from S2, 15 added here), against `npx vite --port 5195`, killed
afterwards by the pid found listening on that port.

| | |
|---|---|
| [`scene-editor-2026-09-06-picker.png`](scene-editor-2026-09-06-picker.png) | the picker on `90-384 — Truffenyi's Green`: two kind chips, the 4.4 m footprint with its eight compass edges, one `water-ribbon-5m` on the **east edge** at x 2.2 z 0, and `Unclassified in this zone: 2` below it |

What the capture drives, in order:

- The click lands on the centre of the square and stores `x: 0, z: 0`. A weak
  position deliberately — the next step moves it, and a value that had to travel
  is worth more than one that happened to match the default.
- `99` is then typed into the x box, which no click could produce, and the store
  holds **2.2**. The property is not that the field clamps: it is that nothing
  the control offers can produce a value `setSceneField` refuses, so the capture
  also asserts no refusal appears on screen. A red message about a number the
  person was handed a box to type is the failure this guards against.
- The page is reloaded and the placement is still there, which is the half that
  React state alone would have passed.
- An import arrives naming the same room, disagreeing about the placement and
  offering a ground nobody here had decided. The placement stands, the ground is
  taken, and the panel says `kept mine over 1`.

**This capture found nothing wrong with the app and one thing wrong with
itself.** The import case first asserted the room-level rule — that a file
naming a room this player has touched is refused entirely — and went red. The
merge is per *field*, and that is the better rule: a disagreement about where a
bridge sits should not also throw away agreement about what the ground is. The
code was right and the check was wrong. It now states the field-level property
and says so in its own comment.

**What this does not cover.** Everything section 3 already named — Chrome is not
the app, the bridge is the mock, the follow-the-character path is not exercised.

## 6. The builder reads it back

The point of S4, and the one thing no browser can show.

`tools/scene-editor-test.mjs` — **56 checks, 0 failed**, 20 added here, with a
floor of 50 so a truncated run cannot exit 0 looking green. Twelve run the real
`tools/build-world-content.mjs` end to end through three new seams
(`DRC_WORLD_OUT`, `DRC_WORLD_RESIDUE`, `DRC_SCENE_OVERRIDES`) pointed at a fresh
temp directory, so a run that ignored the seam fails for want of the file rather
than passing against the committed one. A seam and not a mode switch: the code
under test is byte-for-byte the code that ships.

Beyond the round trip, they establish that a room in the imported set comes out
of the builder with the imported answer and the rule recorded as `player`; that
the block follows an overridden ground rather than staying the batch's; that a
`landmark` of `null` survives, because "this room has no landmark" is the
correction the batch cannot express; that a ground kind this build cannot draw
is dropped and counted rather than baked into content every player receives; and
that no other room in the zone moves.

**Three states, never two.** A run with no override file says so in its own
sentence, because "there is no file" and "a file that decided nothing" would
otherwise both print `player 0` in the rule table. A file naming rooms this
cartography does not have is a hard `FAIL`, since applying none of it silently
looks exactly like having no file.

The coverage list is derived from the committed content by `rule === 'unknown'`
and does **not** read `tools/world-content-residue.csv`, which is the same fact
written a second time. The suite holds the two to each other across all 85 zones
**in both directions**, and asserts the count is non-zero first — two empty sets
satisfy any equality, which is the shape this whole file exists to avoid.

## 7. The sabotages, second pass

`node tools/scene-sabotage.mjs --no-godot` — **9 sabotages, 9 reddened the check
they named, and 2 NOT CHECKED**, the two needing an engine. The harness carries
that skip into its own summary rather than printing nine as though it were the
whole suite.

It is committed at `tools/scene-sabotage.mjs` now rather than left lane-private:
a claim that these checks can fail is worth nothing as a sentence in this
document and everything as a command somebody can re-run.

| # | broken | the check that went red |
|---|---|---|
| 8 | `clampToCell` returns its input unbounded | `FAIL nothing the clamp can produce is refused by the store` |
| 9 | the builder stops reading a person's corrections back | `FAIL a room in the imported set comes out of the builder with the imported answer` |
| 10 | the builder keeps the read but drops the undrawable guard | `FAIL a field this build cannot draw is dropped and counted, never baked in` |
| 11 | the committed residue gains a row for a room the batch classified | `FAIL every row of the residue CSV is a room the panel's coverage list offers` |

**Two more faults in the harness, both caught by the harness rather than by
reading it**, and both the same lesson as the three in section 2:

- Case 10's first version replaced an `if` line with a bare assignment and left
  its `else` dangling, so the module stopped parsing and *every* builder case
  went red, the baseline included. A sabotage that breaks the subject for all
  cases has not reached the one it was aimed at, and reads as a pass to anything
  that only asks whether something went red. It is `if (true)` now.
- Case 11's first version anchored on a row ending `...Liquid\n`. This repo
  checks out CRLF, so the anchor never matched and the case **ABORTed** — the
  harness working as intended, because a sabotage that changes nothing must
  never be allowed to read as a pass. The anchor is now the header line and
  carries no newline of its own. It also *adds* a row rather than deleting one,
  so exactly one direction of the coverage comparison can see it: deleting
  `105-47` reddened both at once, which says less than it appears to.

## 8. What is true, and what is not

- A correction made in the panel changes what the live compiler publishes and
  survives the next `npm run world:build`. Both halves checked, the second by
  running the real builder.
- Nothing the picker offers can produce a placement the store refuses.
- The 86-room residue is reachable from the panel, per zone, and held to the CSV
  in both directions by the suite.
- **Landmarks are still not drawn by the viewer**, unchanged from section 4.
- **No Godot run was made for S3 or S4, and no viewer capture was taken.** That
  is deliberate: this increment touches no `.gd` file, and an engine launch is
  not a private act on a machine running several sessions. So the claim that a
  *placed* primitive is drawn where it was put rests on section 4's pair and on
  `content_registry_test.gd`, both from earlier the same day against the same
  `content_registry.gd`, and on nothing measured for this increment.
- **`data/scene-overrides.json` is not written by the app.** The panel exports
  the JSON into a textarea and a person pastes it into that path; nothing
  automates the last step. The browser harness checks the textarea holds the
  shape the builder reads, and the suite checks the builder reads that shape.
  The hop between them is a person, and no check covers it.
