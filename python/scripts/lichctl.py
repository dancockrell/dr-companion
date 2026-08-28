"""A command line for Lich's own script engine, through DR Companion.

Every other script here reacts to the game; this one is the direct answer to
"wire together lich commands" - a terminal tool that starts, stops, pauses
and lists Lich scripts without ever switching to the game window. Bind it to
a hotkey, call it from cron, chain it in a shell script - it is a thin,
one-shot wrapper over `lich.py`, not a long-running watcher like the others.

    python python/scripts/lichctl.py start autostow
    python python/scripts/lichctl.py start autostow -- 42        # with an argument
    python python/scripts/lichctl.py force autostow               # ;force
    python python/scripts/lichctl.py pause autostow
    python python/scripts/lichctl.py resume autostow
    python python/scripts/lichctl.py stop autostow
    python python/scripts/lichctl.py stop-all
    python python/scripts/lichctl.py list
    python python/scripts/lichctl.py vars-list
    python python/scripts/lichctl.py raw "send hello"              # anything else

Each command connects, sends exactly one thing, and exits - it does not wait
for or print Lich's reply. Lich's output arrives on the ordinary game stream;
watch it in the app itself, or write a two-line script using
`dr_companion.py`'s `on_line` if you want it captured.
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import sys

from dr_companion import Companion, ConnectionError as CompanionConnectionError
from lich import Lich


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--genie-prefix",
        action="store_true",
        help="use ',' instead of ';' - only if this Lich is fronted by Genie",
    )
    sub = parser.add_subparsers(dest="action", required=True)

    p = sub.add_parser("start", help="start a script (fails if already running)")
    p.add_argument("name")
    p.add_argument("args", nargs=argparse.REMAINDER)

    p = sub.add_parser("force", help="start a script, restarting it if already running")
    p.add_argument("name")
    p.add_argument("args", nargs=argparse.REMAINDER)

    p = sub.add_parser("stop", help="kill one running script")
    p.add_argument("name")

    sub.add_parser("stop-all", help="kill every running script")

    p = sub.add_parser("pause", help="pause one running script")
    p.add_argument("name")

    p = sub.add_parser("resume", help="unpause one running script")
    p.add_argument("name")

    sub.add_parser("list", help="print running scripts to the game stream (;list)")
    sub.add_parser("vars-list", help="print this character's Lich variables (;vars list)")

    p = sub.add_parser("vars-set", help="set a Lich variable")
    p.add_argument("key")
    p.add_argument("value")

    p = sub.add_parser("vars-delete", help="delete a Lich variable")
    p.add_argument("key")

    p = sub.add_parser("raw", help="send anything else after the ; prefix")
    p.add_argument("rest")

    args = parser.parse_args()

    try:
        c = Companion()
        lich = Lich(c, prefix="," if args.genie_prefix else ";")

        if args.action == "start":
            lich.start(args.name, *[a for a in args.args if a != "--"])
        elif args.action == "force":
            lich.force_start(args.name, *[a for a in args.args if a != "--"])
        elif args.action == "stop":
            lich.stop(args.name)
        elif args.action == "stop-all":
            lich.stop_all()
        elif args.action == "pause":
            lich.pause(args.name)
        elif args.action == "resume":
            lich.resume(args.name)
        elif args.action == "list":
            lich.list_running()
        elif args.action == "vars-list":
            lich.vars_list()
        elif args.action == "vars-set":
            lich.vars_set(args.key, args.value)
        elif args.action == "vars-delete":
            lich.vars_delete(args.key)
        elif args.action == "raw":
            lich.raw(args.rest)
        else:  # pragma: no cover - argparse's `required=True` rules this out
            parser.error(f"unknown action {args.action!r}")
    except (CompanionConnectionError, ValueError) as e:
        print(f"lichctl: {e}", file=sys.stderr)
        return 1

    print(f"lichctl: sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
