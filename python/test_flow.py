"""flow.py against fixed strings and a fake Companion - no running app or
real game stream needed. `FlowContext.feed_line` is a plain function of a
string, and `FlowRunner` only needs something with `send()` and `on_line()`,
so both are testable the same way `test_lich.py` tests `lich.py`.

Run with:

    python python/test_flow.py
"""

from __future__ import annotations

import re
import sys
import threading
import time

from flow import Flow, FlowContext, FlowRunner, Step, evaluate_condition


def _ok(label: str, cond: bool, detail: str = "") -> bool:
    print(f"{'OK  ' if cond else 'FAIL'} {label:<58}{detail}")
    return cond


class FakeCompanion:
    """Enough of `dr_companion.Companion`'s surface for `FlowRunner`: records
    `on_line` handlers and sent commands; `feed` drives them the way a real
    socket read would, from the test's own thread."""

    def __init__(self) -> None:
        self.sent: list[str] = []
        self._handlers: list = []

    def send(self, command: str) -> None:
        self.sent.append(command)

    def on_line(self, fn):
        self._handlers.append(fn)
        return fn

    def feed(self, text: str) -> None:
        line = type("Line", (), {"seq": 0, "text": text})()
        for fn in self._handlers:
            fn(line)


def test_context() -> int:
    failed = 0
    ctx = FlowContext()

    failed += not _ok("vital_pct is None before any line", ctx.vital_pct("health") is None)
    ctx.feed_line("<progressBar id='health' value='0' text='health 40/100'/>")
    failed += not _ok("vital_pct reads a fed vital", ctx.vital_pct("health") == 40.0)

    failed += not _ok("indicator is None before any line", ctx.indicator("bleeding") is None)
    ctx.feed_line("<indicator id='IconBLEEDING' visible='y'/>")
    failed += not _ok("indicator reads a fed indicator", ctx.indicator("bleeding") is True)
    ctx.feed_line("<indicator id='IconBLEEDING' visible='n'/>")
    failed += not _ok("indicator updates on a later line", ctx.indicator("bleeding") is False)

    ctx.set_flag("healed_this_run")
    failed += not _ok("set_flag/flag round-trips", ctx.flag("healed_this_run") is True)
    failed += not _ok("flag is None for something never set", ctx.flag("nope") is None)

    return failed


def test_conditions() -> int:
    failed = 0
    ctx = FlowContext()

    failed += not _ok("no condition is unconditional", evaluate_condition(None, ctx) is True)
    failed += not _ok("blank condition is unconditional", evaluate_condition("  ", ctx) is True)
    failed += not _ok("unknown gauge fails open (true)", evaluate_condition("health<50", ctx) is True)

    ctx.feed_line("<progressBar id='health' value='0' text='health 30/100'/>")
    failed += not _ok("health<50 true at 30%", evaluate_condition("health<50", ctx) is True)
    failed += not _ok("health>50 false at 30%", evaluate_condition("health>50", ctx) is False)
    failed += not _ok("!health<50 negates", evaluate_condition("!health<50", ctx) is False)
    failed += not _ok("health<=30 true at exactly 30%", evaluate_condition("health<=30", ctx) is True)
    failed += not _ok("health>=30 true at exactly 30%", evaluate_condition("health>=30", ctx) is True)

    failed += not _ok("bare flag false when never reported", evaluate_condition("bleeding", ctx) is False)
    ctx.feed_line("<indicator id='IconBLEEDING' visible='y'/>")
    failed += not _ok("bare flag true once reported on", evaluate_condition("bleeding", ctx) is True)
    failed += not _ok("negated bare flag", evaluate_condition("!bleeding", ctx) is False)

    ctx.set_flag("script_flag")
    failed += not _ok("a script-set flag is readable as a condition", evaluate_condition("script_flag", ctx) is True)

    return failed


def test_runner() -> int:
    failed = 0
    fc = FakeCompanion()
    runner = FlowRunner(fc)

    seen: list[str] = []
    flow = Flow(
        id="t",
        title="test",
        steps=[
            Step("send-and-settle", commands=["look"], wait="settle", settle=0.01),
            Step("run-only", run=lambda ctx: seen.append("ran"), wait="prompt", timeout=0.05),
        ],
    )
    runner.run(flow)
    failed += not _ok("commands are sent via the companion", fc.sent == ["look"], str(fc.sent))
    failed += not _ok("Step.run is called", seen == ["ran"])

    # A 'prompt' wait that times out should not hang the test - the whole
    # point of Step.timeout is that a flow with nobody feeding it lines still
    # returns control.
    slow = Flow(id="slow", title="slow", steps=[Step("wait for nothing", wait="prompt", timeout=0.05)])
    start = time.monotonic()
    runner.run(slow)
    elapsed = time.monotonic() - start
    failed += not _ok("a 'prompt' wait with no prompt still returns", elapsed < 1.0, f"{elapsed:.2f}s")

    # A loop stops when told to, from another thread - the shape `stop()`'s
    # own docstring promises (a Step.run, or a signal handler, calling it).
    counter = {"n": 0}

    def bump(ctx: FlowContext) -> None:
        counter["n"] += 1
        if counter["n"] >= 3:
            runner.stop()

    looper = Flow(id="loop", title="loop", loops=True, steps=[Step("bump", run=bump, wait="settle", settle=0.001)])
    runner.run(looper)
    failed += not _ok("loops=True repeats until stop() is called", counter["n"] == 3, str(counter["n"]))

    # wait='line' actually blocks for a real match delivered on another
    # thread, and returns promptly once it arrives - not just once the
    # timeout would have expired anyway.
    line_flow = Flow(
        id="line",
        title="line",
        steps=[Step("wait for READY", wait="line", wait_for=re.compile(r"^READY$"), timeout=5.0)],
    )

    def deliver_later() -> None:
        time.sleep(0.05)
        fc.feed("something else")
        fc.feed("READY")

    threading.Thread(target=deliver_later, daemon=True).start()
    start = time.monotonic()
    runner.run(line_flow)
    elapsed = time.monotonic() - start
    failed += not _ok("wait='line' returns as soon as a match arrives, not at the timeout", elapsed < 2.0, f"{elapsed:.2f}s")

    return failed


def main() -> int:
    failed = test_context() + test_conditions() + test_runner()
    if failed:
        print(f"\n{failed} check(s) FAILED")
        return 1
    print("\nall checks OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
