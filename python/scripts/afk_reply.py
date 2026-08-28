"""Answer tells while you are away, without answering the same person twice a
minute.

Genie's version of this is usually a single-shot trigger: match `tells you,`,
send a reply, done - which means the tenth person to tell you something in an
hour gets the same canned line the first one did, with no way to tell from
the log how many people actually tried to reach you. This keeps a per-sender
cooldown and a count, and prints a one-line summary of who tried when the
script stops.

The tell match (`Name tells you, "..."`) is DR's ordinary tell format but,
like everything in `streamkit.py`'s text-matched half, is not backed by a tag
this project has verified against a real game - if it never fires, check that
wording against what your own client actually shows before assuming the
script is broken.

    python python/scripts/afk_reply.py --message "afk, back soon"
    python python/scripts/afk_reply.py --message "afk" --cooldown 300
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import re
import time

from dr_companion import Companion, Line

_TELL = re.compile(r'^(?P<name>[A-Z][A-Za-z]*) tells you, "')


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

    last_reply: dict[str, float] = {}
    counts: dict[str, int] = {}

    c = Companion()

    @c.on_line
    def watch(line: Line) -> None:
        m = _TELL.match(line.text.strip())
        if not m:
            return
        name = m.group("name")
        counts[name] = counts.get(name, 0) + 1
        now = time.monotonic()
        if now - last_reply.get(name, -1e9) < args.cooldown:
            return
        last_reply[name] = now
        print(f"afk_reply: replying to {name} (tell #{counts[name]} from them this run)")
        c.send(f"reply {args.message}")

    print(f"afk_reply: watching for tells - attached: {c.status()}")
    try:
        c.run()
    finally:
        if counts:
            print("afk_reply: tells received this run: " + ", ".join(f"{n}={c}" for n, c in sorted(counts.items())))
        else:
            print("afk_reply: no tells received this run")


if __name__ == "__main__":
    main()
