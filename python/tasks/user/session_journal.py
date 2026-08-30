"""Not a Genie port - a session summary Genie's trigger model was never
built to keep. Read-only.

    python python/tasks/user/session_journal.py
    python python/runner.py run user.session_journal

Genie scripts are reactive triggers: match a line, do a thing. What none of
them do well is remember the *shape* of a session while it happens -
Genie's config format has nowhere to keep running totals across hours of
play. This does one job: watch quietly, count kills/coin/deaths and how long
each vital spent below half, and print one summary either on a timer or when
you stop it. Nothing here sends a command.

The point is not the specific counters - it is that this is ordinary Python
state, not a trigger file, so extending it (a per-zone breakdown, a session
log written to disk) is adding a field and a line, not learning a new config
format.
"""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import CleanLine, Task, Vital  # noqa: E402

SUMMARY_INTERVAL = 300.0


class SessionJournal(Task):
    def __init__(self, interval: float = SUMMARY_INTERVAL) -> None:
        super().__init__()
        self.interval = interval
        self.started = time.time()
        self.kills = 0
        self.coins_lines = 0
        self.deaths = 0
        self._low_since: dict[str, float] = {}
        self._low_seconds: dict[str, float] = {}

    def on_start(self) -> None:
        print(f"session_journal: watching, read-only - attached: {self.c.status()}")
        threading.Thread(target=self._summary_loop, daemon=True).start()

    def _summary_loop(self) -> None:
        while not self._stopping:
            time.sleep(self.interval)
            if not self._stopping:
                self._print_summary()

    def on_vitals(self, vitals: dict[str, Vital]) -> None:
        now = time.time()
        for name, v in vitals.items():
            below_half = v.percent < 50
            was_low = name in self._low_since
            if below_half and not was_low:
                self._low_since[name] = now
            elif not below_half and was_low:
                self._low_seconds[name] = self._low_seconds.get(name, 0.0) + (now - self._low_since.pop(name))

    def on_clean(self, line: CleanLine) -> None:
        low = line.text.lower()
        if any(w in low for w in ("is dead", "have slain", "have killed")):
            self.kills += 1
        if "you have died" in low or "you are dead" in low:
            self.deaths += 1
        if "coins" in low and "you " in low:
            self.coins_lines += 1

    def _low_totals(self) -> dict[str, float]:
        now = time.time()
        totals = dict(self._low_seconds)
        for name, since in self._low_since.items():
            totals[name] = totals.get(name, 0.0) + (now - since)
        return totals

    def _print_summary(self) -> None:
        elapsed = time.time() - self.started
        print(f"\n-- session_journal: {elapsed / 60:.0f} min in --")
        print(f"  kills-ish: {self.kills}  coin mentions: {self.coins_lines}  deaths: {self.deaths}")
        for name, seconds in sorted(self._low_totals().items()):
            if seconds >= 1:
                print(f"  {name} under 50%: {seconds / 60:.1f} min")
        print()

    def stop(self) -> None:
        super().stop()
        self._print_summary()


def main() -> None:
    task = SessionJournal()
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("stopped.")


if __name__ == "__main__":
    main()
