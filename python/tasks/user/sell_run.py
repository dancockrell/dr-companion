"""Sell a configured list of items to whichever shop you're standing in, one
at a time, with a real pause between each so a merchant's reply is not eaten.

    python python/tasks/user/sell_run.py --items "bone,fang,pelt"
    python python/tasks/user/sell_run.py --items "junk" --and-drop
    python python/runner.py run user.sell_run

The Genie category this replaces: a "sell junk" script bound to a hotkey
after a hunting trip - walk to the shop, run it once, walk out. This does
not walk anywhere (see `docs/PYTHON_API.md` on `lich.py`/`walk_to` for that
half); it assumes you are already standing at the counter and just runs the
selling loop.

Sends `sell <item>` for each name in `--items`, in order, waiting for the
merchant's roundtime-free reply between them rather than a guessed pause.
`--and-drop` sends `drop <item>` afterwards for anything the merchant refuses
(matched on "i don't want" / "not interested" / "no thanks" - text-matched,
so tune `--refused` if your shop's wording differs), so a junk run does not
leave rejected items cluttering your hands.
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


#: A merchant's reply this task fails to recognise must not stall the whole
#: run - see the module note on text-matched wording. This bounds "waiting
#: for a reply" the same way every other wait in this codebase is bounded.
REPLY_TIMEOUT = 15.0


class SellRun(Task):
    def __init__(self, items: list[str], and_drop: bool, refused: re.Pattern[str]) -> None:
        super().__init__()
        self.items = items
        self.and_drop = and_drop
        self.refused = refused
        self._index = -1
        self._current: str | None = None
        self._lock = threading.Lock()
        self._generation = 0

    def on_start(self) -> None:
        print(f"sell_run: selling {self.items} - attached: {self.c.status()}")
        self._sell_next()

    def _sell_next(self) -> None:
        self._index += 1
        if self._index >= len(self.items):
            print("sell_run: done")
            self.stop()
            return
        self._current = self.items[self._index]
        with self._lock:
            self._generation += 1
            generation = self._generation
        print(f"sell_run: ({self._index + 1}/{len(self.items)}) selling '{self._current}'")
        self.do(f"sell {self._current}")
        threading.Thread(target=self._watchdog, args=(generation,), daemon=True).start()

    def _watchdog(self, generation: int) -> None:
        time.sleep(REPLY_TIMEOUT)
        with self._lock:
            if self._generation != generation or self._current is None:
                return
            item = self._current
            self._current = None
        print(f"sell_run: no recognised reply for '{item}' within {REPLY_TIMEOUT:.0f}s - moving on")
        self._sell_next()

    def _advance(self) -> None:
        with self._lock:
            self._generation += 1  # cancels the watchdog for this item
            self._current = None
        time.sleep(0.3)
        self._sell_next()

    def on_clean(self, line: CleanLine) -> None:
        if self._current is None:
            return
        if self.refused.search(line.text):
            print(f"sell_run: '{self._current}' refused - {line.text}")
            if self.and_drop:
                self.do(f"drop {self._current}")
            self._advance()
        elif "sold" in line.text.lower() or "you receive" in line.text.lower():
            print(f"sell_run: '{self._current}' sold - {line.text}")
            self._advance()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--items", required=True, help="comma-separated item names, sold in order")
    parser.add_argument("--and-drop", action="store_true", help="drop anything the shop refuses")
    parser.add_argument(
        "--refused",
        default=r"(i don't want|not interested|no thanks|do not deal in)",
        help="regex meaning the shop refused the item",
    )
    args = parser.parse_args()

    items = [i.strip() for i in args.items.split(",") if i.strip()]
    if not items:
        parser.error("--items produced no item names")

    task = SellRun(items, args.and_drop, re.compile(args.refused, re.IGNORECASE))
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
