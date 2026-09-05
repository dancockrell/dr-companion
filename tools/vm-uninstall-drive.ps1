# Drives DR Companion's NSIS uninstaller through its own windows, and writes a
# timestamped account of what it saw and did.
#
#   powershell -ExecutionPolicy Bypass -File vm-uninstall-drive.ps1 `
#       -Condition running -TickDeleteAppData
#
# Why this exists rather than a mouse macro. The "Delete the application data"
# checkbox cannot be reached from the command line: `/S` and `/P` both skip the
# confirm page, so `un.ConfirmLeave` never runs and $DeleteAppDataCheckboxState
# stays 0. The ticked path is only reachable through the UI. F8 reached it by
# moving a cursor to coordinates read off a screenshot, which cannot say
# afterwards whether the box was actually ticked - and "did the box go on" is
# the entire premise of every measurement that follows.
#
# So this talks to the controls. It finds the checkbox by its label, sets it,
# reads BM_GETCHECK back, and aborts if the answer is not 1. A run that could
# not tick the box produces no listing at all rather than a listing nobody can
# interpret.
#
# What it records, whether or not it was expected:
#
#   * every top-level window it saw, with the buttons on it;
#   * whether the "<product> is running! / Click OK to kill it" prompt
#     appeared, and its exact text;
#   * the dr-companion.exe and msedgewebview2.exe processes alive at each step,
#     which is what tells a handle race from a logic error.
#
# -Condition says how the app dies before the uninstall runs:
#   closed  - WM_CLOSE to its own window, then wait, the way a person quits
#   running - left running, so the uninstaller's own prompt kills it
#   killed  - taskkill /F, then start the uninstaller straight away
#
# It changes the machine (that is the point) but it asserts before it does.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('closed', 'running', 'killed')][string]$Condition,
  [switch]$TickDeleteAppData,
  # How long to leave the app closed/killed before starting the uninstaller.
  [int]$SettleMs = 0,
  [int]$TimeoutSec = 300
)

$ErrorActionPreference = 'Stop'

$uninstaller = Join-Path $env:LOCALAPPDATA 'DR Companion\uninstall.exe'

function Stamp { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') }
function Say { param([string]$Text) Write-Output ("{0}  {1}" -f (Stamp), $Text) }

function Show-Processes {
  param([string]$When)
  $procs = @(Get-Process -ErrorAction SilentlyContinue)
  if ($procs.Count -eq 0) { throw 'Get-Process returned nothing. The process query is broken.' }
  $watched = @($procs | Where-Object { $_.Name -match 'dr-companion|msedgewebview2' })
  foreach ($p in ($watched | Sort-Object Name, Id)) {
    Say ("PROC {0} {1,-20} pid={2}" -f $When, $p.Name, $p.Id)
  }
  Say ("PROC {0} matching 'dr-companion|msedgewebview2': {1} of {2} processes read" -f $When, $watched.Count, $procs.Count)
}
# Deliberately returns nothing. It used to hand back a count, and every call
# site therefore wrapped it in [void](...) to keep the number out of the
# transcript - which threw away the PROC lines with it. The first run of this
# script recorded no process evidence at all for exactly that reason, in the
# one measurement the process evidence was the point of.

Add-Type -Namespace Drc -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
[DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
public delegate bool EnumProc(IntPtr h, IntPtr p);
public static System.Collections.Generic.List<IntPtr> TopLevel() {
  var found = new System.Collections.Generic.List<IntPtr>();
  EnumWindows(delegate(IntPtr h, IntPtr p) { if (IsWindowVisible(h)) found.Add(h); return true; }, IntPtr.Zero);
  return found;
}
public static System.Collections.Generic.List<IntPtr> Children(IntPtr parent) {
  var found = new System.Collections.Generic.List<IntPtr>();
  EnumChildWindows(parent, delegate(IntPtr h, IntPtr p) { found.Add(h); return true; }, IntPtr.Zero);
  return found;
}
public static string ClassOf(IntPtr h) { var s = new System.Text.StringBuilder(256); GetClassNameW(h, s, 256); return s.ToString(); }
public static string TextOf(IntPtr h) { var s = new System.Text.StringBuilder(1024); GetWindowTextW(h, s, 1024); return s.ToString(); }
'@

$BM_GETCHECK = 0x00F0
$BM_SETCHECK = 0x00F1
$WM_COMMAND = 0x0111
$WM_CLOSE = 0x0010
$IDOK = 1

function Get-DrcWindows {
  $out = @()
  foreach ($h in [Drc.Win]::TopLevel()) {
    $title = [Drc.Win]::TextOf($h)
    $cls = [Drc.Win]::ClassOf($h)
    if ($title -notlike '*DR Companion*' -and $cls -ne '#32770') { continue }
    $kids = @()
    foreach ($c in [Drc.Win]::Children($h)) {
      $kids += [pscustomobject]@{
        Handle = $c
        Class  = [Drc.Win]::ClassOf($c)
        Text   = [Drc.Win]::TextOf($c)
        Id     = [Drc.Win]::GetDlgCtrlID($c)
        Enabled = [Drc.Win]::IsWindowEnabled($c)
      }
    }
    $out += [pscustomobject]@{ Handle = $h; Title = $title; Class = $cls; Children = $kids }
  }
  return $out
}

Say ("== DRC UNINSTALL DRIVE, condition={0}, tick={1} ==" -f $Condition, [bool]$TickDeleteAppData)
Say ("uninstaller: " + $uninstaller)

# This uninstalls things. The developer machine has DR Companion installed at
# exactly the same path as the test VM does, and a stray run of this file there
# would take it off - found the first time this script was compiled, by running
# it on the host to see whether the P/Invoke block built. So it will only run
# where it is meant to.
if ($env:COMPUTERNAME -notlike 'DRC-CLEAN*' -and -not $env:DRC_UNINSTALL_DRIVE_ANYWHERE) {
  throw ("Refusing to run on '$env:COMPUTERNAME'. This drives a real uninstall and belongs on the clean VM " +
         "(DRC-CLEAN*). Set DRC_UNINSTALL_DRIVE_ANYWHERE=1 if you genuinely mean to uninstall here.")
}
if (-not (Test-Path -LiteralPath $uninstaller)) {
  throw "No uninstaller at $uninstaller. Nothing was driven and nothing below would mean anything."
}

# --- how the app dies -------------------------------------------------------
Show-Processes -When 'at-start'
switch ($Condition) {
  'closed' {
    $windows = @(Get-DrcWindows | Where-Object { $_.Title -eq 'DR Companion' })
    if ($windows.Count -eq 0) {
      throw "Condition 'closed' needs the app running with its own window, and no window titled 'DR Companion' was found."
    }
    foreach ($w in $windows) {
      Say ("closing the app window by WM_CLOSE, handle=" + $w.Handle)
      [void][Drc.Win]::PostMessageW($w.Handle, $WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
    }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and @(Get-Process -Name 'dr-companion' -ErrorAction SilentlyContinue).Count -gt 0) {
      Start-Sleep -Milliseconds 250
    }
    Say ('app process count after WM_CLOSE: ' + @(Get-Process -Name 'dr-companion' -ErrorAction SilentlyContinue).Count)
  }
  'running' {
    if (@(Get-Process -Name 'dr-companion' -ErrorAction SilentlyContinue).Count -eq 0) {
      throw "Condition 'running' needs the app running, and no dr-companion process is alive."
    }
    Say 'leaving the app running; the uninstaller is expected to prompt'
  }
  'killed' {
    if (@(Get-Process -Name 'dr-companion' -ErrorAction SilentlyContinue).Count -eq 0) {
      throw "Condition 'killed' needs the app running to kill."
    }
    Say 'taskkill /IM dr-companion.exe /F'
    & taskkill.exe /IM dr-companion.exe /F | ForEach-Object { Say ('taskkill: ' + $_) }
  }
}
if ($SettleMs -gt 0) {
  Say ("settling for {0} ms" -f $SettleMs)
  Start-Sleep -Milliseconds $SettleMs
}
Show-Processes -When 'before-uninstall'

# --- run it -----------------------------------------------------------------
Say 'starting the uninstaller'
$started = Start-Process -FilePath $uninstaller -PassThru
Say ('uninstall.exe pid=' + $started.Id + ' (NSIS relaunches itself from $TEMP, so this pid exits early)')

$sawConfirm = $false
$clickedDetails = $false
$closeHandle = [IntPtr]::Zero
$tickedOk = $false
$sawRunningPrompt = $false
$runningPromptText = ''
$clickedOk = $false
$sawFinish = $false
$seenTitles = New-Object System.Collections.Generic.HashSet[string]
$deadline = (Get-Date).AddSeconds($TimeoutSec)

while ((Get-Date) -lt $deadline) {
  foreach ($w in Get-DrcWindows) {
    $key = $w.Class + ' | ' + $w.Title
    if ($seenTitles.Add($key)) {
      Say ("WINDOW {0}" -f $key)
      foreach ($c in $w.Children) {
        if ($c.Class -match 'Button|Static' -and $c.Text) {
          Say ("  CTRL {0,-8} id={1,-6} enabled={2,-5} '{3}'" -f $c.Class, $c.Id, $c.Enabled, ($c.Text -replace "`r?`n", ' / '))
        }
      }
    }

    $texts = ($w.Children | ForEach-Object { $_.Text }) -join ' | '

    # The kill prompt. Its exact wording is English.nsh's appRunningOkKill.
    if (-not $clickedOk -and $texts -match 'is running') {
      $sawRunningPrompt = $true
      $runningPromptText = (($w.Children | Where-Object { $_.Class -eq 'Static' -and $_.Text -match 'is running' } | Select-Object -First 1).Text)
      Say ("RUNNING PROMPT: '" + ($runningPromptText -replace "`r?`n", ' / ') + "'")
      Show-Processes -When 'at-prompt'
      $ok = $w.Children | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq $IDOK } | Select-Object -First 1
      if ($null -eq $ok) { throw 'The running prompt has no OK button with id 1.' }
      Say 'clicking OK to kill'
      [void][Drc.Win]::PostMessageW($w.Handle, $WM_COMMAND, [IntPtr]$IDOK, $ok.Handle)
      $clickedOk = $true
      continue
    }

    $checkbox = $w.Children | Where-Object { $_.Class -eq 'Button' -and $_.Text -like '*Delete the application data*' } | Select-Object -First 1
    if (-not $sawConfirm -and $null -ne $checkbox) {
      $sawConfirm = $true
      Say 'confirm page is up, and it has the delete-app-data checkbox'
      if ($TickDeleteAppData) {
        [void][Drc.Win]::SendMessageW($checkbox.Handle, $BM_SETCHECK, [IntPtr]1, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 200
        $state = [Drc.Win]::SendMessageW($checkbox.Handle, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero)
        Say ('BM_GETCHECK reads back ' + $state)
        # The assertion this whole script exists for. A run that could not tick
        # the box must not go on to produce a listing.
        if ([int]$state -ne 1) { throw "The checkbox did not take the tick (BM_GETCHECK=$state). Refusing to uninstall." }
        $tickedOk = $true
      } else {
        $state = [Drc.Win]::SendMessageW($checkbox.Handle, $BM_GETCHECK, [IntPtr]::Zero, [IntPtr]::Zero)
        Say ('leaving the checkbox alone; BM_GETCHECK reads ' + $state)
        if ([int]$state -ne 0) { throw "The checkbox was already ticked (BM_GETCHECK=$state) on an unticked run." }
      }
      Start-Sleep -Milliseconds 300
      Say 'clicking Uninstall'
      [void][Drc.Win]::PostMessageW($w.Handle, $WM_COMMAND, [IntPtr]$IDOK, [IntPtr]::Zero)
      continue
    }

    # The details pane, so DetailPrint output is on screen for a screenshot.
    # Once only: the button stays reachable after it has been clicked.
    $details = $w.Children | Where-Object { $_.Class -eq 'Button' -and $_.Text -like '*details*' } | Select-Object -First 1
    if (-not $clickedDetails -and $null -ne $details -and $details.Enabled) {
      Say 'clicking Show details'
      [void][Drc.Win]::PostMessageW($w.Handle, $WM_COMMAND, [IntPtr]$details.Id, $details.Handle)
      $clickedDetails = $true
      Start-Sleep -Milliseconds 300
    }

    # Finished: the Next button has become Close and is enabled again.
    $close = $w.Children | Where-Object { $_.Class -eq 'Button' -and $_.Id -eq $IDOK -and $_.Text -like '*Close*' -and $_.Enabled } | Select-Object -First 1
    if ($sawConfirm -and $null -ne $close) {
      $sawFinish = $true
      Say 'uninstall finished; the button now reads Close'
      $closeHandle = $w.Handle
      break
    }
  }
  if ($sawFinish) { break }
  Start-Sleep -Milliseconds 250
}

Show-Processes -When 'at-finish'

# Let it go, so the next run does not find a stale uninstaller window. Done
# after the process snapshot above, which is the one that matters.
if ($sawFinish -and $closeHandle -ne [IntPtr]::Zero) {
  Start-Sleep -Milliseconds 1500
  [void][Drc.Win]::PostMessageW($closeHandle, $WM_COMMAND, [IntPtr]$IDOK, [IntPtr]::Zero)
}

Say ("RESULT confirm-page={0} ticked={1} running-prompt={2} clicked-ok={3} finished={4}" -f `
  $sawConfirm, $tickedOk, $sawRunningPrompt, $clickedOk, $sawFinish)
Say ("RESULT running-prompt-text='" + ($runningPromptText -replace "`r?`n", ' / ') + "'")

# A run that never reached the confirm page drove nothing at all, and saying so
# here is the difference between "the uninstall left nothing" and "no uninstall
# happened".
if (-not $sawConfirm) { throw 'Never saw the confirm page. Nothing was driven.' }
if (-not $sawFinish) { throw "The uninstall did not reach a Close button within $TimeoutSec s." }
Say '== END DRC UNINSTALL DRIVE =='
