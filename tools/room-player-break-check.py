"""Prove `python/test_room_player.py` can fail, and name what it catches.

    python tools/room-player-break-check.py

A green suite and a suite that asserts nothing print the same thing. This
damages the composer on purpose, four ways, and requires the end-to-end test to
go red *naming the specific checks that should go red* - not merely to fail,
because a sabotage that breaks something unrelated (or breaks the test file's
own import) reads as success just as easily.

# What it does not touch

The repository. Every sabotage is applied to a throwaway copy of `godot/` under
the system temp directory, and the server is started against that copy on its
own port. Several sessions edit this tree at once and one of them is running a
live game client; damaging the real `godot/scripts/room_composer.gd`, even for
four seconds, is not an acceptable way to test anything.

The proof that the copy is what ran is not an assumption: `test_room_player.py`
asks the server which project it loaded and asserts it against
`DRC_ROOM_PROJECT`. Without that, a sabotage the server never saw would look
exactly like code that survived it.

# The three guards this needs, all of which have bitten somebody

1. **The positive control runs first.** The unmodified copy must pass before
   any sabotage result is interpreted. Otherwise a copy that simply does not
   work reads as four caught mutations.
2. **A sabotage that changes nothing is a hard abort**, never a pass. If an
   anchor drifts, the file is rewritten unchanged, the test stays green, and
   the output reads "not caught" when it means "the edit did nothing".
3. **The failing labels are compared as a set.** A mutation that reddens more
   than expected means the checks are entangled and are saying less than they
   look like they are; that is a finding, not a pass.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
GODOT_DIR = REPO / "godot"
TEST = REPO / "python" / "test_room_player.py"
COMPOSER = "scripts/room_composer.gd"

#: Not the default 11731, so a break-check never collides with a normal run of
#: the suite in another shell. Not 11024, ever.
PORT = "11742"


class Sabotage:
    """One deliberate defect, and exactly which checks must notice it."""

    def __init__(self, name: str, why: str, find: str, replace: str, expect: set[str]) -> None:
        self.name = name
        self.why = why
        self.find = find
        self.replace = replace
        self.expect = expect


SABOTAGES = [
    Sabotage(
        "edge placements are dropped",
        "the fifteen `go <thing>` doors of a temple hall are the placements a "
        "naive layout loses, so losing them silently is the failure worth proving "
        "the test catches",
        find='\t\tif where == "edge":\n',
        replace='\t\tif where == "edge":\n\t\t\tcontinue\n',
        expect={
            "every placement appears exactly once",
            "each placement carries the kind the forge asked for",
            # Not in the first version of this expectation, and the mismatch
            # was the harness working. Dropping the edge doors takes the total
            # matched from 68 to under 40, so the denominator collapses - which
            # is the entire reason that floor exists. A third check going red
            # here is the right answer, not entanglement.
            "at least 40 individual placements were matched",
        },
    ),
    Sabotage(
        "openings clear no gap in the boundary",
        "a doorway that is walled up is the difference between a room you can "
        "read and a box; the wall count is the only thing that sees it",
        find="\t\t\tfor step in range(-OPENING_HALF_GAP, OPENING_HALF_GAP + 1):",
        replace="\t\t\tfor step in []:",
        expect={"boundary is the perimeter less one gap per compass exit"},
    ),
    Sabotage(
        "the isometric projection is wrong",
        "swapping the vertical tile size for the horizontal one still produces a "
        "plausible-looking diamond, which is why it needs a formula to check "
        "against rather than an eye",
        find="\t\t(gx + gy) * RoomPrimitives.TILE_H * 0.5",
        replace="\t\t(gx + gy) * RoomPrimitives.TILE_W * 0.5",
        expect={"every node sits where the projection puts it"},
    ),
    Sabotage(
        "openings are never built",
        "the exits are the only part of a room that has to agree with the game; "
        "a room with none is unplayable and renders perfectly",
        find="\tfor row in opening_rows:",
        replace="\tfor row in []:",
        # The boundary check was expected here too and does *not* fire, which
        # is worth knowing rather than papering over: the gaps in the wall are
        # computed from `openings` earlier and independently of the loop that
        # builds the markers, so removing the markers leaves the doorways
        # intact and only the labelled exits gone. The two checks are not
        # entangled, which is exactly what an exact-set comparison is for.
        expect={"every exit the game reports is an opening"},
    ),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_test(project: Path) -> tuple[int, str]:
    env = dict(os.environ)
    env["DRC_ROOM_PROJECT"] = str(project)
    env["DRC_ROOM_PORT"] = PORT
    done = subprocess.run(
        [sys.executable, str(TEST)],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        cwd=str(REPO), env=env, timeout=900,
    )
    return done.returncode, f"{done.stdout}{done.stderr}"


def failing_labels(output: str) -> set[str]:
    """The distinct check labels that went red, with the room id stripped.

    The same property fails once per room, and "it failed for eleven rooms" and
    "it failed for one" are the same finding about the composer. What matters is
    *which* property.
    """
    labels = set()
    for line in output.splitlines():
        if not line.startswith("FAIL"):
            continue
        body = re.sub(r"^room \d+: ", "", line[4:].strip())
        labels.add(body.split(":", 1)[0].strip())
    return labels


def check_count(output: str) -> int:
    match = re.search(r"^(\d+) checked, (\d+) failed", output, re.M)
    return int(match.group(1)) if match else 0


def main() -> int:
    if not TEST.exists():
        print(f"NOT CHECKED: {TEST} is missing; there is no suite to break")
        return 0

    sys.path.insert(0, str(REPO / "python"))
    from room_player_client import find_godot  # noqa: E402

    if find_godot() is None:
        print("NOT CHECKED: no Godot binary, so nothing can be run against a sabotaged copy")
        print("  This is not a pass. Set GODOT4 to a Godot 4 executable.")
        return 0

    workspace = Path(tempfile.mkdtemp(prefix="room-player-break-"))
    project = workspace / "godot"
    shutil.copytree(GODOT_DIR, project)
    pristine = workspace / "room_composer.gd.pristine"
    shutil.copy2(project / COMPOSER, pristine)
    pristine_hash = sha256(pristine)
    print(f"working copy: {project}")
    print(f"composer sha256: {pristine_hash[:16]}\n")

    try:
        # ---- the positive control, before anything is interpreted --------
        print("positive control: the untouched copy must pass")
        code, output = run_test(project)
        control_checks = check_count(output)
        if code != 0:
            print("FAILED: the unmodified copy does not pass, so no sabotage result means anything.")
            print(output[-4000:])
            return 1
        if control_checks < 100:
            print(f"FAILED: the control asserted only {control_checks} checks; "
                  "a suite that barely runs cannot demonstrate anything by failing.")
            return 1
        print(f"  OK - {control_checks} checks, exit 0\n")

        results = []
        for sabotage in SABOTAGES:
            shutil.copy2(pristine, project / COMPOSER)
            if sha256(project / COMPOSER) != pristine_hash:
                print("FAILED: the restore did not restore. Refusing to continue.")
                return 1

            # Text mode on purpose. This repository checks out CRLF on
            # Windows, and an anchor written with "\n" matched against raw
            # bytes would silently find nothing - the classic version of this
            # bug rewrites the file unchanged, leaves the suite green, and
            # reports "not caught" when it means "the edit did nothing".
            # Universal newlines makes the anchor line-ending-agnostic, and
            # the abort below is the backstop if it ever is not.
            source = (project / COMPOSER).read_text(encoding="utf-8")
            if sabotage.find not in source:
                # Rule 2. A rewrite that changed nothing would leave the test
                # green and this script would print "not caught", meaning
                # something entirely different from what it says.
                print(f"ABORT: the anchor for '{sabotage.name}' is not in {COMPOSER} any more.")
                print(f"  Looked for: {sabotage.find!r}")
                print("  The sabotage would have changed nothing and the test would have")
                print("  stayed green, which is indistinguishable from the defect surviving.")
                return 1
            damaged = source.replace(sabotage.find, sabotage.replace, 1)
            (project / COMPOSER).write_text(damaged, encoding="utf-8")
            if sha256(project / COMPOSER) == pristine_hash:
                print(f"ABORT: '{sabotage.name}' left the file byte-identical.")
                return 1

            code, output = run_test(project)
            reds = failing_labels(output)
            checks = check_count(output)
            caught = code != 0
            exact = reds == sabotage.expect
            results.append((sabotage, caught, exact, reds, checks))

            print(f"sabotage: {sabotage.name}")
            print(f"  why it matters: {sabotage.why}")
            print(f"  exit {code}, {checks} checks asserted")
            print(f"  expected red: {sorted(sabotage.expect)}")
            print(f"  actually red: {sorted(reds)}")
            if not caught:
                print("  FAILED - the suite stayed green. It is not checking this.")
            elif not exact:
                print("  FAILED - caught, but not by the checks named. Either the")
                print("           checks are entangled or the expectation is wrong;")
                print("           both are findings, neither is a pass.")
            else:
                print("  OK - caught, by exactly the checks that own this property.")
            print()

        # ---- restore and prove the restore -------------------------------
        shutil.copy2(pristine, project / COMPOSER)
        restored = sha256(project / COMPOSER) == pristine_hash
        print(f"restore verified by hash: {restored}")
        real = sha256(GODOT_DIR / COMPOSER)
        untouched = real == pristine_hash
        print(f"the repository's own {COMPOSER} is untouched: {untouched}")

        bad = [r for r in results if not (r[1] and r[2])]
        print(f"\n{len(results) - len(bad)} of {len(results)} sabotages caught by exactly "
              f"the named checks; control asserted {control_checks}")
        if not restored or not untouched:
            print("FAILED: the working copy or the repository was left damaged.")
            return 1
        if bad:
            print("FAILED: " + "; ".join(r[0].name for r in bad))
            return 1
        print("all passed")
        return 0
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
