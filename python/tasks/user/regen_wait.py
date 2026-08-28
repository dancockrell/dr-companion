"""Wait until a vital recovers to a target percent, then stop - nothing else.

    python python/tasks/user/regen_wait.py --vital mana --to 90
    python python/tasks/user/regen_wait.py --vital spirit --to 100 --rest
    python python/runner.py run user.regen_wait

The Genie category this replaces: a "wait for mana" trigger a caster runs
between fights, usually copy-pasted per spell school with the threshold
hand-edited each time. This is one script, any vital, any threshold.

Read-only unless `--rest` is given, in which case it sends `rest` once at the
start and `stand` once when the target is reached - the two commands that
bookend resting in DR. Exits the moment the threshold is met; it does not
loop or re-check afterwards, so it is safe to chain after a hunting flow
("recover, then wait for mana, then go again") without it lingering.

Uses `Task.on_vitals`, so - like `vitals_monitor.py` - a vital the game has
never reported is `NaN`, not `0`: this waits rather than declaring "already
there" on a vital it has not seen yet.

`--timeout` (default 30 minutes) is the bound every other wait in this task
library has and this one was missing until it was pointed out: an interrupt
mid-rest, a vital that stops updating, or a target that was simply too high
for the character's regen rate would otherwise leave this running
indefinitely with nothing to say it was stuck rather than still working.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import Task, Vital  # noqa: E402

DEFAULT_TIMEOUT = 1800.0


class RegenWait(Task):
    def __init__(self, vital: str, to: float, rest: bool, timeout: float) -> None:
        super().__init__()
        self.vital_name = vital
        self.to = to
        self.rest = rest
        self.timeout = timeout
        self._done = False

    def on_start(self) -> None:
        print(f"regen_wait: waiting for {self.vital_name} >= {self.to:.0f}% - attached: {self.c.status()}")
        if self.rest:
            self.do("rest")
        threading.Thread(target=self._watchdog, daemon=True).start()

    def _watchdog(self) -> None:
        time.sleep(self.timeout)
        if self._done or self._stopping:
            return
        self._done = True
        print(f"regen_wait: gave up after {self.timeout:.0f}s without reaching {self.to:.0f}%")
        # Standing on timeout too, not just on success - --rest sent 'rest'
        # at the start, and leaving the character resting with nothing
        # watching any more is worse than standing them up short of the
        # target.
        if self.rest:
            self.do("stand")
        self.stop()

    def on_vitals(self, vitals: dict[str, Vital]) -> None:
        if self._done:
            return
        v = vitals.get(self.vital_name)
        if v is None:
            return
        print(f"regen_wait: {self.vital_name} {v.current}/{v.max} ({v.percent:.0f}%)")
        if v.percent >= self.to:
            self._done = True
            print(f"regen_wait: reached {self.to:.0f}% - done")
            if self.rest:
                self.do("stand")
            self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--vital",
        default="mana",
        choices=["health", "mana", "spirit", "stamina", "concentration"],
        help="which vital to wait on (default mana)",
    )
    parser.add_argument("--to", type=float, default=100.0, help="target percent (default 100)")
    parser.add_argument(
        "--rest", action="store_true", help="send 'rest' at the start and 'stand' once the target is reached"
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"give up after this many seconds (default {DEFAULT_TIMEOUT:.0f} = 30 min)",
    )
    args = parser.parse_args()

    task = RegenWait(args.vital, args.to, args.rest, args.timeout)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
