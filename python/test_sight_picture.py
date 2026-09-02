"""SightPicture (drtask.py) against a fake Companion - no running app needed.

Same shape as test_drtask.py: a FakeCompanion that records what was sent and
nothing else, because everything here is decision logic (when to send, what
to send, what to keep) that has nothing to do with a real socket.

Run:

    python python/test_sight_picture.py
"""

from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from drtask import MAX_COMMANDS_PER_MINUTE, SightPicture, Task


class FakeCompanion:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.stopped = False

    def send(self, command: str) -> None:
        self.sent.append(command)

    def stop(self) -> None:
        self.stopped = True

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


print("-- never blocks on roundtime --")
c = FakeCompanion()
t = Task(c)
t.roundtime_until = time.time() + 30.0  # a long attack's worth
sp = SightPicture(interval=0.0)
started = time.time()
sp.maybe_refresh(t)
elapsed = time.time() - started
ok("returns immediately mid-roundtime", elapsed < 0.5, f"{elapsed:.2f}s")
ok(
    "still sent something, via wait_rt=False",
    len(c.sent) == 1,
    repr(c.sent),
)

print()
print("-- rotation order and interval gating --")
c2 = FakeCompanion()
t2 = Task(c2)
sp2 = SightPicture(interval=100.0)  # so only the forced first send fires
sp2._last_sent = 0.0
sp2.maybe_refresh(t2)
ok("first tick sends the first topic", c2.sent == [SightPicture.TOPICS[0]], repr(c2.sent))
sp2.maybe_refresh(t2)
ok(
    "a second tick inside the interval sends nothing more",
    c2.sent == [SightPicture.TOPICS[0]],
    repr(c2.sent),
)
sp2._last_sent = 0.0  # pretend the interval elapsed
sp2._collect_until = 0.0  # ...and the first topic's collection window closed
sp2.maybe_refresh(t2)
ok(
    "the next due tick advances to the next topic",
    c2.sent == [SightPicture.TOPICS[0], SightPicture.TOPICS[1]],
    repr(c2.sent),
)

print()
print("-- leaves headroom for real actions under the rate cap --")
c3 = FakeCompanion()
t3 = Task(c3)
now = time.time()
half = MAX_COMMANDS_PER_MINUTE // 2
t3._rate.sent = [now] * half  # exactly at the headroom line
sp3 = SightPicture(interval=0.0)
sp3.maybe_refresh(t3)
ok(
    "does not send once recent traffic already fills half the cap",
    c3.sent == [],
    repr(c3.sent),
)
t3._rate.sent = [now] * (half - 1)
sp3.maybe_refresh(t3)
ok(
    "sends when just under the headroom line",
    len(c3.sent) == 1,
    repr(c3.sent),
)

print()
print("-- stale rate-window entries age out even though only record() prunes --")
c3b = FakeCompanion()
t3b = Task(c3b)
now = time.time()
# `_Rate.record()` is the only thing that prunes `sent` to the trailing 60s
# window, and it only runs from `Task.do()`. A flow that's been blocked in a
# long `until`-wait sends nothing through `do()`, so a burst from minutes ago
# never gets pruned on its own - maybe_refresh has to prune what it reads,
# or it stays stuck at the headroom line long after the real budget is free.
t3b._rate.sent = [now - 90.0] * half  # filled the cap 90s ago, well outside the window
sp3b = SightPicture(interval=0.0)
sp3b.maybe_refresh(t3b)
ok(
    "refreshes once old traffic has aged out of the real 60s window",
    len(c3b.sent) == 1,
    repr(c3b.sent),
)
c3c = FakeCompanion()
t3c = Task(c3c)
t3c._rate.sent = [now] * half  # same count, but genuinely recent
sp3c = SightPicture(interval=0.0)
sp3c.maybe_refresh(t3c)
ok(
    "still refuses when that traffic is genuinely recent",
    c3c.sent == [],
    repr(c3c.sent),
)

print()
print("-- capture only counts while a rotation answer is in flight --")
sp4 = SightPicture(interval=1000.0)
sp4.capture("nothing is collecting yet")
ok("a line arriving before any refresh is dropped", sp4.snapshot == {})

c4 = FakeCompanion()
t4 = Task(c4)
sp4._last_sent = 0.0
sp4.maybe_refresh(t4)  # opens a collection window for TOPICS[0]
sp4.capture("You are in perfect health.")
sp4.capture("You have no injuries.")
sp4._collect_until = 0.0  # pretend the collection window has closed
sp4.maybe_refresh(t4)  # interval not elapsed, but this call is what flushes
topic = SightPicture.TOPICS[0]
ok(
    "the two captured lines are joined into that topic's snapshot",
    sp4.snapshot.get(topic) is not None
    and sp4.snapshot[topic].text == "You are in perfect health. You have no injuries.",
    repr(sp4.snapshot.get(topic)),
)

sp4.capture("arrives after the window closed")
ok(
    "a line after the window closed is not appended to the flushed topic",
    "arrives after" not in sp4.snapshot[topic].text,
)

print()
print("-- as_dict reports age, not a raw timestamp --")
d = sp4.as_dict()
ok("the flushed topic is present", topic in d, repr(d))
ok(
    "age_seconds is a small non-negative number, not a timestamp",
    isinstance(d[topic]["age_seconds"], float) and 0 <= d[topic]["age_seconds"] < 5,
    repr(d[topic]),
)

print()
print("-- save/load round-trips through a real file, overwriting rather than appending --")
with tempfile.TemporaryDirectory() as tmp:
    path = Path(tmp) / "sight-picture.json"
    sp4.save(path)
    loaded = SightPicture.load(path)
    ok("load sees what save wrote", loaded == sp4.as_dict(), repr(loaded))

    sp4.snapshot = {"exp": sp4.snapshot[topic]}
    sp4.save(path)
    reloaded = SightPicture.load(path)
    ok(
        "a second save replaces the file rather than growing it",
        list(reloaded.keys()) == ["exp"],
        repr(reloaded),
    )

print()
print("-- load against a file that was never written --")
with tempfile.TemporaryDirectory() as tmp:
    missing = Path(tmp) / "never-written.json"
    ok("degrades to empty rather than raising", SightPicture.load(missing) == {})

print()
print("-- enable_sight_picture starts a background thread that shares the send lock --")
c5 = FakeCompanion()
t5 = Task(c5)
t5.roundtime_until = time.time() + 2.0
returned = t5.enable_sight_picture(interval=0.1)
ok("returns the picture it created", returned is t5.sight_picture)
again = t5.enable_sight_picture(interval=9.0)
ok("calling it twice is a no-op, not a second thread/instance", again is returned)
time.sleep(1.0)
t5.stop()
ok(
    "the background thread sent at least one info command on its own",
    len(c5.sent) >= 1,
    repr(c5.sent),
)
ok(
    "and never sent the (2s) roundtime-gated command it never asked for",
    all(cmd in SightPicture.TOPICS for cmd in c5.sent),
    repr(c5.sent),
)

print()
ok("enough was checked for a pass to mean something", checked >= 15, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
