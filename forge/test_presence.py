"""Controls for the presence guards, in both directions.

Same discipline as `test_extract.py`: no guard is checked only for what it
rejects. A rule that suppresses false positives by suppressing everything looks
identical, from the outside, to a rule that works, and every trap word in the
PRESENCE table was chosen over a rejected synonym - so each one needs a case it
must catch and a case it must let through.

Two guards here are unusual enough to say why they exist:

* **the five states.** A room described as busy, a room described as deserted, a
  room whose author never mentioned people, and a room with no description are
  four different facts. The case list asserts that each is reachable *and* that
  no two of them collapse into each other, because collapsing them is the
  failure this whole module was written against.
* **the contract.** One case composes a real scene and asserts that occupancy
  is nowhere in the dict it produces. That is a claim about the boundary
  between the static spec and the live game, and it is the sort of claim that
  quietly stops being true the first time somebody adds a convenient field.

Run it directly - `python -m forge.test_presence` - or under pytest.
"""

from __future__ import annotations

from .compose import compose
from .extract import _compiled, read_room
from .presence import (
    FREQUENTED,
    every_occurrence_is_other,
    SOLITARY,
    STATES,
    THRONGED,
    UNREAD,
    UNSAID,
    Occupancy,
    Occupant,
    split_also_see,
)

CASES: list[tuple[str, str, object, object]] = []


def case(guard: str, name: str, got: object, want: object) -> None:
    CASES.append((guard, name, got, want))


def _read(text: str):
    return read_room({'id': 1, 'description': [text], 'wayto': {}})


def _state(text: str) -> str:
    return _read(text).presence.state


def _kinds(text: str) -> set[str]:
    return set(_read(text).presence.kinds)


def build() -> None:
    # --- people are detected at all -----------------------------------------
    # The defect this module exists for: before it, none of these read as
    # anything but an empty street.
    case('presence detected', 'shoppers throng a market',
         _kinds('Shoppers throng the stalls of the open market, haggling with '
                'merchants over bolts of cloth.'), {'crowd', 'patron', 'trader'})
    case('presence detected', 'a clerk behind a counter is staff',
         'staff' in _kinds('A bored clerk leans on the counter, sorting '
                           'through a stack of parchment.'), True)
    case('presence detected', 'children on a village green',
         'child' in _kinds('Children run shrieking between the wash lines '
                           'strung across the yard.'), True)
    case('presence detected', 'prose about masonry names nobody',
         _kinds('Weathered granite blocks, fitted without mortar, rise to a '
                'vaulted ceiling far overhead.'), set())

    # --- the trap words, every one of them counted and rejected --------------
    # Each of these was in the corpus often enough to look like a term worth
    # having, and each is something else. The comment block at the foot of
    # `lexicon.PRESENCE` carries the counts.
    for name, text in [
        ('a rock face is not a face', 'Water streams down a rough face of rock.'),
        ('a body of water is not a body',
         'The only large body of open water in the entire valley lies here.'),
        ('carved figures are not figures',
         'Two lifelike figures carved from gleaming pink marble sit upon a dais.'),
        ('brambles press, they are not a press',
         'Dense brambles press in on all sides, giving this place a closed feel.'),
        ('a multitude of books is not a multitude',
         'The spire is covered in a multitude of books and parchments.'),
        ('a fir stands sentinel, it is not a sentinel',
         'A longleaf fir stands sentinel along the stony ridge.'),
        ('buildings crowd, they are not a crowd',
         'Plain stone buildings crowd the narrow and sand-splattered lane.'),
        ('a banister guards, it is not a guard',
         'A mahogany banister guards the edge of the balcony, overlooking the hall.'),
        ('a guard tower is a building',
         'A guard tower camouflaged with branches rises above the treeline.'),
        ('the local flora is not a local',
         'Ancient instruments are still visible in the local flora here.'),
        ('a former owner is not an owner',
         'Weathered clapboard attests to its owner\'s long neglect.'),
        ('man-made is not a man',
         'The walls are smoothed to give the impression of a man-made cave.'),
        ('a noble giant is a tree',
         'A great gash runs down the side of this noble giant, and sap oozes out.'),
        ('a band of windows is not a band',
         'Light filters down from a band of stained glass windows beneath the dome.'),
    ]:
        case('presence trap', name, _kinds(text), set())

    # And the direction that proves the traps are not simply a table with
    # nothing in it: the honest form of each trapped word's kind still fires.
    case('presence trap', 'a real crowd is still a crowd',
         'crowd' in _kinds('The crowd flows around the fountain at the centre '
                           'of the square.'), True)
    case('presence trap', 'a real guard is still a guard',
         'guard' in _kinds('A beefy guard stands at the door, watching the '
                           'merchandise.'), True)
    case('presence trap', 'the guards are still guards',
         'guard' in _kinds('The guards slow the flow of traffic at the gate.'), True)
    case('presence trap', 'a guard tower with a guard in it still has a guard',
         'guard' in _kinds('A guard tower rises here, and a guard leans out of '
                           'the window above the road.'), True)

    # --- the guard word, read per occurrence --------------------------------
    # The only presence term in the table that containment cannot read: a verb
    # in roughly a third of its 388 occurrences. Every sentence below is from
    # the corpus or a minimal edit of one, and the two directions are what
    # matter - a rule that dropped 'guard' entirely would pass the negatives.
    for name, text, want in [
        ('a beefy guard is a person',
         'A beefy guard stands at the door, watching the merchandise.', True),
        ('an adjective-stacked guard is a person',
         'A stern-looking clan guard stands alert, carefully scrutinising you.', True),
        ('uniformed guards are people',
         'Red and black uniformed guards slow the flow of traffic here.', True),
        ('guards lounging are people',
         'Guards lounge nearby, leaning on the rail.', True),
        ('guards set off by commas are people',
         'Several guards, armed and armored, stand ready by the tellers.', True),
        ('a banister guards nothing but the edge',
         'A mahogany banister guards the edge of the balcony.', False),
        ('a wall guards buildings',
         'Blocking the road north, a high stone wall guards a small group of '
         'buildings.', False),
        ('a railing guards against a fall',
         'A metal railing on the interior edge guards against accidental falls.',
         False),
        ('obelisks stand guard',
         'Jade obelisks mottled with dust stand guard over the narrow road.',
         False),
        ('an oak stands lonely guard',
         'A gnarled scrub oak stands lonely guard off to the side of the road.',
         False),
        ('a guard tower is a building',
         'A tall guard tower surmounts the outer wall.', False),
        ('a guard house is a building',
         'The back of the guard house has a narrow barred window.', False),
        ('a squirrel guards its cache',
         'Some squirrel chose this stone to guard his winter cache.', False),
        # The mixed sentence, which is the reason this is read per occurrence
        # and not per sentence. One verb and one person in the same breath: a
        # sentence-level check would have to choose, and either choice is wrong.
        ('a verb and a person in one sentence keeps the person',
         'The great north gate guards the entrance, and a guard leans on it.',
         True),
    ]:
        case('guard sense', name, 'guard' in _kinds(text), want)
    # The matcher and the caller disagreeing is a loud failure, not a verdict.
    # Without this the function could be handed a pattern that finds nothing and
    # would have to invent an answer; the branch is unreachable through
    # `read_room`, so it is reached directly here rather than left unproven.
    raised = False
    try:
        every_occurrence_is_other('guard', 'there is nobody here at all',
                                  _compiled('guard'))
    except ValueError:
        raised = True
    case('guard sense', 'a pattern that finds nothing raises rather than guesses',
         raised, True)

    # --- busyness attributed to somewhere else -------------------------------
    # "Tucked away from the hustle and bustle" is a room saying it is quiet,
    # using the same word a busy room uses. Without the guard the quietest
    # rooms in the corpus would be the ones marked thronged.
    case('busy elsewhere', 'bustle here is bustle',
         _state('The bustle of the market fills the square from dawn to dusk.'),
         THRONGED)
    case('busy elsewhere', 'bustle elsewhere is not bustle here',
         _state('A small study, tucked away from the hustle and bustle of the '
                'rest of the tower.'), UNSAID)
    case('busy elsewhere', 'the discounted room says why',
         _read('A small study, tucked away from the hustle and bustle of the '
               'rest of the tower.').presence.conflict is not None, True)
    case('busy elsewhere', 'word order decides it',
         _state('Traffic roars past, and the alley is far from the quiet of '
                'the gardens.'), THRONGED)
    # The half of this guard that was missing until a sabotage found it. The
    # state read `unsaid` correctly while the detection survived, so
    # `compose.py` - which turns every detection into a sprite - was drawing a
    # crowd in a room the text calls quiet. The state and the picture are two
    # answers to one question and they have to agree.
    quiet = _read('A small study, tucked away from the hustle and bustle of '
                  'the rest of the tower. A desk stands against the wall.')
    case('busy elsewhere', 'a discounted crowd is not detected either',
         [d.kind for d in quiet.detections if d.category == 'presence'], [])
    case('busy elsewhere', 'and so nothing draws it',
         [p.kind for p in compose(quiet).placements if p.kind == 'crowd'], [])

    # --- the five states, each reachable and none collapsing -----------------
    case('presence states', 'a crowd is thronged',
         _state('Crowds press through the gate at all hours of the day.'),
         THRONGED)
    case('presence states', 'a named role without a crowd is frequented',
         _state('A single clerk works at a desk against the north wall of the '
                'small office.'), FREQUENTED)
    case('presence states', 'the text saying nobody is here is solitary',
         _state('A deserted courtyard, its flagstones cracked and its fountain '
                'long since dry.'), SOLITARY)
    case('presence states', 'silence about people is UNSAID, not empty',
         _state('Rough-hewn granite walls rise to a vaulted ceiling, and a '
                'brazier burns in the corner.'), UNSAID)
    case('presence states', 'no description at all is UNREAD',
         read_room({'id': 1, 'description': [], 'wayto': {}}).presence.state,
         UNREAD)
    # The collapse this file exists to prevent. Asserted as an inequality
    # rather than trusted to the cases above, because the two produce the same
    # picture on screen and a renderer would never notice.
    case('presence states', 'UNSAID and SOLITARY are not the same state',
         _state('Rough-hewn granite walls rise to a vaulted ceiling.')
         == _state('A deserted courtyard, its fountain long since dry.'), False)
    case('presence states', 'UNSAID and UNREAD are not the same state',
         UNSAID == UNREAD, False)
    case('presence states', 'every state is in STATES',
         all(s in STATES for s in (THRONGED, FREQUENTED, SOLITARY, UNSAID,
                                   UNREAD)), True)
    case('presence states', 'STATES has exactly five members', len(STATES), 5)
    # `populated` must not answer yes for silence. This is the property, not
    # the mechanism: a caller asking "does the text claim anybody is here"
    # gets no for UNSAID and for SOLITARY, and they stay distinguishable by
    # `state` for a caller that needs the difference.
    case('presence states', 'UNSAID is not populated',
         _read('Rough-hewn granite walls rise to a vaulted ceiling.')
         .presence.populated, False)
    case('presence states', 'SOLITARY is not populated',
         _read('A deserted courtyard, its fountain long since dry.')
         .presence.populated, False)
    case('presence states', 'a crowd is populated',
         _read('Crowds press through the gate at all hours.').presence.populated,
         True)

    # --- the text arguing with itself ---------------------------------------
    # People win over an emptiness adjective, and the disagreement is recorded
    # rather than smoothed away. 44 rooms in the corpus do this.
    conflicted = _read('A secluded grove where a few pilgrims kneel in silence '
                       'before the shrine.')
    case('presence conflict', 'people beat an emptiness word',
         conflicted.presence.state, FREQUENTED)
    case('presence conflict', 'and the conflict is recorded',
         conflicted.presence.conflict is not None, True)
    case('presence conflict', 'no conflict is recorded when there is none',
         _read('A deserted courtyard, its fountain long since dry.')
         .presence.conflict, None)

    # --- the live contract ---------------------------------------------------
    # Occupancy never reaches the spec. Composed for real rather than asserted
    # about, so that a field added to Scene in another lane trips this.
    scene = compose(_read('Crowds press through the gate at all hours of the '
                          'day, and a guard leans against the wall.'))
    flat = repr(scene.to_dict())
    case('live contract', 'a crowded room still composes', scene is not None, True)
    case('live contract', 'the spec carries no occupancy',
         any(word in flat for word in ('occupan', 'room_uid', 'stale_after')),
         False)
    case('live contract', 'the crowd the TEXT described is in the spec',
         'crowd' in [p.kind for p in scene.placements], True)

    occ = Occupancy(room_uid=10031, at=1000.0,
                    occupants=[Occupant(text='a shaggy mutt', kind='contents',
                                        source='room objs')],
                    streams=['room objs'])
    case('live contract', 'fresh inside the window', occ.fresh_at(1020.0), True)
    case('live contract', 'stale outside it', occ.fresh_at(1100.0), False)
    case('live contract', 'the wire shape round-trips the text verbatim',
         occ.to_dict()['occupants'][0]['text'], 'a shaggy mutt')
    case('live contract', 'an unattributed occupant says so, not "npc"',
         Occupant(text='something').kind, 'unknown')

    # --- splitting the game's own list --------------------------------------
    case('also see', 'the line from a real session',
         split_also_see('You also see a shaggy mutt, the Crossing Forging '
                        'Society Building, an iron anvil and a wooden sign.'),
         ['a shaggy mutt', 'the Crossing Forging Society Building',
          'an iron anvil', 'a wooden sign'])
    case('also see', 'one item, no commas',
         split_also_see('You also see a hitching post.'), ['a hitching post'])
    case('also see', 'two items joined by and',
         split_also_see('You also see a cart and a mule.'), ['a cart', 'a mule'])
    case('also see', 'an "and" inside an item is not a separator',
         split_also_see('You also see a plate of bread and butter, a mug.'),
         ['a plate of bread and butter', 'a mug'])
    case('also see', 'the Oxford comma form',
         split_also_see('You also see a, b, and c.'), ['a', 'b', 'c'])
    # A filter that empties its input must not look like a filter that found
    # one empty thing.
    case('also see', 'an empty line yields nothing, not one blank',
         split_also_see('You also see .'), [])
    case('also see', 'whitespace yields nothing', split_also_see('   '), [])


def main() -> int:
    build()
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
    # The denominator. It goes to zero if this file is truncated or if build()
    # returns early, which is the one way a green run here could mean nothing.
    if len(CASES) < 68 or len(guards) < 8:
        print('REFUSING TO PASS: fewer cases ran than this file contains, '
              'so a green result here would mean nothing')
        return 2
    return 1 if failures else 0


def test_all() -> None:
    """pytest entry point."""
    assert main() == 0


if __name__ == '__main__':
    raise SystemExit(main())
