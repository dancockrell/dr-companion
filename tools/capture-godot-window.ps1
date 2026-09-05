# Capture a Godot window's client area to a PNG.
#
# PrintWindow returns an unchanging image for a GPU-composited Godot window,
# which is why the 5 September live-chain record could not judge what was on
# screen. Copying the composited desktop over the window's client rectangle
# works. Two things have to be right first, and both fail silently:
#
#   - SetProcessDPIAware() before any window call. PowerShell 5.1 is
#     DPI-unaware, and without this GetClientRect reports a window a fraction
#     of its real size and the capture lands in the wrong place. Measured on
#     one window seconds apart: 1024x576 unaware, 3840x2071 aware.
#   - the window must be foreground, or CopyFromScreen photographs whatever is
#     on top of it. SW_MINIMIZE then SW_MAXIMIZE defeats the foreground lock;
#     this refuses to shoot if that did not work, rather than saving a picture
#     of something else and letting it be read as the viewer.
#
#   powershell -File tools/capture-godot-window.ps1 -ProcId <pid> -OutPath shot.png
param([int]$ProcId, [string]$OutPath)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GodotShot {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
[void][GodotShot]::SetProcessDPIAware()
$proc = Get-Process -Id $ProcId -ErrorAction Stop
$h = $proc.MainWindowHandle
if ($h -eq [IntPtr]::Zero) { Write-Output "ABORT: process $ProcId has no main window"; exit 2 }
[void][GodotShot]::ShowWindow($h, 6)
Start-Sleep -Milliseconds 600
[void][GodotShot]::ShowWindow($h, 3)
[void][GodotShot]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 2000
if ([GodotShot]::GetForegroundWindow() -ne $h) { Write-Output "ABORT: window did not take foreground; the capture would be of something else"; exit 3 }
$c = New-Object GodotShot+RECT
[void][GodotShot]::GetClientRect($h, [ref]$c)
$o = New-Object GodotShot+POINT
[void][GodotShot]::ClientToScreen($h, [ref]$o)
$w = $c.Right - $c.Left
$ht = $c.Bottom - $c.Top
if ($w -lt 200 -or $ht -lt 200) { Write-Output "ABORT: client rect is ${w}x${ht}, too small for a maximized window - is DPI awareness working?"; exit 4 }
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($o.X, $o.Y, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved $OutPath (${w}x${ht} from client origin $($o.X),$($o.Y))"
