"""Log every tagged channel to its own timestamped file, and know it did.

    python python/tasks/user/channel_logger.py
    python python/tasks/user/channel_logger.py --channels thoughts,death
    python python/runner.py run user.channel_logger

Genie players who want a permanent thoughts/deaths/talk log build it out of
named windows and a "log this window" checkbox - a UI setting with no record
of whether it was actually on, and no way to log a channel you did not think
to make a window for ahead of time.

This logs every channel `drtask.py`'s parser labels, by default, to
`logs/<channel>.log`, one line per message, each stamped with wall-clock time
and the game's own `Line.seq`. Read-only: it never calls `do()`.
"""

from __future__ import annotations

import argparse
import datetime
import sys
from pathlib import Path
from typing import TextIO

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import CleanLine, Task  # noqa: E402


class ChannelLogger(Task):
    def __init__(self, wanted: set[str], out_dir: Path) -> None:
        super().__init__()
        self.wanted = wanted
        self.out_dir = out_dir
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self._handles: dict[str, TextIO] = {}
        self._counts: dict[str, int] = {}

    def on_start(self) -> None:
        print(f"channel_logger: watching {sorted(self.wanted)} - attached: {self.c.status()}")

    def _handle_for(self, channel: str) -> TextIO:
        if channel not in self._handles:
            path = self.out_dir / f"{channel}.log"
            self._handles[channel] = path.open("a", encoding="utf-8")
            print(f"channel_logger: logging '{channel}' to {path}")
        return self._handles[channel]

    def on_clean(self, line: CleanLine) -> None:
        if line.stream not in self.wanted or not line.text.strip():
            return
        handle = self._handle_for(line.stream)
        stamp = datetime.datetime.now().isoformat(timespec="seconds")
        handle.write(f"[{stamp}] (seq {line.seq}) {line.text}\n")
        handle.flush()
        self._counts[line.stream] = self._counts.get(line.stream, 0) + 1

    def stop(self) -> None:
        super().stop()
        for handle in self._handles.values():
            handle.close()
        logged = {k: v for k, v in self._counts.items() if v}
        print(f"channel_logger: stopped. lines logged this run: {logged or 'none'}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--channels",
        default="thoughts,talk,death,whispers,logons,room,inv",
        help="comma-separated channel names (default: thoughts,talk,death,whispers,logons,room,inv)",
    )
    parser.add_argument(
        "--dir", default="logs", help="directory to write <channel>.log files into (default: ./logs)"
    )
    args = parser.parse_args()

    wanted = {ch.strip() for ch in args.channels.split(",") if ch.strip()}
    task = ChannelLogger(wanted, Path(args.dir))
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()


if __name__ == "__main__":
    main()
