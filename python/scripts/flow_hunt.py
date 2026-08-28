"""A pure Python hunting loop, built on `flow.py`.

The Genie/dr-scripts equivalent of this is a combat macro chained by hand:
attack, wait a guessed number of seconds, loot, wait again, skin, wait again,
tend if bleeding. This is the same shape as `src/data/taskFlows.ts`'s built-in
`hunt` flow (attack / loot / skin / tend, loops, tends only while bleeding) -
same idea, rebuilt for the raw stream instead of the bridge, and with two real
upgrades a fixed `settle` number cannot give you:

- Looting and skinning wait for the game's own `<prompt>` tag instead of a
  guessed sleep - see `streamkit.has_prompt`. A slow server gets waited for
  properly; a fast one is not held up by a sleep sized for the slow case.
- "Tend only while bleeding" reads `IconBLEEDING` off the live stream
  (`streamkit.indicators_in`), not a bridge-reported flag - this script does
  not need the bridge at all.

    python python/scripts/flow_hunt.py
    python python/scripts/flow_hunt.py --attack "cast 906" --settle 2
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import threading

from dr_companion import Companion
from flow import Flow, FlowRunner, Step


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--attack", default="attack", help="the command that starts a fight (default 'attack')")
    parser.add_argument(
        "--settle", type=float, default=1.0, help="seconds to wait after looting/skinning (default 1)"
    )
    args = parser.parse_args()

    hunt = Flow(
        id="hunt",
        title="Hunt cycle",
        summary="Attack, loot, skin, tend. Repeats until stopped.",
        loops=True,
        steps=[
            Step("Attacking", commands=[args.attack]),
            Step("Looting", commands=["get all", "get coins"], wait="settle", settle=args.settle),
            Step("Skinning", commands=["skin"], wait="settle", settle=args.settle),
            Step("Tending", commands=["tend my worst"], condition="bleeding"),
        ],
    )

    c = Companion()
    runner = FlowRunner(c)

    # status() connects and reads its reply on this thread; only once that
    # round trip is done does the background reader start reading the same
    # socket - dr_companion.py's own socket reads are not safe to call from
    # two threads at once, so the two must not overlap.
    print(f"flow_hunt: attached: {c.status()}")
    threading.Thread(target=c.run, daemon=True).start()

    print("flow_hunt: running - Ctrl+C to stop")
    try:
        runner.run(hunt)
    except KeyboardInterrupt:
        runner.stop()
        print("flow_hunt: stopped")


if __name__ == "__main__":
    main()
