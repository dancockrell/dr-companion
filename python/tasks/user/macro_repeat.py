"""Repeat one or more commands a fixed number of times, with a real pause
between each - the generic building block under half the Genie "macro"
category.

    python python/tasks/user/macro_repeat.py --commands "bow;wave" --times 10
    python python/tasks/user/macro_repeat.py --commands "meditate" --times 1000 --settle 5
    python python/runner.py run user.macro_repeat

Genie players keep a folder of one-off macros for exactly this: an emote
loop, a repeated skill practice, a fixed-count ritual. Rather than one script
per macro, this is the macro - `--commands` is a `;`-separated list sent in
order, `--times` is how many full passes, `--settle` is the pause after each
full pass (on top of whatever roundtime `do()` already waits out between the
individual commands in a pass).
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import Task  # noqa: E402


class MacroRepeat(Task):
    def __init__(self, commands: list[str], times: int, settle: float) -> None:
        super().__init__()
        self.commands = commands
        self.times = times
        self.settle = settle

    def on_start(self) -> None:
        print(f"macro_repeat: {self.commands} x{self.times} - attached: {self.c.status()}")
        for i in range(1, self.times + 1):
            if self._stopping:
                return
            print(f"macro_repeat: pass {i}/{self.times}")
            for command in self.commands:
                if self._stopping:
                    return
                self.do(command)
            if i < self.times:
                time.sleep(self.settle)
        print("macro_repeat: done")
        self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--commands", required=True, help="';'-separated commands sent in order, each pass")
    parser.add_argument("--times", type=int, required=True, help="how many full passes")
    parser.add_argument("--settle", type=float, default=1.0, help="seconds between passes (default 1)")
    args = parser.parse_args()

    commands = [c.strip() for c in args.commands.split(";") if c.strip()]
    if not commands:
        parser.error("--commands produced no commands")
    if args.times < 1:
        parser.error("--times must be at least 1")

    task = MacroRepeat(commands, args.times, args.settle)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
