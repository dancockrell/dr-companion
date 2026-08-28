"""Meditate until a vital reaches a target, then stand back up.

    python python/tasks/user/meditate.py --vital spirit --to 100
    python python/runner.py run user.meditate

The Genie category this replaces: a "medstop" trigger tied to a specific
spirit or mana threshold, usually copy-pasted per character. This is
`regen_wait.py`'s shape with DR's own `meditate` verb instead of `rest` -
kept as a separate script rather than a flag on `regen_wait.py` because
meditating and resting are different postures with different game commands,
and a single script silently picking one based on a flag reads less clearly
than two scripts named for what they actually send.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import Task, Vital  # noqa: E402


class Meditate(Task):
    def __init__(self, vital: str, to: float) -> None:
        super().__init__()
        self.vital_name = vital
        self.to = to

    def on_start(self) -> None:
        print(f"meditate: waiting for {self.vital_name} >= {self.to:.0f}% - attached: {self.c.status()}")
        self.do("meditate")

    def on_vitals(self, vitals: dict[str, Vital]) -> None:
        v = vitals.get(self.vital_name)
        if v is None:
            return
        print(f"meditate: {self.vital_name} {v.current}/{v.max} ({v.percent:.0f}%)")
        if v.percent >= self.to:
            print(f"meditate: reached {self.to:.0f}% - standing")
            self.do("stand")
            self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--vital",
        default="spirit",
        choices=["health", "mana", "spirit", "stamina", "concentration"],
        help="which vital to wait on (default spirit)",
    )
    parser.add_argument("--to", type=float, default=100.0, help="target percent (default 100)")
    args = parser.parse_args()

    task = Meditate(args.vital, args.to)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
