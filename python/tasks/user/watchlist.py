"""Alert when a name on your list shows up anywhere in the game text.

    python python/tasks/user/watchlist.py --names Wipsy,Grizzknot
    python python/tasks/user/watchlist.py --file watched-names.txt --cooldown 30
    python python/runner.py run user.watchlist

Genie's equivalent is a hand-built highlight: a regex per name, typed into a
`.cfg` file, that colours a line and maybe rings a bell. This does the same
job with names that live in a plain text file you can edit while the task
runs, and one alert per line so it does not repeat every time the game
reprints a room description mentioning the same name twice.

Matching is plain substring-on-word-boundary against tag-stripped text, so it
fires on a name mentioned in ordinary room text, a thought, a tell - anywhere
- not just a channel this task claims to label correctly. That is broader
than "who just walked in", on purpose: a name-spotter that only catches
arrivals misses the far more common case of someone talking about you.

Read-only by default. `--lich-command` (a raw command sent through `do()`,
without the leading `;`) turns a match into an action - point it at a script
that flees, or one that whispers a friend.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import CleanLine, Task  # noqa: E402

BELL = "\a"


class Watchlist(Task):
    def __init__(self, names: set[str], file_path: Path | None, cooldown: float, lich_command: str) -> None:
        super().__init__()
        self.names = names
        self.file_path = file_path
        self.cooldown = cooldown
        self.lich_command = lich_command
        self._last_reload = 0.0
        self._last_alert: dict[str, float] = {}
        self._patterns: dict[str, re.Pattern[str]] = {}

    def on_start(self) -> None:
        print(f"watchlist: watching for {sorted(self.names)} - attached: {self.c.status()}")

    def _pattern_for(self, name: str) -> re.Pattern[str]:
        if name not in self._patterns:
            self._patterns[name] = re.compile(rf"\b{re.escape(name)}\b")
        return self._patterns[name]

    def _maybe_reload(self) -> None:
        if self.file_path is None:
            return
        now = time.monotonic()
        if now - self._last_reload < 5.0:
            return
        self._last_reload = now
        if self.file_path.exists():
            fresh = {
                line.strip()
                for line in self.file_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            }
            added = fresh - self.names
            if added:
                print(f"watchlist: picked up new name(s) from {self.file_path}: {sorted(added)}")
            self.names = fresh

    def on_clean(self, line: CleanLine) -> None:
        self._maybe_reload()
        if not line.text.strip():
            return
        now = time.monotonic()
        for name in self.names:
            if not self._pattern_for(name).search(line.text):
                continue
            if now - self._last_alert.get(name, -1e9) < self.cooldown:
                continue
            self._last_alert[name] = now
            print(f"{BELL}watchlist: '{name}' - {line.text}")
            if self.lich_command:
                # wait_rt=False: a ;-prefixed command is intercepted by Lich
                # itself and never reaches the game, so there is no roundtime
                # to wait out - waiting anyway would just delay it behind
                # whatever roundtime the character happens to be in.
                self.do(f";{self.lich_command}", wait_rt=False)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--names", default="", help="comma-separated names to watch for")
    parser.add_argument(
        "--file",
        default="",
        help="a text file, one name per line, re-read every few seconds so you can edit it live",
    )
    parser.add_argument(
        "--cooldown",
        type=float,
        default=60.0,
        help="seconds before the same name can alert again (default 60)",
    )
    parser.add_argument(
        "--lich-command",
        default="",
        help="a raw Lich command (without the leading ;) sent on every match",
    )
    args = parser.parse_args()

    names = {n.strip() for n in args.names.split(",") if n.strip()}
    file_path = Path(args.file) if args.file else None
    if file_path and file_path.exists():
        names |= {line.strip() for line in file_path.read_text(encoding="utf-8").splitlines() if line.strip()}
    if not names:
        parser.error("nothing to watch for - pass --names and/or --file")

    task = Watchlist(names, file_path, args.cooldown, args.lich_command)
    try:
        task.run()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
