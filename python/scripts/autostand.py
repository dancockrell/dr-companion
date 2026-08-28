"""Stand back up after a stun, without a human watching for it.

The Genie category this replaces is the "autostand"/"getup" trigger: a
one-line highlight-and-hotkey that a lot of players wire up by hand because
losing several real seconds face-down between stuns adds up over a session.

The Python version is better in one concrete way: it does not just fire once
and hope. `streamkit.is_stunned_line` is a text match (see its docstring - DR's
exact recovery wording is not confirmed anywhere in this repo), so instead of
trusting a "you can move again" line that might never arrive in a form this
recognises, this retries `stand` on an interval and gives up after a bounded
number of attempts - the same shape a human mashing a keybind uses, just
steadier about the timing.

    python python/scripts/autostand.py
    python python/scripts/autostand.py --interval 2 --max-retries 6
"""

from __future__ import annotations

import _common  # noqa: F401  (sets up sys.path before the imports below)

import argparse
import threading
import time

import streamkit as sk
from dr_companion import Companion, Line


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--interval", type=float, default=3.0, help="seconds between 'stand' retries (default 3)"
    )
    parser.add_argument(
        "--max-retries", type=int, default=8, help="give up after this many attempts (default 8)"
    )
    args = parser.parse_args()

    c = Companion()
    # Guards the two fields below against the line-reading thread (`run()`)
    # and the retry thread touching them at once - a stun landing mid-retry
    # must not start a second, overlapping retry loop.
    lock = threading.Lock()
    state = {"recovering": False, "generation": 0}

    def retry_loop(generation: int) -> None:
        for attempt in range(1, args.max_retries + 1):
            time.sleep(args.interval)
            with lock:
                if state["generation"] != generation:
                    return  # recovered, or a newer stun superseded this one
            print(f"autostand: attempt {attempt}/{args.max_retries} - sending 'stand'")
            c.send("stand")
        with lock:
            if state["generation"] == generation:
                state["recovering"] = False
        print("autostand: gave up after max retries - check the character")

    @c.on_line
    def watch(line: Line) -> None:
        text = line.text
        if sk.is_stunned_line(text):
            with lock:
                state["generation"] += 1
                generation = state["generation"]
                already = state["recovering"]
                state["recovering"] = True
            print("autostand: stunned - " + ("already recovering, restarting timer" if already else "starting recovery"))
            threading.Thread(target=retry_loop, args=(generation,), daemon=True).start()
        elif sk.is_recovered_line(text):
            with lock:
                was_recovering = state["recovering"]
                state["recovering"] = False
                state["generation"] += 1  # cancels any retry loop in flight
            if was_recovering:
                print("autostand: recovery line seen - stopping retries")

    print("autostand: watching for stun -", f"attached: {c.status()}")
    c.run()


if __name__ == "__main__":
    main()
