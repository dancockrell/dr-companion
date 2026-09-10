"""Controls for every guard in the parser, in both directions.

A rule that suppresses false positives by suppressing everything looks
identical, from the outside, to a rule that works. So no guard here is checked
only for what it rejects: each one has at least one case it must let through
and one it must stop, and the run asserts how many cases it executed so a
truncated or mis-collected file reports itself instead of reporting a pass.

Run it directly - `python -m forge.test_extract` - or under pytest.
"""

from __future__ import annotations

import re

from .extract import (
    _built_floor,
    _compiled,
    _figurative,
    _ground_near_surface,
    _room_wall,
    _sentence_bounds,
    read_room,
)

# (name, callable, expected) triples, grouped by the guard they control.
CASES: list[tuple[str, str, object, object]] = []


def case(guard: str, name: str, got: object, want: object) -> None:
    CASES.append((guard, name, got, want))


def _enclosure(text: str) -> str | None:
    return read_room({'id': 1, 'description': [text], 'wayto': {}}).enclosure


def _ground(text: str) -> str | None:
    return read_room({'id': 1, 'description': [text], 'wayto': {}}).ground


def _kinds(text: str) -> set[str]:
    reading = read_room({'id': 1, 'description': [text], 'wayto': {}})
    return {d.kind for d in reading.detections}


def build() -> None:
    # --- the term boundary -------------------------------------------------
    # Lets an inflection through, stops a longer word that merely starts the
    # same way. The second direction is the one that was broken: 'wind' was
    # matching 'window' and turning every shuttered interior outdoors.
    for term, text, want in [
        ('wind', 'the wind carries a chill', True),
        ('wind', 'a window overlooks the street', False),
        ('sea', 'the sea beats against the rocks', True),
        ('sea', 'a wooden seat by the fire', False),
        ('arch', 'a stone arch spans the way', True),
        ('arch', 'an archer keeps watch', False),
        ('sun', 'the sun beats down', True),
        ('sun', 'sundry goods fill the shelves', False),
        ('rock', 'a rock juts from the soil', True),
        ('rock', 'a rocket of flame', False),
        ('shop', 'elegant shops line the way', True),
        ('stalactite', 'stalactites hang low', True),
        ('stone floor', 'the stone floor is worn smooth', True),
    ]:
        case('term boundary', f'{term!r} in {text!r}',
             bool(_compiled(term).search(text)), want)

    # --- water words used of crowds ----------------------------------------
    case('figurative water', 'a stream of customers is not a stream',
         _figurative('stream', 'the stream of customers, though steady'), True)
    case('figurative water', 'a stream of water is a stream',
         _figurative('stream', 'a stream of cold water runs past'), False)
    case('figurative water', 'a bare stream is a stream',
         _figurative('stream', 'a stream runs past the mill'), False)
    case('figurative water', 'a river of pilgrims is not a river',
         _figurative('river', 'a river of pilgrims flows toward the temple'), True)

    # --- distance versus immediacy -----------------------------------------
    # Room #50270, which read as *outdoor* before this: one 'nearby' wiped out
    # an interior that says 'room', 'wall' and 'walls' three times.
    case('scenery at a distance', 'a forge that says "the small room" is interior',
         _enclosure('The hard lava floor is hot, not from the nearby volcano but '
                    'from the fires within the glowing forge near the south wall. '
                    'The clanging bounces around the small room until the granite '
                    'walls seem to ring.'), 'interior')
    case('scenery at a distance', 'shops lining a street are still a street',
         _enclosure('Elegant shops with columned arches line the cul-de-sac, '
                    'their bright awnings shading the pavement.'), 'outdoor')
    case('scenery at a distance', 'a forest on the horizon is not this forest',
         _enclosure('You crest a low hill that gives a far-reaching view. Far to '
                    'the south the hills fade out to forest and open water.'), 'outdoor')
    case('scenery at a distance', 'a forest you are standing in still wins',
         _enclosure('Thick trees crowd close around you and the canopy overhead '
                    'blots out what little light there is.'), 'forest')

    # --- the surface-material window ---------------------------------------
    case('ground near surface', 'a marble floor is a marble floor',
         _ground_near_surface('the polished marble floor gleams'), 'marble')
    case('ground near surface', 'straw on the floor is the floor',
         _ground_near_surface('the floor is covered in a thick layer of straw'), 'straw')
    case('ground near surface', 'a lava floor is read',
         _ground_near_surface('the hard ash-speckled lava floor is hot to the touch'), 'lava')
    case('ground near surface', 'a marble altar is not the floor',
         _ground_near_surface('a black marble altar stands at the far end of the '
                              'room, flanked by candelabras'), None)
    case('ground near surface', 'a marble bust in the next sentence is not the floor',
         _ground_near_surface('the floor here is unremarkable. a bust of black '
                              'marble was set into a niche far along the wall'), None)
    case('ground near surface', 'no surface word means no reading',
         _ground_near_surface('crimson roses have been arranged in a crystal bowl '
                              'atop a narrow mahogany table'), None)
    case('ground near surface', 'an explicit ground word still wins outright',
         _ground('Worn cobblestones run the length of the alley beneath a grey sky.'),
         'cobble')

    # --- sentence bounds ---------------------------------------------------
    text = 'one. two. three.'
    case('sentence bounds', 'first sentence', _sentence_bounds(text, 0), (0, 4))
    case('sentence bounds', 'middle sentence', _sentence_bounds(text, 6), (5, 9))
    case('sentence bounds', 'last sentence', _sentence_bounds(text, 12), (10, 16))

    # --- landform and goods are features -----------------------------------
    # Rooms whose entire content is landscape were scoring zero features and
    # being refused. The negative direction: prose that names no thing at all
    # must still detect nothing.
    case('terrain is a feature', 'a dune field has a feature',
         'dune' in _kinds('Each giant sand dune is constantly being built, '
                          'destroyed, and moved to a new location.'), True)
    case('terrain is a feature', 'abstract prose about districts has none',
         _kinds('This is a transitional block leading between the mercantile and '
                'financial districts to the south.'), set())
    case('goods are features', 'crates and tapestries are features',
         {'crate', 'hanging'} <= _kinds('Sturdy crates are stacked against the '
                                        'tapestries hung along the far side.'), True)
    case('goods are features', "'tooled leather' is not a tool",
         'tools' in _kinds('A tooled leather satchel rests on the bench.'), False)

    # --- floor and wall as evidence of being indoors -----------------------
    case('built floor', 'a bare floor is a built floor',
         _built_floor('a thick rush mat covers the floor in this corner'), True)
    case('built floor', 'a forest floor is not',
         _built_floor('pine needles carpet the forest floor'), False)
    case('built floor', 'a canyon floor is not',
         _built_floor('boulders litter the canyon floor below the rim'), False)
    case('built floor', 'no floor at all is not',
         _built_floor('sand stretches away toward the dunes'), False)
    case('room wall', 'a compass wall is a room wall',
         _room_wall('on the rear wall, boar tusk sconces illuminate a sign'), True)
    case('room wall', 'a counted wall is a room wall',
         _room_wall('shelves cover three of the four walls'), True)
    case('room wall', 'a town wall is not a room wall',
         _room_wall('the town wall rises beyond the orchard'), False)
    case('room wall', 'a cliff wall is not a room wall',
         _room_wall('water has eroded a section of cliff wall'), False)
    case('room wall', 'a bank interior is read as interior',
         _enclosure('A desk is littered with papers scratched with notes. An '
                    'abacus clicks loudly. Some chairs lining a wall serve as '
                    'relaxation for customers, set against the north wall.'),
         'interior')

    # --- the tunnel determiner ---------------------------------------------
    case('tunnel determiner', 'a determined tunnel is underground',
         _enclosure('Flickering lanterns cast wavering shadows on the pocketed '
                    'walls. Despite the sconces, the tunnel recedes into '
                    'nightlike blackness in both directions.'), 'underground')
    # The negative case has to be one where the wrong answer is actually
    # available. The first version of it began "One winding alley tunnels
    # beneath another" and passed whatever the guard did, because outdoor was
    # winning three to one on 'wind', 'alley' and 'square' - and 'wind' was
    # itself a false match on 'winding'. Both were found by the sabotage in
    # break_check.py failing to redden this control.
    case('tunnel determiner', 'a lane that tunnels is not underground',
         _enclosure('The lane tunnels below an old aqueduct.'), 'outdoor')


def main() -> int:
    build()
    # The denominator, asserted below, is what disappears if this file is
    # truncated, mis-collected, or if `build()` silently returns early.
    guards = sorted({guard for guard, _, _, _ in CASES})
    failures = [(g, n, got, want) for g, n, got, want in CASES if got != want]

    for guard in guards:
        rows = [c for c in CASES if c[0] == guard]
        bad = sum(1 for c in rows if c[2] != c[3])
        mark = 'FAIL' if bad else 'ok  '
        print(f'{mark}  {guard:<24} {len(rows):>3} cases, {bad} failing')

    for guard, name, got, want in failures:
        print(f'\nFAIL [{guard}] {name}\n  got  {got!r}\n  want {want!r}')

    print(f'\n{len(CASES)} cases across {len(guards)} guards, {len(failures)} failing')
    if len(CASES) < 46 or len(guards) < 9:
        print('REFUSING TO PASS: fewer cases ran than this file contains, '
              'so a green result here would mean nothing')
        return 2
    return 1 if failures else 0


def test_all() -> None:
    """pytest entry point."""
    assert main() == 0


if __name__ == '__main__':
    raise SystemExit(main())
