"""Turn the escalation queue into a few patterns instead of thousands of rooms.

The queue this replaces was a JSONL dump of every room the parser could not
read. It was honest and it was unworkable: 4,311 actionable rooms is not a
list anybody adjudicates, so nobody did, and the decisions the design calls
for were never made at all.

The observation that makes it tractable is that the failures are not 4,311
different problems. They repeat, and they repeat for reasons that are visible
in the parser's own working:

* the same description text appears in dozens of rooms, so one reading closes
  all of them at once;
* a tie is not "the parser was confused", it is two named terms in contest,
  and the same pair of terms is in contest in hundreds of rooms;
* a room with no enclosure at all still detected *something*, and what it
  detected sorts the population into recognisable kinds.

So a cluster here is keyed on the shape of the failure and on the evidence
behind it, never on the zone. Grouping by zone would produce clusters that
look tidy and share no defect - every zone has streets and shops in it - and
adjudicating one would teach you nothing about the next.

Three rules this file keeps, all of them the same rule:

**A cluster carries its evidence.** The verbatim text of sampled rooms, the
terms that fired, the counts. A cluster that says only "340 rooms failed" asks
the reader to take its word for the grouping.

**Author-side silence is not escalated.** A room whose description genuinely
never says what the ground is under it cannot be adjudicated - the only way to
close it is to invent a floor, which is the one thing this pipeline exists to
refuse. Those rooms are counted and set aside, not queued. A list that cries
wolf on 5,002 unactionable items gets skimmed on the day it matters.

**The denominator is printed.** Every count here is against all 18,950 rooms
and the clustering states how many rooms it placed, so a run that clustered
nothing reports itself instead of reporting no problems.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import pathlib
import sys
from dataclasses import dataclass, field

from .audit import DEFAULT_DB, load
from .extract import read_room, RoomReading

# How many verbatim rooms travel with a cluster. Enough to see the pattern and
# to catch a cluster that has grouped unlike things; not so many that the file
# becomes the dump it replaces.
SAMPLES = 6

# A cluster smaller than this is not a pattern, it is a room. They are kept and
# counted - dropping them is how a queue quietly loses its tail - but they are
# reported as a residue rather than as findings.
PATTERN_FLOOR = 10


@dataclass
class Cluster:
    key: str
    shape: str
    witness: str
    rooms: list[int] = field(default_factory=list)
    samples: list[dict] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.rooms)


def _tie_doubt(reading: RoomReading) -> str | None:
    for doubt in reading.doubts:
        if doubt.startswith('enclosure is a tie'):
            return doubt
    return None


def classify(reading: RoomReading, text: str) -> tuple[str, str] | None:
    """The (shape, witness) this room fails as, or None if it is not actionable.

    Order matters and is most-specific-first, so a room lands in the cluster
    that describes the most about it. A tie is more specific than a missing
    ground, because the tie is a question about the text and the missing ground
    is a statement about the author.
    """
    if not text.strip():
        return 'NO-DESCRIPTION', 'the record carries no description text'

    tie = _tie_doubt(reading)
    if tie:
        pair = tie.split('between ')[1].split(',')[0]
        sides = []
        for kind in sorted(pair.split(' and ')):
            fired = reading.evidence.get(kind) or ['(nothing named)']
            sides.append(f'{kind}: {", ".join(sorted(fired))}')
        return f'TIE {pair}', ' | '.join(sides)

    if reading.enclosure is None:
        detected = sorted({d.category for d in reading.detections})
        witness = ('nothing at all was detected' if not detected
                   else 'detected only ' + '+'.join(detected))
        return 'NO-ENCLOSURE', witness

    if not reading.detections:
        ground = reading.ground or 'no ground either'
        return 'NO-FEATURES', f'{reading.enclosure}, ground {ground}'

    if any(d.startswith('description is') for d in reading.doubts):
        return 'TOO-SHORT', f'{reading.words} words'

    # Everything left is a room whose only doubt is that the author never said
    # what the ground was. Not actionable, and deliberately not queued.
    return None


def build(rooms: list[dict]) -> tuple[list[Cluster], dict[str, int]]:
    """Cluster the actionable escalations. Returns (clusters, census)."""
    census = collections.Counter()
    by_text: dict[str, list[tuple[RoomReading, dict]]] = collections.defaultdict(list)
    by_shape: dict[tuple[str, str], Cluster] = {}
    clusters: list[Cluster] = []

    readings = []
    for record in rooms:
        reading = read_room(record)
        text = ((record.get('description') or [''])[0] or '')
        readings.append((reading, record, text))

        if reading.adjudicated:
            census['closed by a ruling'] += 1
            continue
        verdict = classify(reading, text)
        if verdict is None:
            if reading.doubts:
                census['author-side silence, not escalated'] += 1
            else:
                census['read cleanly'] += 1
            continue
        census['actionable'] += 1
        by_text[text.strip()].append((reading, record))

    # Layer one: identical text. One reading closes every room that shares it,
    # so these are separated out before anything else regardless of shape.
    for text, members in by_text.items():
        if len(members) < 2:
            continue
        reading, record = members[0]
        shape = (classify(reading, text) or ('?', '?'))[0]
        cluster = Cluster(
            # hashlib rather than hash(): str hashing is salted per process, so
            # a built-in hash would give this cluster a different name on every
            # run and no ruling could ever refer to it twice.
            key=f'SAME-TEXT/{shape}/{hashlib.sha256(text.encode()).hexdigest()[:8]}',
            shape='SAME-TEXT ' + shape,
            witness=f'{len(members)} rooms share one description, verbatim',
        )
        cluster.rooms = [r.room_id for r, _ in members]
        cluster.samples = [_sample(r, rec, text) for r, rec in members[:SAMPLES]]
        clusters.append(cluster)

    # Layer two: everything else, by shape and the evidence behind it.
    for text, members in by_text.items():
        if len(members) >= 2:
            continue
        reading, record = members[0]
        shape, witness = classify(reading, text)  # type: ignore[misc]
        key = (shape, witness)
        cluster = by_shape.get(key)
        if cluster is None:
            cluster = by_shape[key] = Cluster(
                key=f'{shape}/{witness}', shape=shape, witness=witness)
            clusters.append(cluster)
        cluster.rooms.append(reading.room_id)
        if len(cluster.samples) < SAMPLES:
            cluster.samples.append(_sample(reading, record, text))

    clusters.sort(key=lambda c: -c.size)
    return clusters, dict(census)


def _sample(reading: RoomReading, record: dict, text: str) -> dict:
    return {
        'room_id': reading.room_id,
        'location': reading.location,
        'description': text,
        'doubts': reading.doubts,
        'enclosure': reading.enclosure,
        'ground': reading.ground,
        'evidence': reading.evidence,
        'detected': sorted({d.kind for d in reading.detections}),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=DEFAULT_DB, help="Lich's DR map database")
    parser.add_argument('--out', help='write the clusters here as JSON')
    parser.add_argument('--top', type=int, default=25, help='clusters to print')
    parser.add_argument('--show', help='print the full evidence for one cluster key')
    args = parser.parse_args(argv)

    rooms = load(args.db)
    if not rooms:
        print('REFUSING TO REPORT: no rooms loaded, so every count below '
              'would be a zero that means nothing')
        return 2

    clusters, census = build(rooms)
    total = len(rooms)
    actionable = census.get('actionable', 0)
    placed = sum(c.size for c in clusters)

    # The denominator, asserted rather than assumed. If the clustering silently
    # stopped placing rooms, this is the line that says so - a run that reports
    # "no large clusters" and a run that clustered nothing look identical
    # without it.
    if placed != actionable:
        print(f'REFUSING TO REPORT: clustered {placed:,} rooms but {actionable:,} '
              f'were actionable. The clustering is dropping rooms.')
        return 2
    if actionable and not clusters:
        print('REFUSING TO REPORT: rooms are actionable but no cluster was built')
        return 2

    print(f'rooms examined: {total:,}')
    for name, n in sorted(census.items(), key=lambda kv: -kv[1]):
        print(f'  {n:>7,}  {n / total * 100:5.1f}%  {name}')
    print()

    patterns = [c for c in clusters if c.size >= PATTERN_FLOOR]
    residue = [c for c in clusters if c.size < PATTERN_FLOOR]
    print(f'{len(clusters):,} clusters over {actionable:,} actionable rooms')
    print(f'  {len(patterns):,} patterns of {PATTERN_FLOOR}+ rooms, '
          f'covering {sum(c.size for c in patterns):,} rooms '
          f'({sum(c.size for c in patterns) / max(actionable, 1) * 100:.1f}% of actionable)')
    print(f'  {len(residue):,} clusters below {PATTERN_FLOOR}, '
          f'covering {sum(c.size for c in residue):,} rooms - a residue, not a finding')
    print()

    by_shape = collections.Counter()
    for cluster in clusters:
        by_shape[cluster.shape.split('/')[0]] += cluster.size
    print('by failure shape:')
    for shape, n in by_shape.most_common():
        print(f'  {n:>7,}  {shape}')
    print()

    print(f'largest {args.top} clusters:')
    for cluster in clusters[: args.top]:
        print(f'  {cluster.size:>5,}  {cluster.shape}')
        print(f'         {cluster.witness}')
    print()

    if args.show:
        picked = [c for c in clusters if args.show in c.key or args.show in c.witness]
        if not picked:
            print(f'no cluster matched {args.show!r}')
            return 2
        for cluster in picked[:3]:
            print(f'=== {cluster.key}  ({cluster.size:,} rooms) ===')
            print(f'    {cluster.witness}')
            for sample in cluster.samples:
                print(f'\n  #{sample["room_id"]} [{sample["location"]}]')
                print(f'    {sample["description"][:300]}')
                print(f'    evidence: {sample["evidence"]}')
                print(f'    doubts:   {"; ".join(sample["doubts"]) or "(none)"}')
            print()

    if args.out:
        path = pathlib.Path(args.out)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            'rooms_examined': total,
            'census': census,
            'clusters': [
                {
                    'key': c.key,
                    'shape': c.shape,
                    'witness': c.witness,
                    'rooms': c.size,
                    'room_ids': c.rooms,
                    'samples': c.samples,
                }
                for c in clusters
            ],
        }
        path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
        print(f'clusters -> {path}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
