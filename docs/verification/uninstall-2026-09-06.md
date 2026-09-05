# Uninstall: the two things F8 recorded and did not fix

6 September 2026. `docs/verification/uninstall-2026-09-05.md` (F8) fixed the
bearer tokens, and while checking that found two things it left open in #352:

1. **"Delete the application data" is unreliable.** The same checkbox on the
   same product removed the WebView2 profile completely on one run and left
   **19 files, 141,046 bytes** on another, with write times showing part of the
   tree was never deleted rather than deleted and repopulated. A handle race
   was the hypothesis, and F8 said plainly it had not been tested.
2. **Uninstalling raised `DR Companion is running! / Click OK to kill it`** on
   four of four runs, and nothing had recorded it.

Both are settled here. Everything below was observed; where something was not,
it says so, and there is a "What was not tested" section at the end.

| | |
|---|---|
| Machine | `drc-clean-win11`, restored from snapshot `clean` before the run |
| Guest | Windows 11 Enterprise LTSC Evaluation, 10.0.26100, host `DRC-CLEAN` |
| Account | `tester`, local Administrator, auto-logged-in |
| Instruments | `tools/vm-inventory.ps1`, `tools/vm-webview-residue.ps1`, `tools/vm-uninstall-drive.ps1` |
| Raw logs | this document quotes them; the full transcripts are the guest's `out.txt` per run |

## The two installers, and why each is what it claims to be

| | control (no retry) | fixed (with the retry) |
|---|---|---|
| commit | `d08a8b44`, head of `main` | `66710038`, head of `fix/352-uninstall-data` (PR #372) |
| CI run | 33981396822 | 33986527577 |
| CI's own report | `bytes 217284143`, `sha256 75a04c3e…f58` | `bytes 217284006`, `sha256 e4abe62c…171` |
| `sha256sum` on the host | `75a04c3e3b0eeb9e5cba8e0720eda2137f08b4918cbb224984ac690fddc23f58` | `e4abe62c107e1b1147e8c14f91791a4dfb6c6f48c0f67703e6bd82f038278171` |
| `Get-FileHash` **inside the guest** | same | same (printed by the run itself) |

Three independent readings each, as F8 established. Both were pushed in with
`guestcontrol copyto`, so neither carries a Mark of the Web; SmartScreen is
E2's subject and has no bearing on what an uninstall leaves behind.

## How the checkbox was reached, and why it is a script

`/S` and `/P` both skip the confirm page, so `un.ConfirmLeave` never runs and
`$DeleteAppDataCheckboxState` stays 0. **The ticked path is only reachable
through the UI.** F8 reached it by moving a cursor to coordinates read off a
screenshot, which cannot say afterwards whether the box went on — and "was the
box actually ticked" is the premise of every number below.

`tools/vm-uninstall-drive.ps1` talks to the controls instead. It finds the
checkbox by its label, sets it with `BM_SETCHECK`, reads `BM_GETCHECK` back,
and **throws if the answer is not 1**, so a run that could not tick the box
produces no listing at all rather than one nobody can interpret. Every run
below printed `BM_GETCHECK reads back 1`.

It also refuses to run anywhere but `DRC-CLEAN*`. The developer machine has DR
Companion installed at the identical path, and compiling this script by running
it on the host is how that was noticed.

## The instrument for the residue

`vm-inventory.ps1` answers "is the profile there", which is right for
everything else it probes and wrong here: a probe printing `PRESENT files=19`
cannot say whether those 19 were written after the uninstall or survived it.
`vm-webview-residue.ps1` prints every file with its size and UTC write time,
plus the live `dr-companion` / `msedgewebview2` processes, each with a
denominator, and it aborts if its control probe on `%LOCALAPPDATA%\Microsoft`
is absent or empty.

The clean machine, before anything was installed, so every ABSENT below can be
read against something:

```
== DRC WEBVIEW RESIDUE CLEAN ==
CONTROL   : C:\Users\tester\AppData\Local\Microsoft PRESENT files=185
PROFILE   : ABSENT
files=0 bytes=0
PROC matching 'dr-companion|msedgewebview2': 0 of 111 processes read
```

and `vm-inventory.ps1` on the same machine: `probes=15 present=1 absent=14`,
the one present being its own control.

---

# 1. The prompt (#352 item 2) — correct behaviour, and here is the proof

Three conditions, all on the control build, all with the box ticked. The
question is whether the prompt can appear when the app is **not** running,
which would make it a bug in the running-check rather than a consequence of
the installer launching the app.

| condition | how the app died | processes just before the uninstall | prompt? |
|---|---|---|---|
| **a** closed | `WM_CLOSE` to its own window, waited for exit | `0 of 111` | **no** |
| **c** killed | `taskkill /IM dr-companion.exe /F`, uninstall started immediately | `6 of 114` — **six `msedgewebview2`, no `dr-companion`** | **no** |
| **b** running | left running; the uninstaller killed it | `7 of 117` — `dr-companion` pid 3356 and six children | **yes** |

Verbatim, condition b:

```
19:27:57.135Z  PROC at-prompt dr-companion         pid=3356
19:27:57.135Z  PROC at-prompt msedgewebview2       pid=924
                                    … five more …
19:27:57.136Z  PROC at-prompt matching 'dr-companion|msedgewebview2': 7 of 118 processes read
2026-09-05T19:27:57  CTRL Static id=65535 'DR Companion is running! / Click OK to kill it'
```

**Verdict: the prompt is correct and there is no stale-process bug.** It
appears exactly when `dr-companion.exe` is running and never otherwise.
Condition c is the sharp one: six orphaned `msedgewebview2.exe` processes were
alive and the prompt did **not** appear, because
`CheckIfAppIsRunning "${MAINBINARYNAME}.exe"` looks only at the main binary.

What makes a person meet it is that the installer launches the app from its
last page. That is not a decision this repository can revisit: `installer.nsi`
is generated by Tauri and hardcodes

```
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
```

with no `tauri.conf.json` option to turn it off. Read out of the generated
file, not inferred. So the prompt stays, and this half of #352 closes as
**recorded, correct, not a defect**. The two real sharp edges in it — OK kills
the app with no chance to save, Cancel abandons the uninstall after files are
already gone — are Tauri's `CheckIfAppIsRunning` and unchanged by this work.

---

# 2. The unreliable checkbox (#352 item 1)

## The natural race did not reproduce, four times

All on the control build, box ticked, profile freshly created by launching the
app after a silent install:

| condition | profile before | profile after |
|---|---|---|
| a — closed cleanly | `PRESENT files=159 bytes=4468420` | **ABSENT** |
| c — killed, uninstall immediately | `PRESENT files=159 bytes=4468355` | **ABSENT** |
| b — killed by the uninstaller's prompt | `PRESENT files=159 bytes=4468360` | **ABSENT** |
| b again, earlier boot | `PRESENT files=195 bytes=17630531` | **ABSENT** |

Four for four clean. Condition c is worth dwelling on: six `msedgewebview2`
processes outlived the killed app and the deletion **still** completed, so on
this machine the window in which they hold handles is shorter than the couple
of seconds `Section Uninstall` spends deleting files first.

That is a real result and it is not an answer. F8 saw the profile survive once;
a race that does not happen on the day you look proves nothing about the race,
and "we could not reproduce it" is exactly the kind of negative that looks
identical whether the thing is absent or the method is blind.

## So the mechanism was produced on demand

`vm-uninstall-drive.ps1 -HoldSeconds N` starts a second process that opens one
file inside the profile with `FileShare.None` for N seconds — which is what a
shutting-down `msedgewebview2.exe` is doing to its LevelDB `LOCK` files — and
**asserts the handle actually took** before going near the uninstaller.

That assertion earned its place twice. The first version aimed at the real
`LOCK` file, which the running WebView2 already holds, so the holder could not
open it either and the run aborted itself (`file is locked against us = False`,
19:28:52Z) rather than reporting a clean uninstall. The second failed because
the holder's code went through `Start-Process`'s quoting as an inline
`-Command` and arrived mangled — same symptom, same abort (19:44:45Z). It now
plants its own file and runs the holder from a script file with parameters.

### Control build, handle held 8 s

```
19:57:12.107Z  holding an exclusive handle on '…\EBWebView\Default\drc-handle-injection.bin' for 8s
19:57:14.794Z  handle holder pid=3480, file is locked against us = True
19:57:21.298Z  RESULT confirm-page=True ticked=True running-prompt=True clicked-ok=True finished=True
19:57:21.319Z  RESULT held-file='…\drc-handle-injection.bin' for 8s; still on disk = True
```

before `PRESENT files=161 bytes=4648984`, after:

```
== DRC WEBVIEW RESIDUE AFTER-X-CONTROL-HOLD8 ==
CONTROL   : C:\Users\tester\AppData\Local\Microsoft PRESENT files=189
PROFILE   : PRESENT files=1 bytes=63

lastWriteUtc              bytes  path (relative to root)
2026-09-05T19:57:12Z          63  EBWebView\Default\drc-handle-injection.bin

files=1 bytes=63
```

**The uninstaller reported success over a profile that is still there.** 160 of
161 files went; the one file that could not be deleted stayed, and its parent
directories with it, and nothing anywhere said so. That is F8's finding
reproduced on demand, and it is the mechanism: `RmDir /r` skips what it cannot
delete and is silent about it.

### The cause, established

Read out of the generated `installer.nsi`, in this order inside
`Section Uninstall`:

1. `!insertmacro CheckIfAppIsRunning` — prompts, then
   `KillProcessCurrentUser`, then `Sleep 500`;
2. the install directory, shortcuts and registry entries are deleted;
3. `${If} $DeleteAppDataCheckboxState = 1` → `RmDir /r "$LOCALAPPDATA\${BUNDLEID}"`;
4. `!insertmacro NSIS_HOOK_POSTUNINSTALL` — this repository's hook.

So the recursive delete runs a couple of seconds after the kill, once, and the
`msedgewebview2.exe` children are not killed with the app. The hypothesis F8
could not test is **confirmed as a sufficient cause**: a held handle at step 3
produces exactly the residue it saw. Whether F8's own run was that handle race
or something else remains unproven — nobody was watching the processes at the
moment — and it does not need to be, because the fix is on the outcome.

## The fix

`src-tauri/installer-hooks.nsh`, at `NSIS_HOOK_POSTUNINSTALL`, under the
checkbox and the update guard only: retry `RmDir /r "$LOCALAPPDATA\${BUNDLEID}"`
until `IfFileExists` says it is gone, bounded at 20 x 500 ms, and `DetailPrint`
either the retry it succeeded on or the fact that it ran out.

It waits on the **outcome**, not on the processes. Waiting for
`msedgewebview2.exe` means waiting on an image name shared with Edge and every
other WebView2 app on the machine — not identifiable from NSIS, and the wrong
question. "Is the directory gone" is what the checkbox claims, so it is what
gets checked.

## The fix, on the CI build

Same guest, same injection, `e4abe62c…`:

| run | hold | uninstall took | profile after | held file gone? |
|---|---|---|---|---|
| control, b | none | 4.21 s | ABSENT | — |
| **control, X** | **8 s** | **4.71 s** | **PRESENT files=1 bytes=63** | **no** |
| **fixed, F** | **8 s** | **9.74 s** | **ABSENT** | **yes** |
| **fixed, G** | **30 s** | **13.38 s** | **PRESENT files=1 bytes=63** | **no** |
| fixed, H | none | 2.50 s | ABSENT | — |

Read the middle three together, because each is the control for the others:

- **F is the fix working.** Identical injection to X, opposite outcome. The
  uninstall took 5.5 s longer than the unheld control because the retry was
  waiting out an 8 s lock, and `still on disk = False` says the file it was
  waiting on went in the end.
- **G is the bound working, on purpose.** 30 s is past the 10 s ceiling, so the
  retry runs out and the profile survives — which is the branch that would
  otherwise never be executed by anybody, and the reason it exists is that when
  it fires, the uninstaller says so instead of reporting success. G took 10.9 s
  longer than H, which is the ceiling, measured.
- **H is the cost when nothing is stuck: none.** 2.50 s, faster than the
  control's 4.21 s (different run, same order of magnitude). The first
  `IfFileExists` is false and the loop never runs.

F's after-listing:

```
== DRC WEBVIEW RESIDUE AFTER-F-HOLD8 ==
CONTROL   : C:\Users\tester\AppData\Local\Microsoft PRESENT files=189
PROFILE   : ABSENT
files=0 bytes=0
```

against its own before-listing of `PRESENT files=159 bytes=4468358` two minutes
earlier, on the same boot, printed by the same script.

## Three things settled in passing

**The checkbox state does reach the hook.** The review lane on #352 flagged
that it could not establish, from a reading, whether
`$DeleteAppDataCheckboxState` is in scope at `NSIS_HOOK_POSTUNINSTALL` time,
and that if it were not, the `downloads` cache would silently never be removed.
Two answers, and they agree. The generated `installer.nsi` declares it with
`Var DeleteAppDataCheckboxState` at file scope (line 420), which in NSIS is
global. And it was measured: a marker file was planted at
`DR Companion Data\downloads\marker-cache.bin` before every ticked uninstall in
the fixed sweep, and after every one of them

```
MARKER downloads\marker-cache.bin present    = False
MARKER downloads\ present                    = False
```

**`portraits\` survives, and so does the data folder.** Same runs, same
listings:

```
MARKER portraits\marker-portrait.png present = True
MARKER DR Companion Data present             = True
```

The bare `RMDir` at the end of the hook refuses a non-empty folder, exactly as
its comment says. This is evidence for #352 item 3, not a resolution of it: the
question of whether the checkbox *ought* to take somebody's portraits is still
open, and nothing here decides it.

**The tokens stay gone.** #354's fix holds on both builds: every ticked run
ends with all four of `presentation-bridge.port/.token` and
`script-api.port/.token` ABSENT.

---

# What was not tested

Stated so no gap reads as a pass.

- **F8's own residue was not explained, only reproduced.** The mechanism
  demonstrated here is *a* sufficient cause of exactly that outcome. Nobody
  recorded the processes during F8's Run D, so whether that particular
  19-file residue was this race cannot now be established.
- **The `DetailPrint` lines were never read.** The driver clicks "Show details"
  and the fixed build prints on both branches, but the listview text was not
  captured cross-process and no screenshot was taken. That the retry ran is
  established by the file system and by the timings, not by the message.
- **The natural race was measured four times and never fired.** Four is a small
  number. The fix is not conditional on how often it fires — it re-checks an
  outcome and costs nothing when the outcome is already right — but "how likely
  is this on a real machine" is not answered here.
- **A non-administrator account.** `tester` is a local Administrator, and no
  UAC prompt appeared at any point, consistent with a per-user install. A
  standard user was not tried.
- **Installation through the wizard.** These runs installed with `/S` and
  launched the app from the script, because the finish page's launch is
  E2/E3/F8's subject and identical files land either way. The finish-page launch
  itself is read out of `installer.nsi`, above, not observed here.
- **An upgrade.** `$UpdateMode` guards the retry the same way it guards the
  rest of the hook; that branch was not exercised.
- **Conditions after the first ran on the same booted guest.** The snapshot was
  restored once per sweep. Between conditions the three directories were
  removed and their absence printed (`present = False` for each) before
  reinstalling, rather than re-restoring. The first condition of each sweep is
  the one that ran on a genuinely fresh `clean`.
- **Ruby4Lich5 was not installed**, so the real 65 MB download cache was stood
  in for by a marker file. What is checked is that the checkbox reaches
  `downloads\`, not the size of what it removes.

# Reproducing any of this

```bash
VB="C:/Program Files/Oracle/VirtualBox/VBoxManage.exe"
"$VB" snapshot drc-clean-win11 restore clean
"$VB" startvm drc-clean-win11 --type headless
# do not proceed until this says 3:
"$VB" showvminfo drc-clean-win11 --machinereadable | grep GuestAdditionsRunLevel

gh run list --workflow ci.yml --branch main --status success --limit 1
gh run download <id> -n dr-companion-nsis-installer -D .
sha256sum "DR Companion_0.1.1_x64-setup.exe"   # must equal the run summary's

"$VB" guestcontrol drc-clean-win11 --username tester --password drc-test-vm \
      mkdir --parents "C:/Users/tester/f9"
# then copyto the installer and tools/vm-*.ps1 into C:/Users/tester/f9/
```

In the guest, either side of the uninstall:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\tester\f9\vm-webview-residue.ps1 -Label before
powershell -ExecutionPolicy Bypass -File C:\Users\tester\f9\vm-uninstall-drive.ps1 -Condition running -TickDeleteAppData -HoldSeconds 8
powershell -ExecutionPolicy Bypass -File C:\Users\tester\f9\vm-webview-residue.ps1 -Label after
```

On a build without the retry that leaves `files=1`; with it, `ABSENT`. If
either script prints nothing, it did not run — that is not a clean machine.

Three mechanics this run learned that `docs/verification/vm.md` does not say:

- **`guestcontrol run` returns or segfaults long before a long task ends.** A
  harness that retries on "no output yet" started three concurrent silent
  installs inside one guest. Wait on a completion marker the task itself writes
  and only restart when the task's own id has never appeared at all.
- **Two processes must not fetch the same guest file at once.** Polling
  `out.txt` from a second shell while the harness was polling it deleted the
  file the harness was waiting for, and the harness read that as "never
  started".
- **Stale `VBoxHeadless.exe` processes hold the machine lock after the VM is
  already `poweroff`**, and `startvm` then fails with "The VM session was closed
  before any attempt to power it on". Stop them **by pid** — several sessions
  run here — and the lock clears. A hung `guestcontrol` `VBoxManage.exe` keeps
  them alive; kill that first and some of them exit on their own.

Where this document and those scripts disagree, **the scripts are right and the
prose is stale.**
