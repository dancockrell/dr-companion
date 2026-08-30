"""flow.py's Flow/Step engine against a fake Companion - no running app needed.

flow.py had no test coverage before this file, and it is the one this app
calls its scripting language (see its own module docstring). Written after
finding one real bug in it by hand - a Flow constructed without
`sight_picture_enabled` read back `None` rather than the documented default
`False`, because `Task.__init__` sets an *instance* attribute called
`sight_picture` (the live object, once enabled) that used to collide with a
same-named class-level flag on `Flow`. The first case below is a permanent
guard against that regressing under a different name change.

Run:

    python python/test_flow.py
"""

from __future__ import annotations

import io
import sys
import threading
import time
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dr_companion import Line
from flow import Flow, Step

failed = 0
checked = 0


def ok(label: str, cond: bool, detail: str = "") -> bool:
    global checked, failed
    checked += 1
    print(f"{'OK  ' if cond else 'FAIL'} {label}{f': {detail}' if detail else ''}")
    if not cond:
        failed += 1
    return cond


class FakeCompanion:
    """Drains a scripted list of lines on its own thread, each after a short
    delay - long enough that the main thread's `_await` has already started
    listening for it, which is the ordering a real socket also guarantees
    (nothing arrives before the command that asks for it is sent)."""

    def __init__(self, lines: "list[str]" = (), delay: float = 0.05) -> None:
        self.sent: list[str] = []
        self.stopped = False
        self._lines = list(lines)
        self._delay = delay
        self._line_cb = None

    def send(self, command: str) -> None:
        self.sent.append(command)

    def stop(self) -> None:
        self.stopped = True

    def close(self) -> None:
        pass

    def connect(self) -> None:
        pass

    def on_line(self, fn) -> None:
        self._line_cb = fn

    def run(self) -> None:
        for text in self._lines:
            if self.stopped:
                return
            time.sleep(self._delay)
            if self.stopped:
                return
            if self._line_cb:
                self._line_cb(Line(seq=0, text=text))
        # Idle rather than returning immediately: a real connection stays
        # open after the last line until told to stop, and a Flow whose
        # `until` never matches relies on that to actually reach its own
        # timeout rather than the reader thread exiting first.
        while not self.stopped:
            time.sleep(0.05)


def run_flow(flow: Flow, timeout: float = 5.0) -> str:
    """Runs a non-looping flow to completion in this thread (Flow.run()
    already backgrounds the reader), capturing what it printed. Fails the
    calling assertion rather than hanging if something regresses into an
    infinite wait - a test that can block forever is worse than one that
    fails loudly."""
    buf = io.StringIO()
    done = threading.Event()

    def go():
        with redirect_stdout(buf):
            flow.run()
        done.set()

    threading.Thread(target=go, daemon=True).start()
    if not done.wait(timeout):
        flow.stop()
        raise AssertionError(f"flow did not finish within {timeout}s:\n{buf.getvalue()}")
    return buf.getvalue()


print("-- sight_picture_enabled defaults to False, not to Task's own None --")
plain = Flow(companion=FakeCompanion(), title="Plain", steps=[Step("Noop", [])])
ok(
    "a Flow built without the kwarg reads back False, not None",
    plain.sight_picture_enabled is False,
    repr(plain.sight_picture_enabled),
)
opted_in = Flow(
    companion=FakeCompanion(), title="Opted in", steps=[Step("Noop", [])], sight_picture_enabled=True
)
ok("passing the kwarg still works", opted_in.sight_picture_enabled is True)

print()
print("-- when gates a step; a False condition sends nothing for it --")
seen_when: list[bool] = []


def gate(f: Flow) -> bool:
    seen_when.append(True)
    return False


c1 = FakeCompanion()
f1 = Flow(
    companion=c1,
    title="Gated",
    steps=[
        Step("Skipped", ["should not send"], when=gate),
        Step("Always", ["should send"]),
    ],
)
out1 = run_flow(f1)
ok("the gated step's command never reached the fake socket", c1.sent == ["should send"], repr(c1.sent))
ok("the condition was actually evaluated", len(seen_when) == 1)
ok("the skip is printed rather than silent", "skipped" in out1.lower(), out1)

print()
print("-- until completes as soon as a matching line arrives, not after the timeout --")
c2 = FakeCompanion(lines=["nothing relevant", "Bank, teller number three."], delay=0.1)
f2 = Flow(
    companion=c2,
    title="Banking",
    steps=[Step("Walking", ["go bank"], until=r"Bank|teller", timeout=5.0)],
)
started = time.time()
out2 = run_flow(f2, timeout=5.0)
elapsed = time.time() - started
ok("the command was sent", c2.sent == ["go bank"], repr(c2.sent))
ok(
    "returned once the line matched, well under the 5s timeout",
    elapsed < 2.0,
    f"{elapsed:.2f}s",
)
ok("no timeout message was printed", "timed out" not in out2.lower(), out2)

print()
print("-- until gives up and continues past the timeout when nothing ever matches --")
c3 = FakeCompanion(lines=["the game never mentions the place"], delay=0.1)
f3 = Flow(
    companion=c3,
    title="Nowhere",
    steps=[
        Step("Walking", ["go nowhere"], until=r"Bank|teller", timeout=0.5),
        Step("After", ["still runs"]),
    ],
)
out3 = run_flow(f3, timeout=5.0)
ok("the flow said it timed out", "timed out" in out3.lower(), out3)
ok(
    "and moved on to the next step rather than stopping there",
    c3.sent == ["go nowhere", "still runs"],
    repr(c3.sent),
)

print()
print("-- a non-looping flow with no when/until runs its steps once and stops --")
c4 = FakeCompanion()
f4 = Flow(companion=c4, title="Simple", steps=[Step("One", ["a"]), Step("Two", ["b"])])
out4 = run_flow(f4)
ok("both commands sent in order", c4.sent == ["a", "b"], repr(c4.sent))
ok("said done rather than looping", "done" in out4.lower(), out4)

print()
ok("enough was checked for a pass to mean something", checked >= 10, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
