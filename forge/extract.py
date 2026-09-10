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

import functools
import hashlib
import re
from dataclasses import dataclass, field

from .lexicon import CATEGORIES, DIRECTIONS, ENCLOSURE, SURFACE, SURFACE_MATERIAL

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


# A term ends where the word ends, plus the inflections the corpus actually
# writes. The first version of this had an opening word boundary and no closing
# one, so every term matched anything that merely *started* with it:
#
#   'wind'  matched 'window'   -> every shuttered interior scored as outdoor
#   'sea'   matched 'seat'     -> a bench in a chapel became the ocean
#   'arch'  matched 'archer'   -> a guardsman became a doorway
#   'sun'   matched 'sundry'   -> a general store was sunlit
#   'rock'  matched 'rocket'
#   'pier'  matched 'pierce'
#
# A bare closing boundary is wrong too - the tables lean on prefix matching for
# plurals ('shop' for 'shops', 'stalactite' for 'stalactites'), and several
# entries would go dead. So the boundary allows an inflection, and exactly one
# kind of it: **these tables hold nouns, and a noun inflects by pluralising.**
#
# The first version of this allowed 'ed' and 'ing' as well, which is the same
# defect as the missing boundary wearing a different hat - a verb ending is
# precisely what turns a noun into a different word. Measured over the corpus,
# it produced 1,332 matches through '-ing' and 1,207 through '-ed', and most
# were wrong: 'wind' matched 'winding' in 179 rooms and turned every winding
# stair into weather, 'rush' matched 'rushing', 'arch' matched 'arching',
# 'carpet' matched 'algae-carpeted'. It was found by a sabotage in
# `break_check.py` that failed to redden its own control, because the control
# sentence began "one winding alley" and was scoring outdoor for that.
#
# The participles that genuinely name a thing - a wooded slope, a thatched
# roof - are listed in the lexicon as terms of their own, where they can be
# read and counted rather than generated.
_INFLECTION = r'(?:s|es)?'


# Compiled once and kept. `re`'s own cache holds 512 patterns and the lexicon
# now has more than that, so leaving it to the module meant every term was
# recompiled on every sentence of every room - the audit went from seconds to
# minutes. Nothing about the result changes; only the clock.
@functools.lru_cache(maxsize=None)
def _compiled(term: str) -> re.Pattern[str]:
    return re.compile(_pattern(term))


def _pattern(term: str) -> str:
    return rf'\b{re.escape(term)}{_INFLECTION}\b'


def _first_match(text: str, table: dict[str, tuple[str, ...]]) -> tuple[str, str] | None:
    """The most specific matching entry, since tables lead with their specifics."""
    for kind, terms in table.items():
        for term in terms:
            if _compiled(term).search(text):
                return kind, term
    return None


def _all_matches(text: str, table: dict[str, tuple[str, ...]]) -> list[tuple[str, str]]:
    out = []
    for kind, terms in table.items():
        for term in terms:
            if _compiled(term).search(text):
                out.append((kind, term))
                break
    return out


def _direction_in(sentence: str) -> str | None:
    for d in DIRECTIONS:
        if re.search(rf'\b{d}\b', sentence):
            return 'center' if d == 'centre' else d
    return None


# Water words used of people are not water. "The stream of customers, though
# steady" put a river through a shop front in room #788, found by the bot on a
# live walk rather than by reading.
#
# Deliberately no regex. The first version of this check was a regex built in a
# heredoc, and the tool halved its backslashes: the "\b" word boundary arrived
# as a real backspace byte, so the pattern compiled cleanly and matched
# nothing, and the false positive survived a fix that looked applied. Substring
# containment has nothing to escape and therefore no way to fail silently.
_FIGURATIVE_OF = (
    'customers', 'people', 'visitors', 'shoppers', 'traffic', 'pilgrims',
    'patrons', 'humanity', 'faces', 'bodies', 'refugees', 'mourners',
)


def _figurative(term: str, sentence: str) -> bool:
    """Is this water word being used of a crowd rather than of water?"""
    head = f'{term} of '
    at = sentence.find(head)
    if at < 0:
        return False
    tail = sentence[at + len(head):]
    return any(tail.startswith(word) for word in _FIGURATIVE_OF)


# Terms whose commonest appearance in this corpus is not the thing they name.
# Counted: of the 719 rooms containing 'well', 169 of them are the adverb in
# "as well as" and were putting a stone wellhead in the middle of a bedroom.
# The village green went the other way and was deleted from the outdoor list
# entirely rather than guarded - 'green' is the colour in 475 rooms and the
# place in 136, so it was costing more than it earned. Removing a term that
# does not pay is the same judgement as adding one that does.
#
# Same containment-only construction as _FIGURATIVE_OF above, and for the same
# reason: nothing here to escape, so nothing here can fail silently.
_OTHER_SENSE = {
    'well': ('as well',),
    'hold': ('hold of', 'holding'),
    'spring': ('spring of the year',),
}


def _other_sense(term: str, text: str) -> bool:
    """Is every occurrence of this term part of a phrase that means something else?"""
    phrases = _OTHER_SENSE.get(term)
    if not phrases:
        return False
    total = len(_compiled(term).findall(text))
    if not total:
        return False
    blocked = sum(text.count(phrase) for phrase in phrases)
    return blocked >= total


# How far from the word "floor" a material still counts as being the floor's.
# 48 characters is about eight words either side, which covers "the floor is
# covered in a thick layer of straw" and "polished marble floors" and stops
# short of the next clause.
#
# The window alone is not enough, and the control that proved it is the fifth
# case in `test_extract.py`: "the floor here is unremarkable. a bust of black
# marble was set into a niche" puts 'marble' 47 characters from 'floor' and in
# a different sentence about a different object. So the window is clipped to
# the surface word's own sentence - the same unit the parser already uses to
# stop a fountain being placed among the trees.
_SURFACE_WINDOW = 48


def _sentence_bounds(text: str, at: int) -> tuple[int, int]:
    """The span of the sentence containing offset `at`."""
    start = 0
    end = len(text)
    for hit in _SENTENCE.finditer(text):
        if hit.end() <= at:
            start = hit.end()
        elif hit.start() >= at:
            end = hit.start()
            break
    return start, end


def _ground_near_surface(lowered: str) -> str | None:
    """What the ground is made of, read only where the text is discussing it.

    The naive version of this - look up a material anywhere in the room - is
    the exact move this parser exists to refuse. 'marble' occurs in 688 rooms
    and most of those are a marble altar, a marble column or a marble bust in
    a room whose floor is never described. So a material only counts when it
    sits next to a word that names the surface underfoot, in the same sentence.
    """
    for surface in SURFACE:
        for hit in _compiled(surface).finditer(lowered):
            lo, hi = _sentence_bounds(lowered, hit.start())
            a = max(lo, hit.start() - _SURFACE_WINDOW)
            b = min(hi, hit.end() + _SURFACE_WINDOW)
            match = _first_match(lowered[a:b], SURFACE_MATERIAL)
            if match:
                return match[0]
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
        for category in ('structure', 'terrain', 'goods', 'flora', 'water', 'light'):
            for kind, term in _all_matches(sentence, CATEGORIES[category]):
                # A stream of customers is not a stream. Found live in #788,
                # where "the stream of customers, though steady" put a river
                # through the middle of a shop front. Water words used of
                # people are the common case of this and the cheap one to
                # rule out; a word-sense model is not warranted for it.
                if category == 'water' and _figurative(term, sentence):
                    continue
                # "may as well" is not a wellhead. Same shape as above.
                if _other_sense(term, sentence):
                    continue
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
        reading.ground = _ground_near_surface(lowered)
        if not reading.ground:
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
    # Added after reading refused rooms: "southward the hills fade out to
    # forest and plain" and "the sundered peaks are visible as a differing
    # shade" are both a speaker describing a view, and both were scoring the
    # thing being looked at as the thing they were standing in.
    'far to the', 'far off', 'on the horizon', 'in the far', 'off in the',
    'can be seen', 'is visible', 'are visible', 'view of', 'stretches away',
    'edge of the', 'skirts the', 'borders the', 'fade out to', 'fades into',
)
_AROUND_YOU = (
    'this room', 'this chamber', 'this hall', 'overhead', 'underfoot',
    'in the corner', 'along the walls', 'the walls are', 'the ceiling',
    'above you', 'around you', 'the floor is', 'here the',
    'on the wall', 'against the wall', 'from the rafters', 'in here',
)

# Which enclosure words can be scenery, and which can only be the place you
# are standing in. This is the distinction the distance penalty needs and did
# not have.
#
# Measured, on room #50270 (Lava Forge): "the fires within the glowing forge",
# "the south wall", "the granite walls", "the small room" - unmistakably an
# interior, and it read as *outdoor*, because the single cue "not from the
# nearby volcano" fired the distance penalty and wiped the interior score out.
# The word doing the work there was 'room', which nobody describes at a
# distance; the word the penalty was written for was 'shop', which everybody
# does. Eroding the second and not the first is the whole fix.
_SCENERY_IF_DISTANT = {
    'interior': ('shop', 'counter', 'hall', 'inside'),
    'forest': ('forest', 'wood', 'grove', 'thicket'),
}


# A floor and a room wall are the two commonest ways this corpus says "you are
# indoors", and neither could be used as a term because both have a second
# life outdoors. Counted rather than guessed:
#
#   'floor' appears after a natural place 203 times - "forest floor" 103,
#   "cavern floor" 32, "valley floor" 25, "canyon floor" 21 - out of 2,825
#   mentions. Everything else is a built floor.
#
#   'wall' is worse: 'town wall' 75, 'outer wall' 67, plus city, sea, cliff and
#   curtain walls. So a bare 'wall' proves nothing and is not used. What is
#   used is the small set of phrasings that can only describe a wall of the
#   room you are standing in - a wall with a compass bearing, a near or far
#   one, or one of a counted set.
#
# Substring containment throughout, for the reason given above _FIGURATIVE_OF:
# there is nothing here to escape, so there is no way for it to fail silently.
_FLOOR_OF_A_PLACE = (
    'forest floor', 'cavern floor', 'cave floor', 'valley floor',
    'canyon floor', 'ocean floor', 'sea floor', 'gorge floor',
    'ravine floor', 'chasm floor', 'desert floor', 'jungle floor',
)
_ROOM_WALL = (
    'the back wall', 'the rear wall', 'the far wall', 'the near wall',
    'the north wall', 'the south wall', 'the east wall', 'the west wall',
    'the northern wall', 'the southern wall', 'the eastern wall',
    'the western wall', 'one wall', 'the opposite wall', 'each wall',
    'four walls', 'the walls of this', 'along the walls', 'on the wall',
    'against the wall', 'the walls are', 'walls and floor', 'wall behind the',
    'surrounding walls', 'alongside the wall', 'the walls of the',
    'lining the wall', 'walls and ceiling', 'covers the wall',
)


def _built_floor(lowered: str) -> bool:
    """Does the text name a floor, in the sense of something built to stand on?"""
    if not _compiled('floor').search(lowered):
        return False
    return not any(phrase in lowered for phrase in _FLOOR_OF_A_PLACE)


def _room_wall(lowered: str) -> bool:
    """Does the text name a wall that can only be a wall of this room?"""
    return any(phrase in lowered for phrase in _ROOM_WALL)


def _erode(scores: dict[str, int], kind: str, lowered: str, distance: int) -> bool:
    """Discount an enclosure by however much of it is only scenery.

    Returns whether the kind was removed outright. The penalty can never
    exceed the number of *weak* terms present, so a room that says 'room' or
    'ceiling' keeps its score no matter how much distant landscape it also
    describes.
    """
    if kind not in scores:
        return False
    weak = sum(1 for t in _SCENERY_IF_DISTANT[kind] if _compiled(t).search(lowered))
    if not weak:
        return False
    scores[kind] = max(0, scores[kind] - min(distance, weak))
    if not scores[kind]:
        del scores[kind]
        return True
    return False


# Forest and outdoor are not two answers to the same question, which is why
# 481 rooms were being reported as an unresolved contest between them. A forest
# *is* outdoors; the only thing that separates the two archetypes in
# compose.py is whether there are branches overhead or sky. So a forest/outdoor
# tie is not a coin toss to be escalated, it is a specific question to put back
# to the text: are the trees over you, or are they on the far side of a field?
#
# Read off eight sampled ties and correct on all eight: #8725 "branches form a
# thick canopy" and #52015 "filters through the leafy canopy of the surrounding
# trees" are woods; #1023 "it lies at the edge of a forest" and #31514 "the
# trees of the forests below" are open ground with a treeline in view. Where
# the text says neither, the doubt stands.
_UNDER_THE_TREES = (
    'canopy', 'overhead', 'through the trees', 'among the trees',
    'beneath the trees', 'under the trees', 'surrounding trees',
    'undergrowth', 'overgrowth', 'thicket', 'branches', 'boughs',
    'into the woods', 'through the woods', 'the woods are', 'deep in the',
    'dense', 'crowd close', 'tangle',
)
_TREES_AT_A_REMOVE = (
    'edge of a forest', 'edge of the forest', 'edge of the wood',
    'forests below', 'forest below', 'woods below', 'line of trees',
    'band of', 'border', 'bordering', 'stand of trees', 'toward the forest',
    'the forest beyond', 'distant', 'in the distance',
)


def _under_the_trees(lowered: str) -> bool | None:
    """Are the trees overhead, at a remove, or does the text not say?

    Three states on purpose. Folding "the text does not say" into either of
    the other two is where the invented answer would get in.
    """
    over = any(cue in lowered for cue in _UNDER_THE_TREES)
    away = any(cue in lowered for cue in _TREES_AT_A_REMOVE)
    if over == away:
        return None
    return over


def _decide_enclosure(lowered: str, reading: RoomReading) -> str | None:
    """Indoors, outdoors, or under a hill - the call the whole scene hangs on.

    Scored rather than first-match, because a description can mention a
    ceiling and a window in the same breath and the winner should be the one
    with more of the text behind it. A tie is a doubt, not a coin toss.
    """
    scores: dict[str, int] = {}
    for kind, terms in ENCLOSURE.items():
        hits = sum(1 for t in terms if _compiled(t).search(lowered))
        if hits:
            scores[kind] = hits

    # A built floor and a room wall are evidence of being indoors in their own
    # right, and each is worth exactly what one enclosure word is worth. They
    # are scored here rather than listed in the table because each needs a
    # guard the table has no way to carry.
    for present in (_built_floor(lowered), _room_wall(lowered)):
        if present:
            scores['interior'] = scores.get('interior', 0) + 1

    distance = sum(1 for cue in _AT_A_DISTANCE if cue in lowered)
    immediate = sum(1 for cue in _AROUND_YOU if cue in lowered)

    # Being told where you are beats being told what you can see from there.
    net_distance = max(0, distance - immediate)
    if net_distance:
        emptied = False
        for kind in _SCENERY_IF_DISTANT:
            emptied |= _erode(scores, kind, lowered, net_distance)
        if emptied:
            scores['outdoor'] = scores.get('outdoor', 0) + 1
    if immediate and 'interior' in scores:
        scores['interior'] += immediate

    if not scores:
        reading.doubts.append('nothing says whether this is inside, outside or underground')
        return None

    ranked = sorted(scores.items(), key=lambda kv: -kv[1])

    # A forest/outdoor tie gets one more question rather than an escalation.
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        if {ranked[0][0], ranked[1][0]} == {'forest', 'outdoor'}:
            under = _under_the_trees(lowered)
            if under is not None:
                return 'forest' if under else 'outdoor'

    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        reading.doubts.append(
            f'enclosure is a tie between {ranked[0][0]} and {ranked[1][0]}, '
            f'{ranked[0][1]} mentions each'
        )
    return ranked[0][0]
