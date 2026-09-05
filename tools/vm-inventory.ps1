# What DR Companion has put on a Windows machine, listed the same way before
# and after an uninstall so the two runs can be diffed line for line.
#
# Run it in the guest, twice:
#
#   powershell -ExecutionPolicy Bypass -File vm-inventory.ps1 -Label before
#   powershell -ExecutionPolicy Bypass -File vm-inventory.ps1 -Label after
#
# Why this is a committed file rather than a snippet pasted into each
# verification document: E3 ran a version of it typed into the guest and only
# its text survived, in the appendix of docs/verification/first-run-2026-09-05.md.
# F9, F12 and F13 all say "E2/E3 again", so that snippet was on its way to
# being retyped three more times, and three copies of a listing disagree the
# first time a path moves. One script, one shape of output, diffable across
# releases.
#
# The design constraint that shaped it: an empty listing and a listing whose
# script never reached the disk look identical. So this prints
#
#   * a PROBE line for every probe, present or absent, never only the hits;
#   * a CONTROL probe on a directory Windows itself guarantees, which must be
#     PRESENT in every run, on every machine, installed or not;
#   * a denominator - how many probes ran - and a hard failure if the control
#     is absent, because at that point the instrument is broken and its zeros
#     mean nothing.
#
# It reports. It changes nothing.

[CmdletBinding()]
param(
  # Free text that goes in the header, e.g. "before" / "after".
  [Parameter(Mandatory = $true)][string]$Label
)

$ErrorActionPreference = 'Stop'

$probes = 0
$present = 0
$absent = 0

function Write-Head {
  param([string]$Text)
  Write-Output ''
  Write-Output ("-- " + $Text + " " + ('-' * [Math]::Max(0, 60 - $Text.Length)))
}

# A directory or file: reports file count and total bytes when it is a tree.
function Probe-Path {
  param([string]$Name, [string]$Path, [switch]$Control)

  $script:probes++
  if (-not (Test-Path -LiteralPath $Path)) {
    $script:absent++
    Write-Output ("PROBE  {0,-42} ABSENT   {1}" -f $Name, $Path)
    if ($Control) {
      throw "CONTROL PROBE '$Name' is absent at $Path. This listing is not evidence of anything - the script is looking in the wrong place, or not running where it thinks it is."
    }
    return
  }

  $script:present++
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer) {
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
               Where-Object { -not $_.PSIsContainer })
    $bytes = 0
    if ($files.Count -gt 0) { $bytes = ($files | Measure-Object -Property Length -Sum).Sum }
    Write-Output ("PROBE  {0,-42} PRESENT  files={1} bytes={2}  {3}" -f $Name, $files.Count, $bytes, $Path)
  } else {
    Write-Output ("PROBE  {0,-42} PRESENT  bytes={1}  {2}" -f $Name, $item.Length, $Path)
  }
}

# Every uninstall entry whose DisplayName matches, in both hives and both
# views. Named entries are listed individually; the total is printed too, so a
# run that finds none can be told apart from a run that read no keys at all.
function Probe-Uninstall {
  param([string]$Pattern)

  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )

  $seen = 0
  $hits = 0
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($key in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
      $p = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
      if ($null -eq $p -or [string]::IsNullOrWhiteSpace($p.DisplayName)) { continue }
      $seen++
      if ($p.DisplayName -like $Pattern) {
        $hits++
        Write-Output ("UNINST {0} | {1} | {2} | {3}" -f $p.DisplayName, $p.DisplayVersion, $p.Publisher, $key.PSPath.Replace('Microsoft.PowerShell.Core\Registry::', ''))
      }
    }
  }
  # The denominator. If this is 0 the enumeration failed and "no DR Companion
  # entry" is a statement about the script, not about the machine.
  Write-Output ("UNINST matching '{0}': {1} of {2} uninstall entries read" -f $Pattern, $hits, $seen)
  if ($seen -eq 0) {
    throw "Read 0 uninstall entries from any hive. The registry enumeration is broken; its zeros mean nothing."
  }
}

# Shortcuts anywhere a user would find them.
function Probe-Shortcuts {
  param([string]$Pattern)

  $roots = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
  )

  $seen = 0
  $hits = 0
  foreach ($root in $roots) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root)) { continue }
    foreach ($lnk in (Get-ChildItem -LiteralPath $root -Recurse -Force -Filter '*.lnk' -ErrorAction SilentlyContinue)) {
      $seen++
      if ($lnk.Name -like $Pattern) {
        $hits++
        Write-Output ("SHORTCUT {0}  bytes={1}" -f $lnk.FullName, $lnk.Length)
      }
    }
  }
  Write-Output ("SHORTCUT matching '{0}': {1} of {2} .lnk files seen" -f $Pattern, $hits, $seen)
  if ($seen -eq 0) {
    throw "Found 0 .lnk files in any Desktop or Start Menu folder. Windows always has some; the search is broken."
  }
}

Write-Output ("== DRC INVENTORY {0} ==" -f $Label.ToUpper())
Write-Output ("when      : " + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))
Write-Output ("host      : " + $env:COMPUTERNAME + "  user=" + $env:USERNAME)
Write-Output ("windows   : " + (Get-CimInstance Win32_OperatingSystem).Version)

Write-Head 'the app'
# The control goes first, so a broken run dies before printing a page of
# reassuring absences.
Probe-Path -Name 'CONTROL %LOCALAPPDATA%\Microsoft' -Path (Join-Path $env:LOCALAPPDATA 'Microsoft') -Control
Probe-Path -Name 'install dir' -Path (Join-Path $env:LOCALAPPDATA 'DR Companion')
Probe-Path -Name 'uninstaller' -Path (Join-Path $env:LOCALAPPDATA 'DR Companion\uninstall.exe')
Probe-Path -Name 'main binary' -Path (Join-Path $env:LOCALAPPDATA 'DR Companion\dr-companion.exe')

Write-Head 'data the app writes'
Probe-Path -Name 'webview profile (user data)' -Path (Join-Path $env:LOCALAPPDATA 'io.github.dancockrell.dr-companion')
Probe-Path -Name 'app data dir' -Path (Join-Path $env:LOCALAPPDATA 'DR Companion Data')
Probe-Path -Name 'cached Ruby4Lich5 download' -Path (Join-Path $env:LOCALAPPDATA 'DR Companion Data\downloads')
foreach ($n in @('presentation-bridge.port', 'presentation-bridge.token', 'script-api.port', 'script-api.token')) {
  Probe-Path -Name ('bridge ' + $n) -Path (Join-Path $env:LOCALAPPDATA ('DR Companion Data\' + $n))
}
Probe-Path -Name 'roaming %APPDATA%\DR Companion' -Path (Join-Path $env:APPDATA 'DR Companion')

Write-Head 'other trees this app touches but does not own'
Probe-Path -Name 'Ruby4Lich5 (separate product)' -Path 'C:\Ruby4Lich5'
Probe-Path -Name 'bridge script, desktop Lich5' -Path (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Lich5\scripts\companion_bridge.lic')
Probe-Path -Name 'bridge script, C:\Ruby4Lich5' -Path 'C:\Ruby4Lich5\Lich5\scripts\companion_bridge.lic'

Write-Head 'registry'
Probe-Uninstall -Pattern '*Companion*'
Probe-Uninstall -Pattern '*Ruby4Lich5*'

Write-Head 'shortcuts'
Probe-Shortcuts -Pattern '*Companion*'

Write-Head 'summary'
Write-Output ("probes={0} present={1} absent={2}" -f $probes, $present, $absent)
if ($probes -lt 15) {
  throw "Only $probes probes ran. This file defines more than that, so the script was truncated or an early one threw."
}
Write-Output ("== END DRC INVENTORY {0} ==" -f $Label.ToUpper())
