"""Send an ordered list of prep/buff commands once, each paced by roundtime
rather than a guessed delay.

    python python/tasks/user/buff_sequence.py --commands "cast 906;cast 911;bless my weapon"
    python python/runner.py run user.buff_sequence

The Genie category this replaces: a per-guild "buffup"/"prep" macro, usually
a flat list of spell/skill commands fired one after another. This is that
list, generalized - one script, any sequence, `--commands` is yours to
configure per character. `do()` already waits out roundtime between each
command, so this does not need to guess how long a spell takes to cast the
way a fixed-sleep macro does.

Deliberately does not read the game's replies - unlike most tasks in this
folder, there is nothing here to parse (a cast succeeding or fizzling is
between you and the game); this just fires the list once, in order, and
exits.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import Task  # noqa: E402


class BuffSequence(Task):
    def __init__(self, commands: list[str]) -> None:
        super().__init__()
        self.commands = commands

    def on_start(self) -> None:
        print(f"buff_sequence: {self.commands} - attached: {self.c.status()}")
        for i, command in enumerate(self.commands, 1):
            if self._stopping:
                return
            print(f"buff_sequence: ({i}/{len(self.commands)}) {command}")
            self.do(command)
        print("buff_sequence: done")
        self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--commands", required=True, help="';'-separated commands, sent in order")
    args = parser.parse_args()

    commands = [c.strip() for c in args.commands.split(";") if c.strip()]
    if not commands:
        parser.error("--commands produced no commands")

    task = BuffSequence(commands)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
