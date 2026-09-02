$ErrorActionPreference = 'Stop'
$art = 'C:\Users\Admin\dev\dr-companion\data\art'
$comfyDir = 'C:\Users\Admin\AppData\Local\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI'
$comfyPy = 'C:\Users\Admin\dev\dr-companion\data\art\comfy-venv\Scripts\python.exe'
$nodeExe = 'C:\Program Files\nodejs\node.exe'
# tools/art-daemon.mjs was ported to quartermaster (src/art/), verified
# with a real parity gate against this exact JS on the real corpus/manifest
# before the switch -- see quartermaster's commit history for
# src/art/safety.rs, eval.rs, daemon.rs, render.rs. `qm art-daemon` is a
# drop-in replacement for `node tools/art-daemon.mjs` with no arguments.
$qmExe = 'C:\Users\Admin\dev\quartermaster\target\release\qm.exe'


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

function Start-Comfy {
  # --gpu-only added 28 Aug 2026 switching to DreamShaper (SD1.5, 859M params):
  # every render log line showed the model being re-staged from CPU, dynamic
  # VRAM offload tuned for FLUX's much bigger footprint. SD1.5 fits 12GB VRAM
  # with room to spare, so there's no reason to be paging it in and out.
  # Not named $args: that is PowerShell's own automatic variable for a
  # function's unbound positional parameters, and shadowing it here would
  # still work by accident but reads as a bug waiting to bite the next edit.
  $comfyArgs = @(
    'main.py',
    '--extra-model-paths-config', "$art\comfy-extra-model-paths.yaml",
    '--output-directory', "$art\out",
    '--input-directory', 'C:\Users\Admin\AppData\Local\Comfy-Desktop\ComfyUI-Shared\input',
    '--gpu-only'
  )
  $p = Start-Hidden $comfyPy $comfyArgs $comfyDir "$art\comfy-manual.log" "$art\comfy-manual-err.log"
  $p.Id | Out-File "$art\comfy-manual.pid"
  return $p
}

function Start-Daemon {
  Remove-Item "$art\daemon.lock" -ErrorAction SilentlyContinue
  $p = Start-Hidden $qmExe @('art-daemon') 'C:\Users\Admin\dev\dr-companion' "$art\daemon-manual.log" "$art\daemon-manual-err.log"
  $p.Id | Out-File "$art\daemon-manual.pid"
  return $p
}

Add-Content "$art\watchdog.log" "$(Get-Date -Format o) watchdog starting"

$comfy = Start-Comfy
$daemon = Start-Daemon

while ($true) {
  Start-Sleep -Seconds 30
  $comfyAlive = Get-Process -Id $comfy.Id -ErrorAction SilentlyContinue
  $daemonAlive = Get-Process -Id $daemon.Id -ErrorAction SilentlyContinue
  if (-not $comfyAlive) {
    Add-Content "$art\watchdog.log" "$(Get-Date -Format o) comfy (pid $($comfy.Id)) died, restarting"
    $comfy = Start-Comfy
    Start-Sleep -Seconds 20
  }
  if (-not $daemonAlive) {
    Add-Content "$art\watchdog.log" "$(Get-Date -Format o) daemon (pid $($daemon.Id)) died, restarting"
    $daemon = Start-Daemon
  }
}
