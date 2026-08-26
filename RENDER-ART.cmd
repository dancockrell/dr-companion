@echo off
REM Renders the art pack until it is finished.
REM
REM Leave this window open. Closing it stops the run; starting it again picks
REM up where it left off, because every finished image is recorded as it is
REM made rather than at the end.
REM
REM It needs ComfyUI running on 8188. If ComfyUI is closed, this waits rather
REM than giving up, so it is safe to shut ComfyUI down to play a game and come
REM back to it later.
cd /d "%~dp0"
node tools\art-loop.mjs
pause
