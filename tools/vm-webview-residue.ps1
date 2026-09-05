# What is left of the WebView2 profile, listed file by file, either side of an
# uninstall.
#
#   powershell -ExecutionPolicy Bypass -File vm-webview-residue.ps1 -Label before
#   powershell -ExecutionPolicy Bypass -File vm-webview-residue.ps1 -Label after
#
# `tools/vm-inventory.ps1` answers "is the profile there", which is the right
# question for everything else it probes and the wrong one here: on 5 September
# 2026 the ticked "Delete the application data" checkbox left 19 files of it
# behind on one run and none on another (F8,
# docs/verification/uninstall-2026-09-05.md), and a probe that prints
# `PRESENT files=19` cannot say whether those 19 were written after the
# uninstall or survived it. The timestamps can, so they are printed.
#
# Same design rules as vm-inventory.ps1, for the same reason - an empty listing
# and a listing whose script never ran look identical:
#
#   * a CONTROL probe on a directory Windows guarantees, which throws if it is
#     absent, because at that point the script is looking in the wrong place
#     and its zeros are statements about itself;
#   * every file printed, not a summary, with size and UTC write time;
#   * the process table printed whether or not anything matches, with its own
#     denominator, so "no msedgewebview2" can be told apart from "the process
#     query failed".
#
# It reports. It changes nothing.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Label
)

$ErrorActionPreference = 'Stop'

$profileRoot = Join-Path $env:LOCALAPPDATA 'io.github.dancockrell.dr-companion'
$control = Join-Path $env:LOCALAPPDATA 'Microsoft'

Write-Output ("== DRC WEBVIEW RESIDUE {0} ==" -f $Label.ToUpper())
Write-Output ("when      : " + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'))
Write-Output ("host      : " + $env:COMPUTERNAME + "  user=" + $env:USERNAME)
Write-Output ("root      : " + $profileRoot)

if (-not (Test-Path -LiteralPath $control)) {
  throw "CONTROL $control is absent. This listing is not evidence of anything."
}
$controlFiles = @(Get-ChildItem -LiteralPath $control -Recurse -Force -ErrorAction SilentlyContinue |
                  Where-Object { -not $_.PSIsContainer })
Write-Output ("CONTROL   : {0} PRESENT files={1}" -f $control, $controlFiles.Count)
if ($controlFiles.Count -eq 0) {
  throw "CONTROL $control has no files in it. The recursive enumeration is broken; every zero below is meaningless."
}

Write-Output ''
if (-not (Test-Path -LiteralPath $profileRoot)) {
  Write-Output 'PROFILE   : ABSENT'
  Write-Output 'files=0 bytes=0'
} else {
  $files = @(Get-ChildItem -LiteralPath $profileRoot -Recurse -Force -ErrorAction SilentlyContinue |
             Where-Object { -not $_.PSIsContainer })
  $bytes = 0
  if ($files.Count -gt 0) { $bytes = ($files | Measure-Object -Property Length -Sum).Sum }
  Write-Output ("PROFILE   : PRESENT files={0} bytes={1}" -f $files.Count, $bytes)
  Write-Output ''
  Write-Output 'lastWriteUtc              bytes  path (relative to root)'
  foreach ($f in ($files | Sort-Object LastWriteTimeUtc, FullName)) {
    $rel = $f.FullName.Substring($profileRoot.Length).TrimStart('\')
    Write-Output ("{0}  {1,10}  {2}" -f $f.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ'), $f.Length, $rel)
  }
  Write-Output ''
  Write-Output ("files={0} bytes={1}" -f $files.Count, $bytes)
}

Write-Output ''
Write-Output '-- processes --'
# The denominator: how many processes were read at all. A machine with no
# msedgewebview2 running and a query that returned nothing print the same
# empty list otherwise.
$all = @(Get-Process -ErrorAction SilentlyContinue)
if ($all.Count -eq 0) { throw 'Get-Process returned nothing at all. The process query is broken.' }
$watched = @($all | Where-Object { $_.Name -match 'dr-companion|msedgewebview2' })
foreach ($p in ($watched | Sort-Object Name, Id)) {
  $started = 'unknown'
  try { $started = $p.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } catch { }
  Write-Output ("PROC {0,-20} pid={1,-8} started={2}" -f $p.Name, $p.Id, $started)
}
Write-Output ("PROC matching 'dr-companion|msedgewebview2': {0} of {1} processes read" -f $watched.Count, $all.Count)
Write-Output ("== END DRC WEBVIEW RESIDUE {0} ==" -f $Label.ToUpper())
