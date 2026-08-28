"""Watch health/mana/stamina/spirit/concentration as the game reports them,
and act before you would have noticed yourself.

    python python/tasks/user/vitals_monitor.py
    python python/tasks/user/vitals_monitor.py --vital health --threshold 40 \\
        --on-critical-command "force healer" --cooldown 90
    python python/runner.py run user.vitals_monitor

Genie's health bar is read-only: a player watches four numbers and decides
what to do. This reads the same numbers - via `drtask.Task.on_vitals`, so it
inherits `drtask.py`'s NaN-until-reported handling rather than mistaking an
unreported vital for zero - and adds the one thing a human eyeball cannot do
reliably at 2am: cross a threshold and act on it, every time, with a cooldown
so a vital sitting under the line does not re-trigger every single update.

`--on-critical-command` is a raw Lich command (no leading `;`) sent through
`do()` the moment the named vital drops at or below `--threshold`, then left
alone for `--cooldown` seconds.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import Task, Vital  # noqa: E402


class VitalsMonitor(Task):
    def __init__(self, vital: str, threshold: float, on_critical_command: str, cooldown: float, quiet: bool) -> None:
        super().__init__()
        self.vital_name = vital
        self.threshold = threshold
        self.on_critical_command = on_critical_command
        self.cooldown = cooldown
        self.quiet = quiet
        self._previous: dict[str, Vital] = {}
        self._last_trigger = -1e9

    def on_start(self) -> None:
        print(f"vitals_monitor: watching - attached: {self.c.status()}")

    def on_vitals(self, vitals: dict[str, Vital]) -> None:
        for vid, v in vitals.items():
            was = self._previous.get(vid)
            crossed_down = was is not None and was.percent > self.threshold >= v.percent
            if not self.quiet or crossed_down:
                print(f"vitals: {vid} {v.current}/{v.max} ({v.percent:.0f}%)")

            if vid == self.vital_name and v.percent <= self.threshold and self.on_critical_command:
                now = time.monotonic()
                if now - self._last_trigger >= self.cooldown:
                    self._last_trigger = now
                    print(f"vitals: {vid} at {v.percent:.0f}% - sending '{self.on_critical_command}'")
                    # wait_rt=False: same reasoning as watchlist.py - a
                    # ;-prefixed Lich command never reaches the game, so
                    # there is no roundtime to wait out.
                    self.do(f";{self.on_critical_command}", wait_rt=False)
        self._previous = {k: Vital(v.current, v.max) for k, v in vitals.items()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--vital",
        default="health",
        choices=["health", "mana", "spirit", "stamina", "concentration"],
        help="which vital triggers --on-critical-command (default health)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=50.0,
        help="percent at or below which the vital is 'critical' (default 50)",
    )
    parser.add_argument(
        "--on-critical-command",
        default="",
        help="raw Lich command (without the leading ;) sent when --vital crosses --threshold",
    )
    parser.add_argument(
        "--cooldown",
        type=float,
        default=60.0,
        help="seconds before --on-critical-command can fire again (default 60)",
    )
    parser.add_argument(
        "--quiet", action="store_true", help="only print on a threshold crossing, not every update"
    )
    args = parser.parse_args()

    task = VitalsMonitor(args.vital, args.threshold, args.on_critical_command, args.cooldown, args.quiet)
    try:
        task.run()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
