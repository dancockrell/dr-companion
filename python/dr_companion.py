"""The Python side of the scripting API decided in docs/ENGINE.md.

Talks to the app over the loopback socket `src-tauri/src/script_api.rs`
starts on every launch: newline-delimited JSON, authenticated by a token the
app writes beside its own data on startup. This library exists so nobody
writing a script has to know that - it finds the port and token, connects,
and turns each incoming JSON line into a callback.

Pure standard library, on purpose. `pip install` is a step between a script
idea and running it, and the whole reason a scripting layer exists is to
lower that distance. `python your_script.py` should be the entire setup.

# What a line looks like right now, and the gap that is not hidden

A script receives the same wire text this app's own frontend receives before
its TypeScript parser (`src/lib/gameStream.ts`) turns it into clean lines with
a channel and a bold flag. That parser is hardened by several rounds of
finding real bugs in it - a tag split across two reads, a literal `<` in game
text capturing a real `</popStream>` - and porting it to Python untested
against the same cases would risk a second, quietly different parser rather
than closing a known gap. So `Line.text` can contain markup like
`<pushStream id='thoughts'/>` today. See docs/PYTHON_API.md for the fuller
version of this note and where the gap is tracked.

# Example

    from dr_companion import Companion

    c = Companion()

    @c.on_line
    def watch(line):
        if "you are stunned" in line.text.lower():
            c.send("stand")

    c.run()
"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional


class ConnectionError(Exception):
    """Could not reach the app, or it refused the token."""


class NotConnected(Exception):
    """A method that needs a live socket was called without one."""


@dataclass(frozen=True)
class Line:
    """One chunk of game text. `seq` is stable and increasing; `text` is not
    guaranteed to be one visual line - see the module note on markup."""

    seq: int
    text: str


@dataclass(frozen=True)
class Status:
    """The app's own connection to Lich, as of the last time it was asked or
    the last time it changed - not necessarily this instant. `connected`
    turning `False` mid-script means Lich hung up; it does not mean this
    library disconnected the script."""

    connected: bool
    host: str
    port: int
    lines: int
    note: str


def _data_dir() -> Path:
    """Where the app keeps `script-api.token` and `script-api.port`.

    Mirrors `setup::app_data_dir()` in the Rust side exactly - `%LOCALAPPDATA%`
    joined with the same folder name. If that environment variable is ever
    absent (it is not, on any Windows this app supports), this raises rather
    than guessing a folder the app never wrote to, which would produce a
    confusing "token not found" instead of an honest "cannot locate app data".
    """
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise ConnectionError(
            "LOCALAPPDATA is not set - cannot find where DR Companion keeps its data. "
            "Pass host/port/token to Companion() explicitly instead."
        )
    return Path(local_app_data) / "DR Companion Data"


def _read_connection_info(data_dir: Path) -> tuple[int, str]:
    port_file = data_dir / "script-api.port"
    token_file = data_dir / "script-api.token"

    if not port_file.exists() or not token_file.exists():
        raise ConnectionError(
            f"No script API files found in {data_dir}. Is DR Companion running? "
            "It writes these on startup."
        )

    port_text = port_file.read_text(encoding="utf-8").strip()
    if not port_text.isdigit():
        raise ConnectionError(f"{port_file} does not contain a port number: {port_text!r}")

    token = token_file.read_text(encoding="utf-8").strip()
    if not token:
        raise ConnectionError(f"{token_file} is empty")

    return int(port_text), token


class Companion:
    """One connection to the app, and the callbacks a script hangs off it.

    Not thread-safe to call `send()` from inside an `on_line` callback and
    also from another thread without your own lock - the underlying socket
    write is not synchronised, on the theory that a script is single-threaded
    unless it deliberately isn't, and adding a lock for a case that mostly
    does not happen would tax every script for the rare one that needs it.
    """

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: Optional[int] = None,
        token: Optional[str] = None,
        connect_timeout: float = 5.0,
    ) -> None:
        if port is None or token is None:
            found_port, found_token = _read_connection_info(_data_dir())
            port = port if port is not None else found_port
            token = token if token is not None else found_token

        self._host = host
        self._port = port
        self._token = token
        self._sock: Optional[socket.socket] = None
        self._buf = b""
        self._line_handlers: list[Callable[[Line], None]] = []
        self._state_handlers: list[Callable[[Status], None]] = []
        self._connect_timeout = connect_timeout
        self._stopped = threading.Event()

    # -- connecting -----------------------------------------------------

    def connect(self) -> None:
        """Open the socket and authenticate. Raises `ConnectionError` on
        anything short of success - there is no partially-connected state a
        caller needs to check for."""
        try:
            sock = socket.create_connection(
                (self._host, self._port), timeout=self._connect_timeout
            )
        except OSError as e:
            # A stale port file and a live one are the same file.
            #
            # The port and token are rewritten every time DR Companion starts,
            # and the files survive it closing - so pointing at a port nothing
            # is listening on is the *normal* failure here, not an exotic one.
            # Unhandled, it surfaced as `ConnectionRefusedError: [WinError
            # 10061] No connection could be made because the target machine
            # actively refused it`, ten frames deep, naming a port number the
            # reader never chose and saying nothing about the app.
            #
            # Hit while writing the first task on top of this library: the app
            # had been closed, the file still held its last port, and the error
            # gave no hint that "start DR Companion" was the whole fix.
            raise ConnectionError(
                f"Nothing is listening on {self._host}:{self._port}.\n"
                f"  That port came from {_data_dir() / 'script-api.port'}, which DR "
                "Companion rewrites every time it starts and leaves behind when it "
                "closes.\n"
                "  So this almost always means the app is not running. Start DR "
                "Companion and try again.\n"
                f"  (underlying error: {e})"
            ) from e

        sock.settimeout(self._connect_timeout)
        self._sock = sock

        hello = self._read_message()
        if hello is None or hello.get("type") != "hello":
            self.close()
            raise ConnectionError(f"expected a hello frame, got {hello!r}")

        self._write_message({"type": "auth", "token": self._token})
        reply = self._read_message()
        if reply is None or reply.get("type") != "auth_ok":
            self.close()
            raise ConnectionError(
                "the app refused this token. If DR Companion was restarted, "
                "its token changed - reread it rather than reusing an old one."
            )

        # No more timeout once authenticated: a script legitimately waits
        # quietly for a long time, and a socket timeout would turn "nothing
        # happened yet" into a spurious exception.
        sock.settimeout(None)

    def close(self) -> None:
        self._stopped.set()
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None

    # -- sending ----------------------------------------------------------

    def send(self, command: str) -> None:
        """Send a command exactly as typed - no aliasing, no interpretation,
        matching the Rust side's own `game_send`."""
        if self._sock is None:
            self.connect()
        self._write_message({"type": "send", "command": command})

    def status(self) -> Status:
        """Ask once, rather than waiting for the next state broadcast.
        Blocks briefly for the reply; a script that wants continuous updates
        should use `on_state` instead.

        Connects first if `connect()` was not already called - found by
        actually running the example script rather than by inspection: it
        called `status()` before `run()` had a chance to connect, and got a
        `NotConnected` that a docstring cannot fix. `run()` already tolerated
        this; `send()` and `status()` now match it, so a script can call any
        of the three first without needing to know one of them is special.
        """
        if self._sock is None:
            self.connect()
        self._write_message({"type": "status"})
        while True:
            msg = self._read_message()
            if msg is None:
                raise ConnectionError("connection closed while waiting for status")
            if msg.get("type") == "state":
                return _status_from(msg)
            # Anything else (e.g. a line that arrived first) goes through the
            # normal dispatch so it is not silently dropped just because this
            # call was waiting for something else.
            self._dispatch(msg)

    # -- callbacks ----------------------------------------------------------

    def on_line(self, fn: Callable[[Line], None]) -> Callable[[Line], None]:
        """Usable as a decorator or a plain call. Multiple handlers may be
        registered; each sees every line, in registration order."""
        self._line_handlers.append(fn)
        return fn

    def on_state(self, fn: Callable[[Status], None]) -> Callable[[Status], None]:
        self._state_handlers.append(fn)
        return fn

    # -- the loop ----------------------------------------------------------

    def run(self) -> None:
        """Connect if not already connected, then read forever, dispatching
        to callbacks, until the connection closes or `stop()` is called from
        another thread (e.g. a handler running in a background thread, or a
        signal handler)."""
        if self._sock is None:
            self.connect()

        while not self._stopped.is_set():
            msg = self._read_message()
            if msg is None:
                break
            self._dispatch(msg)

    def stop(self) -> None:
        self._stopped.set()

    def _dispatch(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "line":
            line = Line(seq=msg.get("seq", 0), text=msg.get("text", ""))
            for fn in self._line_handlers:
                fn(line)
        elif kind == "state":
            status = _status_from(msg)
            for fn in self._state_handlers:
                fn(status)
        elif kind == "error":
            # Surfaced rather than swallowed. A script that sends a malformed
            # request deserves to see why nothing happened, not a silent gap.
            print(f"dr_companion: the app reported an error: {msg.get('message')}")
        # Unknown message types are ignored rather than raising, so a future
        # message kind this version of the library does not know about does
        # not crash an already-running script.

    # -- wire framing --------------------------------------------------

    def _write_message(self, obj: dict) -> None:
        if self._sock is None:
            raise NotConnected("call connect() first")
        line = json.dumps(obj) + "\n"
        self._sock.sendall(line.encode("utf-8"))

    def _read_message(self) -> Optional[dict]:
        """One JSON object, or `None` on a clean close.

        Buffers across `recv()` calls because a message and the start of the
        next one can arrive in the same packet, or one message can be split
        across two - the same reason `game_link.rs` reads bytes rather than
        trusting a socket to hand back exactly one line at a time.
        """
        if self._sock is None:
            raise NotConnected("call connect() first")

        while b"\n" not in self._buf:
            chunk = self._sock.recv(4096)
            if not chunk:
                return None
            self._buf += chunk

        line, self._buf = self._buf.split(b"\n", 1)
        text = line.decode("utf-8", errors="replace").strip()
        if not text:
            return self._read_message()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # The app is trusted to send well-formed JSON; if this ever
            # fires, something upstream broke and the honest response is to
            # say so rather than skip the line and continue on bad data.
            raise ConnectionError(f"could not parse a message from the app: {text!r}")


def _status_from(msg: dict) -> Status:
    return Status(
        connected=bool(msg.get("connected", False)),
        host=msg.get("host", ""),
        port=int(msg.get("port", 0)),
        lines=int(msg.get("lines", 0)),
        note=msg.get("note", ""),
    )
