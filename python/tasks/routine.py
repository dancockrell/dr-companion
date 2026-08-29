"""Routine: hunt until hurt, recover or seek a healer, then resume.

The answer to "what workflow builds ideal character growth": a player
running `hunt` by hand, watching health, and switching to `recover` (or
walking to a healer when it's worse than that) is the actual loop most
training sessions already are. This automates the *switch*, not the
judgment underneath it - the thresholds below are the only opinion in the
file, chosen conservative on purpose, and are the first thing worth tuning
for a given class, weapon, or comfort level.

    python python/tasks/routine.py

# Why this is not three flows chained with `settle`

`hunt` and `ambush` already loop forever on their own - there is no point in
their step lists where control naturally returns to a caller who could then
decide "actually, go recover instead." Composing at the flow level would
mean starting `hunt()`, waiting for it to finish (it never does), then
starting `recover()` - which never happens.

So this composes at the *step* level instead, reusing the exact step lists
`tasks/flows.py` already defines (imported, not duplicated - a change to
`hunt()`'s steps is picked up here automatically) via `Flow._run_step`, the
same method `Flow.run()` itself calls. Health is checked between every
single step, not once per full pass through a step list, so a bad hit
partway through a hunt cycle is acted on after that one step finishes, not
after looting and skinning too.

# Two thresholds, not one

`HURT_AT` breaks off hunting; `RECOVERED_AT` is what "healthy again" means
before resuming. They are different numbers on purpose - a single threshold
would have the routine flap between hunting and recovering every time health
crossed it by one point in either direction, which reads as broken even
though each individual switch was "correct" in isolation.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flow import Flow, Step  # noqa: E402
from tasks import flows as _flows  # noqa: E402

#: Break off hunting and switch to recovering (or seeking a healer) once
#: health drops below this.
HURT_AT = 60.0
#: Resume hunting only once health has climbed back above this - not the
#: same number as HURT_AT. See the module docstring.
RECOVERED_AT = 90.0
#: Below this, recovering in place is unlikely to be enough - walk to a
#: healer instead of tending and resting where you are.
CRITICAL_AT = 30.0

Mode = str  # "hunt" | "recover" | "healer" - a plain str, not an Enum: the
# only things that ever compare it are `==` against these three literals,
# in one small file, and an Enum here would be ceremony over three strings.


class Routine(Flow):
    title = "Routine: hunt, recover, repeat"
    summary = "Hunts until hurt, recovers (or finds a healer), then resumes."
    loops = True
    sight_picture_enabled = True

    def __init__(self, **kw) -> None:
        super().__init__(**kw)
        # Starts hunting. If the character is actually already hurt when
        # this begins, the very first `_pick_mode()` call corrects it before
        # a single command is sent - see `_pick_mode`'s own handling of a
        # vital that has already arrived by then.
        self._mode: Mode = "hunt"

    def _steps_for(self, mode: Mode) -> Sequence[Step]:
        if mode == "hunt":
            return _flows.hunt().steps
        if mode == "recover":
            return _flows.recover().steps
        return _flows.to_healer().steps

    def _pick_mode(self) -> Mode:
        """What mode the character's current health calls for.

        A vital nobody has reported yet is NaN (see `Vital.percent`), and
        every comparison against NaN is False - so before the first health
        line ever arrives this correctly does nothing and stays in whatever
        mode it already was (`hunt`, the constructor's default), rather than
        guessing.
        """
        pct = self.health.percent
        if pct != pct:  # the standard, portable way to spell "is NaN"
            return self._mode
        if self._mode == "hunt":
            if pct < CRITICAL_AT:
                return "healer"
            if pct < HURT_AT:
                return "recover"
            return "hunt"
        # Recovering or healer-bound: only resume hunting once genuinely
        # recovered, and escalate from "recover" to "healer" if it turns out
        # to be worse than first thought rather than waiting for recover()
        # to finish tending on its own.
        if pct >= RECOVERED_AT:
            return "hunt"
        if pct < CRITICAL_AT:
            return "healer"
        return self._mode

    def run(self) -> None:
        self._connect_and_start_reader()

        print(f"{self.title} - {self.summary}")
        print("Repeats until stopped, switching mode as health changes. Ctrl+C to stop.")
        print(
            f"Hunt below {HURT_AT:.0f}% breaks off; resumes above {RECOVERED_AT:.0f}%; "
            f"below {CRITICAL_AT:.0f}% goes to a healer instead of recovering in place."
        )
        print()

        try:
            while not self._stopping:
                self._mode = self._pick_mode()
                steps = self._steps_for(self._mode)
                print(f"[{self._mode}]")
                for i, step in enumerate(steps, 1):
                    if self._stopping:
                        return
                    self._run_step(i, step)
                    # Re-checked after every step, not after the whole list -
                    # see the module docstring on why health is checked this
                    # often rather than once per pass.
                    next_mode = self._pick_mode()
                    if next_mode != self._mode:
                        break
                # A step list with nothing in it (should not happen - every
                # built-in flow has at least one step) would otherwise spin
                # here at full speed re-picking the same mode forever.
                if not steps:
                    time.sleep(1.0)
        except KeyboardInterrupt:
            print("\nstopped.")
        finally:
            self._stopping = True
            self.c.stop()
            self.c.close()


def main() -> Routine:
    """Returns a `Routine`, not its result - the same shape `runner.py`'s
    `_user()` loader and every user script in `tasks/user/README.md` use:
    `main()` returns something with `.run()`, and the caller runs it."""
    return Routine()


if __name__ == "__main__":
    main().run()
