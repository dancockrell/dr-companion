# The clean Windows VM (E1)

Built 5 September 2026. This is the machine E2, E3 and E10 run on, and the
whole point of it is that it has never seen this project: the developer machine
has Ruby, Lich, Genie and four years of accumulated PATH, so it cannot answer
"can a stranger install this".

## What it is

| | |
|---|---|
| Host | Windows 11 **Home** — no Hyper-V, no Windows Sandbox, which is why this is VirtualBox |
| Hypervisor | Oracle VirtualBox 7.0.18 r162988 (already installed on this machine; not installed by this increment) |
| VM name | `drc-clean-win11` |
| VM UUID | `d2f33cb1-de66-4385-b131-e0cccd85c80b` |
| Guest | Windows 11 Enterprise LTSC Evaluation, en-US, x64 |
| **Build** | **26100.1742** (see "how the build number was established", below) |
| Firmware | EFI, TPM 2.0 (Windows 11 refuses to install without both) |
| Memory | 4096 MB |
| CPUs | 2 |
| Disk | 61440 MB (60 GB), VDI, dynamically allocated |
| Network | NAT |
| Shared folders | **none** — deliberate, so nothing can reach the host tree by accident |
| Clipboard / drag-and-drop | disabled, same reason |
| Guest Additions | 7.0.18 r162988, installed by the unattended install |
| Local account | `tester` |
| **Snapshot** | **`clean`**, UUID `f3d11570-c6a9-46d2-99c1-77e300027040` |

The install ISO is detached in the `clean` snapshot, so a restore boots the
installed system rather than the installer.

## The source of the ISO

Microsoft's own CDN, not a mirror:

```
https://go.microsoft.com/fwlink/p/?linkid=2289029
  -> https://software-static.download.prss.microsoft.com/dbazure/
     888969d5-f34g-4e03-ac9d-1f9786c66749/
     26100.1742.240906-0331.ge_release_svc_refresh_CLIENT_LTSC_EVAL_x64FRE_en-us.iso
```

5,112,850,432 bytes, and the downloaded file is exactly that size — checked
against the `Content-Length` the server returned, which is the only figure
Microsoft publishes for it. Saved outside the repository, at
`C:\Users\Admin\dev\_scratch\vm\win11-ltsc-eval.iso`.

## How the build number was established

Two independent sources agree on the branch and differ in what they report,
so both are recorded rather than one being picked:

- **VirtualBox's own inspection of the ISO**, before installing anything:
  `detectedOSVersion = 10.0.26100.1742`, and
  `detectedImage[0] = #1: Windows 11 Enterprise LTSC Evaluation
  (10.0.26100.1742 / x64 / en-US)`. This is the figure in the table above.
- **The installed desktop's own watermark**, read off a screenshot of the
  booted VM: `Windows 11 Enterprise LTSC Evaluation` / `Build
  26100.ge_release.240331-1435`.

**`ver` has now been run inside the guest** and says
`Microsoft Windows [Version 10.0.26100.1742]`, which agrees with what
VirtualBox read off the ISO. Corrected 5 Sep 2026 during E2. This paragraph
used to say the in-guest value was unverified because `guestcontrol` returned
"the guest execution service is not ready (yet)"; that diagnosis was wrong —
see "Guest control works, and here is how" below.

## The licence watermark, and what it said when

Worth knowing before it turns up in an E2 or E10 screenshot and reads as a
finding. It changed between two observations on the same day:

- **immediately after install**, first boot to a desktop:
  `Windows License is expired`;
- **on the next boot**, about ten minutes later:
  `Windows License valid for 90 days`.

The first reading was the evaluation clock before activation state had
settled, not a broken image. This section originally recorded only that
reading and asserted it was the permanent state, which was wrong within one
reboot — corrected here rather than left standing, because a screenshot
saying "expired" beside a document insisting that is normal would send the
next person hunting a licensing problem that does not exist.

The ninety days run from **5 September 2026**. After that the guest begins
shutting itself down periodically and the VM has to be rebuilt from the ISO.

## Rebuilding or resetting it

```powershell
# Back to a machine that has never seen DR Companion:
& 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe' snapshot drc-clean-win11 restore clean
& 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe' startvm drc-clean-win11
```

Always restore `clean` before an installer test. A VM that has had the
installer run on it once is no longer answering the question E2 asks.

## Traps hit building it, so nobody pays for them twice

- **`VBoxManage unattended install ... --start-vm=headless` boots to
  `Press any key to boot from CD or DVD` and then times out into
  `No bootable option or device was found`.** The VM sits there looking
  exactly like a long install. Twenty-five minutes of "installing" turned out
  to be a boot prompt nobody had answered, and it was only caught by taking a
  screenshot rather than trusting `VMState="running"`. Fix: `controlvm reset`,
  wait about two seconds, then send Enter (`keyboardputscancode 1c 9c`)
  repeatedly for a few seconds.
- **Do not keep sending Enter after that.** The extra presses land on Windows
  Setup's `Cancel` button and raise `Are you sure you want to quit?`, which
  blocks the install behind a modal. `Esc` did not dismiss it; the accelerator
  `n` (scancode `31 b1`) did.
- **Windows 11 needs EFI and TPM 2.0** on the VM or setup refuses.
  `--firmware efi` and `--tpm-type 2.0`.
- **`aka.ms/windev_VM_vbox`**, the ready-made developer VM, now redirects to
  Bing: that image is gone. The evaluation ISO above is the route.

## State when E1 was signed off, and what E2 still needs

The VM is done. E2, E3 and E10 are not, and they are `[!]` in the plan rather
than half-done here. What exists already, so nobody rebuilds it:

**The installer exists.** Built locally on 5 Sep 2026 from this branch:

```
src-tauri/target/release/bundle/nsis/DR Companion_0.1.1_x64-setup.exe
217,297,383 bytes
SHA-256 1F813B6F74982F9E2A6E39095F37A59526137F1E838033F1E59D6F97810BE09E
```

A copy is staged outside the repository at
`C:\Users\Admin\dev\_scratch\vm\payload\`. It bundles the **real**
Ruby4Lich5 v5.20.1, hash-verified by `tools/vendor-fetch.mjs --require-real`,
not the stub. It does **not** contain the Godot world viewer, for the reason
`docs/RELEASE.md` gives.

E2, E3 and E10 have since been done on this VM. The walkthrough, every prompt
and the two file inventories are in
`docs/verification/first-run-2026-09-05.md`.

## Guest control works, and here is how

This section used to say `VBoxManage guestcontrol` does not work on this VM —
"the guest execution service is not ready (yet)", four attempts across two
boots — and it listed three ways to get a file in without it. That diagnosis
was wrong, and it is corrected here rather than left standing, because it was
the stated blocker on three increments.

Two separate things were going on, and neither is a broken execution service:

1. **The earlier attempts were made before anyone had logged in.** Guest
   Additions report `GuestAdditionsRunLevel=2` at the sign-in screen and `3`
   once the desktop is up, and the execution service belongs to run level 3.
   This VM auto-logs in, so the entire fix is to wait about a minute after
   `startvm` — and to *check* the run level rather than assume it.
2. **Nobody had the account password**, so at run level 3 the next error would
   have been `The specified user was not able to logon on guest`, which reads
   like the same wall. It is `drc-test-vm`, and it is on this disk, in the
   VM's own unattended answer file:
   `C:\Users\Admin\VirtualBox VMs\drc-clean-win11\Unattended-*-autounattend.xml`
   (`<AutoLogon>` and `<LocalAccounts>`).

```bash
VB="C:/Program Files/Oracle/VirtualBox/VBoxManage.exe"
"$VB" snapshot drc-clean-win11 restore clean
"$VB" startvm drc-clean-win11 --type gui
# do not proceed until this says 3:
"$VB" showvminfo drc-clean-win11 --machinereadable | grep GuestAdditionsRunLevel
"$VB" guestcontrol drc-clean-win11 --username tester --password drc-test-vm \
      copyto <hostfile> --target-directory "C:/Users/tester/drc/"
```

Three mechanics that cost an hour between them:

- **`--target-directory` needs a trailing slash.** Without one it fails with
  "Destination ... already exists and is a directory".
- **Passing arguments to `cmd.exe` via `guestcontrol run` did not work** in any
  form tried; every variant came back "The syntax of the command is incorrect."
  Write a `.cmd` file, `copyto` it, run it with no arguments. `.cmd` files need
  CRLF (`sed -i 's/$/\r/'`).
- **Git Bash rewrites `/c` to `C:/`** before VBoxManage sees it. Export
  `MSYS_NO_PATHCONV=1`.

For the GUI, `controlvm screenshotpng` and `controlvm keyboardputscancode`
work with no guest cooperation at all. Mouse clicks were done from inside the
guest via `SetCursorPos` + `mouse_event` in a copied-in PowerShell file — a
process started by guest control does land in the interactive session, which is
what makes that work. The screenshot PNG is the guest's native resolution, so
its pixels are 1:1 with what the mouse API takes.

**On delivery, prefer a real browser download.** A file pushed in with
`copyto` carries no Mark of the Web, so it installs with no security prompt and
proves nothing about what a stranger sees. E2 served the payload from the host
over HTTP and fetched it with Edge in the guest, which produced a genuine
`ZoneId=3` and the full SmartScreen chain. There is still no GitHub release to
download from (`gh release list` is empty).

**Restore `clean` first.** The snapshot is pristine; the VM was booted once
after it was taken, to test guest control, and restored afterwards.
