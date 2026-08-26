@echo off
REM Turn the art daemon on. Close the window to stop it, or run: ART.cmd stop
REM
REM It renders candidates, scores them off their own pixels, keeps the best and
REM deletes the rest. When nothing is missing it goes back to the weakest art
REM in the pack instead of stopping, so there is always work.
REM
REM ComfyUI going away is a wait, not an error. Close ComfyUI to play a game
REM and this costs the one image in flight; it picks up when ComfyUI returns.
cd /d "%~dp0"
if "%1"=="" (
  echo Starting the art daemon. Close this window to stop it.
  node tools\art-daemon.mjs
) else (
  node tools\art-daemon.mjs %*
)
