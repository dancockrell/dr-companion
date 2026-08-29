"""The seven built-in task flows, in Python.

    python python/tasks/flows.py              list them
    python python/tasks/flows.py recover      run one

Ported from `src/data/taskFlows.ts`. The commands are unchanged - they were
chosen because they had already been used against the live game rather than
invented, and re-deriving them here would throw that away for nothing.

What changed is everything around them, and each change is the reason for
moving rather than a side effect of it:

  conditions   were strings parsed by src/lib/flowConditions.ts; now they are
               ordinary expressions, so the parser is not needed
  settle       fixed timers become `until`, which waits for what the game
               actually says, with the timer demoted to a backstop
  safety       unchanged - drtask's rate cap and roundtime handling apply to
               every command below

# A warning worth reading before running any of these

Five of the seven send commands to a live character: they attack, loot, walk,
sleep and flee. `watch.py` is the one that sends nothing. Run these on a
character you are willing to have act on its own, in a place you have looked
at first, and stay at the keyboard - a flow is an assistant, not an autopilot,
and the two that loop will keep going until you stop them.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dr_companion import Companion  # noqa: E402
from flow import Flow, Step  # noqa: E402


def hunt(companion: Optional[Companion] = None) -> Flow:
    return Flow(
        companion=companion,
        title="Hunt cycle",
        summary="Attack, loot, skin, tend. Repeats until stopped.",
        loops=True,
        # A hunt runs for a long time and spends real stretches waiting -
        # `wait_rt()` before the next attack, `until` while looting settles -
        # which is exactly the downtime a sight picture is for. See
        # drtask.py's SightPicture: this never delays an attack, it only
        # spends seconds the flow was already going to spend waiting.
        sight_picture_enabled=True,
        steps=[
            # `until` rather than a bare settle: the game says when the swing
            # resolved, and waiting for that beats guessing at a duration that
            # changes with weapon, stance and target.
            Step("Attacking", ["attack"], until=r"you (hit|miss|swing)|roundtime", timeout=20),
            Step("Looting", ["get all", "get coins"], settle=1),
            Step("Skinning", ["skin"], settle=1),
            # Was `condition: 'bleeding'`, a string the TypeScript grammar had
            # to parse. Here it is the expression it always was.
            Step("Tending", ["tend my worst"], when=lambda f: f.bleeding),
        ],
    )


def ambush() -> Flow:
    return Flow(
        title="Ambush cycle",
        summary="Hidden opener, loot, back to guarded. Repeats until stopped.",
        loops=True,
        sight_picture_enabled=True,
        steps=[
            Step("Setting the stance", ["stance offensive"]),
            Step("Ambushing", ["ambush"], until=r"you (hit|miss)|roundtime", timeout=20),
            Step("Looting", ["get all", "get coins"], settle=1),
            Step("Back to guarded", ["stance guarded"]),
        ],
    )


def recover(companion: Optional[Companion] = None) -> Flow:
    return Flow(
        companion=companion,
        title="Recover",
        summary="Check the damage, tend it, rest.",
        steps=[
            Step("Reading the damage", ["diagnose"], until=r"you have|no injuries", timeout=10),
            # Only if there is something to tend. The TypeScript version tended
            # unconditionally, which on an unhurt character is a wasted command
            # and a wasted roundtime.
            Step("Tending the worst", ["tend my worst"], when=lambda f: f.bleeding),
            Step("Guarded stance", ["stance guarded"]),
            Step("Resting", ["sleep"], settle=2),
        ],
    )


def to_healer(companion: Optional[Companion] = None) -> Flow:
    return Flow(
        companion=companion,
        title="Go to a healer",
        summary="Stow, walk to the healer, show the damage.",
        steps=[
            Step("Stowing", ["stow all"], settle=1),
            # The clearest case for `until`. Walking took a flat 3 seconds in
            # TypeScript whether the healer was next door or across town.
            Step("Walking to the healer", ["go healer"], until=r"Empath|healer|infirmary", timeout=45),
            Step("Showing the damage", ["diagnose"]),
        ],
    )


def town_run() -> Flow:
    return Flow(
        title="Town run",
        summary="Bank the coins, then somewhere safe.",
        steps=[
            Step("Stowing", ["stow all"], settle=1),
            Step("Walking to the bank", ["go bank"], until=r"[Bb]ank|teller|clerk", timeout=45),
            Step("Counting it", ["wealth"], settle=1),
            Step("Somewhere safe", ["go safe"], until=r"safe|inn|hall", timeout=45),
        ],
    )


def prepare() -> Flow:
    return Flow(
        title="Prepare to fight",
        summary="Refresh, harness, offensive stance.",
        steps=[
            Step("Checking what is up", ["spells"], settle=1),
            Step("Refreshing", ["spell refresh"], settle=2),
            # Only harness if there is mana worth harnessing. Unconditional in
            # TypeScript, and a failed harness is a wasted roundtime at exactly
            # the moment before a fight.
            Step("Harnessing", ["harness 20"], when=lambda f: f.mana.percent > 20, settle=1),
            Step("Offensive stance", ["stance offensive"]),
        ],
    )


def disengage() -> Flow:
    return Flow(
        title="Break off",
        summary="Defensive, retreat, flee.",
        steps=[
            Step("Defensive stance", ["stance defensive"]),
            Step("Retreating", ["retreat"], settle=1),
            Step("Fleeing", ["flee"], settle=1),
        ],
    )


FLOWS = {
    "hunt": hunt,
    "ambush": ambush,
    "recover": recover,
    "to-healer": to_healer,
    "town-run": town_run,
    "prepare": prepare,
    "disengage": disengage,
}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] not in FLOWS:
        print("Flows:\n")
        for name, make in FLOWS.items():
            f = make()
            loops = "  (repeats until stopped)" if f.loops else ""
            print(f"  {name:<12} {f.title}{loops}")
            print(f"  {'':<12} {f.summary}")
        print("\n  python python/tasks/flows.py <name>")
        print("\nAll of these send real commands to a live character.")
        print("python/tasks/watch.py sends nothing, if you want to check the")
        print("connection first.")
        return 0 if len(sys.argv) < 2 else 2

    FLOWS[sys.argv[1]]().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
