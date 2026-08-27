"""dr_companion.py against the real app, not a stand-in for it.

Everything below connects to a genuinely running DR Companion - reading its
actual `script-api.port`/`script-api.token` files, the same way any real
script would, rather than a mock server that only proves the two sides agree
with themselves. `game_link.rs`'s own tests use a bare TcpListener standing in
for Lich, which is the right call there because Lich is not this project's
code to run in a test; the script API is, and the app was already open when
this was written, so there is no excuse for testing anything less than the
real thing.

Skips loudly rather than passing quietly when the app is not running - see
`_require_running_app`. A green run against nothing would be indistinguishable
from a green run that actually exercised the socket, which is exactly the
failure this project's own working notes call out repeatedly: a check that
cannot fail is not a check.

Run with the app open:

    python python/test_dr_companion.py
"""

from __future__ import annotations

import sys
import threading
import time

from dr_companion import Companion, ConnectionError, Line, Status, _data_dir


def _require_running_app() -> None:
    data_dir = _data_dir()
    port_file = data_dir / "script-api.port"
    token_file = data_dir / "script-api.token"
    if not port_file.exists() or not token_file.exists():
        print(
            f"SKIPPED: no script-api files in {data_dir} - is DR Companion running? "
            "This is not a pass; nothing was checked."
        )
        sys.exit(2)


def _ok(label: str, cond: bool, detail: str = "") -> bool:
    print(f"{'OK  ' if cond else 'FAIL'} {label:<58}{detail}")
    return cond


def main() -> int:
    _require_running_app()
    failed = 0

    print("-- status() and send() connect on their own, like run() does --")
    # Found by running python/examples/hello.py, which calls status() before
    # run() gets a chance to connect: status() raised NotConnected. A method
    # a script would reasonably call first should not be the one exception
    # to "you do not have to call connect() yourself".
    for label, action in [
        ("status()", lambda comp: comp.status()),
        ("send()", lambda comp: comp.send("--dr-companion-python-api-smoke-test--")),
    ]:
        fresh = Companion()
        try:
            action(fresh)
            ok = fresh._sock is not None
        except Exception as e:  # noqa: BLE001 - reporting, not handling
            ok = False
            print(f"     {label} raised: {e}")
        if not _ok(f"{label} connects without connect() being called first", ok):
            failed += 1
        fresh.close()

    print("\n-- connecting to the real app --")
    c = Companion()
    c.connect()
    if not _ok("connected and authenticated", True):
        failed += 1

    print("\n-- status works even with nothing attached --")
    st = c.status()
    if not _ok("status came back as the right type", isinstance(st, Status), repr(st)):
        failed += 1
    # Not asserting `connected` either way - whether Lich is attached is
    # this machine's real state right now, not something this test controls,
    # and asserting a specific value would make the test depend on a human
    # having clicked Attach. What matters is that a real, well-formed answer
    # came back at all.
    if not _ok("note is a string", isinstance(st.note, str), repr(st.note)):
        failed += 1

    print("\n-- a bad token is refused, against the real server --")
    try:
        bad = Companion(token="not-the-real-token")
        bad.connect()
        _ok("a wrong token is rejected", False, "connected anyway")
        failed += 1
    except ConnectionError as e:
        _ok("a wrong token is rejected", True, str(e)[:60])

    print("\n-- lines arrive as they are broadcast, not just in principle --")
    # Send a command. Whether or not a game is attached, sending itself either
    # succeeds (attached) or comes back as a documented error (not attached) -
    # both are the real server answering honestly, and this proves `send`
    # reaches the app rather than only proving the client can format a string.
    c.send("--dr-companion-python-api-smoke-test--")
    got_error = threading.Event()
    error_text = []

    original_dispatch = c._dispatch

    def watching_dispatch(msg):
        if msg.get("type") == "error":
            error_text.append(msg.get("message", ""))
            got_error.set()
        original_dispatch(msg)

    c._dispatch = watching_dispatch

    # Give the app a moment to answer if it is going to (only fires when not
    # attached - a real attach would just send the text into the game, which
    # is not an error and produces no reply to wait for).
    deadline = time.time() + 1.5
    while time.time() < deadline and not got_error.is_set():
        c._sock.settimeout(0.2)
        try:
            msg = c._read_message()
        except OSError:
            break
        if msg is not None:
            watching_dispatch(msg)
        else:
            break
    c._sock.settimeout(None)

    if st.connected:
        print("OK   (Lich is attached right now - send() had a real effect, not asserted here)")
    else:
        if not _ok(
            "not attached: send() is answered with an error, not silence",
            got_error.is_set(),
            error_text[0] if error_text else "(nothing came back)",
        ):
            failed += 1

    c.close()

    print("\n-- the second connection gets a fresh, working socket too --")
    c2 = Companion()
    c2.connect()
    st2 = c2.status()
    if not _ok("a second real connection also authenticates and answers", isinstance(st2, Status)):
        failed += 1
    c2.close()

    print(f"\n{failed} failed" if failed else "\nall passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
