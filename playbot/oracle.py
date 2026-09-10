"""Does the scene we built match the room the game describes?

This is the check the bot exists for, and it works because the bot holds both
halves: the room's own words, and the scene the forge produced from them. Any
disagreement between those two is a defect in something, and it can be found
without a human looking at a picture.

Deliberately mechanical. It asks questions with checkable answers - is the
thing the text names actually in the scene, does every exit have an opening,
do two adjacent rooms look different - and leaves the questions of taste to
the critic, which has a model behind it. A rule that tried to judge whether a
scene "feels like" a description would be a rule inventing an opinion.
"""

from __future__ import annotations

import re

from forge.compose import Scene
from forge.extract import RoomReading

from .complaints import Complaint

# Things a description names that a player would expect to see, mapped to the
# scene kinds that would satisfy them. Only unambiguous ones: "a fountain" is
# a fountain, but "light" could be anything.
MUST_APPEAR = {
    'fountain': ('well',),
    'statue': ('statue',),
    'bridge': ('bridge',),
    'stair': ('stair',),
    'staircase': ('stair',),
    'door': ('door',),
    'gate': ('door',),
    'well': ('well',),
    'altar': ('statue',),
    'hearth': ('hearth',),
    'forge': ('hearth',),
    'fireplace': ('hearth',),
    'tree': ('tree', 'tree-broadleaf', 'tree-conifer', 'tree-palm', 'tree-dead'),
    'river': ('river',),
    'waterfall': ('waterfall',),
}

# Words that can only be said about somewhere with the sky over it, and words
# that can only be said about somewhere with a roof. A scene whose archetype
# disagrees with the room's own words is drawing the wrong kind of place, and
# unlike a question of taste this one has an answer.
OPEN_AIR_WORDS = ('sky', 'stars', 'starry', 'sun beats', 'clouds overhead',
                  'open sky', 'sunlight streams', 'moons')
ROOFED_WORDS = ('ceiling', 'rafters', 'roof overhead', 'low beams')

# Said of a place with no light in it. A scene that renders these at the same
# brightness as noon is not wrong about any object, it is wrong about the
# whole room, which is the sort of thing only a rule about the text can see.
UNLIT_WORDS = ('darkness', 'pitch black', 'unlit', 'gloom', 'dimly lit',
               'shadowy', 'lightless')


def check_room(
    reading: RoomReading,
    scene: Scene | None,
    description: str,
    title: str | None,
    mission: str,
) -> list[Complaint]:
    """Compare one room's text against its scene and say what disagrees."""
    out: list[Complaint] = []
    lowered = description.lower()

    def complain(severity: str, summary: str, **kw) -> None:
        out.append(Complaint(
            severity=severity, subject='scene', summary=summary,
            room_id=reading.room_id, room_title=title, mission=mission, **kw,
        ))

    if scene is None:
        complain(
            'blocking',
            'the room has a description but produced no scene at all',
            expected='a scene of some archetype',
            observed='; '.join(reading.doubts) or 'the parser refused it',
            evidence={'words': reading.words},
        )
        return out

    # 1. Everything the game says you can walk needs somewhere to walk out of.
    compass_exits = [e for e in reading.exits
                     if e.strip().lower() in
                     {'north', 'northeast', 'east', 'southeast', 'south',
                      'southwest', 'west', 'northwest', 'up', 'down', 'out'}]
    missing = [e for e in compass_exits if e.strip().lower() not in scene.openings]
    if missing:
        complain(
            'blocking',
            'the game reports exits the scene has no opening for',
            expected=f'openings for {", ".join(sorted(compass_exits))}',
            observed=f'openings: {", ".join(scene.openings) or "none"}',
            evidence={'missing': missing},
        )

    # 2. A thing the description names by a concrete noun should be on screen.
    kinds = {p.kind for p in scene.placements}
    for noun, satisfied_by in MUST_APPEAR.items():
        if re.search(rf'\b{noun}s?\b', lowered) and not (set(satisfied_by) & kinds):
            complain(
                'wrong',
                f'the description names a {noun} and the scene has none',
                expected=f'a placement of kind {" or ".join(satisfied_by)}',
                observed=f'kinds present: {", ".join(sorted(kinds)) or "none"}',
            )

    # 3. A scene with nothing in it is a floor, not a place.
    if not scene.placements:
        complain(
            'thin',
            'the scene is bare - a ground plane and nothing else',
            expected='at least one feature from a description this long',
            observed=f'{reading.words} words of description produced 0 placements',
        )

    # 4. Guessed ground is allowed, but it must not be silent.
    if scene.ground_source != 'text':
        complain(
            'note',
            'the ground was chosen by archetype because the text never said',
            expected='the description to name a surface',
            observed=f'defaulted to {scene.ground}',
        )

    # 5. Detail thrown away because the archetype ran out of slots.
    if scene.unplaced:
        complain(
            'thin',
            'the room described more than the scene had room for',
            expected='every detected feature placed',
            observed=f'{scene.unplaced} dropped',
        )

    # 6. The other direction of check 1, and the one nobody writes. An opening
    #    the game never reported is a wall the player can see through and then
    #    cannot walk through, which reads as a broken game rather than a
    #    broken picture. Checking only that every exit has an opening leaves
    #    this whole half unexamined.
    reported = {e.strip().lower() for e in reading.exits}
    invented = [o for o in scene.openings if o not in reported]
    if invented:
        complain(
            'wrong',
            'the scene has an opening where the game reports no exit',
            expected=f'openings only for {", ".join(sorted(reported)) or "nothing"}',
            observed=f'invented: {", ".join(sorted(invented))}',
            evidence={'invented': invented},
        )

    # 7. Two things drawn in the same place are one thing hiding another. The
    #    composer's rule-placed features cannot collide by construction; the
    #    ones the text positioned can, and those are the ones a player was
    #    told about explicitly.
    stacked = _stacked(scene)
    if stacked:
        complain(
            'thin',
            'two features are placed at the same position and will overlap',
            expected='one feature per position, or a composer that offsets them',
            observed='; '.join(f'{where}: {", ".join(kinds)}' for where, kinds in stacked),
            evidence={'stacked': {w: k for w, k in stacked}},
        )

    # 8. The archetype is the one decision that colours everything else, so a
    #    room whose own words contradict it is worth more than a misplaced
    #    bench.
    roofed = scene.archetype in ('interior', 'cave', 'underground')
    if roofed:
        said = [w for w in OPEN_AIR_WORDS if w in lowered]
        if said:
            complain(
                'wrong',
                'the description is of somewhere open to the sky and the scene has a roof',
                expected='an outdoor or forest archetype',
                observed=f'archetype {scene.archetype}, text says: {", ".join(said)}',
            )
    else:
        said = [w for w in ROOFED_WORDS if w in lowered]
        if said:
            complain(
                'wrong',
                'the description is of somewhere with a ceiling and the scene has open sky',
                expected='an interior, cave or underground archetype',
                observed=f'archetype {scene.archetype}, text says: {", ".join(said)}',
            )

    # 9. A room the text calls dark, rendered at the same brightness as noon.
    if scene.light is None:
        said = [w for w in UNLIT_WORDS if w in lowered]
        if said:
            complain(
                'thin',
                'the description calls the room dark and the scene carries no light setting',
                expected='a light value the renderer can dim by',
                observed=f'light is unset; text says: {", ".join(said)}',
            )

    return out


def _stacked(scene: Scene) -> list[tuple[str, list[str]]]:
    """Positions holding more than one feature.

    `edge` is excluded: it is where every door goes by construction, so a
    room with two doors would report a defect that is really this check
    misreading the composer's own convention.
    """
    by_where: dict[str, list[str]] = {}
    for placement in scene.placements:
        if placement.where == 'edge':
            continue
        by_where.setdefault(placement.where, []).append(placement.kind)
    return [(where, kinds) for where, kinds in sorted(by_where.items()) if len(kinds) > 1]


def check_neighbours(scenes: dict[int, Scene], wayto: dict[int, dict]) -> list[Complaint]:
    """Two rooms you can walk between must not render identically.

    This is the wayfinding check, and it is the reason the composer is seeded
    at all. It is a property of a *pair*, so no per-room check could ever
    catch it - which is exactly why it is worth its own pass.
    """
    out: list[Complaint] = []
    seen: set[tuple[int, int]] = set()

    for room_id, scene in scenes.items():
        for neighbour_id in (wayto.get(room_id) or {}):
            try:
                other = scenes[int(neighbour_id)]
            except (KeyError, ValueError):
                continue
            # Some rooms list themselves in `wayto`. A scene is identical to
            # itself by construction, so comparing the pair reports a
            # wayfinding defect that is really this loop's own reflection -
            # the first version of this check did exactly that, twice in 800
            # rooms, and the pair it named was #19275 against #19275.
            if int(neighbour_id) == room_id:
                continue
            pair = (min(room_id, int(neighbour_id)), max(room_id, int(neighbour_id)))
            if pair in seen:
                continue
            seen.add(pair)

            if _signature(scene) == _signature(other):
                out.append(Complaint(
                    severity='wrong', subject='scene',
                    summary='two rooms you can walk between render identically',
                    room_id=room_id,
                    expected='a visible difference, so the pair can be told apart',
                    observed=f'#{room_id} and #{neighbour_id} share a signature',
                    evidence={'signature': _signature(scene), 'pair': list(pair)},
                ))
    return out


def _signature(scene: Scene) -> str:
    """What a player would actually see, ignoring what they would not."""
    parts = [scene.archetype, scene.ground, scene.light or '-', scene.palette or '-']
    parts += sorted(f'{p.kind}@{p.where}' for p in scene.placements)
    return '|'.join(parts)
