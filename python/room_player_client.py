"""Drive the headless Godot room player from Python.

One long-lived engine, started once, reused, and killed by the exact pid this
module started. That is not a style preference: a Godot-driven crash has taken
this machine down and killed every running session, several sessions run their
own Godot at once here, and a launch-per-room loop is the shape that causes
both. `RoomPlayer.stop()` sends `taskkill /PID <the one we spawned>` and never
touches an image name.

Usage:

    from room_player_client import RoomPlayer, find_godot

    godot = find_godot()                 # None if there is no engine: a real
    if godot is None: ...                # third state, not a pass and not a fail
    with RoomPlayer(godot) as player:
        report = player.compose(scene_dict)

`scene_dict` is exactly `forge.compose.Scene.to_dict()`. What comes back is
`RoomComposer.report()` - a description of the node tree Godot actually built,
walked out of the tree, not an echo of what was asked for.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GODOT_PROJECT = REPO / "godot"

#: Not 11024. A live DragonRealms session runs there, owned by another process
#: on this machine, and connecting to it would be an intrusion into somebody
#: else's game. The server refuses that port too, on its own side.
DEFAULT_PORT = 11731

#: Where a Godot tends to be on this machine, plus whatever `GODOT4` names.
#: The same list `tools/godot-tests.mjs` uses, in the same order, because two
#: answers to "is there an engine here" would drift.
_CANDIDATES = (
    r"C:\Users\Admin\dev\tools\godot\bin\Godot_v4.3-stable_win64_console.exe",
    r"C:\Users\Admin\dev\tools\godot\bin\Godot_v4.3-stable_win64.exe",
    r"C:\Users\Admin\AppData\Local\Programs\Godot\Godot_v4.7.2-stable_mono_win64"
    r"\Godot_v4.7.2-stable_mono_win64.exe",
    "godot",
)


class RoomPlayerError(RuntimeError):
    pass


def find_godot() -> str | None:
    """The first candidate that runs, or None.

    `--version` rather than a filesystem check: a path that exists and cannot
    execute is the same absence with more steps.

    No version gate here, unlike `tools/godot-tests.mjs`. That gate exists
    because the `godot/tests` suite is written for the engine the project
    declares; the room player is deliberately 4.3-compatible and is run on both
    engines on purpose, so refusing 4.7 here would refuse a run that is part of
    the point.
    """
    explicit = os.environ.get("GODOT4")
    for candidate in ([explicit] if explicit else list(_CANDIDATES)):
        try:
            done = subprocess.run(
                [candidate, "--version"],
                capture_output=True, text=True, timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if done.returncode == 0 and done.stdout.strip():
            return candidate
    return None


def godot_version(binary: str) -> str:
    done = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=30)
    return done.stdout.strip().splitlines()[0] if done.stdout.strip() else "?"


class RoomPlayer:
    """A running headless Godot with the room server in it."""

    def __init__(
        self,
        godot: str,
        port: int = DEFAULT_PORT,
        project: Path | str = GODOT_PROJECT,
        start_timeout: float = 60.0,
    ) -> None:
        self.godot = godot
        self.port = port
        self.project = Path(project)
        self.start_timeout = start_timeout
        self.process: subprocess.Popen | None = None
        self._sock: socket.socket | None = None
        self._rx = b""
        self._log_lines: list[str] = []
        self._pump: threading.Thread | None = None

    @property
    def startup_output(self) -> str:
        """Everything Godot has said so far.

        Collected by a thread rather than read at the end, and that is a fix
        rather than a nicety. Measured: with the child's stdout left undrained,
        Godot printed its banner and then never reached the line where it
        binds the port - the client waited the full 60s and reported "nothing
        was listening", while the byte-identical command run by hand (with its
        output being read) listened instantly. Whatever the console
        wrapper does with a pipe nobody is reading, the symptom looks exactly
        like a server that failed to start, which is the most misleading
        possible disguise for a client-side bug.
        """
        return "".join(self._log_lines)

    # -- lifecycle --------------------------------------------------------

    def start(self) -> "RoomPlayer":
        if self.port == 11024:
            raise RoomPlayerError("port 11024 is the live game bridge; pick another")
        # The port goes in the environment, not in `-- --port=N`. Exactly one
        # script under `godot/scripts` is allowed to read the command line
        # (`room_scene.gd`, which owns the live/mock launch mode), and
        # `src-tauri/src/viewer.rs` has a test that fails if a second one does.
        env = dict(os.environ)
        env["DRC_ROOM_PORT"] = str(self.port)
        self.process = subprocess.Popen(
            [
                self.godot, "--headless",
                "--path", str(self.project),
                "--script", "res://scripts/room_server.gd",
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self._pump = threading.Thread(target=self._drain, daemon=True)
        self._pump.start()

        deadline = time.monotonic() + self.start_timeout
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                time.sleep(0.2)  # let the drain thread finish the last lines
                raise RoomPlayerError(
                    f"Godot exited {self.process.returncode} before serving:\n{self.startup_output}"
                )
            try:
                sock = socket.create_connection(("127.0.0.1", self.port), timeout=5.0)
            except OSError:
                time.sleep(0.15)
                continue
            sock.settimeout(60.0)
            self._sock = sock
            return self
        self.stop()
        raise RoomPlayerError(
            f"nothing was listening on 127.0.0.1:{self.port} after {self.start_timeout}s"
            f"\nGodot said:\n{self.startup_output}"
        )

    def _drain(self) -> None:
        stream = self.process.stdout if self.process else None
        if stream is None:
            return
        try:
            for line in stream:
                self._log_lines.append(line)
        except (ValueError, OSError):
            pass

    def stop(self) -> None:
        """Close the socket, then kill the exact pid this object spawned."""
        if self._sock is not None:
            try:
                self._request({"cmd": "shutdown"}, timeout=5.0)
            except Exception:
                pass
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        proc = self.process
        self.process = None
        if proc is None:
            return
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            # By pid. Never by image name: other sessions are running their own
            # Godot under the identical binary name right now.
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                    capture_output=True,
                )
            else:
                proc.kill()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        if self._pump is not None:
            self._pump.join(timeout=5)
            self._pump = None
        if proc.stdout is not None:
            try:
                proc.stdout.close()
            except OSError:
                pass

    def __enter__(self) -> "RoomPlayer":
        return self.start()

    def __exit__(self, *_exc) -> None:
        self.stop()

    # -- protocol ---------------------------------------------------------

    def _request(self, payload: dict, timeout: float = 60.0) -> dict:
        if self._sock is None:
            raise RoomPlayerError("not connected")
        self._sock.settimeout(timeout)
        self._sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        while b"\n" not in self._rx:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise RoomPlayerError("server closed the connection without replying")
            self._rx += chunk
        line, self._rx = self._rx.split(b"\n", 1)
        return json.loads(line.decode("utf-8"))

    def ping(self) -> dict:
        return self._request({"cmd": "ping"})

    def compose(self, scene: dict) -> dict:
        """Compose one scene and return the whole reply envelope.

        The envelope, not just `report`, because `project` in it is how a
        caller proves which checkout actually did the work - which matters the
        moment a test runs against a sabotaged copy of the tree.
        """
        reply = self._request({"cmd": "compose", "scene": scene})
        if not reply.get("ok"):
            raise RoomPlayerError(f"compose refused: {reply.get('error')}")
        return reply

    def render(self, scene: dict) -> dict:
        """Ask for a PNG. Headless has no renderer, so this reports why rather
        than pretending; the reply is the honest third state, not an error to
        be retried."""
        return self._request({"cmd": "render", "scene": scene})
