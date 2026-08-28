"""Alert when a name on your list shows up anywhere in the game text.

Genie's equivalent is a hand-built highlight: a regex per name, typed into a
`.cfg` file, that colours a line and maybe rings a bell. This does the same
job with names that live in a plain text file you can edit while the script
runs, one alert per line so it does not repeat every time the game reprints a
room description in a story that mentions the name twice, and an optional
`--command` that runs a Lich command through `lich.py` the moment a match
fires - "wire together lich commands" made concrete: point it at a script
that flees, or one that whispers a friend, and the highlight becomes an
action instead of a colour.

Matching is plain substring-on-word-boundary against the *tag-stripped* line,
so it fires on a name mentioned in ordinary room text, a thought, a tell -
anywhere - not just a channel this module claims to understand. That is
broader than "who just walked in", on purpose: a name-spotter that only
catches arrivals misses the far more common case of someone talking about you
in a channel this module cannot verify it parses correctly.

    python python/scripts/watchlist.py --names Wipsy,Grizzknot
    python python/scripts/watchlist.py --file watched-names.txt --cooldown 30
    python python/scripts/watchlist.py --names Wipsy --lich-command "force greet"
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import re
import time
from pathlib import Path

import streamkit as sk
from dr_companion import Companion, Line
from lich import Lich

BELL = "\a"


def _load_names(args: argparse.Namespace) -> set[str]:
    names: set[str] = set()
    if args.names:
        names |= {n.strip() for n in args.names.split(",") if n.strip()}
    if args.file:
        path = Path(args.file)
        if path.exists():
            names |= {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}
        else:
            print(f"watchlist: {path} does not exist yet - watching for it to appear, starting empty")
    return names


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
        help="a raw Lich command (without the leading ;) sent through lich.py on every match",
    )
    args = parser.parse_args()

    names = _load_names(args)
    if not names:
        parser.error("nothing to watch for - pass --names and/or --file")

    file_path = Path(args.file) if args.file else None
    last_reload = 0.0
    last_alert: dict[str, float] = {}
    patterns: dict[str, re.Pattern[str]] = {}

    def pattern_for(name: str) -> re.Pattern[str]:
        if name not in patterns:
            patterns[name] = re.compile(rf"\b{re.escape(name)}\b")
        return patterns[name]

    def maybe_reload() -> None:
        nonlocal last_reload, names
        if file_path is None:
            return
        now = time.monotonic()
        if now - last_reload < 5.0:
            return
        last_reload = now
        if file_path.exists():
            fresh = {line.strip() for line in file_path.read_text(encoding="utf-8").splitlines() if line.strip()}
            added = fresh - names
            if added:
                print(f"watchlist: picked up new name(s) from {file_path}: {sorted(added)}")
            names = fresh | ({n.strip() for n in args.names.split(",") if n.strip()} if args.names else set())

    c = Companion()
    lich = Lich(c)

    @c.on_line
    def watch(line: Line) -> None:
        maybe_reload()
        text = sk.strip_tags(line.text)
        if not text.strip():
            return
        now = time.monotonic()
        for name in names:
            if not pattern_for(name).search(text):
                continue
            if now - last_alert.get(name, -1e9) < args.cooldown:
                continue
            last_alert[name] = now
            print(f"{BELL}watchlist: '{name}' - {text.strip()}")
            if args.lich_command:
                lich.raw(args.lich_command)

    print(f"watchlist: watching for {sorted(names)} - attached: {c.status()}")
    c.run()


if __name__ == "__main__":
    main()
