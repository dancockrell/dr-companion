"""Does the tree Godot built match the scene the forge asked for?

One verification, two callers, because two would drift:

  * `python/test_room_player.py` - the gate, a fixed dozen-odd rooms, one
    printed line per assertion per room.
  * `python -m room_roundtrip` (the `main` below) - the sweep, every composable
    room in the map database or a slice of it, one line per *failing* room and
    a census at the end.

The gate answers "did this change break the round trip". The sweep answers
"how much of the real map survives it", which is a different question and the
only one that finds a defect present in 20% of rooms and in none of the dozen.
That is not hypothetical: the sweep is what found edge-anchored doors landing
on the north cell, in 178 rooms of a 1,004-room sample, while the gate was
green.

# What a finding is

`verify` returns a list of `Finding`, one per property, each with the property
it asserted and whether the built tree has it. It never raises and it never
prints. Both callers decide what to do with them, and neither can quietly
disagree with the other about what "clean" means.

# The properties, and why these

Everything the forge put in the spec must be in the tree - every placement,
once, at the position asked for, with the kind asked for; every opening. The
counts must be the arithmetic exactly (81 ground tiles, 32 perimeter cells
less a three-cell gap per compass exit) rather than "about right". Every node
must satisfy the isometric projection, recomputed here in Python rather than
read back out of the report, so agreement means two implementations agree
instead of one implementation repeating itself.

And no two features may occupy one position. A position is a cell *and* a
layer: "overhead", "underfoot" and "in the middle" are the same cell and three
different places, so counting by cell alone reports collisions that are not
there and hides the ones that are.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(REPO))

#: Where the `forge` package is imported from. Must be applied *after* REPO,
#: and this module must apply it even though `test_room_player.py` already
#: does: importing this one used to push REPO back to the front of `sys.path`
#: and quietly undo the override. That is not a hypothetical - it made a
#: deliberate sabotage of `forge/compose.py` run against the pristine repository
#: copy, and the break-check reported "the suite stayed green. It is not
#: checking this" when it meant "the damaged file was never loaded".
FORGE_ROOT = os.environ.get("DRC_FORGE_ROOT")
if FORGE_ROOT:
    sys.path.insert(0, FORGE_ROOT)

TILE_W = 64.0
TILE_H = 32.0

COMPASS = ("north", "northeast", "east", "southeast",
           "south", "southwest", "west", "northwest")


def iso(gx: float, gy: float) -> tuple[float, float]:
    """The same formula as `RoomComposer.iso`, written out again here.

    Deliberately a second implementation rather than a value read back from the
    report. Two implementations agreeing is evidence; one implementation
    agreeing with itself is not.
    """
    return ((gx - gy) * TILE_W / 2.0, (gx + gy) * TILE_H / 2.0)


def ring_cells(radius: int) -> dict[str, tuple[int, int]]:
    """Compass word -> grid cell, and the special anchors, worked out here.

    A second implementation of `RoomComposer.RING` on purpose, from the same
    two facts the composer derives it from - that north is -x-y and that the
    ring sits at the radius. `edge` is deliberately absent: it has no bearing,
    so there is no cell to predict, and pretending otherwise would turn an
    honest "the room never said" into a wrong assertion.
    """
    r = radius
    return {
        "north": (-r, -r), "northeast": (0, -r), "east": (r, -r),
        "southeast": (r, 0), "south": (r, r), "southwest": (0, r),
        "west": (-r, r), "northwest": (-r, 0),
        "center": (0, 0), "centre": (0, 0), "ground": (0, 0), "canopy": (0, 0),
    }


@dataclass
class Finding:
    label: str
    ok: bool
    detail: str = ""


def verify(room_id, spec: dict, reply: dict, radius: int) -> list[Finding]:
    """Assert one composed room. Returns one Finding per property checked."""
    out: list[Finding] = []

    def note(label: str, cond: bool, detail: str = "") -> None:
        out.append(Finding(label, bool(cond), detail))

    report = reply["report"]
    counts = report["counts"]
    nodes = report["nodes"]
    room = report["room"]

    side = radius * 2 + 1
    perimeter = radius * 8

    note("the report is about this room", room.get("room_id") == room_id,
         f"report says {room.get('room_id')}")
    note("archetype survived the round trip",
         room.get("archetype") == spec["archetype"],
         f"{room.get('archetype')} vs {spec['archetype']}")
    note("ground fills the grid", counts["ground"] == side * side,
         f"{counts['ground']} tiles, wanted {side * side}")

    ring_openings = [d for d in spec["openings"] if d in COMPASS]
    want_boundary = perimeter - 3 * len(ring_openings)
    note("boundary is the perimeter less one gap per compass exit",
         counts["boundary"] == want_boundary,
         f"{counts['boundary']} segments, wanted {want_boundary} "
         f"({perimeter} - 3x{len(ring_openings)})")

    got_openings = sorted(row["dir"] for row in report["openings"])
    note("every exit the game reports is an opening",
         got_openings == sorted(spec["openings"]),
         f"{got_openings} vs {sorted(spec['openings'])}")

    placements = [row for row in nodes if row["role"] == "placement"]
    by_index = {row["spec_index"]: row for row in placements}
    note("every placement appears exactly once",
         len(by_index) == len(spec["placements"]) == len(placements),
         f"{len(placements)} nodes, {len(by_index)} distinct indices, "
         f"{len(spec['placements'])} in the spec")

    wrong_kind = [i for i, p in enumerate(spec["placements"])
                  if i not in by_index or by_index[i]["kind"] != p["kind"]]
    note("each placement carries the kind the forge asked for",
         not wrong_kind, f"{len(wrong_kind)} mismatched at indices {wrong_kind[:5]}")

    # The position, not only the kind. A composer that builds every node with
    # the right label at the wrong anchor passes every check above.
    #
    # Checked against the *cell*, worked out here from the compass word and the
    # radius, not against the `where` string. The string is one the composer
    # copies straight out of the spec, so comparing it can only catch a
    # composer that mangles text, never one that puts the node in the wrong
    # place - which is the failure that matters and the one that was found.
    want_cell = ring_cells(radius)
    wrong_where = []
    for i, p in enumerate(spec["placements"]):
        row = by_index.get(i)
        if row is None or row["where"] != p["where"]:
            wrong_where.append((i, "missing or relabelled"))
            continue
        expected = want_cell.get(p["where"])
        if expected is not None and tuple(row["grid"]) != expected:
            wrong_where.append((i, f'{p["where"]} -> {row["grid"]}, wanted {list(expected)}'))
    note("each placement carries the position the forge asked for",
         not wrong_where, f"{len(wrong_where)} mismatched: {wrong_where[:3]}")

    # The forge only records `displaced_from` so that something downstream can
    # tell a demoted text reading from a plain rule fill. If it does not survive
    # the trip, the field is an absence with extra steps.
    lost_trace = [i for i, p in enumerate(spec["placements"])
                  if p.get("displaced_from")
                  and (i not in by_index
                       or by_index[i].get("displaced_from") != p["displaced_from"])]
    note("a displaced text reading keeps the word the room used",
         not lost_trace, f"{len(lost_trace)} lost at indices {lost_trace[:5]}")

    off = []
    for row in nodes:
        gx, gy = row["grid"]
        want_x, want_y = iso(float(gx), float(gy))
        want_y += float(row.get("stack_offset") or 0.0)
        want_y += float(row.get("lift") or 0.0)
        if abs(row["pos"][0] - want_x) > 0.001 or abs(row["pos"][1] - want_y) > 0.001:
            off.append((row["path"], row["pos"], [want_x, want_y]))
    note("every node sits where the projection puts it",
         not off, f"{len(off)} off, first {off[0] if off else ''}")

    # The one this whole lane exists for. Keyed on (cell, layer): the vertical
    # anchors share the middle cell on purpose and are not on top of each other.
    spots = Counter((tuple(row["grid"]), row.get("layer", "floor"))
                    for row in placements)
    doubled = {k: n for k, n in spots.items() if n > 1}
    note("no two features occupy one position",
         not doubled,
         f"{len(doubled)} position(s) hold more than one: "
         + ", ".join(f"{cell}/{layer} x{n}" for (cell, layer), n in
                     sorted(doubled.items(), key=lambda kv: -kv[1])[:4]))

    note("the composer reports no problems with a real forge spec",
         not room["problems"], str(room["problems"][:2]))
    note("every kind is one the primitive table knows",
         not report["unknown_kinds"], str(report["unknown_kinds"]))

    return out


# -- the sweep ---------------------------------------------------------------

MAP_DB = os.environ.get("DRC_DR_MAP", r"C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json")
PROJECT = os.environ.get("DRC_ROOM_PROJECT", str(REPO / "godot"))
PORT = int(os.environ.get("DRC_ROOM_PORT", "11731"))

#: A sweep that composes nothing and a sweep that composes everything cleanly
#: print the same "0 failures". This is the number that collapses when the
#: database walk, the archetype selection or the socket breaks.
SWEEP_FLOOR = 500


def main(argv: list[str]) -> int:
    from room_player_client import RoomPlayer, find_godot, godot_version

    from forge.compose import compose
    from forge.extract import read_room

    #: Every Nth composable room, lowest id first. Deterministic, so a change in
    #: the result is a change in the code and not a change in the sample.
    step = 1
    limit = 0
    for arg in argv:
        if arg.startswith("--every="):
            step = int(arg.split("=", 1)[1])
        elif arg.startswith("--limit="):
            limit = int(arg.split("=", 1)[1])

    if not Path(MAP_DB).exists():
        print(f"NOT CHECKED: no DragonRealms map database at {MAP_DB}")
        print("  This is not a pass. Nothing round-tripped.")
        return 0
    godot = find_godot()
    if godot is None:
        print("NOT CHECKED: no Godot binary; set GODOT4 to one")
        print("  This is not a pass. Nothing round-tripped.")
        return 0
    if not (Path(PROJECT) / "project.godot").exists():
        print(f"NOT CHECKED: {PROJECT} is not a Godot project")
        print("  This is not a pass. Nothing round-tripped.")
        return 0

    print(f"engine {godot_version(godot)}")
    print(f"project {PROJECT}")
    print(f"map     {MAP_DB}")

    with open(MAP_DB, encoding="utf-8") as handle:
        records = json.load(handle)

    specs: list[tuple[int, dict]] = []
    refused = 0
    for record in sorted(records, key=lambda r: r.get("id") or 0):
        scene = compose(read_room(record))
        if scene is None:
            refused += 1
            continue
        specs.append((record.get("id"), scene.to_dict()))
    print(f"{len(records)} rooms, {len(specs)} composable, {refused} refused a scene")

    sample = specs[::step]
    if limit:
        sample = sample[:limit]
    print(f"{len(sample)} to round-trip (every {step}"
          + (f", first {limit}" if limit else "") + ")")
    print()

    clean = 0
    checks = 0
    failures = 0
    by_property: Counter = Counter()
    first_examples: dict[str, tuple] = {}

    with RoomPlayer(godot, port=PORT, project=PROJECT) as player:
        hello = player.ping()
        if not hello.get("ok"):
            print(f"FAIL: the server did not answer: {hello}")
            return 1
        radius = int(hello["composer_radius"])

        # Which tree actually did the work. Without it, a sabotage the server
        # never loaded looks exactly like code that survived it.
        want = str(Path(PROJECT).resolve()).replace("\\", "/").rstrip("/") + "/"
        got = str(hello.get("project", "")).replace("\\", "/")
        if got.lower() != want.lower():
            print(f"FAIL: the server is serving {got}, not {want}")
            return 1
        print(f"server pid {player.process.pid} on 127.0.0.1:{PORT}, "
              f"composer radius {radius}, project confirmed")

        for room_id, spec in sample:
            findings = verify(room_id, spec, player.compose(spec), radius)
            checks += len(findings)
            bad = [f for f in findings if not f.ok]
            if not bad:
                clean += 1
                continue
            failures += len(bad)
            for finding in bad:
                by_property[finding.label] += 1
                first_examples.setdefault(finding.label, (room_id, finding.detail))
            if len(by_property) <= 40:
                print(f"room {room_id}: " + "; ".join(
                    f"{f.label} [{f.detail}]" for f in bad))

    print()
    print(f"{clean} / {len(sample)} rooms round-tripped clean "
          f"({100.0 * clean / max(len(sample), 1):.1f}%)")
    print(f"{checks} properties checked, {failures} failed")
    if by_property:
        print("\nby property:")
        for label, n in by_property.most_common():
            room_id, detail = first_examples[label]
            print(f"  {n:>6}  {label}\n          first: room {room_id} [{detail}]")

    if len(sample) < SWEEP_FLOOR:
        print(f"\nFAIL: only {len(sample)} rooms were swept, below the floor of "
              f"{SWEEP_FLOOR}. A sweep this small proves nothing; the database "
              f"walk or the composer is broken, not the map.")
        return 1

    print(f"\n{'PASS' if not failures else 'FAIL'}: "
          f"{len(sample)} rooms, {checks} properties, {failures} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
