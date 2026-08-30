"""Stand back up after a stun, without a human watching for it.

    python python/tasks/user/autostand.py
    python python/runner.py run user.autostand

The Genie category this replaces is the "autostand"/"getup" trigger: a
one-line highlight-and-hotkey a lot of players wire up by hand because losing
several real seconds face-down between stuns adds up over a session.

Retries `stand` on an interval instead of firing once and hoping - DR's exact
stun-recovery wording is not something this repo has confirmed against a real
game (see the note by `_RECOVERED` below), so trusting a single "you can move
again" line to fire the retry loop would be trusting a guess. Retrying on a
timer and giving up after a bounded number of attempts is the same shape a
human mashing a keybind uses, just steadier about the timing - and every
retry still goes through `do()`, so it is still subject to the rate cap and
`autostand` cannot itself become the runaway loop it exists to shorten.
"""

from __future__ import annotations

import re
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from drtask import CleanLine, Task  # noqa: E402

# Independently confirmed elsewhere in this repo - src/lib/chatChannels.ts
# matches the same phrase to route combat text - so this is not a guess
# invented for this file.
_STUNNED = re.compile(r"\byou are stunned\b", re.IGNORECASE)

# Unverified against a real game or an existing parser in this repo, unlike
# _STUNNED above. Used only to stop retrying early when it happens to match;
# never relied on as the sole way this task learns the stun is over.
_RECOVERED = re.compile(r"\byou regain your senses\b", re.IGNORECASE)

INTERVAL = 3.0
MAX_RETRIES = 8


class Autostand(Task):
    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self._generation = 0

    def on_start(self) -> None:
        print(f"autostand: watching - attached: {self.c.status()}")

    def _retry_loop(self, generation: int) -> None:
        for attempt in range(1, MAX_RETRIES + 1):
            time.sleep(INTERVAL)
            with self._lock:
                if self._generation != generation:
                    return  # recovered, or a newer stun superseded this one
            print(f"autostand: attempt {attempt}/{MAX_RETRIES} - sending 'stand'")
            self.do("stand")
        print("autostand: gave up after max retries - check the character")

    def on_clean(self, line: CleanLine) -> None:
        if _STUNNED.search(line.text):
            with self._lock:
                self._generation += 1
                generation = self._generation
            print("autostand: stunned - starting recovery")
            threading.Thread(target=self._retry_loop, args=(generation,), daemon=True).start()
        elif _RECOVERED.search(line.text):
            with self._lock:
                self._generation += 1  # cancels any retry loop in flight


def main() -> None:
    try:
        Autostand().run()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
