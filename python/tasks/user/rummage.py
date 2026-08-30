"""Search a corpse (or the room) and grab everything worth keeping, once.

    python python/tasks/user/rummage.py
    python python/tasks/user/rummage.py --target "corpse" --keep coins,gem,herb
    python python/runner.py run user.rummage

The Genie category this replaces: a post-kill loot script that searches the
corpse, reads what turned up, and grabs the things worth carrying rather than
`get all` sweeping up everything including junk you would just drop again.

One pass, not a loop - run it once per kill (bind it to a hotkey, or chain it
after a hunting flow's own loot step). Sends `search <target>`, reads the
list DR prints back, and sends `get` for anything whose name contains one of
`--keep`'s (case-insensitive) substrings. Everything else is left on the
corpse. If `--keep` is empty, falls back to `get all` - the same as not
having this script at all, so you always end up with a working default.

The parse is a plain line match on "You search ... and find:" style text,
which is a guess rather than something this repo has confirmed against a
live game - if nothing gets picked up, run with default args once and check
what the raw line actually looked like before assuming the task is broken.
`--timeout` (default 15s) is what stops this from waiting forever on a
result line whose wording never matches, rather than the task quietly never
returning.
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

# "You rummage through a corpse and find a small pouch, some coins, and a
# rusty dagger." - DR's search results tend to read as one sentence with a
# comma/and-separated list. Anchored on "You ... find" specifically, rather
# than a bare "find"/"see", so this does not fire on an unrelated line like a
# room description that happens to contain "you see" - a false match here
# sends `get` for whatever words that unrelated line contained.
_FOUND = re.compile(r"^you (?:rummage.*?|search.*?)?finds?:?\s+(?P<items>.+?)\.?\s*$", re.IGNORECASE)
_ITEM_SPLIT = re.compile(r",\s*(?:and\s+)?|\s+and\s+")


def _split_items(text: str) -> list[str]:
    items = [i.strip() for i in _ITEM_SPLIT.split(text) if i.strip()]
    return [re.sub(r"^(a|an|some)\s+", "", i, flags=re.IGNORECASE) for i in items]


DEFAULT_TIMEOUT = 15.0


class Rummage(Task):
    def __init__(self, target: str, keep: list[str], timeout: float = DEFAULT_TIMEOUT) -> None:
        super().__init__()
        self.target = target
        self.keep = [k.lower() for k in keep]
        self.timeout = timeout
        self._done = False

    def on_start(self) -> None:
        print(f"rummage: searching '{self.target}' - attached: {self.c.status()}")
        if not self.keep:
            print("rummage: --keep is empty, sending 'get all' instead")
            self.do("get all")
            self.stop()
            return
        self.do(f"search {self.target}")
        threading.Thread(target=self._watchdog, daemon=True).start()

    def _watchdog(self) -> None:
        time.sleep(self.timeout)
        if self._done or self._stopping:
            return
        self._done = True
        print(f"rummage: no recognised result within {self.timeout:.0f}s - giving up")
        self.stop()

    def on_clean(self, line: CleanLine) -> None:
        if self._done:
            return
        m = _FOUND.search(line.text)
        if not m:
            return
        self._done = True
        items = _split_items(m.group("items"))
        if not items:
            print("rummage: nothing recognised in the result line")
            self.stop()
            return
        kept = [i for i in items if any(k in i.lower() for k in self.keep)]
        print(f"rummage: saw {items}, keeping {kept or 'nothing'}")
        for item in kept:
            time.sleep(0.2)
            self.do(f"get {item}")
        self.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--target", default="corpse", help="what to search (default 'corpse')")
    parser.add_argument(
        "--keep",
        default="coin,gem,gold,silver,herb,root,relic",
        help="comma-separated substrings; an item is kept if any appears in its name",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"give up waiting for a result line after this many seconds (default {DEFAULT_TIMEOUT:.0f})",
    )
    args = parser.parse_args()

    keep = [k.strip() for k in args.keep.split(",") if k.strip()]
    task = Rummage(args.target, keep, args.timeout)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
