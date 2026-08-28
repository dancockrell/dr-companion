"""Watch the game and say what is happening, without touching it.

    python python/tasks/watch.py

Sends nothing. Not "sends little" - nothing: this task never calls `do()`, so
it is safe to point at a live character mid-session, and it is the right first
thing to run when checking whether the scripting stack works end to end.

# Why a read-only task is worth shipping

The first question about any automation layer is "is it seeing what I'm
seeing", and every way of answering that which involves sending a command
changes the thing being measured. This answers it with no side effects at all.

It is also the honest demonstration of `drtask.py`: if the vitals here are
wrong, they are wrong for every task built on that parser, and this is where
that shows up cheaply rather than in the middle of a hunt.

# What it reports

    vitals        only when they change, with the arrow showing direction
    roundtime     when the game puts you in one
    channels      thoughts, deaths, speech - labelled by the game, not guessed
    arrivals      who came and went
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from drtask import CleanLine, Task, Vital  # noqa: E402


class Watch(Task):
    def __init__(self) -> None:
        super().__init__()
        self.previous: dict[str, Vital] = {}
        self.started = time.time()
        self.lines = 0

    def on_start(self) -> None:
        st = self.c.status()
        # ASCII only in output. The Windows console defaults to cp1252, and an
        # em-dash here printed as a replacement character on the first real
        # run - a task whose own status line is mojibake does not inspire much
        # confidence in the numbers underneath it.
        print(f"watching {st.host}:{st.port} - {st.lines} lines already in the buffer")
        print("nothing will be sent. Ctrl+C to stop.\n")

    def on_vitals(self, vitals: dict[str, Vital]) -> None:
        for name, v in vitals.items():
            was = self.previous.get(name)
            if was and was.current == v.current and was.max == v.max:
                continue
            # The arrow is the point: a number alone does not say whether you
            # are recovering or dying, and that is the whole question.
            arrow = "" if not was else ("  up" if v.current > was.current else "  down")
            print(f"  [vital] {name:<14} {v.current}/{v.max} ({v.percent:.0f}%){arrow}")
        self.previous = {k: Vital(v.current, v.max) for k, v in vitals.items()}

    def on_clean(self, line: CleanLine) -> None:
        self.lines += 1

        # A bare prompt is punctuation, not an event. The game sends one after
        # nearly every exchange, and printing them doubles the output while
        # saying nothing - the very noise a watcher is supposed to cut through.
        if line.text in (">", ">>"):
            return

        if line.stream:
            print(f"  [{line.stream}] {line.text}")
            return

        low = line.text.lower()

        # Arrivals and departures, which is what a player actually watches for
        # in a shared room.
        if " just arrived" in low or " runs " in low or " walks " in low or " limps " in low:
            print(f"  [room] {line.text}")
            return

        if "roundtime" in low or self.roundtime_until > time.time():
            left = max(0.0, self.roundtime_until - time.time())
            if left > 0:
                print(f"  [rt] {left:.0f}s — {line.text}")
                return

        # Everything else is ordinary game text; print it plainly so the
        # stream is legible rather than filtered down to only what this task
        # happened to recognise. A watcher that shows only what it understands
        # teaches you to trust it about the rest.
        print(f"        {line.text}")


if __name__ == "__main__":
    try:
        Watch().run()
    except KeyboardInterrupt:
        print("\nstopped.")
