"""Python-native task-flow primitives used by the shipped flows and routines.

`python/tasks/flows.py`, `python/tasks/routine.py`, and player tasks compose the
`Flow` and `Step` types in this module. The desktop app discovers and launches
those tasks through the Python runner; there is no client-side FlowDriver.

Keeping this capability in Python buys three things a client-side flow engine
cannot have.

# 1. Conditions are expressions, so the grammar disappears

TypeScript needed `flowConditions.ts` to parse `health<50` into something it
could evaluate, and that parser has to grow a feature every time somebody wants
a condition it did not anticipate - two gauges compared, a count, a substring.

    TS      { commands: ['tend my worst'], condition: 'bleeding' }
    Python  Step('Tending', ['tend my worst'], when=lambda t: t.bleeding)

The Python version needs no parser at all, and `when=lambda t: t.health.percent
< 50 and not t.in_combat` needs no new feature.

# 2. Waiting on the game instead of guessing at it

A TypeScript step waits `settle` seconds because it has no way to know when the
game is ready - the comment on that field says as much: "for the cases where
the game needs a beat and gives no roundtime - walking through a door, a
shopkeeper's reply". A fixed timer is either too short, and the next command is
eaten, or too long, and the flow crawls.

    TS      { commands: ['go bank'], settle: 3 }
    Python  Step('To the bank', ['go bank'], until=r'Bank|teller')

`until` waits for the game to actually say it arrived, with a timeout as the
backstop rather than the mechanism. `settle` still exists for the cases where
there is genuinely nothing to wait for.

# 3. A step can decide things

`on_line` is available inside a flow, so a step can react to what the game
actually said rather than assuming its command worked.

# What is deliberately kept

The safety properties, because they are the reason this is trustworthy:
`do()`'s rate cap still applies to every command a flow sends (see drtask.py),
roundtime is still respected, and a flow that loops says so rather than
surprising somebody who expected it to end.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

from drtask import CleanLine, Task, Vital

#: Returned for a vital the game has never reported. Shared rather than
#: constructed per call so `is` comparisons work and there is one thing to
#: point at when explaining why a condition did not fire.
_UNKNOWN = Vital(0, 0, known=False)


@dataclass
class Step:
    """One step of a flow.

    `when`, `until` and `settle` are three different questions and a step may
    use any combination:

        when    should this step run at all, checked once before it starts
        until   what the game says when the step has finished
        settle  a flat pause, for when there is nothing to wait for
    """

    label: str
    commands: Sequence[str]
    #: Run only if this returns true. Receives the flow, so it can read vitals,
    #: the last line, anything the task knows.
    when: Optional[Callable[["Flow"], bool]] = None
    #: A regex; the step is done when a game line matches it. Preferred over
    #: `settle` whenever the game says something observable.
    until: Optional[str] = None
    #: Seconds. A backstop when `until` is set, a flat wait when it is not.
    settle: float = 0.0
    #: How long to wait for `until` before giving up and moving on. A flow that
    #: blocks forever on a message that never comes is worse than one that
    #: moves on and is visibly wrong.
    timeout: float = 15.0


class Flow(Task):
    """A sequence of steps, run in order, optionally repeating.

    Subclass and set `title`, `summary` and `steps`, or build one inline:

        Flow(title='Recover', steps=[...]).run()
    """

    title: str = "Flow"
    summary: str = ""
    steps: Sequence[Step] = ()
    #: Repeat until stopped. An endless flow has to be obvious rather than a
    #: surprise, so this is printed at the start.
    loops: bool = False
    #: Opt in to `Task.enable_sight_picture()` - see drtask.py. Named
    #: distinctly from `Task.sight_picture` (the live `SightPicture` instance
    #: once enabled, or `None`) on purpose: `Task.__init__` runs first via
    #: `super().__init__()` below and would otherwise set an *instance*
    #: attribute of the same name, permanently shadowing this class-level
    #: default the moment a `Flow` is constructed without passing the kwarg -
    #: found by testing `recover()` (which does not opt in) and seeing `None`
    #: instead of `False`. Off by default: a short, one-shot flow like
    #: `recover` or `to_healer` is done before a 20-second rotation would
    #: ever fire, so there is nothing for it to buy there. The two flows that
    #: actually loop for a while (`hunt`, `ambush`) turn it on in
    #: `tasks/flows.py`.
    sight_picture_enabled: bool = False
    #: Seconds between rotation topics - see `SightPicture.interval`.
    sight_picture_interval: float = 20.0

    def __init__(self, companion: Optional[object] = None, **kw) -> None:
        # Forwarded rather than dropped. `Task.__init__(companion=None)`
        # constructs a real `Companion()` when none is given, which reads
        # token/port files from the app's data directory and raises if
        # they're not there - so a bare `Flow(...)` used to work only by
        # accident, on a machine that happened to have those files left over
        # from a previous real run (see `dr_companion.py`'s own note that it
        # rewrites them on start and leaves them behind on close). On a clean
        # checkout, or in CI, that constructor call would simply raise.
        # Forwarding `companion` is what makes `Flow(companion=Fake(), ...)`
        # possible at all - found writing this file's own tests.
        super().__init__(companion)
        for key in (
            "title",
            "summary",
            "steps",
            "loops",
            "sight_picture_enabled",
            "sight_picture_interval",
        ):
            if key in kw:
                setattr(self, key, kw.pop(key))
        if kw:
            raise TypeError(f"unexpected arguments: {', '.join(kw)}")

        self._waiting: Optional[re.Pattern[str]] = None
        self._matched = False
        self.last_line: str = ""
        self._lines_seen = 0

    # -- things a condition can ask ------------------------------------
    #
    # A vital the game has not reported yet is `known=False`, whose `percent`
    # is NaN - so every comparison against it is false and a condition on an
    # unreported vital does nothing rather than firing on a zero nobody sent.
    # See Vital.percent in drtask.py for the run that made this necessary.

    @property
    def health(self) -> Vital:
        return self.vitals.get("health", _UNKNOWN)

    @property
    def mana(self) -> Vital:
        return self.vitals.get("mana", _UNKNOWN)

    @property
    def stamina(self) -> Vital:
        return self.vitals.get("stamina", _UNKNOWN)

    @property
    def concentration(self) -> Vital:
        return self.vitals.get("concentration", _UNKNOWN)

    @property
    def bleeding(self) -> bool:
        return "bleeding" in self.last_line.lower()

    # -- plumbing -------------------------------------------------------

    def on_clean(self, line: CleanLine) -> None:
        self.last_line = line.text
        self._lines_seen += 1
        if self._waiting and self._waiting.search(line.text):
            self._matched = True

    def _await(self, pattern: str, timeout: float) -> bool:
        """Wait for a line matching `pattern`. True if it arrived."""
        self._waiting = re.compile(pattern, re.I)
        self._matched = False
        deadline = time.time() + timeout
        try:
            while time.time() < deadline:
                if self._matched:
                    return True
                if self._stopping:
                    return False
                time.sleep(0.1)
            return False
        finally:
            self._waiting = None

    def _connect_and_start_reader(self) -> None:
        """Connect, background the reader, and start the sight picture if
        asked for. Split out of `run()` so a subclass that drives its own
        loop - `Routine` in `tasks/routine.py`, choosing which step list to
        run rather than walking one fixed list - gets this plumbing without
        duplicating it.

        The reader runs on its own thread so `on_clean` keeps firing while a
        step waits - without that, `until` could never match, because the line
        it is waiting for would be queued behind the wait itself.
        """
        import threading

        self.c.connect()
        self.c.on_line(self._feed)
        threading.Thread(target=self.c.run, daemon=True).start()

        if self.sight_picture_enabled:
            self.enable_sight_picture(self.sight_picture_interval)

    def _run_step(self, i: int, step: Step) -> None:
        """Run one step: the `when` gate, the commands, then `until` or
        `settle`. Pulled out of `run()`'s loop body for the same reason as
        `_connect_and_start_reader` - `Routine` runs steps drawn from
        whichever of several step lists the character's state currently
        calls for, one at a time, and needs this exact logic without a fixed
        `self.steps` to loop over."""
        if step.when and not step.when(self):
            print(f"  {i}. {step.label} - skipped, condition not met")
            return

        print(f"  {i}. {step.label}")
        for command in step.commands:
            if self._stopping:
                return
            self.do(command)

        if step.until:
            if not self._await(step.until, step.timeout):
                # Said out loud rather than moving on quietly. A step whose
                # expected message never arrived is the single most useful
                # thing to know when a flow behaves oddly, and it is
                # invisible otherwise.
                print(
                    f"     (timed out after {step.timeout:.0f}s waiting for "
                    f"/{step.until}/ - continuing)"
                )
        elif step.settle:
            time.sleep(step.settle)

    def run(self) -> None:
        """Connect, then walk `self.steps` in order, looping if `self.loops`."""
        self._connect_and_start_reader()

        print(f"{self.title}" + (f" - {self.summary}" if self.summary else ""))
        if self.loops:
            print("This flow repeats until stopped. Ctrl+C to stop.")
        if self.sight_picture_enabled:
            print(
                f"Building a sight picture in the background every "
                f"~{self.sight_picture_interval:.0f}s, between real actions."
            )
        print()

        try:
            while True:
                for i, step in enumerate(self.steps, 1):
                    if self._stopping:
                        return
                    self._run_step(i, step)

                if not self.loops:
                    print("\ndone.")
                    return
        except KeyboardInterrupt:
            print("\nstopped.")
        finally:
            # Set first, same reasoning as `self.c.stop()` below applied to
            # the sight-picture thread: it polls `self._stopping` once a
            # second (see `Task.enable_sight_picture`) and would otherwise
            # keep trying to tick - harmlessly, since `self.c.send` still
            # works, but pointlessly, on a flow that has already finished.
            self._stopping = True
            # Tell the reader to stop *before* closing the socket it is
            # blocked on, so it treats the close as expected rather than as a
            # failure. Closing first is a race the reader loses noisily.
            self.c.stop()
            self.c.close()
