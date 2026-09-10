"""Read a room's own words and say what is in it.

The one rule this file exists to enforce: **the description is the source.**
Not the title, not the zone, not the room's neighbours. An earlier pipeline in
this repository classified 17,750 rooms by reading their names and stamped
`"rule":"title"` on every record it produced; that is derived data wearing the
costume of observed data, and it is what this replaces.

Two things are read besides the prose, and both are structure rather than
content: the room's real exits (a scene needs an opening where the game says
you can walk out) and its location (which regional palette to tint with).
Neither may decide what is *in* the room.

Nothing here guesses. A room the parser cannot read is refused and counted,
never filled with a plausible default - the failure mode that makes a
generator look 100% successful while emitting the same street 8,000 times.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from .lexicon import CATEGORIES, DIRECTIONS, ENCLOSURE

# A sentence is the unit a feature and its direction share. "A fountain plays
# to the southeast. Trees line the road." - splitting on sentences is what
# stops the fountain being placed among the trees.
_SENTENCE = re.compile(r'(?<=[.!?])\s+')


@dataclass
class Detection:
    """One thing the room said, and where in the text it said it."""

    category: str
    kind: str
    term: str
    sentence: int
    direction: str | None = None
    scale: str | None = None
    tint: str | None = None


@dataclass
class RoomReading:
    """Everything the parser could establish about one room, and what it could not."""

    room_id: int
    detections: list[Detection] = field(default_factory=list)
    enclosure: str | None = None
    ground: str | None = None
    exits: list[str] = field(default_factory=list)
    location: str | None = None
    words: int = 0
    doubts: list[str] = field(default_factory=list)

    def of(self, category: str) -> list[Detection]:
        return [d for d in self.detections if d.category == category]

    def kinds(self, category: str) -> list[str]:
        seen, out = set(), []
        for d in self.of(category):
            if d.kind not in seen:
                seen.add(d.kind)
                out.append(d.kind)
        return out

    @property
    def seed(self) -> int:
        """Stable per room, so a room looks the same on every visit.

        Variation is for wayfinding: a landmark you cannot learn is not a
        landmark. Seeding off the room id rather than the clock or the run
        order is what makes the variation learnable instead of noise.
        """
        return int(hashlib.sha256(str(self.room_id).encode()).hexdigest()[:8], 16)


def _first_match(text: str, table: dict[str, tuple[str, ...]]) -> tuple[str, str] | None:
    """The most specific matching entry, since tables lead with their specifics."""
    for kind, terms in table.items():
        for term in terms:
            if re.search(rf'\b{re.escape(term)}', text):
                return kind, term
    return None


def _all_matches(text: str, table: dict[str, tuple[str, ...]]) -> list[tuple[str, str]]:
    out = []
    for kind, terms in table.items():
        for term in terms:
            if re.search(rf'\b{re.escape(term)}', text):
                out.append((kind, term))
                break
    return out


def _direction_in(sentence: str) -> str | None:
    for d in DIRECTIONS:
        if re.search(rf'\b{d}\b', sentence):
            return 'center' if d == 'centre' else d
    return None


def read_room(record: dict) -> RoomReading:
    """Parse one room record out of Lich's map database.

    `record` is a raw entry from `data/DR/map-*.json`: it carries `description`
    (one string per variant - DragonRealms writes a day and a night version of
    many rooms), `wayto` (the real exits), and `location`.
    """
    room_id = record.get('id')
    descriptions = record.get('description') or []
    reading = RoomReading(
        room_id=room_id,
        # Some rooms carry a null movement string for an exit that exists.
        # Dropping the nulls rather than the exits: the opening is real even
        # when the database has forgotten the words for walking through it.
        exits=sorted({v for v in (record.get('wayto') or {}).values() if v}),
        location=record.get('location'),
    )

    if not descriptions:
        reading.doubts.append('no description at all')
        return reading

    # The first variant is the one to read. The others are the same room at a
    # different hour; composing from all of them would put the moonlight and
    # the sunlight in one scene.
    text = descriptions[0]
    reading.words = len(text.split())

    if reading.words < 8:
        reading.doubts.append(f'description is {reading.words} words, too short to compose from')

    lowered = text.lower()
    sentences = _SENTENCE.split(lowered)

    for index, sentence in enumerate(sentences):
        direction = _direction_in(sentence)
        scale = _first_match(sentence, CATEGORIES['scale'])
        tint = _first_match(sentence, CATEGORIES['tint'])
        for category in ('structure', 'flora', 'water', 'light'):
            for kind, term in _all_matches(sentence, CATEGORIES[category]):
                reading.detections.append(
                    Detection(
                        category=category,
                        kind=kind,
                        term=term,
                        sentence=index,
                        direction=direction,
                        scale=scale[0] if scale else None,
                        tint=tint[0] if tint else None,
                    )
                )

    ground = _first_match(lowered, CATEGORIES['ground'])
    if ground:
        reading.ground = ground[0]
    else:
        reading.doubts.append('nothing in the text says what the ground is')

    reading.enclosure = _decide_enclosure(lowered, reading)
    return reading


# A noun is not evidence of enclosure until you know how far away it is.
#
# Measured, not assumed: "elegant shops with columned arches line the
# cul-de-sac" and "blasts of heat roll out of the flat-roofed white buildings"
# both mention shops and buildings, and in both the speaker is standing in a
# street looking at them. Counting the nouns alone read those rooms as
# interiors. What separates them is the relationship - a thing that is
# *nearby*, *across*, or *lining* something is scenery; a thing that is
# *overhead* or *in this room* is the room.
_AT_A_DISTANCE = (
    'nearby', 'line the', 'lines the', 'across the', 'beyond', 'surrounding',
    'in the distance', 'distant', 'further', 'outside', 'roll out of',
    'from the north', 'from the south', 'from the east', 'from the west',
    'overlook', 'towards the', 'toward the', 'leads to', 'leading',
)
_AROUND_YOU = (
    'this room', 'this chamber', 'this hall', 'overhead', 'underfoot',
    'in the corner', 'along the walls', 'the walls are', 'the ceiling',
    'above you', 'around you', 'the floor is', 'here the',
)


def _decide_enclosure(lowered: str, reading: RoomReading) -> str | None:
    """Indoors, outdoors, or under a hill - the call the whole scene hangs on.

    Scored rather than first-match, because a description can mention a
    ceiling and a window in the same breath and the winner should be the one
    with more of the text behind it. A tie is a doubt, not a coin toss.
    """
    scores: dict[str, int] = {}
    for kind, terms in ENCLOSURE.items():
        hits = sum(1 for t in terms if re.search(rf'\b{re.escape(t)}', lowered))
        if hits:
            scores[kind] = hits

    distance = sum(1 for cue in _AT_A_DISTANCE if cue in lowered)
    immediate = sum(1 for cue in _AROUND_YOU if cue in lowered)
    if distance and 'interior' in scores:
        # The built nouns are things being looked at, not things you are in.
        scores['interior'] = max(0, scores['interior'] - distance)
        if not scores['interior']:
            del scores['interior']
        scores['outdoor'] = scores.get('outdoor', 0) + 1
    if immediate and 'interior' in scores:
        scores['interior'] += immediate

    if not scores:
        reading.doubts.append('nothing says whether this is inside, outside or underground')
        return None

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        reading.doubts.append(
            f'enclosure is a tie between {ranked[0][0]} and {ranked[1][0]}, '
            f'{ranked[0][1]} mentions each'
        )
    return ranked[0][0]
