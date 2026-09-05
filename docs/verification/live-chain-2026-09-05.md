# The live chain, end to end — 5 September 2026

The first time anything in this repository has watched the app drive the
viewer. Until the commit below, `godot/scripts/world_root.gd` went live only
when `--live-presentation` was among the user arguments and
`src-tauri/src/viewer.rs` launched the executable with none, so every viewer
the app had ever opened came up in the mock Crossing fixture. Nothing errored.
A mock world and a live one look identical until you read the room name.

## What was run

| | |
|---|---|
| Commit | `a7ea8414` — `fix(viewer): start the app-launched viewer in live mode, and show why when it cannot [B2]`, on `lane-b/live-chain` |
| Worktree | `C:\Users\Admin\dev\wt-b` |
| Godot | `4.3.stable.official.77dcf97d8`, installed at `C:\Users\Admin\dev\tools\godot\bin`, outside every repo |
| Viewer build | `godot/build/DRCompanionWorldViewer.exe`, 84 367 312 bytes, sha256 `4c26b019…0f7f1c` |
| Game source | `node tools/fake-lich.mjs --port 11138` — the captured-text fixture, not a live character |

```
GODOT4=C:/Users/Admin/dev/tools/godot/bin/Godot_v4.3-stable_win64.exe npm run godot:export
node tools/fake-lich.mjs --port 11138
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223 npm run tauri dev
```

The app was then driven through its own UI over the debugging port with
`tools/app-eyes.mjs`: the attach port was set to 11138, Attach pressed,
Settings opened, and **Open viewer** pressed in the Godot 3D viewer bridge
section.

## The viewer was launched live

`Get-CimInstance Win32_Process`, immediately after pressing Open viewer:

```
ProcessId   : 37184
CommandLine : "C:\Users\Admin\dev\wt-b\godot\build\DRCompanionWorldViewer.exe" -- --live-presentation
```

The bare `--` matters: Godot keeps everything before it, and
`OS.get_cmdline_user_args()` — which `_live_requested()` reads — returns only
what follows.

## Godot received a snapshot with a numeric sequence

`netstat -ano`, with the app on pid 32648:

```
TCP    127.0.0.1:60916        127.0.0.1:63488        ESTABLISHED     37184
TCP    127.0.0.1:63488        127.0.0.1:60916        ESTABLISHED     32648
```

A socket proves a connection, not a snapshot, so the content was checked two
ways. A second authenticated client on the same bridge saw what the app is
publishing:

```
port 63488 token length 64
hello {"protocol":1,"type":"hello"}
{"type":"auth_ok"}
SNAPSHOT sequence= 5 number currentRoomId= 1-308 worldId= 1 cells= 1060
```

And the viewer's own window (`live-chain-2026-09-05.png`, beside this file)
reads **Current room: Empaths' Guild, 1-308** with one exit, southwest. That
is the live snapshot's room. The mock fixture's starting room is `1-14`, Town
Green North, in a `crossing-mock` world of a few dozen cells — so the picture
could not have come from mock mode.

## A walk intent reaches the game

Sent from an authenticated client as a viewer would send it:

```
snapshot seq 5 room 1-308
exits here: [{"direction":"walk","move":"southwest","targetCellId":"1-307","targetRoomId":307}]
sent walk intent southwest
<- {"type":"intent_accepted"}
```

and on the game side, in the same second:

```
  > southwest
```

So the whole downstream half is real: Godot's intent → `validate_walk` against
the app's own published snapshot → `intent_accepted` → the
`presentation:intent` event → `requestGameAction` → the socket to Lich.

## What did not work

**A click on the viewer's own exit button produced no command.** Three
synthesised clicks were sent to the `southwest` button in the viewer's
accessible exit list — cursor moved onto it, pressed, released, the window
confirmed foreground each time — and `fake-lich` logged nothing. The identical
intent sent over the socket by hand was accepted and reached the game (above),
so everything from `BridgeClient.send_intent` onwards is proven and only the
button's own `pressed` connection is not. Which of these it is has **not** been
established:

- the synthesised click never reached Godot as a press. The first click did
  change the button's hover state, but `PrintWindow` on a GPU-composited Godot
  window returned an unchanging image afterwards, so the visual channel used
  to judge this is itself unreliable and cannot arbitrate;
- or `world_controls._rebuild_exit_buttons`'s `pressed.connect(...)` binding
  does not fire in a live session. `request_visible_exit`, the seam those
  buttons call, is covered by `godot/tests/world_controls_test.gd`; the
  `Button.pressed` connection into it is covered by nothing.

A person clicking that button once settles it in a second, and that is the
next thing to do. **Nothing here should be read as evidence that clicking an
exit in the viewer moves a character.** The claim this record supports is
narrower: the app starts the viewer live, the viewer gets the player's real
room, and an intent from the viewer's side of the socket moves the character.

**A confirmed room change could not be observed at all**, whichever way the
intent is sent, because `tools/fake-lich.mjs` replays captured text on a loop
and answers `southwest` with "…wait, what? (the fixture has no answer)". Only
a live character can close that loop. This is a limit of the fixture, not a
finding about the app.

**Two smaller things**, neither in Lane B's way:

- ~~`godot/tests/live_bridge_transport_test.gd` does not parse under Godot 4.3 —
  `OS.get_temp_dir()` does not exist in that version — so it fails to load on
  every export. The export still succeeds and the file ships as a broken
  script.~~

  **Corrected 5 Sep 2026 by a later review pass.** This was true when it was
  observed and had already been fixed by the time this page reached `main`,
  and it was left standing in the present tense — the one stale claim in this
  directory not corrected in place, beside two sibling pages that do correct
  themselves. `c8c3bb77` ("test(godot): run the Godot tests, one of which
  could not parse [C11]", #301) is the fix. The check, which stays right
  whatever else changes:

  ```
  $ grep -n "get_temp_dir" godot/tests/live_bridge_transport_test.gd
  22:	# Not OS.get_temp_dir(): that arrived in Godot 4.4 and this project is 4.3
  ```

  The only surviving occurrence is the comment explaining why it is *not*
  used. Where that command and this paragraph disagree, the command is right.
  Positive control: `grep -c "func " ` on the same file returns 10, so a zero
  would have been a claim about the file and not about the grep.
- The export warns `Could not start rcedit executable` and skips the
  executable's version resources. `rcedit` is not on this machine; CI installs
  it with Godot's own tooling.

## Re-running this

The claim is the commands, not the paragraphs. Where the two disagree, run
these:

```bash
# the flag actually reaches the viewer
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='DRCompanionWorldViewer.exe'\" | Select-Object CommandLine"

# the app is publishing a real snapshot to the bridge (B4 automates this)
node tools/live-chain-check.mjs
```

---

# Appendix: the reconnect contract (B7), same day

Same worktree, `test:viewer-absent` and B5/B6 commits in the tree, the app
attached to `node tools/fake-lich.mjs --port 11141`. A second authenticated
client watched the bridge throughout and logged every frame.

## Godot is killed and relaunched: it gets the held snapshot on auth

The app published `sequence 5` for room `1-308` on attach, and published
nothing afterwards — the watcher's whole log for the episode is three lines:

```
07:04:49.906 hello -> auth sent
07:04:49.907 auth_ok
07:04:49.924 snapshot sequence 5 room 1-308
```

That watcher connected minutes *after* the publish, which is the contract
itself: a client that arrives between publishes is sent the last one on auth.

Then the viewer proper: opened from Settings (pid 36204), killed by that pid,
Recheck, Relaunch (pid 35100 — a genuinely new process). The relaunched
viewer's window is `live-chain-2026-09-05-relaunch.png` beside this file, and
it reads **Empaths' Guild, 1-308** with its southwest exit, the same as before.
The watcher logged no further snapshot in that window, so the room on screen
came from the held snapshot handed over at auth and from nothing else.

## Lich dropped and reattached: no forced publish, and the reason is not a bug

Detach pressed, then Attach — `fake-lich` logged `client detached` then
`client attached from 127.0.0.1`, and `game_status` came back
`{"connected":true,"port":11141,"lines":16}`. **No new snapshot reached the
bridge.**

`justReconnected` is driven by `bridgeConnected`, and `bridgeConnected` is the
*companion bridge* — the Lich plugin socket on 7415 — not the game socket that
Attach opens. `tools/fake-lich.mjs` provides only the game socket, so
`bridgeConnected` was false throughout and the forced-publish path could not
have fired whatever happened. The increment's phrase "drop and reattach Lich"
names an event this fixture cannot produce.

Nothing here is evidence of a defect: the room did not change across the
reattach, so `shouldPublish` deduplicating is correct behaviour. What it is
evidence of is that **the forced-publish path remains unexercised**, and the
setup that would exercise it needs the companion bridge plugin running in a
real Lich, not this fixture. Whoever has that should watch for a second
snapshot with a higher `sequence` for an unchanged room.
