"""Watch training mindstate and say when a skill is full, read-only.

    python python/tasks/user/skill_trainer.py --skills locksmithing,athletics
    python python/runner.py run user.skill_trainer

`docs/DOMAIN.md` §1 documents the mechanic most training scripts get wrong:
DR trains skills through a per-skill *mindstate*, an experience pool from
Clear to Mind Lock (34/34) - once a skill is at Mind Lock, training it
further is wasted until the pool drains, so an experienced player rotates
between skills with room rather than grinding one. That is a fact about the
game, sourced there from Elanthipedia and a community script's own rotation
logic - this task is what a Python script does with it: watch, not decide,
since actually switching what you train is a character-specific judgement
call this task is not positioned to make for you.

Periodically sends `skill <name>` for each name in `--skills` (DR's own
command for one skill's ranks and mindstate) and parses the reply. When a
watched skill reaches Mind Lock, says so - loudly enough to notice, exactly
once until it drains below Mind Lock again.

Read-only except for the polling command itself; never calls `do()` on
anything training-related. The mindstate wording match
(`Mind Lock`/`ranks?/`) is a best-effort read of DR's own `skill` command
output, not confirmed against a live game - if nothing ever reports, run
`skill <name>` yourself once and compare the wording against `_MINDSTATE`
below.
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

# "Locksmithing (at 1734 ranks) is at Mind Lock." - or similar; DR's skill
# command reports ranks and a named mindstate rung together. This looks for
# the skill name and the mindstate word/phrase on the same line, however
# they are actually punctuated - the exact wording is the part this repo has
# not confirmed, see the module note above.
_MINDSTATE = re.compile(
    r"(?P<skill>[A-Za-z ]+?)\D+(?P<state>clear|dabbling|perusing|learning|thoughtprint|"
    r"analyzing|understanding|considering|absorbing|comprehending|assimilating|"
    r"pondering|ruminating|contemplating|cogitating|fathoming|mind lock)",
    re.IGNORECASE,
)

MIND_LOCK = "mind lock"
POLL_INTERVAL = 90.0


class SkillTrainer(Task):
    def __init__(self, skills: list[str], interval: float) -> None:
        super().__init__()
        self.skills = skills
        self.interval = interval
        self._locked: set[str] = set()

    def on_start(self) -> None:
        print(f"skill_trainer: watching {self.skills}, polling every {self.interval:.0f}s - attached: {self.c.status()}")
        threading.Thread(target=self._poll_loop, daemon=True).start()

    def _poll_loop(self) -> None:
        while not self._stopping:
            for skill in self.skills:
                if self._stopping:
                    return
                self.do(f"skill {skill}", wait_rt=False)
                time.sleep(1.0)
            time.sleep(self.interval)

    def on_clean(self, line: CleanLine) -> None:
        m = _MINDSTATE.search(line.text)
        if not m:
            return
        skill = m.group("skill").strip().lower()
        state = m.group("state").strip().lower()
        matched = next((s for s in self.skills if s.lower() in skill or skill in s.lower()), None)
        if matched is None:
            return

        if state == MIND_LOCK:
            if matched not in self._locked:
                self._locked.add(matched)
                print(f"skill_trainer: {matched} is at Mind Lock - full, switch to something with room")
        elif matched in self._locked:
            self._locked.discard(matched)
            print(f"skill_trainer: {matched} has drained below Mind Lock - room again")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--skills", required=True, help="comma-separated skill names, spelled as DR spells them")
    parser.add_argument(
        "--interval", type=float, default=POLL_INTERVAL, help=f"seconds between polls (default {POLL_INTERVAL:.0f})"
    )
    args = parser.parse_args()

    skills = [s.strip() for s in args.skills.split(",") if s.strip()]
    if not skills:
        parser.error("--skills produced no skill names")

    task = SkillTrainer(skills, args.interval)
    try:
        task.run()
    except KeyboardInterrupt:
        task.stop()
        print("\nstopped.")


if __name__ == "__main__":
    main()
