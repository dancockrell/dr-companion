# The Crossing slice acceptance checklist — 5 September 2026

The six lines of `docs/THREE_D_REBUILD_HANDOFF.md` §9, run against the viewer
as it stands. Two are recorded. Four are not, and this file says what was tried
for each rather than leaving them blank, because the next person should not
have to rediscover which instruments do not work here.

Read the "instruments" section at the bottom before repeating any of this. Two
of the four unproven lines are unproven because of the rig, not the program,
and one of those obstacles is now solved.

## What was run

| | |
|---|---|
| Commit | `b811775d` — `feat(godot): the Codex contract for the Crossing slice [L1, L2, L3, L4] (#305)`, on `main` |
| Worktree | `C:\Users\Admin\dev\wt-l` |
| Godot | `4.3.stable.official.77dcf97d8`, `C:\Users\Admin\dev\tools\godot\bin` |
| Viewer build | `godot/build/DRCompanionWorldViewer.exe`, 84 367 360 bytes, sha256 `f6df553bdbfb154ede05123f0600c8bfd91faafe167de23ab4c0ab92925f30c9` |
| Mode | mock — the viewer launched with no user arguments, so `_live_requested()` is false and it loads `godot/mock/crossing_mock_world.json` |

```bash
GODOT4=C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64.exe npm run godot:export
./godot/build/DRCompanionWorldViewer.exe
```

## Line 1 — Town Green North renders. **Recorded.**

`crossing-slice-2026-09-05-mock.png`, beside this file, is the viewer's own
client area, captured whole. It reads:

```
Current room                                     Hide
The Crossing, Town Green North
1-14
PLAYER STATE UNKNOWN  Health not received
No status flags reported
People and creatures
No one confirmed here
Items on the ground
No items confirmed here
```

and draws primitive terrain — the yellow, green and brown five-metre cells the
manifest asks for, in an isometric arrangement, with the focused cell outlined
in blue. Eight exit anchors stand on that cell, labelled `north`, `east`,
`southeast`, `south`, `southwest`, `west`, `go weaponsmith's` and
`go green pond`. Those are exactly the eight exits `1-14` carries in the
fixture, in the fixture's order, and no more:

```bash
node -e "const f=require('./godot/mock/crossing_mock_world.json');console.log(f.cells.find(c=>c.id==='1-14').exits.map(e=>e.move).join(', '))"
north, east, southeast, south, southwest, west, go weaponsmith's, go green pond
```

So this is not merely "a scene appeared": the room on screen is the room the
fixture names, and the anchors on it are that room's real exits rather than a
generic set.

## Line 4 — a fabricated exit is refused. **Recorded.**

`godot/tests/foundation_test.gd`, which now runs in the suite (`npm run
test:godot`, 11 of 11 scripts, 131 checks), asserts *a fabricated exit intent
is refused by IntentSender before reaching the bridge* and *a made-up exit is
correctly rejected as not true*, both against this fixture.

The app-side half was run here, against the app started from this worktree
(`npm run tauri dev`, with `node tools/fake-lich.mjs --port 11147` for the game
socket):

```
node tools/live-chain-check.mjs
OK   files - port 56792, token 64 chars, from C:\Users\Admin\AppData\Local\DR Companion Data
OK   connect - 127.0.0.1:56792
OK   hello - protocol 1
OK   auth
OK   snapshot - sequence 5, room 1-308, 1060 cells
OK   intent-rejected - intent's fromRoomId does not match the current room
6 of 6 steps passed, 0 failed, 0 never ran / all passed
```

An intent naming a room the app never published is refused by the app before
anything reaches the game socket, and the viewer refuses one before it reaches
the app. Both halves of the line are covered.

## Line 2 — every real exit is clickable. **Unproven.**

Not "failed". Something happens, and what happens could not be attributed.

A synthesised click inside the `Current exits` list changed the mock current
room, four times in five attempts, across two fresh viewer processes:

```
1-14 → click → 1-17 → click → 1-16 → click → 1-15 → click → 1-14
```

That is more than the 5 September live-chain record could establish, which
found no response at all: the `pressed` connection from those buttons into
`request_visible_exit` is **not** dead, and the mock snapshot does move.

What cannot be claimed is *which* button was pressed. The click coordinates
came from a PowerShell rig, and PowerShell 5.1 is DPI-unaware by default, so
its idea of where a point is and the window's differ by the display's scale
factor. Measured, in the same script, on the same window, seconds apart:

```
IsProcessDPIAware = False   client size 1024x576   origin 2048,271
IsProcessDPIAware = True    client size 3840x2071  origin 0,29
```

Worse, in one run the cursor moved between `SetCursorPos` and the button press:
the script asked for screen `(360,375)` and `GetCursorPos` a second later
reported `(1515,19)`. This machine has a person and several agent sessions on
it, and a rig that steers the shared cursor cannot tell its own click from
anyone else's.

So the reading that *clicking the row labelled `north` walked east* — which the
room ids above would support if the coordinates were sound — is **not** a
finding. It is what a mis-scaled coordinate looks like, and the two are
indistinguishable from here. A person clicking that button once still settles
it in a second, and that is still the next thing to do.

## Line 3 — click → `intent_accepted` → confirmed room change → token moves. **Unproven.**

The confirmed-room-change half cannot be reached with `tools/fake-lich.mjs`,
which replays captured text on a loop and answers a movement command with
"…wait, what? (the fixture has no answer)". This is the same limit the
5 September record hit, and it is a property of the fixture rather than a
finding about the app: only a live character closes that loop.

The intent half is already recorded there — an intent sent as the viewer would
send it was accepted and `> southwest` appeared on the game side in the same
second.

## Line 5 — a stun flips `cannotAct` and the scene reacts. **Unproven.**

In mock mode the viewer's own panel reads `PLAYER STATE UNKNOWN  Health not
received` and `No status flags reported` — it has no player state at all, so there is nothing for a stun to flip. Reaching this line needs
the app publishing a snapshot with `cannotAct` set, which needs a character who
has actually been stunned; `fake-lich` cannot produce one.

Filed as a gap for the content side: a way to publish a chosen player state to
the bridge without a live character would make this line, and line 6, testable
by anyone. Nothing on either side offers that today.

## Line 6 — an assessed creature's confidence visibly ages. **Unproven.**

Same obstacle, one step further out. Mock mode shows `No one confirmed here` under
"People and creatures", so there is no assessed creature to age. This needs a
published snapshot carrying an assessment with a timestamp, and then a wait.

`godot/tests/combat_presentation_test.gd` (14 checks) exercises the projection
side of this, so the ageing rule is not unwritten — it is unwatched.

## The instruments

Two mechanical findings, both worth more than the lines they were gathered for.

**`Graphics.CopyFromScreen` captures the Godot window; `PrintWindow` does not.**
The 5 September record could not judge a hover state because `PrintWindow` on a
GPU-composited Godot window returned an unchanging image. Foregrounding the
window and copying its client rectangle off the composited desktop works, and
`crossing-slice-2026-09-05-mock.png` is the proof. `tools/capture-godot-window.ps1`
is that, kept because the next person needs it: `ShowWindow(SW_MINIMIZE)` then `SW_MAXIMIZE` to
defeat the foreground lock, refuse to shoot if the window is not foreground,
then `GetClientRect` + `ClientToScreen` + `CopyFromScreen`.

**Call `SetProcessDPIAware()` before any window call, or every coordinate is
wrong** — silently, and by a factor that looks plausible. See the two lines
under line 2. A rig that skips this reports a window a third of its real size
and clicks a third of the way into it.

**A shared cursor is not an instrument on this machine.** `SetCursorPos`
succeeds and holds when nothing else is competing, and does not when something
is. Anything that must know where it clicked should assert the cursor position
immediately before the press and abort if it moved, which the scripts here do
not yet do.

## Re-running this

```bash
GODOT4=C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64.exe npm run godot:export
./godot/build/DRCompanionWorldViewer.exe          # mock mode: line 1
powershell -File tools/capture-godot-window.ps1 -ProcId <pid> -OutPath shot.png
npm run test:godot                                # line 4, Godot side
node tools/godot-fixture-contract-test.mjs        # the fixture the above reads
node tools/live-chain-check.mjs                   # line 4, app side; needs the app running
```
