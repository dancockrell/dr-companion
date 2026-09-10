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
FORGE_DIR = REPO / "forge"
TEST = REPO / "python" / "test_room_player.py"

#: The two sabotage targets, each relative to its own copied tree. `COMPOSER` is
#: under the working copy of `godot/`; `FORGE_COMPOSE` is under the working copy
#: of the package root that holds `forge/`.
COMPOSER = "scripts/room_composer.gd"
FORGE_COMPOSE = "forge/compose.py"

#: Not the default 11731, so a break-check never collides with a normal run of
#: the suite in another shell. Not 11024, ever.
PORT = "11742"


class Sabotage:
    """One deliberate defect, and exactly which checks must notice it.

    `target` names which half of the round trip is damaged. Both halves are
    sabotageable on purpose: the composer decides how a spec becomes a tree, the
    forge decides what the spec says in the first place, and a harness that can
    only break one of them proves half a chain.
    """

    def __init__(self, name: str, why: str, find: str, replace: str,
                 expect: set[str], target: str = COMPOSER) -> None:
        self.name = name
        self.why = why
        self.find = find
        self.replace = replace
        self.expect = expect
        self.target = target


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
            # A third check joined this set, and one left it. Both moves were
            # this comparison working rather than noise, so both are written
            # down instead of being smoothed away:
            #
            # `carries the position` arrived because that check now works from
            # the *cell*, not from the `where` string the composer copies out
            # of the spec, so a placement that is not in the tree at all now
            # registers as a position failure as well as a kind failure.
            #
            # `at least 40 individual placements were matched` left because the
            # sample grew from 16 rooms to 19 when the stress rooms for the
            # collision properties were added. Dropping every edge door used to
            # take the total from 68 to under 40; against 75 it lands on 55 and
            # the floor no longer fires. That floor is not tuned to this
            # mutation - its job is to catch a composer that answers every
            # request and places nothing - so it is left where it is and the
            # expectation is corrected instead.
            "each placement carries the position the forge asked for",
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
    Sabotage(
        "edge doors are spread over cells other placements already took",
        "`edge` and `north` are different words in the spec and the same cell "
        "in this file, so only the composer can see the collision. Measured "
        "before it was fixed: 209 rooms in a 1,004-room sample stacked two "
        "features in one cell, 178 of them exactly this pair",
        find="\t\tif not claimed_cells.has(cell):",
        replace="\t\tif true:",
        expect={"no two features occupy one position"},
    ),
    Sabotage(
        "overhead, underfoot and the middle collapse into one place",
        "all three anchor at cell (0,0) and they are not the same position; "
        "a window the room put overhead drew on the floor beside a statue, six "
        "pixels apart, and every check in the suite was green",
        find='\t"canopy": "overhead",',
        replace='\t"__no-such-where": "overhead",',
        expect={"no two features occupy one position"},
    ),
    Sabotage(
        "the word a displaced reading came from is dropped in transit",
        "the forge records `displaced_from` for one reason only - so something "
        "downstream can tell a demoted text reading from a plain rule fill. A "
        "field nobody receives is the same absence with more steps",
        find='\t\t\t"displaced_from": p.get("displaced_from"),',
        replace='\t\t\t"displaced_from": null,',
        expect={"a displaced text reading keeps the word the room used"},
    ),
    Sabotage(
        "compass placements are all anchored in the middle",
        "the node keeps the right label and the right kind and moves to the "
        "wrong place. Comparing the `where` string cannot see this - the "
        "composer copies that straight out of the spec - which is why the "
        "position check works from the cell instead",
        find="\t\telif RING.has(where):\n\t\t\tcell = RING[where]",
        replace="\t\telif RING.has(where):\n\t\t\tcell = Vector2i(0, 0)",
        expect={
            "each placement carries the position the forge asked for",
            # Eight compass points landing on one cell in one layer is a pile,
            # and the collision check is right to say so. Two checks red here
            # is the correct answer rather than entanglement: they assert
            # different properties and this defect genuinely breaks both.
            "no two features occupy one position",
        },
    ),
    Sabotage(
        "the forge lets a text reading claim a position already taken",
        "this is the defect the lane began with, on the other side of the "
        "socket. A room that names one direction twice - a wall and a building "
        "both to the north - used to put both features on the same cell; "
        "2,838 of the map's 17,060 composable rooms did. The fix is that text "
        "claims are handed out before rule fills and each position is claimed "
        "once, so removing the `not in taken` guard restores it exactly",
        target=FORGE_COMPOSE,
        find="        if stated is not None and stated not in taken:",
        replace="        if stated is not None:",
        expect={"no two features occupy one position"},
    ),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_test(project: Path, forge_root: Path) -> tuple[int, str]:
    env = dict(os.environ)
    env["DRC_ROOM_PROJECT"] = str(project)
    env["DRC_FORGE_ROOT"] = str(forge_root)
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
    forge_root = workspace / "pkg"
    shutil.copytree(FORGE_DIR, forge_root / "forge")

    #: target -> (the file under the working copy, an untouched copy of it, its
    #: hash). Both halves of the round trip, so a sabotage of either can be
    #: applied, undone, and proved undone.
    targets = {}
    for name, path in ((COMPOSER, project / COMPOSER),
                       (FORGE_COMPOSE, forge_root / FORGE_COMPOSE)):
        keep = workspace / (Path(name).name + ".pristine")
        shutil.copy2(path, keep)
        targets[name] = (path, keep, sha256(keep))

    print(f"working copy: {project}")
    print(f"forge copy:   {forge_root / 'forge'}")
    for name, (_path, _keep, digest) in targets.items():
        print(f"  {name} sha256 {digest[:16]}")
    print()

    try:
        # ---- the positive control, before anything is interpreted --------
        print("positive control: the untouched copies must pass")
        code, output = run_test(project, forge_root)
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
            path, pristine, pristine_hash = targets[sabotage.target]
            for other, (opath, okeep, ohash) in targets.items():
                shutil.copy2(okeep, opath)
                if sha256(opath) != ohash:
                    print(f"FAILED: the restore of {other} did not restore. "
                          "Refusing to continue.")
                    return 1

            # Text mode on purpose. This repository checks out CRLF on
            # Windows, and an anchor written with "\n" matched against raw
            # bytes would silently find nothing - the classic version of this
            # bug rewrites the file unchanged, leaves the suite green, and
            # reports "not caught" when it means "the edit did nothing".
            # Universal newlines makes the anchor line-ending-agnostic, and
            # the abort below is the backstop if it ever is not.
            source = path.read_text(encoding="utf-8")
            if sabotage.find not in source:
                # Rule 2. A rewrite that changed nothing would leave the test
                # green and this script would print "not caught", meaning
                # something entirely different from what it says.
                print(f"ABORT: the anchor for '{sabotage.name}' is not in "
                      f"{sabotage.target} any more.")
                print(f"  Looked for: {sabotage.find!r}")
                print("  The sabotage would have changed nothing and the test would have")
                print("  stayed green, which is indistinguishable from the defect surviving.")
                return 1
            damaged = source.replace(sabotage.find, sabotage.replace, 1)
            path.write_text(damaged, encoding="utf-8")
            if sha256(path) == pristine_hash:
                print(f"ABORT: '{sabotage.name}' left the file byte-identical.")
                return 1

            code, output = run_test(project, forge_root)
            reds = failing_labels(output)
            checks = check_count(output)
            caught = code != 0
            exact = reds == sabotage.expect
            results.append((sabotage, caught, exact, reds, checks))

            print(f"sabotage: {sabotage.name}")
            print(f"  in: {sabotage.target}")
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
        #
        # Both trees, and both against the repository's own file as well as
        # against the working copy. These suites damage real source; leaving one
        # broken is the only outcome worse than having no negative test.
        restored = True
        untouched = True
        for name, (path, keep, digest) in targets.items():
            shutil.copy2(keep, path)
            here = sha256(path) == digest
            real = (GODOT_DIR / COMPOSER) if name == COMPOSER else (REPO / name)
            mine = sha256(real) == digest
            restored = restored and here
            untouched = untouched and mine
            print(f"{name}: working copy restored {here}, repository untouched {mine}")

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
