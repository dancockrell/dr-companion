"""Answer tells while you are away, without answering the same person twice a
minute.

    python python/tasks/user/afk_reply.py --message "afk, back soon"
    python python/runner.py run user.afk_reply

Genie's version of this is usually a single-shot trigger: match `tells you,`,
send a reply, done - which means the tenth person to tell you something in an
hour gets the same canned line the first one did. This keeps a per-sender
cooldown and a count, and prints a one-line summary of who tried when the
task stops.

The tell match (`Name tells you, "..."`) is DR's ordinary tell format but,
like everything text-matched rather than tag-based, is not backed by
anything this repo has verified against a real game - if it never fires,
check that wording against what your own client actually shows.
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import CleanLine, Task  # noqa: E402

_TELL = re.compile(r'^(?P<name>[A-Z][A-Za-z]*) tells you, "')


class AfkReply(Task):
    def __init__(self, message: str, cooldown: float) -> None:
        super().__init__()
        self.message = message
        self.cooldown = cooldown
        self._last_reply: dict[str, float] = {}
        self._counts: dict[str, int] = {}

    def on_start(self) -> None:
        print(f"afk_reply: watching for tells - attached: {self.c.status()}")

    def on_clean(self, line: CleanLine) -> None:
        m = _TELL.match(line.text)
        if not m:
            return
        name = m.group("name")
        self._counts[name] = self._counts.get(name, 0) + 1
        now = time.monotonic()
        if now - self._last_reply.get(name, -1e9) < self.cooldown:
            return
        self._last_reply[name] = now
        print(f"afk_reply: replying to {name} (tell #{self._counts[name]} from them this run)")
        self.do(f"reply {self.message}")

    def stop(self) -> None:
        super().stop()
        if self._counts:
            print(
                "afk_reply: tells received this run: "
                + ", ".join(f"{n}={c}" for n, c in sorted(self._counts.items()))
            )
        else:
            print("afk_reply: no tells received this run")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--message", required=True, help="what to send back")
    parser.add_argument(
        "--cooldown",
        type=float,
        default=120.0,
        help="seconds before the same sender gets another auto-reply (default 120)",
    )
    args = parser.parse_args()

    task = AfkReply(args.message, args.cooldown)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()


if __name__ == "__main__":
    main()
