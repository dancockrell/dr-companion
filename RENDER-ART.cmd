@echo off
REM Superseded by ART.cmd, which runs the daemon.
REM
REM This used to launch a one-shot batch renderer that had to be watched and
REM restarted. The daemon does the same work without anyone in the loop: it
REM waits for ComfyUI rather than exiting, scores its own output, and keeps
REM going after the pack is full by improving the weakest art in it.
REM
REM Kept as a pointer rather than deleted, because it is in muscle memory.
cd /d "%~dp0"
echo RENDER-ART is now ART.cmd. Starting the daemon.
node tools\art-daemon.mjs %*
