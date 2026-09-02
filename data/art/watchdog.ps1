$ErrorActionPreference = 'Stop'
$art = 'C:\Users\Admin\dev\dr-companion\data\art'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
# Local generation (ComfyUI, any local checkpoint -- FLUX/schnell, DreamShaper,
# whatever else) is retired from this watchdog on purpose, not an oversight:
# generation goes through Magnific exclusively now. Start-Comfy and the old
# Start-Daemon (which drove tools/art-daemon.mjs) are gone.
#
# What this watchdog polled next -- tools/frame-factory-requests.js -- lived
# in the quartermaster repo, which was deleted entirely (both locally and on
# GitHub) on 2 Sep 2026. Nothing here currently drives any part of the
# Magnific pipeline unattended as a result: this script logs one line and
# exits rather than looping against a path that no longer exists. Whatever
# replaces this (a re-hosted requests watcher, a different tool) needs a new
# $requestsScript/$requestsCwd pointed at wherever it actually lives.
Add-Content "$art\watchdog.log" "$(Get-Date -Format o) watchdog.ps1: no automated art-pipeline step configured (quartermaster, which hosted frame-factory-requests.js, was deleted 2 Sep 2026) -- exiting"
exit 0


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

# No Run-RequestsWatcher / polling loop here anymore -- see the exit 0 near
# the top of this file for why. Start-Hidden above is the reusable part;
# whatever gets scheduled next (a re-hosted requests watcher, a browser-
# automation agent for a signed-in Magnific session) calls it the same way
# Start-Comfy/Start-Daemon used to.
