"""Send the bot at the world and print what it complains about.

Two ways to run, and the difference matters:

  --walk        reads rooms out of Lich's map database and criticises the
                scenes they produce. No game, no account, no risk, and it can
                cover 18,950 rooms in a minute.

  --live        plays the actual character through the companion bridge.
                Everything it may send goes through playbot.safety, which is
                an allowlist, and it is rate-limited and budgeted. Not
                implemented until the offline half has stopped finding
                things, because there is no sense risking an account to find
                bugs a file can tell you about.

The offline mode is not a stand-in for the live one. It cannot see anything
about how the client behaves, only whether the scenes agree with the text.
That limit is the point of saying it out loud.
"""

from __future__ import annotations

import argparse
import json
import random
import sys

from forge.compose import compose
from forge.extract import read_room

from .complaints import Sink
from .oracle import check_neighbours, check_room

DEFAULT_DB = r'C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json'


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=DEFAULT_DB)
    parser.add_argument('--walk', type=int, default=500, help='rooms to visit')
    parser.add_argument('--location', help='limit to one location')
    parser.add_argument('--seed', type=int, default=1, help='which rooms it wanders into')
    parser.add_argument('--out', help='write complaints here as JSONL')
    parser.add_argument('--live', action='store_true', help='play the real character')
    args = parser.parse_args(argv)

    if args.live:
        print('live play is not built yet, and deliberately so.')
        print('playbot.safety is written and enforced, but the offline walk below')
        print('is still finding defects, and none of them need an account at risk.')
        return 3

    with open(args.db, encoding='utf-8') as handle:
        rooms = json.load(handle)
    if args.location:
        rooms = [r for r in rooms if r.get('location') == args.location]

    # Wander rather than march: taking the first N rooms samples one city and
    # reads as a finding about the world.
    rng = random.Random(args.seed)
    if args.walk < len(rooms):
        rooms = rng.sample(rooms, args.walk)

    sink = Sink(args.out)
    mission = f'walk {len(rooms)} rooms and check every scene against its own description'
    scenes, wayto, visited = {}, {}, 0

    for record in rooms:
        descriptions = record.get('description') or []
        if not descriptions:
            continue
        visited += 1
        reading = read_room(record)
        scene = compose(reading)
        if scene:
            scenes[record['id']] = scene
            wayto[record['id']] = record.get('wayto') or {}
        for complaint in check_room(
            reading, scene, descriptions[0],
            (record.get('title') or [None])[0], mission,
        ):
            sink.file(complaint)

    for complaint in check_neighbours(scenes, wayto):
        sink.file(complaint)

    print(f'mission: {mission}')
    print(f'rooms with a description visited: {visited:,}')
    print(f'scenes built: {len(scenes):,}')
    print()
    print(sink.report())

    if args.out:
        print(f'{sink.flush()} distinct complaints -> {args.out}')

    # A run that finds nothing is more likely a broken bot than a clean world,
    # and it should say so rather than read as a pass.
    if visited and not sink.all():
        print('\nNOTHING FOUND. Treat this as a broken oracle until proven otherwise.')
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
