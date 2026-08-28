"""drtask.py's Task base, against a fake Companion - no running app needed.

Unlike test_dr_companion.py, which insists on the real app because it is
testing the actual socket, this is testing decision logic inside Task itself
(rate limiting, roundtime waiting, command formatting) that has nothing to do
with whether a real connection exists. A fake transport is the right choice
here, not a compromise - see the module note in test_dr_companion.py for why
the two files make opposite choices for good reason.

Run:

    python python/test_drtask.py
"""

from __future__ import annotations

import time

from drtask import MAX_COMMANDS_PER_MINUTE, RateLimited, Task


class FakeCompanion:
    """Stands in for the real socket. Records what was sent; sends nothing."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self.stopped = False

    def send(self, command: str) -> None:
        self.sent.append(command)

    def stop(self) -> None:
        self.stopped = True

    # Task.run() calls these; unused by these tests but present so nothing
    # explodes if a test accidentally calls run().
    def connect(self) -> None:
        pass

    def on_line(self, _cb) -> None:
        pass


failed = 0
checked = 0


def ok(label: str, cond: bool, detail: str = "") -> bool:
    global checked, failed
    checked += 1
    print(f"{'OK  ' if cond else 'FAIL'} {label}{f': {detail}' if detail else ''}")
    if not cond:
        failed += 1
    return cond


print("-- walk_to: what it actually sends --")
c = FakeCompanion()
t = Task(c)
t.walk_to(4821)
ok("sends the ;go2 form", c.sent == [";go2 4821"], repr(c.sent))

c2 = FakeCompanion()
t2 = Task(c2)
t2.walk_to("bank")
ok("a named target works the same as a room id", c2.sent == [";go2 bank"], repr(c2.sent))

print()
print("-- walk_to does not wait out roundtime first --")
c3 = FakeCompanion()
t3 = Task(c3)
t3.roundtime_until = time.time() + 5.0
started = time.time()
t3.walk_to(1234)
elapsed = time.time() - started
ok(
    "returns immediately even mid-roundtime",
    elapsed < 0.5,
    f"{elapsed:.2f}s (a wait_rt=True call here would have blocked ~5s)",
)
ok("still sent, roundtime or not", c3.sent == [";go2 1234"], repr(c3.sent))

print()
print("-- walk_to still goes through the one rate-limited choke point --")
c4 = FakeCompanion()
t4 = Task(c4)
for _ in range(MAX_COMMANDS_PER_MINUTE):
    t4.walk_to(1)
raised = False
try:
    t4.walk_to(1)
except RateLimited:
    raised = True
ok("a runaway loop of walk_to hits the same cap as do()", raised)
ok("and the task actually stops", c4.stopped)

print()
ok("enough was checked for a pass to mean something", checked >= 6, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
