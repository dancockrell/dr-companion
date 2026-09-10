"""Real rooms, end to end: Lich's map database -> forge -> TCP -> Godot's tree.

    python python/test_room_player.py
    node tools/python-test.mjs python/test_room_player.py --min 60

`godot/tests/room_composer_test.gd` already checks the composer's arithmetic
against specs it writes itself. This checks the thing that one cannot: that the
arithmetic survives a room nobody chose, a JSON round trip, and a socket. Both
are needed. A composer that is right about hand-written specs and wrong about
`{"where": "edge"}` fifteen times over is a real and unremarkable bug, and only
the database has rooms like that in it.

# What it asserts, and why those

The properties themselves live in `python/room_roundtrip.py`, shared with the
corpus sweep (`python -m room_roundtrip`), because a gate and a sweep that
disagreed about what "clean" means would be worse than having only one: the
gate would go green on the very defect the sweep exists to count.

In short, every placement the forge emitted must appear in the tree, once, with
its kind and at the cell its `where` implies; every opening must appear; no two
features may occupy one position; the counts must be exactly the arithmetic (81
ground tiles, 32 perimeter cells, a three-cell gap per compass opening) rather
than "about right"; and every node's position must satisfy the projection
formula, recomputed in Python rather than read back from Godot, so agreement
means two implementations agree instead of one implementation repeating itself.

# Which rooms, and why not any dozen

Three per archetype plus five named stress rooms. The stress rooms are not
decoration: a check on a chooser has to run against a population where the
wrong answer is present and reachable, and three-per-archetype happens to
contain no room that anchors something overhead, no room whose text names one
direction twice, and no room holding both a bearing-less door and a feature to
the north. Every collision property could have passed against a composer that
did not have it. `STRESS_ROOMS` says which room covers which property, and the
sample aborts rather than shrinking if one of them stops composing.

# The denominators

Two, because two different mechanisms can silently produce nothing. `ROOM_FLOOR`
is how many real rooms were composed - it goes to zero if the database walk or
the archetype selection breaks. `PLACEMENT_FLOOR` is how many individual
placements were matched, which is the number that collapses if the composer
starts emitting empty rooms while still answering every request.

# Three states

No Godot, or no map database, is NOT CHECKED and says so. It is not a pass.

# One engine, killed by its pid

All the rooms go through a single server started once. Several sessions run
their own Godot on this machine and a Godot-driven crash has taken the box
down; `RoomPlayer.stop()` kills the exact pid it spawned and never an image
name.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

#: Where the `forge` package is imported from. `DRC_ROOM_PROJECT` already lets
#: the break-check point the Godot half at a damaged copy; without the same
#: seam on this side, half of the round trip - the half that decides where
#: anything goes - has no way of being sabotaged on purpose, and a branch
#: nobody can execute deliberately is a branch nobody can prove they fixed.
FORGE_ROOT = os.environ.get("DRC_FORGE_ROOT")
if FORGE_ROOT:
    sys.path.insert(0, FORGE_ROOT)

from room_player_client import RoomPlayer, find_godot, godot_version  # noqa: E402
from room_roundtrip import verify  # noqa: E402

failed = 0
checked = 0


def ok(label: str, cond: bool, detail: str = "") -> bool:
    global checked, failed
    checked += 1
    print(f"{'OK  ' if cond else 'FAIL'} {label}{f': {detail}' if detail else ''}")
    if not cond:
        failed += 1
    return cond


def not_checked(why: str) -> None:
    print(f"NOT CHECKED: {why}")
    print("  This is not a pass. Nothing about the room player was verified.")
    print("\n0 checked, 0 failed; the run had nothing to run against")
    sys.exit(0)


# -- inputs -----------------------------------------------------------------

#: Read-only, always. Overridable so the file can be pointed somewhere else,
#: which is also the only way to execute the missing-database branch on
#: purpose - a branch nobody can trigger is a branch nobody can prove.
MAP_DB = os.environ.get(
    "DRC_DR_MAP", r"C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json"
)

#: Which Godot project the server runs. Overridden by the break-check, which
#: runs this same file against a deliberately damaged copy of the tree.
PROJECT = os.environ.get("DRC_ROOM_PROJECT", str(REPO / "godot"))

PORT = int(os.environ.get("DRC_ROOM_PORT", "11731"))

#: Three rooms per archetype, lowest room id first, plus one deliberately
#: awful one. Deterministic: the same rooms every run, so a change in the
#: result is a change in the code.
PER_ARCHETYPE = 3

#: Rooms chosen because they are the only thing that makes a property
#: checkable. A check on a chooser has to run against a population where the
#: wrong answer is present and reachable; a sample of three-per-archetype
#: happens not to contain any of these, so every property below could have gone
#: green against a composer that did not have it.
#:
#: Each was found by sweeping the whole map database, not by guessing.
STRESS_ROOMS = {
    8179: "the Temple of Light's grand hall, fifteen `go <thing>` exits - the "
          "case where a naive layout stacks every door on one cell, and no "
          "hand-written fixture would have thought to have fifteen",
    2: "an edge-anchored door and a feature to the north. `edge` and `north` "
       "are different words in the spec and the same cell in the composer, so "
       "only a room holding both can tell whether the composer knows that",
    292: "a feature overhead and a feature in the middle. Both anchor at cell "
         "(0,0) and they are not in the same place; a room with only one of "
         "them cannot say whether the composer agrees",
    1413: "a feature underfoot and a feature in the middle, for the same reason",
    5: "the room says `north` twice. The second reading is demoted to a free "
       "ring position carrying `displaced_from`, and this is the only kind of "
       "room where that field is ever non-null",
}

ROOM_FLOOR = 12
PLACEMENT_FLOOR = 40


def load_rooms() -> list[dict]:
    with open(MAP_DB, encoding="utf-8") as handle:
        return json.load(handle)


def choose(rooms: list[dict]) -> list[tuple[dict, dict]]:
    """(record, scene dict) for the sample, in a fixed order."""
    from forge.compose import compose
    from forge.extract import read_room

    per: dict[str, list] = {}
    stress: dict[int, tuple[dict, dict]] = {}
    for record in sorted(rooms, key=lambda r: r.get("id") or 0):
        scene = compose(read_room(record))
        if scene is None:
            continue
        if record.get("id") in STRESS_ROOMS:
            stress[record["id"]] = (record, scene.to_dict())
        bucket = per.setdefault(scene.archetype, [])
        if len(bucket) < PER_ARCHETYPE:
            bucket.append((record, scene.to_dict()))
    chosen: list[tuple[dict, dict]] = []
    for archetype in sorted(per):
        chosen.extend(per[archetype])
    # Every stress room must actually be here. A stress room that quietly
    # vanished - renumbered map, a lexicon change that stops the room composing -
    # takes its property's only coverage with it and nothing else would say so.
    missing = sorted(set(STRESS_ROOMS) - set(stress))
    if missing:
        raise SystemExit(
            f"ABORT: stress rooms {missing} did not compose from {MAP_DB}.\n"
            "  They are in the sample because they are the only rooms that make\n"
            "  a property checkable; without them the suite passes without\n"
            "  asserting it, which is worse than failing."
        )
    for room_id in sorted(stress):
        if stress[room_id] not in chosen:
            chosen.append(stress[room_id])
    return chosen


# -- checks -----------------------------------------------------------------
#
# The properties themselves live in `room_roundtrip.verify`, shared with the
# corpus sweep (`python -m room_roundtrip`). One implementation, because a gate
# and a sweep that disagreed about what "clean" means would be worse than
# having only one of them: the gate would go green on the very defect the sweep
# was built to count.


def check_room(record: dict, spec: dict, reply: dict, radius: int) -> int:
    """Assert one composed room. Returns how many placements it matched."""
    room_id = record.get("id")
    for finding in verify(room_id, spec, reply, radius):
        ok(f"room {room_id}: {finding.label}", finding.ok, finding.detail)
    return len({row["spec_index"] for row in reply["report"]["nodes"]
                if row["role"] == "placement"})


def main() -> None:
    if not Path(MAP_DB).exists():
        not_checked(f"no DragonRealms map database at {MAP_DB}")

    godot = find_godot()
    if godot is None:
        not_checked("no Godot binary; set GODOT4 to one")

    if not (Path(PROJECT) / "project.godot").exists():
        not_checked(f"{PROJECT} is not a Godot project")

    print(f"engine {godot_version(godot)} at {godot}")
    print(f"project {PROJECT}")
    print(f"map {MAP_DB}")

    rooms = load_rooms()
    print(f"{len(rooms)} rooms in the database")
    sample = choose(rooms)
    print(f"{len(sample)} composed for the sample: "
          + ", ".join(f"{r.get('id')}/{s['archetype']}" for r, s in sample))
    print()

    matched = 0
    with RoomPlayer(godot, port=PORT, project=PROJECT) as player:
        hello = player.ping()
        ok("the server answers", bool(hello.get("ok")), json.dumps(hello))
        radius = int(hello["composer_radius"])

        # Which tree actually did the work. The break-check runs this same
        # file against a damaged copy, and without this a sabotage that failed
        # to land would look exactly like a sabotage the code survived.
        want = str(Path(PROJECT).resolve()).replace("\\", "/").rstrip("/") + "/"
        got = str(hello.get("project", "")).replace("\\", "/")
        ok("and it is the project this run pointed it at",
           got.lower() == want.lower(), f"{got} vs {want}")

        # The same question about the other half of the chain, and it is asked
        # for the same reason. `DRC_FORGE_ROOT` was added so a sabotage of
        # `forge/compose.py` could be run deliberately, and the first attempt
        # silently loaded the pristine repository copy instead - because
        # importing `room_roundtrip` put the repository back at the front of
        # `sys.path`. The break-check printed "the suite stayed green. It is not
        # checking this", which is the wrong sentence for "the damaged file was
        # never loaded", and only a claim about the file that actually got
        # imported can tell those apart.
        import forge.compose as forge_compose
        forge_file = Path(forge_compose.__file__).resolve()
        want_forge = (Path(FORGE_ROOT).resolve() / "forge" / "compose.py"
                      if FORGE_ROOT else REPO / "forge" / "compose.py")
        ok("and the forge under test is the one this run pointed at",
           forge_file == want_forge.resolve(), f"{forge_file} vs {want_forge}")

        for record, spec in sample:
            matched += check_room(record, spec, player.compose(spec), radius)

        refused = player.render(spec)
        ok("a PNG is refused with a reason rather than faked",
           refused.get("ok") is False and refused.get("rendered") is False
           and bool(refused.get("why")), json.dumps(refused))

    ok(f"the sample was at least {ROOM_FLOOR} real rooms", len(sample) >= ROOM_FLOOR,
       f"{len(sample)} rooms (a smaller number means the database walk or the "
       f"archetype selection is broken, not that the map shrank)")
    ok(f"at least {PLACEMENT_FLOOR} individual placements were matched",
       matched >= PLACEMENT_FLOOR,
       f"{matched} placements (this is the number that collapses if the composer "
       f"answers every request and places nothing)")

    print(f"\n{checked} checked, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
