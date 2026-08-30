"""lich.py against a fake Companion - no running app needed. This module only
formats strings and hands them to `Companion.send()`, so a stand-in that just
records what it was called with is a complete test double, not a shortcut
that misses real behaviour the way it would for the socket-owning parts of
this library.

Run with:

    python python/test_lich.py
"""

from __future__ import annotations

import sys

from lich import Lich


class FakeCompanion:
    def __init__(self) -> None:
        self.sent: list[str] = []

    def send(self, command: str) -> None:
        self.sent.append(command)


def _ok(label: str, cond: bool, detail: str = "") -> bool:
    print(f"{'OK  ' if cond else 'FAIL'} {label:<58}{detail}")
    return cond


def main() -> int:
    failed = 0

    fc = FakeCompanion()
    lich = Lich(fc)

    lich.start("autostow")
    failed += not _ok("start() sends ';name'", fc.sent[-1] == ";autostow", fc.sent[-1])

    lich.start("autostow", "42")
    failed += not _ok("start() with args", fc.sent[-1] == ";autostow 42", fc.sent[-1])

    lich.force_start("autostow")
    failed += not _ok("force_start() sends ';force name'", fc.sent[-1] == ";force autostow", fc.sent[-1])

    lich.stop("autostow")
    failed += not _ok("stop() sends ';kill name'", fc.sent[-1] == ";kill autostow", fc.sent[-1])

    lich.stop_all()
    failed += not _ok("stop_all() sends ';kill all'", fc.sent[-1] == ";kill all", fc.sent[-1])

    lich.pause("autostow")
    failed += not _ok("pause() sends ';pause name'", fc.sent[-1] == ";pause autostow", fc.sent[-1])

    lich.resume("autostow")
    failed += not _ok("resume() sends Lich's ';unpause', not ';resume'", fc.sent[-1] == ";unpause autostow", fc.sent[-1])

    lich.list_running()
    failed += not _ok("list_running() sends ';list'", fc.sent[-1] == ";list", fc.sent[-1])

    lich.vars_list()
    failed += not _ok("vars_list() sends ';vars list'", fc.sent[-1] == ";vars list", fc.sent[-1])

    lich.vars_set("healer", "true")
    failed += not _ok("vars_set() sends ';vars set key value'", fc.sent[-1] == ";vars set healer true", fc.sent[-1])

    lich.vars_delete("healer")
    failed += not _ok("vars_delete() sends ';vars delete key'", fc.sent[-1] == ";vars delete healer", fc.sent[-1])

    lich.raw("send hello")
    failed += not _ok("raw() sends exactly what it is given, prefixed", fc.sent[-1] == ";send hello", fc.sent[-1])

    genie = Lich(FakeCompanion(), prefix=",")
    genie.start("autostow")
    failed += not _ok("Genie prefix uses ','", genie._c.sent[-1] == ",autostow", genie._c.sent[-1])

    for bad in ["", "  ", "auto stow", "auto,stow", ";autostow", "auto\tstow"]:
        try:
            Lich(FakeCompanion()).start(bad)
            failed += not _ok(f"start({bad!r}) rejects a bad script name", False)
        except ValueError:
            failed += not _ok(f"start({bad!r}) rejects a bad script name", True)

    try:
        Lich(FakeCompanion(), prefix="!")
        failed += not _ok("Lich() rejects an unknown prefix", False)
    except ValueError:
        failed += not _ok("Lich() rejects an unknown prefix", True)

    if failed:
        print(f"\n{failed} check(s) FAILED")
        return 1
    print("\nall checks OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
