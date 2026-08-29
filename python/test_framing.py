"""dr_companion's message framing, against a scripted socket.

    python python/test_framing.py

Separate from `test_dr_companion.py` on purpose. That file connects to a
genuinely running app, which is the right way to test the protocol and the
wrong way to test the reader: framing bugs live in what the *bytes* look
like, and a real app never sends the shapes that break it. A fake socket can
hand over exactly the sequence that does.

It also runs without the app, so it can sit in the suite and execute on every
CI run rather than skipping.

Two defects this was written for, both measured before they were fixed:

    1500 blank lines then a message  -> RecursionError
    4 KB chunks with no newline      -> buffer grew to 819,200 bytes, no cap

`RecursionError` is the worse of the two. It is neither `ConnectionError` nor
`NotConnected` - the two exceptions this module documents - so a script's own
error handling does not catch it, and the failure reaches the player as a bare
traceback out of a library they did not write. Neither case needs the app to
be malicious: a half-finished framing change on the other end produces both.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dr_companion import Companion, ConnectionError, MAX_MESSAGE_BYTES  # noqa: E402

failed = 0


def _ok(label: str, cond: bool, detail: str = "") -> bool:
    print(f"{'OK  ' if cond else 'FAIL'} {label}{f': {detail}' if detail else ''}")
    return cond


def check(label: str, cond: bool, detail: str = "") -> None:
    global failed
    if not _ok(label, cond, detail):
        failed += 1


class FakeSock:
    """Hands back a scripted sequence of recv() chunks, then EOF."""

    def __init__(self, chunks):
        self.chunks = list(chunks)

    def recv(self, _n):
        return self.chunks.pop(0) if self.chunks else b""


def reader(chunks) -> Companion:
    c = Companion.__new__(Companion)
    c._sock = FakeSock(chunks)
    c._buf = b""
    return c


print("-- the ordinary shapes still work --")
# The floor. Without these, every check below would pass against a reader
# that raised on everything, which would break the whole client and look
# like a hardened one.
check("one whole message", reader([b'{"type":"ok"}\n'])._read_message() == {"type": "ok"})
check(
    "a message split across two recv() calls",
    reader([b'{"type":', b'"ok"}\n'])._read_message() == {"type": "ok"},
)
check(
    "two messages in one packet: the first is returned, the second buffered",
    reader([b'{"a":1}\n{"b":2}\n'])._read_message() == {"a": 1},
)
check("a clean close returns None", reader([b""])._read_message() is None)
check(
    "a few blank lines are skipped to reach the message",
    reader([b"\n\n\n" + b'{"type":"ok"}\n'])._read_message() == {"type": "ok"},
)

print()
print("-- a long run of blank lines must not exhaust the stack --")
# 1500 crossed CPython's default 1000-frame limit when the blank-line branch
# recursed. 5000 is well past any plausible limit.
for n in (900, 1500, 5000):
    try:
        got = reader([b"\n" * n + b'{"type":"ok"}\n'])._read_message()
        check(f"{n} blank lines then a message", got == {"type": "ok"}, repr(got))
    except RecursionError:
        check(f"{n} blank lines then a message", False, "RecursionError")

print()
print("-- a peer that never sends a newline is refused, not buffered forever --")
over = (MAX_MESSAGE_BYTES // 4096) + 8
try:
    reader([b"x" * 4096] * over)._read_message()
    check("a stream with no newline raises", False, "it returned instead")
except ConnectionError as e:
    check("a stream with no newline raises ConnectionError", True)
    check("the message says what was wrong", "newline" in str(e).lower(), str(e)[:70])
except RecursionError:
    check("a stream with no newline raises ConnectionError", False, "RecursionError")

# And the cap must not fire on traffic that is merely large but well-formed:
# a check that refuses everything would pass the case above and break the app.
big = b'{"type":"line","text":"' + b"y" * (MAX_MESSAGE_BYTES // 2) + b'"}\n'
try:
    got = reader([big[i : i + 4096] for i in range(0, len(big), 4096)])._read_message()
    check(
        "a large but properly framed message still parses",
        isinstance(got, dict) and got.get("type") == "line",
        f"{len(big):,} bytes",
    )
except Exception as e:  # noqa: BLE001
    check("a large but properly framed message still parses", False, f"{type(e).__name__}: {e}")

print()
print(f"{failed} failed" if failed else "all passed")
raise SystemExit(1 if failed else 0)
