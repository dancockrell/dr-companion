"""Log every tagged channel to its own timestamped file, and know it did.

Genie players who want a permanent thoughts/deaths/talk log build it out of
named windows and a "log this window" checkbox - a UI setting with no record
of whether it was actually on, and no way to log a channel you did not think
to make a window for ahead of time.

This logs every channel `streamkit.KNOWN_STREAMS` names, by default, to
`<data-dir>/logs/<channel>.log`, one line per message, each stamped with a
wall-clock time and the running `Line.seq` so a log line can be matched back
to the exact moment in a replay. Pass `--channels` to log a subset.

    python python/scripts/channel_logger.py
    python python/scripts/channel_logger.py --channels thoughts,death
    python python/scripts/channel_logger.py --dir ~/dr-logs
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import datetime
from pathlib import Path
from typing import TextIO

import streamkit as sk
from dr_companion import Companion, Line


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--channels",
        default=",".join(sk.KNOWN_STREAMS),
        help=f"comma-separated channel names (default: all known - {', '.join(sk.KNOWN_STREAMS)})",
    )
    parser.add_argument(
        "--dir", default="logs", help="directory to write <channel>.log files into (default: ./logs)"
    )
    args = parser.parse_args()

    wanted = {ch.strip() for ch in args.channels.split(",") if ch.strip()}
    out_dir = Path(args.dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Opened once, kept open for the run rather than per line - a session can
    # log thousands of thoughts, and reopening a file every line is the kind
    # of thing that is invisible in testing and shows up as lag two hours in.
    handles: dict[str, TextIO] = {}

    def handle_for(channel: str) -> TextIO:
        if channel not in handles:
            path = out_dir / f"{channel}.log"
            handles[channel] = path.open("a", encoding="utf-8")
            print(f"channel_logger: logging '{channel}' to {path}")
        return handles[channel]

    counts: dict[str, int] = {ch: 0 for ch in wanted}

    c = Companion()

    @c.on_line
    def watch(line: Line) -> None:
        for stream_id, inner in sk.tagged_segments(line.text):
            if stream_id not in wanted:
                continue
            text = sk.strip_tags(inner).strip()
            if not text:
                continue
            handle = handle_for(stream_id)
            stamp = datetime.datetime.now().isoformat(timespec="seconds")
            handle.write(f"[{stamp}] (seq {line.seq}) {text}\n")
            handle.flush()
            counts[stream_id] = counts.get(stream_id, 0) + 1

    print(f"channel_logger: watching {sorted(wanted)} - attached: {c.status()}")
    try:
        c.run()
    finally:
        for channel, handle in handles.items():
            handle.close()
        logged = {k: v for k, v in counts.items() if v}
        print(f"channel_logger: stopped. lines logged this run: {logged or 'none'}")


if __name__ == "__main__":
    main()
