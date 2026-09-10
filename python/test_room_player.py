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

Every placement the forge emitted must appear in the tree, once, with its kind,
traceable to the spec index it came from. Every opening must appear. The
counts must be exactly the arithmetic (81 ground tiles, 32 perimeter cells, a
three-cell gap per compass opening) rather than "about right". And every node's
position must satisfy the projection formula, recomputed here in Python rather
than read back from Godot, so agreement means two implementations agree instead
of one implementation repeating itself.

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

from room_player_client import RoomPlayer, find_godot, godot_version  # noqa: E402

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

#: Room 8179, the Temple of Light's grand hall, carries fifteen `go <thing>`
#: exits. Edge placements are the case where a naive layout stacks everything
#: on one cell, and no hand-written fixture would have thought to have fifteen.
STRESS_ROOM = 8179

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
    stress: list[tuple[dict, dict]] = []
    for record in sorted(rooms, key=lambda r: r.get("id") or 0):
        scene = compose(read_room(record))
        if scene is None:
            continue
        if record.get("id") == STRESS_ROOM:
            stress.append((record, scene.to_dict()))
        bucket = per.setdefault(scene.archetype, [])
        if len(bucket) < PER_ARCHETYPE:
            bucket.append((record, scene.to_dict()))
    chosen: list[tuple[dict, dict]] = []
    for archetype in sorted(per):
        chosen.extend(per[archetype])
    for entry in stress:
        if entry not in chosen:
            chosen.append(entry)
    return chosen


# -- the projection, independently ------------------------------------------

TILE_W = 64.0
TILE_H = 32.0


def iso(gx: float, gy: float) -> tuple[float, float]:
    """The same formula as `RoomComposer.iso`, written out again here.

    Deliberately a second implementation rather than a value read back from the
    report. Two implementations agreeing is evidence; one implementation
    agreeing with itself is not.
    """
    return ((gx - gy) * TILE_W / 2.0, (gx + gy) * TILE_H / 2.0)


# -- checks -----------------------------------------------------------------


def check_room(record: dict, spec: dict, reply: dict, radius: int) -> int:
    """Assert one composed room. Returns how many placements it matched."""
    room_id = record.get("id")
    report = reply["report"]
    counts = report["counts"]
    nodes = report["nodes"]
    room = report["room"]

    side = radius * 2 + 1
    perimeter = radius * 8

    ok(f"room {room_id}: the report is about this room", room.get("room_id") == room_id,
       f"report says {room.get('room_id')}")
    ok(f"room {room_id}: archetype survived the round trip",
       room.get("archetype") == spec["archetype"],
       f"{room.get('archetype')} vs {spec['archetype']}")
    ok(f"room {room_id}: ground fills the grid", counts["ground"] == side * side,
       f"{counts['ground']} tiles, wanted {side * side}")

    ring_openings = [d for d in spec["openings"]
                     if d in ("north", "northeast", "east", "southeast",
                              "south", "southwest", "west", "northwest")]
    want_boundary = perimeter - 3 * len(ring_openings)
    ok(f"room {room_id}: boundary is the perimeter less one gap per compass exit",
       counts["boundary"] == want_boundary,
       f"{counts['boundary']} segments, wanted {want_boundary} "
       f"({perimeter} - 3x{len(ring_openings)})")

    got_openings = sorted(row["dir"] for row in report["openings"])
    ok(f"room {room_id}: every exit the game reports is an opening",
       got_openings == sorted(spec["openings"]),
       f"{got_openings} vs {sorted(spec['openings'])}")

    placements = [row for row in nodes if row["role"] == "placement"]
    by_index = {row["spec_index"]: row for row in placements}
    ok(f"room {room_id}: every placement appears exactly once",
       len(by_index) == len(spec["placements"]) == len(placements),
       f"{len(placements)} nodes, {len(by_index)} distinct indices, "
       f"{len(spec['placements'])} in the spec")

    wrong_kind = [
        i for i, p in enumerate(spec["placements"])
        if i not in by_index or by_index[i]["kind"] != p["kind"]
    ]
    ok(f"room {room_id}: each placement carries the kind the forge asked for",
       not wrong_kind, f"{len(wrong_kind)} mismatched at indices {wrong_kind[:5]}")

    off = []
    for row in nodes:
        gx, gy = row["grid"]
        want_x, want_y = iso(float(gx), float(gy))
        want_y += float(row.get("stack_offset", 0.0))
        if row["role"] == "canopy":
            want_y += float(row.get("lift", 0.0))
        if abs(row["pos"][0] - want_x) > 0.001 or abs(row["pos"][1] - want_y) > 0.001:
            off.append((row["path"], row["pos"], [want_x, want_y]))
    ok(f"room {room_id}: every node sits where the projection puts it",
       not off, f"{len(off)} off, first {off[0] if off else ''}")

    ok(f"room {room_id}: the composer reports no problems with a real forge spec",
       not room["problems"], str(room["problems"][:2]))
    ok(f"room {room_id}: every kind is one the primitive table knows",
       not report["unknown_kinds"], str(report["unknown_kinds"]))

    return len(by_index)


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
