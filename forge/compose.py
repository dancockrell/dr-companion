"""Turn what a room said into a scene a renderer can draw.

Formulaic on purpose. A scene is an archetype (what kind of place this is)
filled from slots, and the archetype decides the composition so that two
streets read as streets and a cavern reads as a cavern. Nothing is scattered
at random.

The variation inside that formula is not decoration. It exists so a player
can navigate: two adjacent rooms that render identically are a wayfinding
bug. So the variation is seeded off the room id - stable, therefore
learnable - and the composer records which slots it varied, so the audit can
ask whether neighbours actually came out different rather than assuming they
did.

Everything placed here traces to a detection from the room's own description,
or to its real exits. There is no slot filled because a street "ought to
have" one.

A position holds one thing. That is a rule about what a scene *is*, not an
optimisation: two features at one spot is one sprite drawn over another, and
the room reads as having lost a feature it described. Positions are handed out
in two passes for that reason - text first, then rules - and the comment on
that loop says what it cost to learn.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field

from .extract import Detection, RoomReading

# Which archetype an enclosure maps to, and what that archetype is made of.
# `boundary` is what stands at the edges, `canopy` is what is overhead, and
# `ground` is the default surface when the text never said - always recorded
# as a default rather than presented as something the room stated.
ARCHETYPES = {
    'interior': {
        'boundary': 'wall',
        'canopy': 'ceiling',
        'ground_default': 'wood-floor',
        'slots': 6,
    },
    'cave': {
        'boundary': 'rock-face',
        'canopy': 'rock-ceiling',
        'ground_default': 'rock',
        'slots': 5,
    },
    'underground': {
        'boundary': 'rock-face',
        'canopy': 'rock-ceiling',
        'ground_default': 'dirt',
        'slots': 5,
    },
    'forest': {
        'boundary': 'treeline',
        'canopy': 'branches',
        'ground_default': 'dirt',
        'slots': 8,
    },
    'outdoor': {
        'boundary': 'open',
        'canopy': 'sky',
        'ground_default': 'dirt',
        'slots': 8,
    },
}

# Where a feature goes when the text did not say. Eight positions round the
# cell, filled in a fixed order so the same detections always land the same
# way, then rotated by the room's seed so neighbours differ.
_RING = ('north', 'northeast', 'east', 'southeast',
         'south', 'southwest', 'west', 'northwest')

# The positions that are not on the ring. `center` is the floor's middle;
# `canopy` and `ground` are the overhead and underfoot anchors a description
# reaches when it says "above" or "underfoot". Each holds one thing, same as a
# ring position - two sprites at one anchor is a visible defect whether the
# anchor is a compass point or not.
_SPECIAL = ('center', 'canopy', 'ground')

# Every position this composer can hand out. The ring first, because a
# displaced feature should land on the floor beside the thing that took its
# spot rather than being flung overhead, and `center` last because it is the
# most crowded cell on screen.
_ALL_POSITIONS = _RING + _SPECIAL

# How many things can be placed before a scene runs out of room. Read off the
# positions rather than written down again: an archetype whose `slots` exceeds
# this could not be laid out without stacking, and that is worth failing on
# rather than discovering as two sprites in one cell.
POSITION_CAPACITY = len(_ALL_POSITIONS)

_OVERSUBSCRIBED = {n: s['slots'] for n, s in ARCHETYPES.items()
                   if s['slots'] > POSITION_CAPACITY}
if _OVERSUBSCRIBED:
    raise RuntimeError(
        f'these archetypes ask for more features than there are positions to '
        f'put them in, so a scene would have to stack two on one spot: '
        f'{_OVERSUBSCRIBED} against {POSITION_CAPACITY} positions'
    )


@dataclass
class Placement:
    kind: str
    where: str
    source: str          # 'text' when the description said where; 'rule' otherwise
    term: str | None = None
    scale: str | None = None
    tint: str | None = None
    #: Set when the text named a position that another feature had already
    #: taken. `where` is then a rule position and `source` says so, but the
    #: word the room actually used is kept here rather than thrown away -
    #: otherwise the only record that the text was ever consulted is gone, and
    #: nobody downstream can tell a demotion from a plain rule fill.
    displaced_from: str | None = None


@dataclass
class Scene:
    room_id: int
    archetype: str
    ground: str
    ground_source: str           # 'text' or 'archetype-default'
    boundary: str
    canopy: str
    openings: list[str] = field(default_factory=list)
    placements: list[Placement] = field(default_factory=list)
    light: str | None = None
    palette: str | None = None
    varied: list[str] = field(default_factory=list)
    unplaced: int = 0

    def to_dict(self) -> dict:
        d = asdict(self)
        d['placements'] = [asdict(p) for p in self.placements]
        return d


# The exits the game reports are movement strings ("go dark forge", "west").
# Only the plain compass ones become openings in the boundary; a "go X" exit
# is a door into something and is placed as one.
_COMPASS = {'north', 'northeast', 'east', 'southeast',
            'south', 'southwest', 'west', 'northwest', 'up', 'down', 'out'}


def compose(reading: RoomReading) -> Scene | None:
    """Build a scene, or return None if the room was never readable.

    Refusing is the point. A room with no archetype gets no scene rather than
    a generic one, so the count of missing scenes stays honest.
    """
    if reading.enclosure is None:
        return None

    spec = ARCHETYPES[reading.enclosure]
    rng = random.Random(reading.seed)

    ground = reading.ground
    ground_source = 'text'
    if not ground:
        ground = spec['ground_default']
        ground_source = 'archetype-default'

    scene = Scene(
        room_id=reading.room_id,
        archetype=reading.enclosure,
        ground=ground,
        ground_source=ground_source,
        boundary=spec['boundary'],
        canopy=spec['canopy'],
    )

    for movement in reading.exits:
        word = movement.strip().lower()
        if word in _COMPASS:
            scene.openings.append(word)
        else:
            scene.placements.append(
                Placement(kind='door', where='edge', source='text', term=movement)
            )

    # Rotate the ring by the seed. Same room, same rotation, every time; two
    # neighbours with the same detections still lay them out differently,
    # which is the whole reason the seed exists.
    offset = rng.randrange(len(_RING))
    ring = _RING[offset:] + _RING[:offset]
    scene.varied.append(f'ring-rotation:{offset}')

    slots = spec['slots']

    # Which detections get placed at all, decided before any position is handed
    # out. Doors already in `scene.placements` count against the budget, as they
    # always did; `edge` is not a position this function assigns, so a door
    # never competes for one.
    budget = slots - len(scene.placements)
    candidates: list[tuple[Detection, str | None]] = []
    for detection in reading.detections:
        if detection.category == 'light':
            scene.light = scene.light or detection.kind
            continue
        if detection.tint and not scene.palette:
            scene.palette = detection.tint
        if len(candidates) >= budget:
            scene.unplaced += 1
            continue
        candidates.append((detection, _stated_position(detection)))

    # Two passes, and the order is the whole fix.
    #
    # The old single pass assigned each detection as it arrived, so a feature
    # whose position came from the *text* could land on a ring position a rule
    # fill had already taken, and two sprites drew at one spot. Measured over
    # the 17,060 composable rooms in the map database: 2,838 of them did.
    #
    # Text is the source, so text claims first and every one of them is honest
    # or nothing is. Only then do the rule fills take what is left. Where two
    # detections name the *same* position - which is most of the collisions,
    # rooms that mention a wall and a building both to the north - the first
    # keeps it and the second is demoted to a free ring position with
    # `displaced_from` recording what the text asked for. Nothing is discarded
    # and nothing is stacked.
    taken: set[str] = set()
    resolved: list[str | None] = [None] * len(candidates)

    for i, (_detection, stated) in enumerate(candidates):
        if stated is not None and stated not in taken:
            taken.add(stated)
            resolved[i] = stated

    # The rule order: the rotated ring first, then the special anchors. Skipping
    # what text already claimed rather than counting past it, so a rule fill can
    # still reach a position an earlier rule fill stepped over.
    order = list(ring) + [w for w in _SPECIAL if w not in ring]
    free = [w for w in order if w not in taken]

    for i, (_detection, stated) in enumerate(candidates):
        if resolved[i] is not None:
            continue
        if not free:
            # Unreachable while every archetype's `slots` stays inside
            # POSITION_CAPACITY, and asserted rather than assumed: silently
            # stacking here is exactly the defect this function was fixed for,
            # so it fails loudly instead.
            raise RuntimeError(
                f'room {reading.room_id}: {len(candidates)} features and only '
                f'{POSITION_CAPACITY} positions; archetype {reading.enclosure!r} '
                f'asks for {slots} slots'
            )
        resolved[i] = free.pop(0)
        taken.add(resolved[i])

    for (detection, stated), where in zip(candidates, resolved):
        displaced = stated if (stated is not None and stated != where) else None
        scene.placements.append(
            Placement(
                kind=detection.kind,
                where=where,
                source='text' if stated == where else 'rule',
                term=detection.term,
                scale=detection.scale,
                tint=detection.tint,
                displaced_from=displaced,
            )
        )

    return scene


def _stated_position(detection: Detection) -> str | None:
    """The position the room's own words asked for, or None if they did not.

    Separated out because the two-pass assignment above has to ask this
    question before it hands anything out, and asking it in two places is how
    the text and rule halves drift apart.
    """
    direction = detection.direction
    if direction and direction in _RING:
        return direction
    if direction in ('above', 'overhead'):
        return 'canopy'
    if direction in ('below', 'underfoot'):
        return 'ground'
    if direction in ('center', 'centre'):
        return 'center'
    return None
