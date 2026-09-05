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

**`ver` was not run inside the guest.** `VBoxManage guestcontrol` returned
`The guest execution service is not ready (yet)` on two attempts, so the
in-guest value is unverified. The two figures above are what was actually
observed; if an exact UBR ever matters, log in and run `winver`, and correct
this section rather than trusting it.

## The licence watermark says "expired"

The booted desktop shows `Windows License is expired` alongside the evaluation
notice. That is the evaluation image's own clock and not a fault in the VM —
it boots, logs in and runs. It is recorded here because it will be visible in
every E2, E3 and E10 screenshot and would otherwise look like a finding.

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
