$ErrorActionPreference = 'Stop'
$art = 'C:\Users\Admin\dev\dr-companion\data\art'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
# Local generation (ComfyUI, any local checkpoint -- FLUX/schnell, DreamShaper,
# whatever else) is retired from this watchdog on purpose, not an oversight:
# generation goes through Magnific exclusively now. Start-Comfy and the old
# Start-Daemon (which drove tools/art-daemon.mjs, then briefly its
# quartermaster port) are gone. What this watchdog supervises instead is
# tools/frame-factory-requests.js -- the one piece of the Magnific pipeline
# that involves no generation at all, so it is safe to run unattended: it
# only reads open GitHub issues for a magnific-frame-factory block and
# compiles it into a job file under var/frame-factory-queue. Everything past
# that -- a signed-in Magnific browser actually generating something,
# harvesting frames, curating -- is still an agent/human driving
# frame-factory-job.js and frame-factory-harvest.js by hand, per this
# repo's own README: there is no token and no browser-automation agent for
# that step yet, and claiming otherwise is exactly the "job file exists, so
# it must have worked" gap this whole pipeline exists to close.
$requestsScript = 'C:\Users\Admin\dev\quartermaster\tools\frame-factory-requests.js'
$requestsCwd = 'C:\Users\Admin\dev\quartermaster'


# Currently unused by this file -- frame-factory-requests.js runs to
# completion every poll rather than staying up as a supervised process, so
# nothing here needs a hidden long-lived child right now. Left in place: the
# moment a browser-automation agent for a signed-in Magnific session exists,
# it will need exactly this (a long-lived hidden process this watchdog
# restarts if it dies), and the bug below cost real time to find once
# already.
#
# issue #50: `Start-Process -WindowStyle Hidden` does nothing here, and it
# never did. .NET's ProcessStartInfo only honours WindowStyle when
# UseShellExecute is true, and Start-Process silently forces
# UseShellExecute=false the moment -RedirectStandardOutput/-RedirectStandardError
# are given (confirmed against the real ProcessStartInfo object, not assumed
# from the docs alone) - which both spawns below already did, for the
# manual.log files. So every restart of either worker span a fresh, visible
# console, on a schedule this watchdog controls but a flag that looked right
# could not fix, because the flag was never live in this configuration.
#
# The actual switch that survives redirected output is CreateNoWindow on a
# raw System.Diagnostics.Process/ProcessStartInfo - Start-Process has no
# parameter for it, so this drops to the object underneath the cmdlet
# instead of the cmdlet itself.
function Start-Hidden($FilePath, [string[]]$Arguments, $WorkingDirectory, $StdOutLog, $StdErrLog) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  # ProcessStartInfo.Arguments is one shell-escaped string on this .NET
  # (Windows PowerShell 5.1 runs on .NET Framework, which predates
  # ArgumentList) - quoted per argument rather than joined with bare spaces,
  # so a future path containing one does not silently split into two argv
  # entries the way the naive join would.
  $psi.Arguments = ($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $p.EnableRaisingEvents = $true
  $p.Start() | Out-Null

  # Piped by hand rather than left to Start-Process's own -RedirectStandardOutput
  # file redirection, which came for free with the cmdlet and is gone now that
  # the cmdlet is. Register-ObjectEvent rather than the C#-style `+=`/
  # `add_OutputDataReceived` PowerShell exposes on the event: tried that route
  # first and it silently delivered nothing - measured, not assumed, with a
  # `cmd /c echo` child that should have produced one line and produced none.
  # Register-ObjectEvent goes through PowerShell's own event queue instead of
  # a raw delegate conversion and was verified against the same case to
  # actually write the line. Async either way, so a slow-writing child cannot
  # block this script the way a synchronous ReadToEnd would.
  #
  # Named per PID and unregistered on Exited so a worker that dies and gets
  # restarted every 30 seconds for hours does not leave its old subscriptions
  # behind - PowerShell's event queue does not garbage-collect these on its
  # own just because the process object is unreferenced.
  Register-ObjectEvent -InputObject $p -EventName OutputDataReceived `
    -SourceIdentifier "art-watchdog-stdout-$($p.Id)" -MessageData $StdOutLog -Action {
      if ($EventArgs.Data -ne $null) { Add-Content -Path $Event.MessageData -Value $EventArgs.Data }
    } | Out-Null
  Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived `
    -SourceIdentifier "art-watchdog-stderr-$($p.Id)" -MessageData $StdErrLog -Action {
      if ($EventArgs.Data -ne $null) { Add-Content -Path $Event.MessageData -Value $EventArgs.Data }
    } | Out-Null
  Register-ObjectEvent -InputObject $p -EventName Exited `
    -SourceIdentifier "art-watchdog-exited-$($p.Id)" -Action {
      Unregister-Event -SourceIdentifier "art-watchdog-stdout-$($Event.Sender.Id)" -ErrorAction SilentlyContinue
      Unregister-Event -SourceIdentifier "art-watchdog-stderr-$($Event.Sender.Id)" -ErrorAction SilentlyContinue
      Unregister-Event -SourceIdentifier $Event.SourceIdentifier -ErrorAction SilentlyContinue
    } | Out-Null

  $p.BeginOutputReadLine()
  $p.BeginErrorReadLine()

  return $p
}

function Run-RequestsWatcher {
  # Not started-and-supervised like the old Comfy/daemon processes: this
  # exits on its own every run (it is a poll, not a loop), so it is simply
  # invoked on an interval rather than watched for staying alive.
  & $nodeExe $requestsScript *>> "$art\frame-factory-requests.log"
}

Add-Content "$art\watchdog.log" "$(Get-Date -Format o) watchdog starting (frame-factory-requests polling only -- no local generation)"

while ($true) {
  Add-Content "$art\watchdog.log" "$(Get-Date -Format o) polling frame-factory-requests"
  Push-Location $requestsCwd
  try { Run-RequestsWatcher }
  catch { Add-Content "$art\watchdog.log" "$(Get-Date -Format o) frame-factory-requests failed: $_" }
  finally { Pop-Location }
  Start-Sleep -Seconds 300
}
