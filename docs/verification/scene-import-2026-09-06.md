# Scene override import: the schema, the caps, and the honest write

Issue #461, fixed 6 Sep 2026. This note records the commands, not the
conclusions: where a sentence here and a command disagree, the command is
right and this page is stale.

## Re-verified before anything was changed

Each of the issue's four findings was reproduced against the real
`src/lib/sceneOverrides.ts` and the real `compileWorldSnapshot`, with a control
in the same run proving the probe reached the code (`CONTROL setSceneField 1-14
ground street -> {"ok":true}`, and the compiled cell for `1-14` carrying the
override).

| Finding | Measured on `origin/main` |
|---|---|
| version/provenance unread | no version at all and `version: 99, provenance: "attacker"` both `{"added":1}` |
| `isDrawable('primitives')` too loose | `{kind, x, z, payload:{a:{b:{c:…}}}, __proto__x:1}` accepted and stored verbatim |
| room-id keys unchecked | a 1 MB key stored (1,048,600 bytes in the store); `99999-1` stored, then dropped at compile with no field able to report it (`protocol, sequence, worldId, currentRoomId, cells, activeRoom, entities, groundItems, player`) |
| unbounded, quota invisible | zone 1 alone, every room, every field: 188,634 characters, no complaint. With a `QuotaExceededError` injected, `setSceneField` returned `{"ok":true}` while the store still held the previous value and the in-memory cache held the edit the UI was drawing |

## The quota, measured

`tools/scene-editor-shots.mjs` fills one key until the store refuses:

```
node tools/scene-editor-shots.mjs http://127.0.0.1:5192/
NOTE this origin held 5177344 characters in one key (4.94 MiB of characters) before refusing
```

That is the **whole origin**, shared with every key in `docs/PLAYER_DATA.md`.
The caps in `SCENE_LIMITS` are chosen against it: 1,048,576 characters in
total (a fifth of it), 4,096 for one room, 64 primitives in one cell. The
harness asserts `quota > cap * 2` so the relationship is checked rather than
remembered.

## The checks

```
node --experimental-strip-types tools/scene-editor-test.mjs   # 92 checks, 0 failed
node tools/scene-sabotage.mjs --no-godot                      # 13 red, 13 named, 2 not checked
node tools/scene-editor-shots.mjs http://127.0.0.1:5192/      # 41 checks, no failures
npx tsc -b && npm run lint && node tools/plan-audit.mjs
DRC_TEST_PORT=8072 node tools/run-tests.mjs                   # no failures
```

Refusal cases in the node suite, each naming its own cause: no version, a
future version, no provenance, not an object, a key that is not a room id, a
megabyte-long key, `__proto__` as a key (through `JSON.parse`, since as an
object literal it sets the prototype and there is no key to refuse), a room the
map does not have, an unknown kind, a primitive with an extra key, more
primitives than the cap, a value longer than a registry value can be, a room
past the per-room cap, and a set past the total cap. A control runs first —
a well-formed file with a real room is accepted — because every one of those
asserts a *refusal*, and a parser that refused its own export would satisfy all
of them.

Sabotage, restored by `git checkout --` and verified clean against HEAD:

| Case | Reddens |
|---|---|
| 13. the importer stops reading the format version | `FAIL a future version is refused and named` |
| 14. the store stops reading a write back | `FAIL a write that is accepted and not kept is reported too` |
| 15. the compiler stops reporting the overrides it could not apply | `FAIL a compile names an override for a room this zone does not have` |

Cases 3 and 10 were re-aimed: their anchors were lines this change replaced,
and a sabotage whose anchor no longer matches rewrites the file unchanged and
reads exactly like a pass.

## What is on screen

`docs/verification/scene-import-2026-09-06.png` — the panel after a file naming
`1-99999` is imported: the refusal names the room, the real rooms in the same
file are still taken, and the nested-payload primitive is named by its extra
key.

## What is not covered

Chrome, not the app. `isTauri()` is false in this harness, so nothing here
exercises WebView2's own quota, which may differ from the 5,177,344 characters
measured above. The number the caps are chosen against is a Chrome number and
the caps are a fifth of it, which is the margin that makes the difference not
matter; a WebView2 measurement would still be worth having.
