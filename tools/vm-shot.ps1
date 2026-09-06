# Look at the guest's screen, and measure its windows, from inside the guest.
#
#   powershell -ExecutionPolicy Bypass -File vm-shot.ps1 -Label 07-first-screen
#   powershell -ExecutionPolicy Bypass -File vm-shot.ps1 -Label 08 -ClickX 500 -ClickY 400
#
# Why in-guest and not `VBoxManage controlvm screenshotpng`: that returns a
# STALE framebuffer on this VM (memory-db trap/vbox-screenshotpng-stale) - it
# kept handing back a 1024x768 picture of an empty desktop while the guest was
# at 1440x900 with an installer window on screen. A stale frame and an empty
# desktop are indistinguishable, so a screenshot of nothing reads as "the app
# never launched".
#
# Everything here prints its denominator: the captured size, how many top-level
# windows were enumerated, and how many of them were visible with a title. A
# run that enumerated nothing says so instead of printing an empty list that
# looks like "no windows".
#
# It reports and it clicks. It installs nothing.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Label,
  [string]$Out = 'C:\Users\tester\f10\shots',
  [int]$ClickX = -1,
  [int]$ClickY = -1,
  [int]$Clicks = 1,
  [string]$Keys = '',
  [int]$ScrollTicks = 0,
  [int]$ScrollX = -1,
  [int]$ScrollY = -1,
  [int]$PreDelayMs = 400,
  [int]$PostDelayMs = 1200,
  [switch]$NoShot
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$sig = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class DrcWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
if (-not ('DrcWin' -as [type])) { Add-Type -TypeDefinition $sig -Language CSharp }

[void][DrcWin]::SetProcessDPIAware()

if (-not (Test-Path -LiteralPath $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
Write-Output ("== DRC SHOT {0} == {1}" -f $Label, $stamp)

# ---- the click, before anything is measured or captured -------------------
if ($ClickX -ge 0 -and $ClickY -ge 0) {
  Start-Sleep -Milliseconds $PreDelayMs
  [void][DrcWin]::SetCursorPos($ClickX, $ClickY)
  Start-Sleep -Milliseconds 150
  for ($i = 0; $i -lt $Clicks; $i++) {
    [DrcWin]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # LEFTDOWN
    Start-Sleep -Milliseconds 60
    [DrcWin]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # LEFTUP
    Start-Sleep -Milliseconds 120
  }
  Write-Output ("CLICK  x={0} y={1} times={2}" -f $ClickX, $ClickY, $Clicks)
  Start-Sleep -Milliseconds $PostDelayMs
}

# ---- the wheel, for panels that scroll ------------------------------------
if ($ScrollTicks -ne 0) {
  if ($ScrollX -ge 0 -and $ScrollY -ge 0) { [void][DrcWin]::SetCursorPos($ScrollX, $ScrollY); Start-Sleep -Milliseconds 150 }
  $step = 120
  if ($ScrollTicks -lt 0) { $step = -120 }
  for ($i = 0; $i -lt [Math]::Abs($ScrollTicks); $i++) {
    [DrcWin]::mouse_event(0x0800, 0, 0, [uint32]$step, [IntPtr]::Zero)  # WHEEL
    Start-Sleep -Milliseconds 90
  }
  Write-Output ("SCROLL ticks={0} at x={1} y={2}" -f $ScrollTicks, $ScrollX, $ScrollY)
  Start-Sleep -Milliseconds 800
}

if ($Keys -ne '') {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Write-Output ("KEYS   {0}" -f $Keys)
  Start-Sleep -Milliseconds $PostDelayMs
}

# ---- the screen -----------------------------------------------------------
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
Write-Output ("SCREEN={0}x{1}" -f $vs.Width, $vs.Height)
Write-Output ("WORKAREA L={0} T={1} R={2} B={3} W={4} H={5}" -f $wa.Left, $wa.Top, $wa.Right, $wa.Bottom, $wa.Width, $wa.Height)

# ---- every top-level window, with its rectangle ---------------------------
$seen = 0
$shown = 0
# Write-Output from inside the callback goes nowhere - a delegate invoked by
# user32 is not on this pipeline, so the first version of this script printed
# "WIN listed 2 of 89" and not one WIN line. Collect, then print.
$script:winlines = New-Object System.Collections.ArrayList
$cb = [DrcWin+EnumProc] {
  param([IntPtr]$h, [IntPtr]$p)
  $script:seen++
  if (-not [DrcWin]::IsWindowVisible($h)) { return $true }
  $sb = New-Object System.Text.StringBuilder 512
  [void][DrcWin]::GetWindowTextW($h, $sb, 512)
  $title = $sb.ToString()
  if ([string]::IsNullOrWhiteSpace($title)) { return $true }
  $r = New-Object DrcWin+RECT
  [void][DrcWin]::GetWindowRect($h, [ref]$r)
  if (($r.Right - $r.Left) -lt 120 -or ($r.Bottom - $r.Top) -lt 60) { return $true }
  $pid2 = 0
  [void][DrcWin]::GetWindowThreadProcessId($h, [ref]$pid2)
  $pname = '?'
  try { $pname = (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { }
  $script:shown++
  [void]$script:winlines.Add(("WIN '{0}' proc={1} pid={2} L={3} T={4} R={5} B={6} W={7} H={8}" -f `
    $title, $pname, $pid2, $r.Left, $r.Top, $r.Right, $r.Bottom, ($r.Right - $r.Left), ($r.Bottom - $r.Top)))
  return $true
}
[void][DrcWin]::EnumWindows($cb, [IntPtr]::Zero)
foreach ($line in $script:winlines) { Write-Output $line }
Write-Output ("WIN listed {0} of {1} top-level windows enumerated" -f $shown, $seen)
if ($seen -eq 0) {
  throw "EnumWindows returned nothing. Windows always has top-level windows; this listing is not evidence of anything."
}

# ---- the picture ----------------------------------------------------------
if (-not $NoShot) {
  $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
  $g.Dispose()
  $path = Join-Path $Out ($Label + '.png')
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $len = (Get-Item -LiteralPath $path).Length
  Write-Output ("SHOT   {0} {1}x{2} bytes={3}" -f $path, $vs.Width, $vs.Height, $len)
  # A capture the size of nothing, or a PNG of a few hundred bytes, is a
  # broken instrument rather than a blank desktop. Say so instead of saving it.
  if ($len -lt 5000) { throw "Captured PNG is $len bytes. That is not a screen." }
}

Write-Output ("== END DRC SHOT {0} ==" -f $Label)
