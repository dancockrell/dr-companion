"""Run the parser over every room and report what it could not read.

The number that matters here is not how many rooms produced a scene. It is
how many produced one *honestly*. A generator that emits a plausible street
for every room it failed to understand reports 100% and is worthless, and
that failure is invisible unless the refusals are counted separately and
printed next to the successes.

So this prints three populations and never merges them: read, doubted, and
refused. Anything in the second or third goes to the escalation queue rather
than into the world.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys

from . import rulings as _rulings
from .extract import read_room

DEFAULT_DB = r'C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json'


def load(path: str) -> list[dict]:
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=DEFAULT_DB, help="Lich's DR map database")
    parser.add_argument('--location', help='limit to one location, e.g. Zoluren')
    parser.add_argument('--limit', type=int, help='stop after N rooms')
    parser.add_argument('--queue', help='write the escalation queue here as JSONL')
    parser.add_argument('--examples', type=int, default=0, help='show N doubted rooms')
    parser.add_argument('--rulings', action='store_true',
                        help='print every ruling in force and the open questions')
    args = parser.parse_args(argv)

    rooms = load(args.db)
    if args.location:
        rooms = [r for r in rooms if r.get('location') == args.location]
    if args.limit:
        rooms = rooms[: args.limit]

    if not rooms:
        print('REFUSING TO REPORT: no rooms matched, so any percentage below would be a lie')
        return 2

    read_ok, bare, doubted, refused, overridden = [], [], [], [], []
    enclosures = collections.Counter()
    grounds = collections.Counter()
    feature_counts = []
    placed, unplaced = 0, 0
    doubt_reasons = collections.Counter()

    for record in rooms:
        reading = read_room(record)

        # A room closed by hand is counted on its own and never anywhere else.
        # Folding an override into `read_ok` is precisely how a coverage
        # number becomes a lie: it would say the parser read a room that a
        # person decided.
        if reading.adjudicated:
            overridden.append(reading)
        # Refused: nothing to compose a scene from at all.
        elif reading.enclosure is None:
            refused.append(reading)
        elif not reading.detections:
            # A room with no props is not automatically a room the parser
            # failed on. If the text named both the enclosure and the ground,
            # there are two real readings in hand and compose.py has an
            # archetype and a surface to draw - an empty stretch of street or
            # an empty desert is a scene, and a truthful one.
            #
            # Counted separately from `read_ok` all the same. These scenes are
            # thin, and merging them into the headline number would overstate
            # what the pipeline can draw. What was wrong before was calling
            # them refusals, which understated it in the other direction.
            if reading.ground and not reading.doubts:
                bare.append(reading)
            else:
                refused.append(reading)
        elif reading.doubts:
            doubted.append(reading)
        else:
            read_ok.append(reading)

        for reason in reading.doubts:
            doubt_reasons[reason.split(',')[0]] += 1

        if reading.enclosure:
            enclosures[reading.enclosure] += 1
        if reading.ground:
            grounds[reading.ground] += 1
        feature_counts.append(len(reading.detections))
        for d in reading.detections:
            if d.direction:
                placed += 1
            else:
                unplaced += 1

    total = len(rooms)
    pct = lambda n: f'{n / total * 100:5.1f}%'

    print(f'rooms examined: {total:,}')
    print()
    print(f'  read cleanly   {len(read_ok):>7,}  {pct(len(read_ok))}')
    print(f'  read bare      {len(bare):>7,}  {pct(len(bare))}   '
          f'enclosure and ground from the text, no props')
    print(f'  overridden     {len(overridden):>7,}  {pct(len(overridden))}   '
          f'decided by a ruling, NOT read by the parser')
    print(f'  doubted        {len(doubted):>7,}  {pct(len(doubted))}   -> escalate')
    print(f'  refused        {len(refused):>7,}  {pct(len(refused))}   -> escalate')
    print()

    # Spelled out because the two numbers answer different questions and the
    # difference is the whole point of keeping the columns apart.
    print(f'  composable from the room\'s own words: '
          f'{len(read_ok) + len(bare):,}  {pct(len(read_ok) + len(bare))}')
    if overridden:
        print(f'  composable only because somebody decided: {len(overridden):,}  '
              f'{pct(len(overridden))}')
    print()

    features = sum(feature_counts)
    print(f'features detected: {features:,}  '
          f'({features / total:.1f} per room, max {max(feature_counts)})')

    # The question that decides whether this is a scene or a themed backdrop.
    total_features = placed + unplaced
    if total_features:
        print(f'  with a direction in the text: {placed:,} of {total_features:,} '
              f'({placed / total_features * 100:.1f}%) - placeable')
        print(f'  without:                      {unplaced:,} '
              f'({unplaced / total_features * 100:.1f}%) - composed by rule')
    print()

    print('enclosure:')
    for kind, n in enclosures.most_common():
        print(f'  {kind:<14} {n:>7,}  {pct(n)}')
    print()
    print('ground (top 10):')
    for kind, n in grounds.most_common(10):
        print(f'  {kind:<14} {n:>7,}  {pct(n)}')

    if doubt_reasons:
        print()
        print('why rooms were doubted:')
        for reason, n in doubt_reasons.most_common(8):
            print(f'  {n:>7,}  {reason}')

    # What the escalation queue is actually made of, which is not obvious from
    # the counts above and decides whether it is worth a human's time.
    #
    # A doubt only earns an escalation if there is something a reader could do
    # about it. "The parser could not tell inside from outside" is one of
    # those. "The author never wrote down what the floor was made of" is not:
    # the only way to close it is to invent a floor, which is the one thing
    # this whole pipeline exists to refuse. Printing them as one number makes
    # a queue of several thousand items that mostly cannot be acted on, and a
    # list that cries wolf gets skimmed on the day it matters.
    silent, unsure = 0, 0
    for reading in doubted:
        reasons = set(reading.doubts)
        if reasons == {'nothing in the text says what the ground is'}:
            silent += 1
        else:
            unsure += 1
    if doubted:
        print()
        print('what the doubted population is made of:')
        print(f'  {silent:>7,}  {pct(silent)}  the description never mentions the '
              f'ground; composable, nothing to escalate')
        print(f'  {unsure:>7,}  {pct(unsure)}  the parser is genuinely unsure; '
              f'this is the actionable queue')

    # What is in force, printed rather than left implicit. A ruling nobody can
    # see is a change to the parser's behaviour with no trail back to whoever
    # made it and the evidence they made it on.
    if args.rulings:
        ruled = _rulings.active()
        print()
        print(f'rulings in force: {len(ruled.by_id)}')
        for ruling in ruled.by_id.values():
            if ruling['kind'] == 'lexicon':
                what = (f'lexicon {ruling["table"]}/{ruling["category"]}: '
                        f'-{list(ruling.get("remove", []))} '
                        f'+{list(ruling.get("add", []))}')
            else:
                what = (f'{len(ruling["rooms"])} rooms overridden: '
                        f'{ruling["set"]}')
            print(f'\n  [{ruling["id"]}] {what}')
            print(f'    by:  {ruling["by"]}')
            print(f'    why: {ruling["why"][:400]}')
        print()
        print(f'open questions for Dan: {len(ruled.open_questions)}')
        for question in ruled.open_questions:
            print(f'\n  [{question["id"]}] {question.get("rooms", "?")} rooms, '
                  f'cluster {question.get("cluster")}')
            print(f'    {question["question"]}')

    if args.examples:
        print()
        print(f'--- {args.examples} doubted rooms, verbatim ---')
        for reading in (doubted + refused)[: args.examples]:
            record = next(r for r in rooms if r.get('id') == reading.room_id)
            title = (record.get('title') or ['(untitled)'])[0]
            desc = (record.get('description') or [''])[0]
            print(f'\n#{reading.room_id} {title}')
            print(f'  {desc[:220]}')
            print(f'  DOUBT: {"; ".join(reading.doubts) or "no features detected"}')

    if args.queue:
        path = pathlib.Path(args.queue)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('w', encoding='utf-8') as handle:
            for reading in doubted + refused:
                record = next(r for r in rooms if r.get('id') == reading.room_id)
                handle.write(json.dumps({
                    'room_id': reading.room_id,
                    'title': (record.get('title') or [None])[0],
                    'location': reading.location,
                    'description': (record.get('description') or [None])[0],
                    'exits': reading.exits,
                    'doubts': reading.doubts,
                    'detected': [d.kind for d in reading.detections],
                }) + '\n')
        print(f'\nescalation queue: {len(doubted) + len(refused):,} rooms -> {path}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
