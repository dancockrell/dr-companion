# Walking the client on the clean VM, with no Godot and no game

9 September 2026. Dan's instruction was *"outside of godot we need to get the
build running and tested as a mud client without godot, all on its own."* This
is that run: an installer built on this machine from `origin/main`, installed on
the VM restored from `clean`, and walked as far as a stand-in Lich allows.

Everything below was observed on the VM. Where something was not, it says so,
and there is a "What was not tested" section at the end. Screenshots are the
`standalone-client-2026-09-09-NN-*.png` files beside this document.

| | |
|---|---|
| Machine | `drc-clean-win11`, restored from snapshot `clean` before anything was installed, powered off and restored to `clean` afterwards |
| Guest | Windows 11 Enterprise LTSC Evaluation, `10.0.26100.1742` (read with `ver` in the guest), host `DRC-CLEAN`, user `tester` |
| Source | `origin/main` at `f75e589ef1627090a100ed2228b795894b101b96` ("Make the session-directory tests unique per process…" (#516)) |
| Artefact | `src-tauri/target/release/bundle/nsis/DR Companion_0.1.1_x64-setup.exe` |
| Size | 217,870,535 bytes |
| SHA-256 | `981e503553f283eb08f65a4b93a8e8edc13a9162ab60f391e3de8c2b61cfe60d` |
| Viewer | none, by design (`npm run release:config` with no `--require-viewer`) |
| Screens | 1440x900 for the walkthrough, 1600x1200 for the parts that do not fit in 852 px of work area |
| Stand-in game | `tools/fake-lich.mjs` on `127.0.0.1:11124`, run under Node **inside the guest** |

**Chain of custody, two readings, equal.** `sha256sum` on the host after the
build printed
`981e503553f283eb08f65a4b93a8e8edc13a9162ab60f391e3de8c2b61cfe60d`, and
`certutil -hashfile … SHA256` **inside the guest**, on the file that actually
arrived, printed the same. The guest was never given the build any other way.

## The build

```
npm run release:config      # 4 resources, all inherited. NO world viewer in this installer.
npm run tauri:build         # finished in 4m46s; makensis produced the setup.exe
node tools/verify-release-bundle.mjs
```

`verify-release-bundle` reports the absent viewer as a **state**, not a failure:

```
OK   companion_bridge.lic             141164 bytes
All 1 required resources are staged in the release build.
This installer carries NO world viewer. The app runs without it and reports it as not installed.
exit 0
```

And it can still fail, which is the half worth showing — the same command with
`--expect-viewer`:

```
FAIL DRCompanionWorldViewer.exe       not found under the release output
     needed because: the world viewer - the point of this release wiring
1 of 2 required resources missing from the release build.
exit 1
```

That 141,164-byte `companion_bridge.lic` is the same number the installed bridge
script reports on the VM further down, so the file is traceable from the release
check through the installer to Lich's own scripts folder.

## Shot list

| # | file | what it shows |
|---|---|---|
| 01 | `-01-wizard-first-screen.png` | setup wizard, 0 of 3 ready, the Desktop-vs-Ruby4Lich5 guidance |
| 02 | `-02-ruby-verified-offline.png` | bundled Ruby4Lich5 verified and saved, with no download |
| 03 | `-03-ruby-destination.png` | the third-party installer, destination page |
| 04 | `-04-ruby-components.png` | Both Lich and Ruby |
| 05 | `-05-ruby-lich-folder.png` | Select Additional Tasks, Desktop default taken deliberately |
| 06 | `-06-ruby-finish.png` | Completing the Ruby4Lich5 wizard |
| 07 | `-07-rows-found.png` | 2 of 3 ready, both rows naming their paths |
| 08 | `-08-empty-state-default-window.png` | setup done, the empty state at the app's default window |
| 09 | `-09-empty-state-maximised.png` | the same state maximised — the right of the window is empty |
| 10 | `-10-player-config-popout.png` | Player config as a real second window, rendering |
| 11 | `-11-empty-state-scrolled.png` | the empty state scrolled to its end |
| 12 | `-12-demo-workspace.png` | the whole workspace, in the demo |
| 13 | `-13-attached-to-fixture.png` | attached to the fixture: Detach, channel tabs, live vitals |
| 14 | `-14-attached-but-empty-state.png` | **the socket still open, the app saying nothing is connected** |
| 15 | `-15-map-hidden-1440x900.png` | maximised at 1440x900, map still hidden |
| 16 | `-16-map-visible-1600x1200.png` | the same session at 1600x1200, map present |
| 17 | `-17-music-not-installed.png` | Music not installed, with both install offers |
| 18 | `-18-automation-paused.png` | Pause, and "Automation paused." in the log |

## What was tried, and what happened

| Feature | Verdict | Evidence |
|---|---|---|
| Silent install `/S` on a clean machine | **WORKS** | `installer exit=0`; main binary 153,710,080 bytes |
| Chain of custody host → guest | **WORKS** | `certutil` in the guest equals `sha256sum` on the host |
| `verify-release-bundle`, no viewer | **WORKS** | reports "NO world viewer" and exits 0; `--expect-viewer` exits 1 |
| Wizard: Ruby row guidance (#388) | **WORKS** | shot 01, the Desktop/DragonRealms sentence, still present after the button changes (shot 02) |
| Wizard: bundled Ruby verified offline | **WORKS** | shot 02, "Verified and saved to …\downloads\Ruby4Lich5.exe" |
| Wizard: third-party installer walk | **WORKS** | shots 03–06, four pages, defaults taken |
| Wizard: rows name their paths (#388) | **WORKS** | shot 07: `ruby 4.0.5 … C:\Ruby4Lich5\4.0.5\bin\ruby.exe`, `Found in C:\Users\tester\Desktop\Lich5` |
| Bridge script install, one click | **WORKS** | `companion_bridge.lic` 141,164 bytes in Lich's scripts folder |
| Window clamped inside the work area (#417/#427) | **WORKS** | `WIN … L=122 T=24 R=1318 B=828` against `WORKAREA … B=852`; outer bottom 828 = 852 − 24 exactly. This is the re-measurement the 6 Sep doc said was still owed |
| Empty state fits and scrolls (#428) | **WORKS** | shot 08: heading and both buttons visible at the default window; shot 11: the container scrolls to its end |
| Panel pop-out renders (#431) | **WORKS** | shot 10, Player config as its own window on the dark surface — against the blank white window of 6 Sep |
| Player config: 7 tabs, add a rule, persist | **WORKS** | Highlights (0) → (1), "1 stored in `drc.player-config.highlights.v1`. Read: current." |
| Music: no track, no Retry at rest (#389/#405) | **WORKS** | shot 08 bottom bar |
| Music: "not installed" state on Play | **WORKS** | shot 17: `Music not installed  [Install The Old Concert Hall (512 MB)] [Install all (4.4 GB)]` plus its tooltip |
| Bridge reconnect ladder is legible | **WORKS** | `Bridge reconnecting 2/8` → `3/8` → `Bridge gave up (8)`, and in the log: error → reconnecting (attempt 6 of 8) → disconnected → "Switched to mock bridge" |
| AI panel with no model | **WORKS** | "No local model is installed.", "No local model, so 129 captured events are unreviewed. Nothing is wrong…", model-server box with `Test`, then "No model server answered. Check that yours is running." |
| Attach to a `--detachable-client` listener | **WORKS** | shot 13: control becomes Detach, channel tabs appear, `client attached from 127.0.0.1` in the fixture's own log |
| Vitals parsed from the right attribute | **WORKS** | `HE 100 ST 96 SP 100` against a fixture that hardcodes `value='0'` and puts the numbers in `text` |
| Tagged streams → channel tabs | **WORKS** | `game: Deaths / Speech / Thoughts` counters climbing off `pushStream` |
| Posture indicator from the live stream | **WORKS** | chip follows `IconKNEELING` / `IconSTANDING` |
| Command bar → game socket | **WORKS** | the fixture recorded `> look` and `> health` |
| Numpad movement → game socket | **WORKS** | scancode `48` (Numpad8) and `4c` (Numpad5) produced `> n` and `> out` in the fixture's log |
| Pause chip | **WORKS** | shot 18, and "Automation paused." in the log |
| Close with no Lich of ours | **WORKS** | no prompt, `dr-companion procs after close = 0`, no ruby/rubyw left |
| Uninstall, checkbox left alone | **WORKS** | running prompt reproduced; `RESULT confirm-page=True ticked=False running-prompt=True clicked-ok=True finished=True` |
| Uninstall removes the program half | **WORKS** | see the two inventories below |
| Loopback tokens removed on the unticked path (#354) | **WORKS** | all four `.port`/`.token` ABSENT afterwards |
| **Attach reachable while disconnected** | **BROKEN** | no such control exists in the empty state — **#523** |
| **Attached socket + demo off** | **BROKEN** | socket ESTABLISHED, app says "Nothing is connected yet." — **#523** |
| **Live game text in the game pane while the demo is on** | **BROKEN** | counters climb, pane shows only mock lines — **#525** |
| **Map at 1440x900** | **BROKEN** | hidden even maximised, with an instruction the player cannot follow — **#524** |
| `tools/vm-shot.ps1` scroll-down | **BROKEN, fixed here** | `mouse_event` declared `dwData` as `uint`, so every downward scroll threw. One line, fixed in this PR |
| Attach-offer states (#513: ours/foreign/no_port/no_lich/unknown) | **COULD NOT CHECK** | see below |
| Exits strip | **COULD NOT CHECK** | see below |
| Real account sign-in | **NOT TESTED** — Dan's, N7 | no credentials were entered anywhere |

### The one that decides the question Dan asked

The client can hold a game connection and drive it: commands go out, text and
structured state come back, channels fill, vitals and posture follow. What it
cannot do is *be a client on that alone*. `src/App.tsx` renders the whole
workspace only when `character` is set, and `character` comes from the bridge —
so with a live socket attached and the demo turned off, the app shows the empty
state while the connection stays open:

```
established connections involving 11124 = 2
  127.0.0.1:52387 -> 127.0.0.1:11124  owner=dr-companion
  127.0.0.1:11124 -> 127.0.0.1:52387  owner=node
```

`GameConnectionBar` — the Attach control — lives inside `GameChatColumn`, which
is inside that gated workspace. So the control that creates a connection is
behind the state it exists to establish. That is #523, and it is the answer to
"can it run as a MUD client on its own" as the build stands: not without the
demo or a real sign-in.

## The two inventories

`tools/vm-inventory.ps1`, same script both times, so they compare line for line.
Each opens with a control probe that aborts the listing if
`%LOCALAPPDATA%\Microsoft` is missing, and each prints its denominators.

**Before anything was installed** (`probes=15 present=1 absent=14`) — the only
PRESENT line is the control, `files=186 bytes=45756135`. `C:\Ruby4Lich5`,
the Lich tree, the bridge script, both shortcuts and the registry entry are all
ABSENT, and the denominators read `0 of 3 uninstall entries` and
`0 of 45 .lnk files`.

**Installed** (`probes=15 present=13 absent=2`):

```
PROBE  install dir                                PRESENT  files=42 bytes=222728988
PROBE  main binary                                PRESENT  bytes=153710080
PROBE  app data dir                               PRESENT  files=5 bytes=68583698
PROBE  bridge presentation-bridge.port            PRESENT  bytes=5
PROBE  bridge presentation-bridge.token           PRESENT  bytes=64
PROBE  bridge script-api.port                     PRESENT  bytes=5
PROBE  bridge script-api.token                    PRESENT  bytes=64
PROBE  Ruby4Lich5 (separate product)              PRESENT  files=7783 bytes=196125241
PROBE  bridge script, desktop Lich5               PRESENT  bytes=141164
UNINST DR Companion | 0.1.1 | Dan Cockrell | HKCU\...\Uninstall\DR Companion
SHORTCUT matching '*Companion*': 2 of 47 .lnk files seen
```

The publisher reads **Dan Cockrell**, not `github` — Defect 4 of the 5 September
run still fixed.

**After the uninstall, checkbox left alone** (`probes=15 present=6 absent=9`):

```
PROBE  CONTROL %LOCALAPPDATA%\Microsoft           PRESENT  files=195 bytes=48262208
PROBE  install dir                                ABSENT
PROBE  uninstaller                                ABSENT
PROBE  main binary                                ABSENT
PROBE  webview profile (user data)                PRESENT  files=360 bytes=27500853
PROBE  app data dir                               PRESENT  files=1 bytes=68583560
PROBE  cached Ruby4Lich5 download                 PRESENT  files=1 bytes=68583560
PROBE  bridge presentation-bridge.port            ABSENT
PROBE  bridge presentation-bridge.token           ABSENT
PROBE  bridge script-api.port                     ABSENT
PROBE  bridge script-api.token                    ABSENT
PROBE  Ruby4Lich5 (separate product)              PRESENT  files=7783 bytes=196125241
PROBE  bridge script, desktop Lich5               PRESENT  bytes=141164
UNINST matching '*Companion*': 0 of 4 uninstall entries read
SHORTCUT matching '*Companion*': 0 of 45 .lnk files seen
```

Three things to read off that. The program half is clean, and the zeros are the
machine's rather than the script's, because the denominators still read 4
uninstall entries and 45 `.lnk` files while the control probe still finds 195
files. All four loopback tokens are gone on the default path. What survives is
what should: the WebView2 profile, the 65 MB cached Ruby4Lich5 download (removed
only when the box is ticked, which this run did not do), and `C:\Ruby4Lich5` and
`companion_bridge.lic`, which belong to other products.

## What was not tested

Stated so no gap reads as a pass.

- **Any real account sign-in.** No credentials were entered anywhere. This build
  is a release build, so `DRC_LICH_DRY_RUN` is debug-only (#475) and pressing
  **Sign in** would attempt a real EAccess login. That is Dan's to do (N7).
- **The five attach-offer states of #513** (`ours` / `foreign` / `no_port` /
  `no_lich` / `unknown`). Reaching any of them needs a process named
  `rubyw.exe`, because the refusal comes from a `tasklist` match on that image
  name. The only way to produce one here would have been to copy a binary to
  that name, which is a masquerade and was declined rather than worked around.
  Producing these states without renaming a binary — a test seam on the
  detection, the way #505's env override works — is the thing that would make
  them checkable at all.
- **The exits strip.** `ExitButtons` renders inside `ClassicRoomText`, and the
  session ran in the art-scene room presentation throughout; the strip was not
  visible at either resolution and it was not chased down. Whether it is
  affected by the height budget in #524 is **not established**.
- **The music download.** 4.4 GB. What is verified is the state and the two
  offers, not that either works.
- **SmartScreen and the Edge download chain.** The installer was pushed in with
  `guestcontrol copyto`, which carries no Mark of the Web, and run with `/S`.
  Those seven prompts were measured on 5 September and nothing here touches
  them, but they were not seen again.
- **The ticked "Delete the application data" path.**
  `docs/verification/uninstall-2026-09-06.md` owns that one.
- **A non-administrator account**, the optional wizard rows (Genie, the
  222-script suite, the map database), and a GitHub release download.
- **Whether #525 also loses text when the demo has never been started.** Not
  reachable, because #523 means there is no attached session without the demo.

## Reproducing this

The VM procedure is `docs/verification/vm.md` and
`docs/verification/first-run-2026-09-06.md`. Four things this run learned that
neither of them has, all of which cost real time:

- **`VBoxManage guestcontrol run` was unusable on this host all day.** Every
  call segfaulted having started nothing — verified by deleting the output file
  first and confirming it never appeared, so this is not the "segfaults but the
  work happened" case already in `memory-db`. `copyto` and `copyfrom` kept
  working throughout. The way through is a **guest-side agent**: a PowerShell
  loop watching a `cmd\` directory, driven by dropping `.ps1` files in with
  `copyto` and polling `out\` with `copyfrom`. It needs starting once per boot,
  and the only channel that could start it was
  `controlvm keyboardputscancode` — Win+R and type the path, which needs no
  guest cooperation at all and worked every time.
- **The host path handed to `copyfrom` must be Windows-style.** With
  `MSYS_NO_PATHCONV=1` set (which is required, or Git Bash mangles the guest
  path), a POSIX host path makes `copyfrom` fail silently. Four separate
  conclusions in this run — "the Startup folder never fired", "the files were
  lost in the reset", "the agent never started" — were all that one bug, and
  every one of them looked like a fact about the guest. `copyfrom` also
  **refuses to overwrite** an existing host file, so the target has to be
  removed before every poll or only the first one can ever succeed.
- **A `.cmd` in the guest's Startup folder did not run**, and
  `guestcontrol run` could not be used to start anything, which is why the
  keyboard route above exists.
- **Do not start a long-lived process from an agent job with `Start-Process`
  or `cmd /c start`.** Either leaves something holding the job's stdout, and
  the agent waiting on that pipe wedges — twice here. `Invoke-CimMethod
  -ClassName Win32_Process -MethodName Create` starts a process with no
  inherited handles and does not.

And one that belongs to a committed tool rather than to the VM: **`vm-shot.ps1`
could not scroll down.** `mouse_event`'s `dwData` was declared `uint`, and a
wheel-down tick is `-120`, so every downward scroll threw
`Cannot convert value "-120" to type "System.UInt32"`. Scrolling *up* passes
`+120` and worked, which is why the wrong type survived: the only half anybody
had exercised was the half that cannot show the bug. Fixed in this PR, and the
fix is what produced shot 11.

Where this document and those scripts disagree, **the scripts are right and the
prose is stale.**
