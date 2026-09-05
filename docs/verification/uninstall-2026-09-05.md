# Uninstall, on the installer CI built (F8)

5 September 2026. E3 ran an uninstall on a **locally built** installer
(`docs/verification/first-run-2026-09-05.md`). F8 is the same question asked of
the artefact a CI runner produced from `main`, which is what a release is made
of and what nobody on this machine can inspect by hand.

Everything below was observed. Where something was not observed, it says so.
The four inventory listings are printed in full rather than summarised: an empty
listing and a listing whose script never ran look identical, and the only
defence against that is to show what was checked.

| | |
|---|---|
| Machine | `drc-clean-win11`, restored from snapshot `clean` before each of the two builds |
| Guest | Windows 11 Enterprise LTSC Evaluation, 10.0.26100 |
| Account | `tester`, local Administrator, auto-logged-in |
| Screen | 1440x900 for the first build, 1024x768 for the second (see "the display", below) |

## The blocker that was actually there

F8's `blocked-on:` line named E3, which merged this morning in PR #335. A
different blocker was sitting behind it.

**There was no CI artefact.** `ci.yml`'s `tauri` job ran `npm run tauri:build`
and then ended, so a 217 MB installer was built on every push to `main` and
thrown away with the runner. The phrase "the CI artefact", which F8 and F9 are
both written against, named something that had never existed:

```
$ gh api repos/dancockrell/dr-companion/actions/runs/33972082431/artifacts \
    --jq '.total_count, (.artifacts[] | "\(.name) \(.size_in_bytes)")'
0
$ gh run view 33972082431 --json jobs --jq '.jobs[] | "\(.name) \(.conclusion)"'
checks success
tauri success        <- built an installer, kept nothing
```

PR #338 added `actions/upload-artifact` and a step before it that refuses unless
exactly one `*-setup.exe` is present and prints its sha256 to the run summary.
Everything below runs on artefacts from that.

## Provenance of the two installers

Three independent readings of each file agree, so what was installed on the VM
is what CI produced from a named commit. This matters more than it sounds: an
artefact whose provenance is "it downloaded from somewhere" proves nothing
about the commit it is supposed to be evidence for.

| | Build A (before the fix) | Build B (with the fix) |
|---|---|---|
| commit | `b3dff003`, head of `main` | `205e375b`, head of `lane-f/f8-uninstall` (PR #354) |
| CI run | 33974178888 | 33976922038 |
| CI's own report | `bytes 217287257`, `sha256 3c7cd265…33b0` | `bytes 217285244`, `sha256 cb18daad…9bb4` |
| `sha256sum` on the host after `gh run download` | `3c7cd2658fac856001146eeafb60079f4eaddeb81d5e7d28ae86d256abab33b0` | `cb18daad7e1f02ba6a4be6b73ab2da565dfddeec7b0ca67635bd986f5ff69bb4` |
| `Get-FileHash` **inside the guest** | same | same |

**No Mark of the Web.** Both files were pushed in with `guestcontrol copyto`, so
`Get-Content -Stream Zone.Identifier` finds nothing and neither SmartScreen nor
Edge's download warning appeared. That is deliberate and it is a difference from
E2, which served the payload over HTTP specifically to produce a real `ZoneId=3`
and record the prompts a stranger sees. Those prompts are E2's subject and are
already recorded there; F8's subject is what an uninstall leaves behind, and the
zone marker has no bearing on it.

## What the inventories are

`tools/vm-inventory.ps1`, run in the guest before and after each uninstall.
E3 typed its ancestor into the guest and only the text survived, in an appendix;
F9, F12 and F13 all say "E2/E3 again", so it is committed now rather than
retyped a fourth time.

It prints a `PROBE` line for every probe **whether present or absent**, never
only the hits. It opens with a control probe on `%LOCALAPPDATA%\Microsoft`,
which exists on every Windows machine and makes the script abort if it is
missing — at that point the instrument is broken and its absences mean nothing.
It prints denominators for the two sweeps that could otherwise silently read
nothing (`0 of 6 uninstall entries read`, `2 of 47 .lnk files seen`), and it
refuses to finish if fewer than 15 probes ran.

Those denominators turned out to carry the result as well as guard it: across an
uninstall they fall by exactly the right amount, from 6 registry entries to 5
and from 47 shortcuts to 45, which is a second, independent statement that two
shortcuts and one registry entry went.

### The clean machine, before anything was installed

The listing that proves the script can say ABSENT correctly. Taken on the
restored `clean` snapshot:

```
== DRC INVENTORY CLEAN ==
when      : 2026-09-05T15:08:29Z
host      : DRC-CLEAN  user=tester
windows   : 10.0.26100

-- the app -----------------------------------------------------
PROBE  CONTROL %LOCALAPPDATA%\Microsoft           PRESENT  files=184 bytes=43603557
PROBE  install dir                                ABSENT   C:\Users\tester\AppData\Local\DR Companion
PROBE  uninstaller                                ABSENT
PROBE  main binary                                ABSENT

-- data the app writes -----------------------------------------
PROBE  webview profile (user data)                ABSENT   C:\Users\tester\AppData\Local\io.github.dancockrell.dr-companion
PROBE  app data dir                               ABSENT   C:\Users\tester\AppData\Local\DR Companion Data
PROBE  cached Ruby4Lich5 download                 ABSENT
PROBE  bridge presentation-bridge.port            ABSENT
PROBE  bridge presentation-bridge.token           ABSENT
PROBE  bridge script-api.port                     ABSENT
PROBE  bridge script-api.token                    ABSENT
PROBE  roaming %APPDATA%\DR Companion             ABSENT

-- other trees this app touches but does not own ---------------
PROBE  Ruby4Lich5 (separate product)              ABSENT   C:\Ruby4Lich5
PROBE  bridge script, desktop Lich5               ABSENT
PROBE  bridge script, C:\Ruby4Lich5               ABSENT

-- registry ----------------------------------------------------
UNINST matching '*Companion*': 0 of 4 uninstall entries read
UNINST matching '*Ruby4Lich5*': 0 of 4 uninstall entries read

-- shortcuts ---------------------------------------------------
SHORTCUT matching '*Companion*': 0 of 45 .lnk files seen

-- summary -----------------------------------------------------
probes=15 present=1 absent=14
```

One present, fourteen absent, and the one present is the control. Every ABSENT
below can be read against this.

---

# Run A — build A, the default: checkbox left unticked

Install through the NSIS wizard, then Ruby4Lich5's own installer from the setup
wizard's Ruby row (default answers, including the GemStone IV Lich5 layout E3
found), then the bridge script. Same route a person takes, so the "after"
listing is comparable to E3's line for line.

The uninstall was started from the registry's own `UninstallString`, read back
rather than typed — that is exactly the command Settings → Apps runs:

```
DisplayName          DR Companion
DisplayVersion       0.1.1
Publisher            github
InstallLocation      "C:\Users\tester\AppData\Local\DR Companion"
UninstallString      "C:\Users\tester\AppData\Local\DR Companion\uninstall.exe"
NoModify             1
NoRepair             1
```

There is **no `QuietUninstallString`**, so there is no documented silent
uninstall. Recorded, not judged.

### Before

```
== DRC INVENTORY BEFORE ==   2026-09-05T15:44:14Z

PROBE  CONTROL %LOCALAPPDATA%\Microsoft           PRESENT  files=189 bytes=47954021
PROBE  install dir                                PRESENT  files=42 bytes=221011347
PROBE  uninstaller                                PRESENT  bytes=79653
PROBE  main binary                                PRESENT  bytes=152002560

PROBE  webview profile (user data)                PRESENT  files=302 bytes=46868805
PROBE  app data dir                               PRESENT  files=5 bytes=68583698
PROBE  cached Ruby4Lich5 download                 PRESENT  files=1 bytes=68583560
PROBE  bridge presentation-bridge.port            PRESENT  bytes=5
PROBE  bridge presentation-bridge.token           PRESENT  bytes=64
PROBE  bridge script-api.port                     PRESENT  bytes=5
PROBE  bridge script-api.token                    PRESENT  bytes=64
PROBE  roaming %APPDATA%\DR Companion             ABSENT

PROBE  Ruby4Lich5 (separate product)              PRESENT  files=7783 bytes=196125241
PROBE  bridge script, desktop Lich5               PRESENT  bytes=131142
PROBE  bridge script, C:\Ruby4Lich5               ABSENT

UNINST DR Companion | 0.1.1 | github | HKCU\...\Uninstall\DR Companion
UNINST matching '*Companion*': 1 of 6 uninstall entries read
UNINST Ruby4Lich5 Ruby 4.0.5 … | 040.002.003 | Elanthia-Online | HKCU\...\{edd9ccd7-…}_is1
UNINST matching '*Ruby4Lich5*': 1 of 6 uninstall entries read

SHORTCUT C:\Users\tester\Desktop\DR Companion.lnk  bytes=1300
SHORTCUT C:\Users\tester\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\DR Companion.lnk  bytes=1308
SHORTCUT matching '*Companion*': 2 of 47 .lnk files seen

probes=15 present=13 absent=2
```

The install tree is **42 files, 221,011,347 bytes**, against E3's 49 files and
221,078,388 bytes for the locally built installer. The difference is the
`python\` folder: 37 files here, 46 in E3's listing. That is a change in the
repository between the two builds, not a difference between local and CI
packaging — both carry `dr-companion.exe`, `uninstall.exe`, `vendor\` (2 files)
and `lich-scripts\companion_bridge.lic`, and nothing is missing from the CI one
that the local one had at the top level.

### After

```
== DRC INVENTORY AFTER ==   2026-09-05T15:47:33Z

PROBE  CONTROL %LOCALAPPDATA%\Microsoft           PRESENT  files=189 bytes=47955645
PROBE  install dir                                ABSENT
PROBE  uninstaller                                ABSENT
PROBE  main binary                                ABSENT

PROBE  webview profile (user data)                PRESENT  files=307 bytes=47033203
PROBE  app data dir                               PRESENT  files=5 bytes=68583698
PROBE  cached Ruby4Lich5 download                 PRESENT  files=1 bytes=68583560
PROBE  bridge presentation-bridge.port            PRESENT  bytes=5
PROBE  bridge presentation-bridge.token           PRESENT  bytes=64
PROBE  bridge script-api.port                     PRESENT  bytes=5
PROBE  bridge script-api.token                    PRESENT  bytes=64
PROBE  roaming %APPDATA%\DR Companion             ABSENT

PROBE  Ruby4Lich5 (separate product)              PRESENT  files=7783 bytes=196125241
PROBE  bridge script, desktop Lich5               PRESENT  bytes=131142
PROBE  bridge script, C:\Ruby4Lich5               ABSENT

UNINST matching '*Companion*': 0 of 5 uninstall entries read
UNINST Ruby4Lich5 Ruby 4.0.5 … still present
UNINST matching '*Ruby4Lich5*': 1 of 5 uninstall entries read

SHORTCUT matching '*Companion*': 0 of 45 .lnk files seen

probes=15 present=10 absent=5
```

**The program half is clean**, and it matches E3 exactly: the install directory,
the registry entry and both shortcuts are gone, and the denominators fell 6→5
and 47→45 to say so independently. `C:\Ruby4Lich5`, its own registry entry and
`companion_bridge.lic` in Lich's tree all survive, which is right — they belong
to a separate product and to Lich, neither of which this app owns.

**The data half is unchanged, byte for byte.** `files=5 bytes=68583698` before
and after.

# Run B — build A, the branch E3 never exercised: checkbox ticked

E3's "what was not tested" names this. Reinstalled over Run A's leftovers,
launched, then uninstalled with **Delete the application data ticked**
(screenshot 04).

```
PROBE  webview profile (user data)   ABSENT     <- removed, correct
PROBE  app data dir                  PRESENT  files=5 bytes=68583698
PROBE  cached Ruby4Lich5 download    PRESENT  files=1 bytes=68583560
PROBE  bridge presentation-bridge.port    PRESENT  bytes=5
PROBE  bridge presentation-bridge.token   PRESENT  bytes=64
PROBE  bridge script-api.port             PRESENT  bytes=5
PROBE  bridge script-api.token            PRESENT  bytes=64
probes=15 present=9 absent=6
```

Identical to Run A's after-listing, to the byte, for everything under
`DR Companion Data`.

## The finding

**Neither uninstall path removed the two loopback bearer tokens.** There was no
route through the product that removed a live credential. Ticking the box
removes the WebView2 profile — the actual user data — and leaves the
credentials.

`presentation-bridge.token` and `script-api.token` are 64-character bearer
tokens for two loopback sockets, written by `presentation_bridge.rs:463` and
`script_api.rs:325` on every start. `downloads\Ruby4Lich5.exe` is 65 MB of
cached copy of a bundled installer.

### Why, read rather than inferred

From the `installer.nsi` Tauri generates, `Section Uninstall`:

```
  ; Delete app data if the checkbox is selected
  ; and if not updating
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ...
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}
```

`${BUNDLEID}` is `io.github.dancockrell.dr-companion`. That is the whole of what
the checkbox reaches. This app does not keep its runtime files there:
`app_data_dir()` (`src-tauri/src/setup.rs:125`) deliberately returns
`%LOCALAPPDATA%\DR Companion Data`, with a comment explaining why — an earlier
layout put a whole Lich 5 tree, including the user's own scripts, inside the
install directory, where an uninstall would have taken it.

**That decision is right.** What nobody had followed through is its consequence:
the uninstaller then cannot see any of it.

Filed as issue #352.

---

# Runs C and D — the fix, on build B

`src-tauri/installer-hooks.nsh`, wired by `bundle.windows.nsis.installerHooks`,
at `NSIS_HOOK_POSTUNINSTALL`:

- the four port/token files **unconditionally** — they are credentials, the app
  rewrites all four on every start, and after an uninstall nothing owns them.
  Leaving a credential behind is not a preference, so it is not on the checkbox;
- `downloads\` only when the checkbox is ticked — that is cache, not a
  credential, and somebody who declined to delete their data may reasonably want
  the download they already have;
- then a bare `RMDir` — **not** `/r` — on the data folder, which succeeds only
  if it is already empty. It must never be recursive: that folder can hold
  `portraits\` (the player's own images) and whole `lich\` and `genie\`
  installs.

VM restored to `clean`. Build B installed. Ruby4Lich5 was **not** installed this
time — the setup wizard's Ruby row was clicked as far as "Verified and saved",
which is what produces the download cache, and no further. Its own installer
takes four minutes and adds nothing to the question being asked here.

### Run C — checkbox unticked (the default)

```
before                                          after
PROBE  app data dir      PRESENT files=5 bytes=68583698     PRESENT files=1 bytes=68583560
PROBE  cached download   PRESENT files=1 bytes=68583560     PRESENT files=1 bytes=68583560
PROBE  presentation-bridge.port   PRESENT bytes=5           ABSENT
PROBE  presentation-bridge.token  PRESENT bytes=64          ABSENT
PROBE  script-api.port            PRESENT bytes=5           ABSENT
PROBE  script-api.token           PRESENT bytes=64          ABSENT
PROBE  webview profile  PRESENT files=159 bytes=4469868     PRESENT files=172 bytes=5972432
PROBE  install dir      PRESENT                             ABSENT
UNINST '*Companion*'    1 of 5                              0 of 4
SHORTCUT '*Companion*'  2 of 47                             0 of 45
probes=15 present=11 absent=4                               present=4 absent=11
```

All four credentials gone. The cache stays, which is what "do not delete my
data" should mean. The user's WebView2 profile stays.

### Run D — checkbox ticked

Reinstalled, relaunched, uninstalled with the box ticked:

```
PROBE  install dir                     ABSENT
PROBE  app data dir                    ABSENT      <- the folder itself
PROBE  cached Ruby4Lich5 download      ABSENT
PROBE  bridge presentation-bridge.port  ABSENT
PROBE  bridge presentation-bridge.token ABSENT
PROBE  bridge script-api.port           ABSENT
PROBE  bridge script-api.token          ABSENT
PROBE  roaming %APPDATA%\DR Companion   ABSENT
UNINST matching '*Companion*': 0 of 4 uninstall entries read
SHORTCUT matching '*Companion*': 0 of 45 .lnk files seen
probes=15 present=2 absent=13
```

Two present: the control, and the WebView2 profile — see the next section, which
is a separate defect and not this fix's doing.

## A second thing, found while checking the first

On Run D the ticked checkbox left **19 files, 141,046 bytes** of WebView2
profile behind, where the same checkbox on Run B had removed it completely. The
timestamps say what happened — the uninstall ran at about 16:43:30–16:44:00Z:

```
16:34:54           0  EBWebView\Default\shared_proto_db\metadata\LOCK
16:34:54          41  EBWebView\Default\shared_proto_db\metadata\MANIFEST-000001
16:35:02       32768  EBWebView\Default\ExtensionActivityEdge
16:35:02       45056  EBWebView\Default\Network Action Predictor
...
16:44:09           0  EBWebView\Default\Feature Engagement Tracker\EventDB\LOCK
```

Files written at 16:34 and 16:35 — nine minutes *before* the uninstall —
survived it. So the tree was not deleted and repopulated; part of it was never
deleted. `msedgewebview2` processes: none, by the time the listing ran.

The likely mechanism is that the uninstaller kills the app (see the prompt
below) and immediately runs `RmDir /r`, while WebView2's own processes still
hold handles, and NSIS's `RmDir /r` skips what it cannot delete without saying
so. **That is a hypothesis and it was not tested.** What was observed is that
the same checkbox on the same product produced a complete deletion once and a
partial one once, which makes "Delete the application data" unreliable rather
than wrong. Recorded here, added to #352, and not fixed in this increment.

## Prompts, and one that is not in E2's table

E2 recorded seven prompts to install. The uninstall adds one nobody had written
down, because in E2's run the app was not running at the time:

> **DR Companion is running!**
> Click OK to kill it
> [ OK ] [ Cancel ]

Screenshot 02. It appeared on every uninstall in this document — four of four —
because the app launches itself from the installer's last page and there is
nothing in the flow that tells you to close it first. OK kills the app outright
with no chance to save; Cancel abandons the uninstall halfway through, after
some files are already gone. Not a defect this increment fixes; worth a decision
before 1.0.

## Defects from E2/E10 that reproduce on the CI build

Checked deliberately, because "it worked locally" is the claim a CI artefact
exists to test:

- **Defect 1 — the window is not clamped to the display.** `GetWindowRect`, not
  estimated: at 1440x900 the first-run window opened `L=452 T=20 R=1648 B=879`,
  208 px off the right edge; at 1024x768 it opened `L=26 T=0 R=1222 B=859`,
  198 px off the right and 91 below. Same failure, both resolutions. The header's
  **Check again** button is among what falls off, and the wizard cannot be
  completed at 1024x768 without moving the window with an API call, which a
  user cannot do.
- **Defect 2 — the Ruby4Lich5 default is the GemStone IV layout.** Unchanged:
  the preselected option is `Place in Desktop … preferred for Gemstone IV`, on a
  page a DragonRealms client sends people to. Taking the default worked, exactly
  as E10 found.
- **Defect 3 — the first screen after setup is fabricated game state.** "In
  combat, 84 of 100 health", "Dan the Bold", room 308, 18 others present, on a
  machine that has never connected to anything. Labelled `MOCK`, as E10 says.
- **Defect 4 — publisher reads `github`.** Confirmed from the registry rather
  than the Settings UI this time: `Publisher github`.
- **Defect 5 — a failed load with a Retry button on the first screen.** Seen
  twice with different text: `Inleiding Le Concert Spirituel olv. …` and
  `Paul Ayres - Handel's Music for th…`, both beside the sound controls at the
  bottom of the window. E3 recorded it as `Hmv-da1480-ola1015 — unavaila…` and
  could not say what the identifier was. These two are **music track titles**,
  which narrows it to the sound player failing to load a track, and the varying
  text says it is not one specific missing file. Still not diagnosed.

## Mechanics, for whoever runs this next

`docs/verification/vm.md` and the E2 document cover guest control. Three things
this run learned that they do not say:

- **`VBoxManage startvm --type gui` did not work today.** It spawned two
  `VirtualBoxVM.exe` processes, left `SessionName="GUI/Qt"` holding a lock on a
  machine whose `VMState` stayed `poweroff`, and every retry added two more
  processes. `--type headless` started it first time and everything else in this
  document worked against a headless VM. If you hit the lock, stop the
  `VirtualBoxVM.exe` processes **by pid** — never by image name, several
  sessions run here — and the lock clears.
- **`controlvm screenshotpng` returned a stale frame.** After a
  `setvideomodehint`, the host-side capture kept returning a 1024x768 image of an
  empty desktop while the guest reported 1440x900 and `GetWindowRect` listed an
  installer window the image did not contain. A stale framebuffer and an empty
  desktop are indistinguishable. Capture from inside the guest instead —
  `SetProcessDPIAware` then `CopyFromScreen` over `SystemInformation.VirtualScreen`
  — and print the size with the image so a wrong one is visible.
- **`guestcontrol run` fails intermittently and it does not always say so.** It
  exits non-zero having done the work (it segfaults on teardown on this host),
  and separately it sometimes starts nothing at all. Both were survived by
  deleting the output file in the guest first and asserting it exists
  afterwards, retrying up to three times, and reading the exit code the `.cmd`
  writes into that file rather than VBoxManage's. Without that the runner hands
  back the *previous* task's output, which reads as a result — it produced two
  identical screenshots of a page the installer had already left, and they were
  only caught because the page had visibly moved on.

## What was not tested

Stated so nobody reads a gap as a pass:

- **A non-administrator account.** `tester` is a local Administrator. No UAC
  prompt appeared at any point in any of the four uninstalls, which is
  consistent with a per-user install, but a standard user was not tried.
- **Uninstall through the Settings → Apps UI.** The uninstaller was launched
  from the registry's own `UninstallString`, which is the command Settings runs
  — quoted above, read back from the registry rather than typed. The Settings
  chrome around it (the "This app and its related info will be uninstalled"
  confirmation) is E3's record and was not repeated.
- **The `portraits\` folder.** No custom portraits existed on this machine, so
  what the ticked checkbox does to them was not observed. `custom_portraits.rs`
  puts them under `DR Companion Data`, and the fix deliberately does not touch
  them. Open question in #352.
- **An upgrade.** `$UpdateMode` guards the new hook the same way it guards
  Tauri's own app-data deletion, and that branch was not exercised.
- **Whether the partial WebView2 deletion is the handle race described above.**
  Observed twice with two different outcomes; the mechanism is a hypothesis.
- **A real GitHub release download**, and therefore the SmartScreen reputation a
  release URL would carry. `gh release list` is still empty.

## Reproducing any of this

```bash
VB="C:/Program Files/Oracle/VirtualBox/VBoxManage.exe"
"$VB" snapshot drc-clean-win11 restore clean
"$VB" startvm drc-clean-win11 --type headless
# wait for run level 3 - check it, do not assume:
"$VB" showvminfo drc-clean-win11 --machinereadable | grep GuestAdditionsRunLevel

# the installer CI built for the current head of main:
gh run list --workflow ci.yml --branch main --limit 1
gh run download <id> -n dr-companion-nsis-installer -D .
sha256sum "DR Companion_0.1.1_x64-setup.exe"   # must equal the run summary's

"$VB" guestcontrol drc-clean-win11 --username tester --password drc-test-vm \
      copyto "DR Companion_0.1.1_x64-setup.exe" --target-directory "C:/Users/tester/f8/"
"$VB" guestcontrol drc-clean-win11 --username tester --password drc-test-vm \
      copyto tools/vm-inventory.ps1 --target-directory "C:/Users/tester/f8/"
```

Then in the guest, either side of the uninstall:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\tester\f8\vm-inventory.ps1 -Label before
powershell -ExecutionPolicy Bypass -File C:\Users\tester\f8\vm-inventory.ps1 -Label after
```

Run it on a machine where the app **is** installed and it must print the install
tree with a non-zero file count, the registry entry, and two shortcuts. Run it
after an uninstall and those must be gone while the control probe stays PRESENT.
If it prints nothing at all in either state, the script did not run — that is
not a clean machine.

Where this document and that script disagree, **the script is right and the
prose is stale.**
