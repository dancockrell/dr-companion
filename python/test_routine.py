"""Routine (tasks/routine.py) - the hunt/recover/healer state machine.

Only `_pick_mode()` is tested here, against a fake Companion - no running app
needed. That is the one piece of judgment in the file (see its own module
docstring: "the thresholds below are the only opinion"); `run()` itself is
just `Flow._run_step` in a loop, already covered by test_flow.py.

Run:

    python python/test_routine.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from drtask import Vital
from tasks.routine import CRITICAL_AT, HURT_AT, RECOVERED_AT, Routine

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
    def send(self, command: str) -> None:
        pass

    def stop(self) -> None:
        pass

    def close(self) -> None:
        pass

    def connect(self) -> None:
        pass

    def on_line(self, fn) -> None:
        pass


def routine_at(mode: str, percent: float) -> Routine:
    r = Routine(companion=FakeCompanion())
    r._mode = mode
    r.vitals["health"] = Vital(int(percent), 100)
    return r


print("-- starts in hunt, and a vital that has never arrived changes nothing --")
r0 = Routine(companion=FakeCompanion())
ok("starts in hunt", r0._mode == "hunt")
ok(
    "no health report yet: NaN compares false both ways, so the mode holds",
    r0._pick_mode() == "hunt",
    r0._pick_mode(),
)

print()
print("-- hunting, health drops: two different landings depending on how far --")
ok(
    f"just under {HURT_AT:.0f}% while hunting -> recover",
    routine_at("hunt", HURT_AT - 1)._pick_mode() == "recover",
)
ok(
    f"at exactly {HURT_AT:.0f}% while hunting -> still hunt (the threshold is exclusive)",
    routine_at("hunt", HURT_AT)._pick_mode() == "hunt",
)
ok(
    f"under {CRITICAL_AT:.0f}% while hunting -> straight to healer, not recover",
    routine_at("hunt", CRITICAL_AT - 1)._pick_mode() == "healer",
)
ok(
    "comfortably healthy while hunting -> stays hunt",
    routine_at("hunt", 95)._pick_mode() == "hunt",
)

print()
print("-- recovering: only resumes hunting once genuinely recovered --")
ok(
    f"just under {RECOVERED_AT:.0f}% while recovering -> keeps recovering",
    routine_at("recover", RECOVERED_AT - 1)._pick_mode() == "recover",
)
ok(
    f"at {RECOVERED_AT:.0f}% while recovering -> resumes hunting",
    routine_at("recover", RECOVERED_AT)._pick_mode() == "hunt",
)
ok(
    "does not flap: healthy enough to stop being critical, "
    "but not enough to resume hunting, holds the current mode",
    routine_at("recover", (HURT_AT + RECOVERED_AT) / 2)._pick_mode() == "recover",
)

print()
print("-- recovering gets worse, not better: escalates to a healer --")
ok(
    f"drops under {CRITICAL_AT:.0f}% while recovering -> escalates to healer",
    routine_at("recover", CRITICAL_AT - 1)._pick_mode() == "healer",
)

print()
print("-- healer-bound: same resume rule as recovering --")
ok(
    "not yet recovered while healer-bound -> keeps heading to the healer",
    routine_at("healer", HURT_AT)._pick_mode() == "healer",
)
ok(
    f"reaches {RECOVERED_AT:.0f}% while healer-bound -> resumes hunting",
    routine_at("healer", RECOVERED_AT)._pick_mode() == "hunt",
)

print()
print("-- the three modes actually resolve to the real, distinct step lists --")
r1 = Routine(companion=FakeCompanion())
hunt_steps = r1._steps_for("hunt")
recover_steps = r1._steps_for("recover")
healer_steps = r1._steps_for("healer")
ok("hunt steps are non-empty", len(hunt_steps) > 0)
ok(
    "recover and healer are different step lists from hunt and from each other",
    recover_steps is not hunt_steps and healer_steps is not hunt_steps and recover_steps is not healer_steps,
)
ok(
    "hunt's first step is actually attacking, not some placeholder",
    "attack" in hunt_steps[0].commands,
    repr(hunt_steps[0].commands),
)

print()
ok("enough was checked for a pass to mean something", checked >= 14, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
