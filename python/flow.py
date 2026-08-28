"""Multi-step automation, native to the Python side.

`src/data/taskFlows.ts` already has a "flow" concept for the bridge - a list
of steps a player can read before pressing, run over `run_macro`, which waits
out roundtime and refuses when it cannot run. This is the same idea rebuilt
for a Python script talking to the raw game stream instead: a `Flow` is a
list of `Step`s, a `FlowRunner` walks them in order (or forever, if
`Flow.loops`), and a `FlowContext` accumulates vitals and situation flags from
the stream so a step's `condition` can read live state - the same grammar
`src/lib/flowConditions.ts` defines (`health<50`, `bleeding`, `!bleeding`),
evaluated against `streamkit.py`'s vitals/indicators instead of the bridge's
`CharacterStatus`.

**Where this is genuinely more than the bridge flows can do, not just a
port:** a bridge flow's step is a fixed command list plus a fixed `settle`
number of seconds. A `Step.run` here is an arbitrary Python callable - it can
look at `FlowContext`, decide what to send, loop internally, call into
`lich.py` to chain Lich scripts together, or do nothing at all and just wait.
That is the "pure python flow" half of the ask: not a bigger command list, a
real program.

# Waiting between steps

There is no bridge here waiting out roundtime for you - `dr_companion.py`'s
`send()` puts a command on the wire and returns immediately, full stop. Three
ways to wait, picked per step with `Step.wait`:

- `"prompt"` (the default) - wait for the game's own `<prompt>` tag
  (`streamkit.has_prompt`), the signal the game just handed control back.
  Better than a guessed sleep, not a guarantee - see `has_prompt`'s own
  docstring for the honest limit.
- `"line"` - wait for a line matching `Step.wait_for` (a compiled regex, or a
  `str -> bool` callable).
- `"settle"` - a fixed sleep, for the cases Genie scripts have always used
  this for: a door, a shopkeeper's reply, nothing the stream announces.

Every wait mode is bounded by `Step.timeout` (default 30s) so a flow can never
hang forever on a line that does not arrive - it moves on and the next step
runs against whatever state actually exists, the same "fails open" choice
`flowConditions.ts` makes for an unmet condition.

# Example - a pure Python flow, no Lich scripts involved

    from dr_companion import Companion
    from flow import Flow, Step, FlowRunner

    hunt = Flow(
        id="hunt",
        title="Hunt cycle",
        loops=True,
        steps=[
            Step("Attacking", commands=["attack"]),
            Step("Looting", commands=["get all", "get coins"], wait="settle", settle=1),
            Step("Skinning", commands=["skin"], wait="settle", settle=1),
            Step("Tending", commands=["tend my worst"], condition="bleeding"),
        ],
    )

    c = Companion()
    runner = FlowRunner(c)
    c.status()                                    # connects, on this thread
    threading.Thread(target=c.run, daemon=True).start()  # then, and only then, start reading
    runner.run(hunt)   # blocks; Ctrl+C or another thread calling runner.stop()

# Example - chaining Lich commands into a workflow

    from lich import Lich
    lich = Lich(c)
    rotation = Flow(id="rotation", title="Train then heal if needed", steps=[
        Step("Training pass", run=lambda ctx: lich.start("my-trainer")),
        Step("Wait for it to finish", wait="line", wait_for=re.compile(r"my-trainer.*(?:done|dies|stops)", re.I), timeout=600),
        Step("Heal if needed", run=lambda ctx: lich.force_start("healer") if ctx.vital_pct("health") < 60 else None),
    ])
    FlowRunner(c, lich=lich).run(rotation)
"""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable, Optional, Pattern, Sequence, Union

import streamkit as sk

if TYPE_CHECKING:
    from dr_companion import Companion, Line
    from lich import Lich


WaitMatcher = Union[Pattern[str], Callable[[str], bool]]


class FlowContext:
    """Live state a running flow can read: vitals and situation flags built
    from the stream, plus whatever a script's own `Step.run` chooses to set.

    Thread-safe - lines arrive on whatever thread is running `Companion.run`,
    while a flow step's wait and its `condition` check happen on the thread
    that called `FlowRunner.run`. Every read and write below takes the same
    lock.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._vitals: dict[str, sk.Vital] = {}
        self._indicators: dict[str, bool] = {}
        self._flags: dict[str, bool] = {}
        # (counter, text) rather than bare text, so a wait started after some
        # lines already arrived can filter to "since I started" by counter
        # even once the deque's maxlen has evicted earlier entries - a plain
        # index into the deque would silently shift as older lines fall off.
        self._recent: deque[tuple[int, str]] = deque(maxlen=200)
        self._line_counter = 0
        self._prompt_counter = 0

    # -- fed by the reading thread ---------------------------------------

    def feed_line(self, text: str) -> None:
        """Update state from one raw `Line.text`. Called by `FlowRunner`'s
        own `on_line` handler; exposed directly (and kept independent of any
        socket) so it can be unit-tested with plain strings."""
        with self._cond:
            for vital in sk.all_vitals_in(text):
                self._vitals[vital.id] = vital
            for key, value in sk.indicators_in(text).items():
                self._indicators[key] = value
            self._line_counter += 1
            self._recent.append((self._line_counter, text))
            if sk.has_prompt(text):
                self._prompt_counter = self._line_counter
            self._cond.notify_all()

    # -- read by a step's condition / run callable -----------------------

    def vital_pct(self, name: str) -> Optional[float]:
        """0-100, or `None` if this vital has not been reported yet - a step
        condition treats `None` as "no reading", which is what makes the
        grammar below fail open the same way `flowConditions.ts` does."""
        with self._lock:
            v = self._vitals.get(name)
            return v.pct if v is not None else None

    def indicator(self, name: str) -> Optional[bool]:
        """`True`/`False` as last reported, or `None` if never reported."""
        with self._lock:
            return self._indicators.get(name)

    def set_flag(self, name: str, value: bool = True) -> None:
        """A script's own situation flag, checked the same way an `indicator`
        is - `condition="my_flag"` reads whatever this last set. Lets a
        `Step.run` communicate something to a later step's condition without
        both ends knowing about a game indicator."""
        with self._lock:
            self._flags[name] = value

    def flag(self, name: str) -> Optional[bool]:
        with self._lock:
            return self._flags.get(name)

    # -- waiting ------------------------------------------------------------

    def wait_for_prompt(self, timeout: float) -> bool:
        """Block until a line containing `<prompt ...>` arrives, or
        `timeout` elapses. Returns whether a prompt was actually seen."""
        deadline = time.monotonic() + timeout
        with self._cond:
            start = self._line_counter
            while self._prompt_counter <= start:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._cond.wait(remaining)
            return True

    def wait_for_line(self, matcher: WaitMatcher, timeout: float) -> Optional[str]:
        """Block until a line since this call matches `matcher`, or
        `timeout` elapses. Returns the matching line's text, or `None`.

        A match older than the buffer's last 200 lines (`FlowContext`'s own
        cap) by the time this wakes up is missed rather than found - the same
        "probably right, occasionally silent" trade the rest of this stack
        makes, not a guarantee for a busy stream and a very long timeout."""
        test = matcher.search if isinstance(matcher, re.Pattern) else matcher
        deadline = time.monotonic() + timeout
        with self._cond:
            since = self._line_counter
            while True:
                for counter, text in self._recent:
                    if counter > since and test(text):
                        return text
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._cond.wait(remaining)


_COMPARISON = re.compile(r"^(\w+)\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)$")


def evaluate_condition(condition: Optional[str], ctx: FlowContext) -> bool:
    """The same grammar as `src/lib/flowConditions.ts`, evaluated against a
    `FlowContext`: `gauge<50` / `gauge>=80` (gauge is a `streamkit.py` vital
    id - `health`, `mana`, `spirit`, `stamina`, `concentration`, not the
    bridge's `fatigue`/`spirit` pair), a bare flag (`bleeding`, `stunned`, or
    anything a `Step.run` set with `FlowContext.set_flag`), either negated
    with a leading `!`. `None` or blank is unconditional. Fails open on an
    unknown gauge or a reading that has not arrived yet, for the same reason
    the TS version gives: a flow stuck forever on a typo or a slow connection
    is worse than one that ran a step it could have skipped."""
    if not condition or not condition.strip():
        return True
    trimmed = condition.strip()
    negate = trimmed.startswith("!")
    body = trimmed[1:].strip() if negate else trimmed

    m = _COMPARISON.match(body)
    if m:
        name, op, num_text = m.group(1), m.group(2), m.group(3)
        value = ctx.vital_pct(name.lower())
        if value is None:
            result = True  # unknown gauge, or no reading yet - fail open
        else:
            n = float(num_text)
            result = value < n if op == "<" else value > n if op == ">" else value <= n if op == "<=" else value >= n
    else:
        flag = ctx.indicator(body)
        if flag is None:
            flag = ctx.flag(body)
        result = bool(flag)

    return not result if negate else result


StepRun = Callable[[FlowContext], None]


@dataclass
class Step:
    """One step of a `Flow`. `label` is shown while it runs, same spirit as
    the bridge flow's own `label` - written as the thing happening."""

    label: str
    commands: Sequence[str] = ()
    run: Optional[StepRun] = None
    condition: Optional[str] = None
    wait: str = "prompt"  # "prompt" | "line" | "settle"
    settle: float = 1.0
    wait_for: Optional[WaitMatcher] = None
    timeout: float = 30.0

    def __post_init__(self) -> None:
        if self.wait not in ("prompt", "line", "settle"):
            raise ValueError(f"Step.wait must be 'prompt', 'line' or 'settle', not {self.wait!r}")
        if self.wait == "line" and self.wait_for is None:
            raise ValueError(f"step {self.label!r}: wait='line' needs wait_for")


@dataclass
class Flow:
    id: str
    title: str
    steps: Sequence[Step]
    summary: str = ""
    loops: bool = False


class FlowRunner:
    """Walks a `Flow`'s steps against a live `Companion`, one at a time."""

    def __init__(self, companion: "Companion", lich: Optional["Lich"] = None) -> None:
        self._c = companion
        self._lich = lich
        self.ctx = FlowContext()
        self._stopped = threading.Event()
        companion.on_line(self._on_line)

    def _on_line(self, line: "Line") -> None:
        self.ctx.feed_line(line.text)

    def stop(self) -> None:
        """Ends the flow after the step in progress finishes - callable from
        another thread, e.g. a `Step.run` that decides the loop is done, or a
        signal handler."""
        self._stopped.set()

    def run(self, flow: Flow) -> None:
        """Runs `flow` to completion (or forever, if `flow.loops`), blocking
        the calling thread. `Companion.run()` must already be pumping lines
        on another thread - this does not start it, the same way it does not
        own the socket. Start that thread *after* any `connect()`/`status()`
        call your script makes on the main thread, not before -
        `dr_companion.py`'s socket reads are not safe to call from two
        threads at once, and a `status()` call racing the reader thread is
        exactly that."""
        self._stopped.clear()
        while not self._stopped.is_set():
            for step in flow.steps:
                if self._stopped.is_set():
                    return
                if not evaluate_condition(step.condition, self.ctx):
                    print(f"flow[{flow.id}]: skipping '{step.label}' - condition {step.condition!r} not met")
                    continue

                print(f"flow[{flow.id}]: {step.label}")
                for command in step.commands:
                    self._c.send(command)
                if step.run is not None:
                    step.run(self.ctx)

                if step.wait == "settle":
                    time.sleep(step.settle)
                elif step.wait == "prompt":
                    if not self.ctx.wait_for_prompt(step.timeout):
                        print(f"flow[{flow.id}]: '{step.label}' - no prompt seen within {step.timeout}s, moving on")
                elif step.wait == "line":
                    assert step.wait_for is not None  # enforced in Step.__post_init__
                    if self.ctx.wait_for_line(step.wait_for, step.timeout) is None:
                        print(f"flow[{flow.id}]: '{step.label}' - nothing matched within {step.timeout}s, moving on")

            if not flow.loops:
                return
        return
