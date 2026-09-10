"""Walk the real character and complain about what does not match.

The loop: look, find this room in the map database by what the game just
said, build the scene the forge would build for it, and check the two agree.
Then step to a neighbour and do it again.

Identifying the room is done by matching the live description against the
database rather than by asking Lich, on purpose. If the live text and the
stored text disagree, that is itself a finding worth having - the whole
generator is built on the stored text being what a player actually reads.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time

from forge.compose import compose
from forge.extract import read_room

from .complaints import Complaint, Sink
from .live import Session
from .oracle import check_room

DEFAULT_DB = r'C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json'


def normalise(text: str) -> str:
    return re.sub(r'[^a-z ]+', '', re.sub(r'\s+', ' ', text.lower())).strip()


def build_index(rooms: list[dict]) -> dict[str, dict]:
    """First 60 characters of each stored description -> its room record."""
    index = {}
    for record in rooms:
        for description in record.get('description') or []:
            key = normalise(description)[:60]
            if key:
                index.setdefault(key, record)
    return index


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=DEFAULT_DB)
    parser.add_argument('--port', type=int, default=11024)
    parser.add_argument('--steps', type=int, default=12, help='rooms to visit')
    parser.add_argument('--out', help='write complaints here as JSONL')
    args = parser.parse_args(argv)

    with open(args.db, encoding='utf-8') as handle:
        rooms = json.load(handle)
    index = build_index(rooms)
    print(f'map database: {len(rooms):,} rooms, {len(index):,} description keys')

    session = Session(port=args.port)
    sink = Sink(args.out)
    mission = f'walk {args.steps} real rooms and check each scene against the live description'
    rng = random.Random()

    visited, matched, unmatched = [], 0, 0
    taken: set[tuple[str, str]] = set()
    try:
        session.drain(2)
        room = session.look()

        for step in range(args.steps):
            if not room.usable:
                print(f'  step {step}: the game sent no room this time')
                room = session.look()
                continue

            print(f'  step {step}: {room.title}  exits={",".join(room.exits) or "none"}')
            visited.append(room.title)

            record = index.get(normalise(room.description)[:60])
            if record is None:
                unmatched += 1
                sink.file(Complaint(
                    severity='wrong', subject='game',
                    summary='a room the game showed is not in the map database we generate from',
                    room_title=room.title, mission=mission,
                    expected='the stored description to match what a player reads',
                    observed=(room.description or '')[:160],
                ))
            else:
                matched += 1
                reading = read_room(record)
                scene = compose(reading)

                # The live exits are the truth; the stored ones can be stale.
                reading.exits = list(room.exits)

                for complaint in check_room(
                    reading, scene, room.description, room.title, mission
                ):
                    sink.file(complaint)

                if scene and room.objects:
                    _check_objects(room, scene, sink, mission)

            if not room.exits:
                print('    no exits reported; looking again rather than guessing a direction')
                room = session.look()
                continue

            # Explore rather than wander. A random walk in a street grid
            # revisits: the first version of this saw Magen Road four times
            # in ten steps, so six of its ten samples were re-reads of three
            # rooms. Prefer a direction out of a room not yet seen, and fall
            # back to random only when everything adjacent is known.
            fresh = [d for d in room.exits if (room.title, d) not in taken]
            direction = rng.choice(fresh or room.exits)
            taken.add((room.title, direction))
            room = session.walk(direction)

    except KeyboardInterrupt:
        print('\ninterrupted')
    finally:
        session.close()

    print()
    print(f'rooms visited: {len(visited)}   matched to the database: {matched}   unmatched: {unmatched}')
    print(f'commands sent: {session.governor.sent}   refused by the safety list: {len(session.refusals)}')
    for refusal in session.refusals[:5]:
        print(f'  refused: {refusal}')
    print()
    print(sink.report())
    if args.out:
        print(f'{sink.flush()} distinct complaints -> {args.out}')

    if visited and not sink.all():
        print('\nNOTHING FOUND across a real walk. Suspect the oracle before the world.')
        return 2
    return 0


def _check_objects(room, scene, sink: Sink, mission: str) -> None:
    """Things standing in the room right now that the scene has no place for.

    The stored description is written once; `You also see ...` is what is
    actually there this minute. A scene built only from the former can be
    perfectly faithful to the text and still miss the anvil in front of you.
    """
    kinds = {p.kind for p in scene.placements}
    for noun, wants in (('anvil', 'hearth'), ('forge', 'hearth'), ('well', 'well'),
                        ('fountain', 'well'), ('statue', 'statue'), ('sign', 'sign'),
                        ('table', 'counter'), ('bench', 'counter')):
        if re.search(rf'\b{noun}s?\b', room.objects.lower()) and wants not in kinds:
            sink.file(Complaint(
                severity='wrong', subject='scene',
                summary=f'the room contains a {noun} the scene has nowhere to put',
                room_title=room.title, mission=mission,
                expected=f'a {wants} placement',
                observed=f'scene kinds: {", ".join(sorted(kinds)) or "none"}',
                evidence={'room_objects': room.objects[:200]},
            ))


if __name__ == '__main__':
    sys.exit(main())
