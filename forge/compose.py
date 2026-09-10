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
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, field

from .extract import RoomReading

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


@dataclass
class Placement:
    kind: str
    where: str
    source: str          # 'text' when the description said where; 'rule' otherwise
    term: str | None = None
    scale: str | None = None
    tint: str | None = None


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
    used_positions: set[str] = set()
    rule_index = 0

    for detection in reading.detections:
        if detection.category == 'light':
            scene.light = scene.light or detection.kind
            continue
        if detection.tint and not scene.palette:
            scene.palette = detection.tint
        if len(scene.placements) >= slots:
            scene.unplaced += 1
            continue

        if detection.direction and detection.direction in _RING:
            where, source = detection.direction, 'text'
        elif detection.direction in ('above', 'overhead'):
            where, source = 'canopy', 'text'
        elif detection.direction in ('below', 'underfoot'):
            where, source = 'ground', 'text'
        elif detection.direction in ('center', 'centre'):
            where, source = 'center', 'text'
        else:
            while rule_index < len(ring) and ring[rule_index] in used_positions:
                rule_index += 1
            where = ring[rule_index] if rule_index < len(ring) else 'center'
            source = 'rule'
            rule_index += 1

        used_positions.add(where)
        scene.placements.append(
            Placement(
                kind=detection.kind,
                where=where,
                source=source,
                term=detection.term,
                scale=detection.scale,
                tint=detection.tint,
            )
        )

    return scene
