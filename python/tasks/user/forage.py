"""Search the room for reagents/herbs on a loop, and stop when you say to.

    python python/tasks/user/forage.py
    python python/tasks/user/forage.py --command "forage" --max-finds 20
    python python/runner.py run user.forage

The Genie category this replaces: a herb-running trigger that sends a search
command, waits, sends it again, and stops when the room or your hands are
exhausted - normally built from a handful of hand-tuned regexes per player.

A background thread resends `--command` (`do()` still waits out roundtime and
enforces the rate cap between sends - nothing here bypasses either), while
the main line-reading loop watches for the phrases that mean "nothing left
here" or "your hands are full" and stops the loop. `--max-finds` is a second,
independent backstop, so a wording this task fails to recognise cannot turn
it into an unbounded loop nobody is watching.

All of the message matching is text-based - like the rest of this repo's
text-matched heuristics, it is a reasonable guess at DR's phrasing, not
something verified against a live game, so tune `--nothing-here`/`--hands-full`
if your server's wording differs.
"""

from __future__ import annotations

import argparse
import re
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import CleanLine, Task  # noqa: E402


class Forage(Task):
    def __init__(
        self, command: str, max_finds: int, nothing_here: re.Pattern[str], hands_full: re.Pattern[str]
    ) -> None:
        super().__init__()
        self.command = command
        self.max_finds = max_finds
        self.nothing_here = nothing_here
        self.hands_full = hands_full
        self.finds = 0

    def on_start(self) -> None:
        print(f"forage: '{self.command}' up to {self.max_finds} finds - attached: {self.c.status()}")
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self) -> None:
        while not self._stopping:
            self.do(self.command)
            time.sleep(0.5)

    def on_clean(self, line: CleanLine) -> None:
        if self.hands_full.search(line.text):
            print(f"forage: hands full after {self.finds} finds - stopping")
            self.stop()
            return
        if self.nothing_here.search(line.text):
            print(f"forage: nothing left here after {self.finds} finds - stopping")
            self.stop()
            return
        if "you find" in line.text.lower() or "you discover" in line.text.lower():
            self.finds += 1
            print(f"forage: find #{self.finds} - {line.text}")
            if self.finds >= self.max_finds:
                print(f"forage: reached --max-finds ({self.max_finds}) - stopping")
                self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--command", default="forage", help="the search command to repeat (default 'forage')")
    parser.add_argument("--max-finds", type=int, default=30, help="stop after this many finds (default 30)")
    parser.add_argument(
        "--nothing-here", default=r"nothing (else )?(here|worth)", help="regex meaning the room is exhausted"
    )
    parser.add_argument(
        "--hands-full", default=r"(your hands are full|already holding)", help="regex meaning you must stow first"
    )
    args = parser.parse_args()

    task = Forage(
        args.command,
        args.max_finds,
        re.compile(args.nothing_here, re.IGNORECASE),
        re.compile(args.hands_full, re.IGNORECASE),
    )
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
