"""What a player's own workflow looks like. Copy this file and edit it.

    python python/tasks/example_custom.py

This is the answer to "how does a player wire scripts together with conditions
and branching", and the answer is deliberately boring: it is a Python file, and
branching is `if`.

# Why not a visual wiring editor, or a YAML workflow format

Both were considered and both recreate the problem this move was made to
escape. A declarative format starts as `condition: health<50`, then somebody
needs two gauges compared, then a count, then "unless we did this already" -
and now there is a grammar, a parser for it, and an editor that has to keep up
with both. That is exactly `src/lib/flowConditions.ts`, which is what moving to
Python deleted.

Python already has conditions, loops, branching and variables, all of them
better specified than anything that would be invented here, and every player
who has written a Lich script has met a scripting language before.

So the design goal is not a new abstraction. It is that the boring version is
*short*: a useful custom workflow should be about a dozen lines, and nothing
above should have to be understood before writing the first one.

# The three pieces

    Step(...)        one thing to do, with optional condition and wait
    Flow(...)        a sequence of Steps, optionally repeating
    on_clean()       react to what the game actually said

Everything below is those three.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flow import Flow, Step  # noqa: E402
from tasks.flows import recover, town_run  # noqa: E402


# ---------------------------------------------------------------- simple --
#
# A workflow is a list of steps. This is the whole of a useful one.

morning = Flow(
    title="Morning routine",
    summary="Wake up, check on things, get ready.",
    steps=[
        Step("Waking up", ["awaken"], settle=1),
        Step("Checking myself", ["health"], until=r"you (are|have)", timeout=8),
        Step("Checking the purse", ["wealth"], settle=1),
        # `when` is any expression. It receives the flow, so vitals, the last
        # line, and anything else the task knows are all in scope.
        Step("Eating something", ["eat bread"], when=lambda f: f.stamina.percent < 80),
    ],
)


# -------------------------------------------------------------- branching --
#
# For anything conditional beyond a single step, subclass and write the logic.
# `on_clean` sees every line, so a flow can decide based on what happened
# rather than on a timer.

class SmartRecover(Flow):
    """Tend if hurt, go to a healer if badly hurt, otherwise carry on.

    The branch a fixed step list cannot express: the *destination* depends on
    how bad the damage turned out to be, and that is only known after asking.
    """

    title = "Smart recover"
    summary = "Diagnose, then decide: tend here, or walk to a healer."

    def __init__(self) -> None:
        super().__init__(
            steps=[Step("Reading the damage", ["diagnose"], until=r"you have|no injuries", timeout=10)]
        )
        self.badly_hurt = False

    def on_clean(self, line) -> None:
        super().on_clean(line)
        # The game's own words decide, not a guess at a percentage.
        if any(w in line.text.lower() for w in ("severe", "grievous", "internal")):
            self.badly_hurt = True

    def run(self) -> None:
        super().run()

        # Branch on what was actually observed. This is the part a YAML
        # workflow format would need a whole feature for.
        if self.badly_hurt:
            print("\n-> badly hurt, heading for a healer")
            from tasks.flows import to_healer
            to_healer().run()
        elif self.health.percent < 90:
            print("\n-> minor damage, resting it off")
            recover().run()
        else:
            print("\n-> nothing worth treating")


# ------------------------------------------------------------- composing --
#
# Flows are ordinary objects, so chaining them is a loop. No wiring format
# needed: the relationship between two flows is that one `run()` follows
# another.

def after_hunting() -> None:
    """Recover, then bank what you picked up."""
    for step in (recover, town_run):
        step().run()


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which == "morning":
        morning.run()
    elif which == "smart-recover":
        SmartRecover().run()
    elif which == "after-hunting":
        after_hunting()
    else:
        print(__doc__.strip())
        print("\n  morning         a plain step list")
        print("  smart-recover   branching on what the game said")
        print("  after-hunting   two flows, one after the other")
        print("\n  python python/tasks/example_custom.py <name>")
