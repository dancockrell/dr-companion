"""Controls for the adjudication path, in both directions.

Same standard as `test_extract.py`: no guard is checked only for what it
rejects. A rulings loader that refused everything and a rulings loader that
worked would both pass a suite that only fed them bad files, so every guard
here has at least one case it must let through and one it must stop.

The guard this file exists for is the one that keeps the coverage number
honest: a room decided by hand must be *distinguishable* from a room the
parser read. That has two directions and both are asserted - an overridden
room must name the ruling that decided it, and an ordinary room must say
'parsed'. Checking only the first would pass against an implementation that
stamped every room with a ruling id.

Run directly - `python -m forge.test_escalate` - or under pytest.
"""

from __future__ import annotations

import json
import pathlib
import tempfile

from . import critic, rulings
from .escalate import classify
from .extract import _TABLE_CACHE, read_room

CASES: list[tuple[str, str, object, object]] = []


def case(guard: str, name: str, got: object, want: object) -> None:
    CASES.append((guard, name, got, want))


def _with_rulings(data: dict | None):
    """Load `data` as the active rulings and return the parser's view of it.

    Writes a real file rather than constructing the object, because the file
    is what a person edits and the parse is part of what is being tested. A
    `None` writes no file at all, which is the absent-file case.
    """
    tmp = pathlib.Path(tempfile.mkdtemp()) / 'rulings.json'
    if data is not None:
        tmp.write_text(json.dumps(data), encoding='utf-8')
    _TABLE_CACHE.clear()
    return rulings.reload(tmp)


def _raises(fn) -> str | bool:
    """The exception type name, or False if it did not raise.

    Returns the *name* rather than True so a case that raises for the wrong
    reason - an IOError where a RulingError was meant - fails instead of
    passing as 'something went wrong'.
    """
    try:
        fn()
    except Exception as exc:  # noqa: BLE001 - the type is the assertion
        return type(exc).__name__
    return False


def _room(text: str, room_id: int = 1) -> object:
    return read_room({'id': room_id, 'description': [text], 'wayto': {}})


_A_RULING = {
    'version': 1,
    'rulings': [{
        'id': 'test-room-override',
        'kind': 'room',
        'rooms': [4242],
        'set': {'enclosure': 'interior'},
        'answers': ['nothing says whether this is inside'],
        'by': 'the suite',
        'why': 'a fixture',
    }],
    'open_questions': [],
}


def build() -> None:
    # --- the rulings file loads, and refuses what it cannot trust -----------
    # Positive: a well-formed file loads and the ruling is really in there.
    loaded = _with_rulings(_A_RULING)
    case('rulings load', 'a valid ruling is loaded',
         'test-room-override' in loaded.by_id, True)
    # Positive: no file at all is a real state - no decisions yet - and must
    # load as empty rather than raise. Without this case the loader could
    # refuse everything and the negatives below would still pass.
    case('rulings load', 'an absent file is empty, not an error',
         len(_with_rulings(None).by_id), 0)
    # Negative: each of these would otherwise load as a silent no-op, which is
    # the failure the whole file is written against.
    case('rulings load', 'a ruling with no why is refused',
         _raises(lambda: _with_rulings({
             'version': 1, 'rulings': [{'id': 'x', 'kind': 'room',
                                        'rooms': [1], 'set': {'ground': 'mud'},
                                        'by': 'the suite'}]})),
         'RulingError')
    case('rulings load', 'an unknown version is refused',
         _raises(lambda: _with_rulings({'version': 99, 'rulings': []})),
         'RulingError')
    case('rulings load', 'overriding a field that is not overridable is refused',
         _raises(lambda: _with_rulings({
             'version': 1, 'rulings': [{'id': 'x', 'kind': 'room', 'rooms': [1],
                                        'set': {'detections': 'anything'},
                                        'by': 'the suite', 'why': 'a fixture'}]})),
         'RulingError')
    case('rulings load', 'two rulings claiming one room are refused',
         _raises(lambda: _with_rulings({
             'version': 1, 'rulings': [
                 {'id': 'a', 'kind': 'room', 'rooms': [7],
                  'set': {'ground': 'mud'}, 'by': 's', 'why': 'w'},
                 {'id': 'b', 'kind': 'room', 'rooms': [7],
                  'set': {'ground': 'sand'}, 'by': 's', 'why': 'w'}]})),
         'RulingError')
    case('rulings load', 'an open question with no question is refused',
         _raises(lambda: _with_rulings({
             'version': 1, 'rulings': [],
             'open_questions': [{'id': 'q1', 'rooms': 5}]})),
         'RulingError')

    # --- a room override is visible as an override -------------------------
    # This is the guard that keeps the coverage number from becoming a lie,
    # and it is asserted in both directions on purpose.
    _with_rulings(_A_RULING)
    overridden = _room('A featureless void that says nothing at all.', 4242)
    case('override provenance', 'an overridden room takes the ruling value',
         overridden.enclosure, 'interior')
    case('override provenance', 'an overridden room names the ruling',
         overridden.sources.get('enclosure'), 'test-room-override')
    case('override provenance', 'an overridden room reports itself adjudicated',
         overridden.adjudicated, True)
    # The other direction. Without these two, an implementation that stamped a
    # ruling id on every room would pass everything above.
    ordinary = _room('The ceiling of this room is low and the walls are close.', 9)
    case('override provenance', 'an ordinary room says it was parsed',
         ordinary.sources.get('enclosure'), 'parsed')
    case('override provenance', 'an ordinary room is not adjudicated',
         ordinary.adjudicated, False)
    # An override answers the doubt it was written for, and does not silently
    # clear doubts it says nothing about.
    case('override provenance', 'the answered doubt is struck',
         any('nothing says whether this is inside' in d
             for d in overridden.doubts), False)

    # --- a lexicon ruling changes what the parser knows ---------------------
    # Positive: the added term is really matched.
    _with_rulings({
        'version': 1,
        'rulings': [{'id': 'test-add', 'kind': 'lexicon', 'table': 'enclosure',
                     'category': 'underground', 'add': ['beneath the surface'],
                     'by': 'the suite', 'why': 'a fixture'}],
    })
    case('lexicon ruling', 'an added term is matched',
         _room('The passage runs beneath the surface of the plaza above, '
               'and the air is close and still.').enclosure,
         'underground')
    # Negative: a removal that matches nothing must be an error. A removal that
    # quietly did nothing would leave the ruling out of force while the audit
    # reported it as applied - the exact shape of a check that cannot fail.
    _with_rulings({
        'version': 1,
        'rulings': [{'id': 'test-bad-remove', 'kind': 'lexicon',
                     'table': 'enclosure', 'category': 'underground',
                     'remove': ['a term that is not in the table'],
                     'by': 'the suite', 'why': 'a fixture'}],
    })
    case('lexicon ruling', 'removing an absent term is refused, not a no-op',
         _raises(lambda: _room('any text at all here, eight words or more')),
         'RulingError')

    # --- the queue escalates what can be acted on, and only that -----------
    _with_rulings(None)
    # Negative direction for the escalation filter: a room whose only doubt is
    # that the author never said what the ground was must NOT be queued. The
    # only way to close it is to invent a floor.
    silent = _room('Sturdy shelves line the walls of this room, and a low '
                   'counter faces the door where a shopkeeper waits.')
    case('escalation filter', 'author-side silence is not actionable',
         classify(silent, 'x' * 40), None)
    case('escalation filter', 'and it really was doubted about the ground',
         any('ground' in d for d in silent.doubts), True)
    # Positive direction: things that ARE actionable get a shape.
    case('escalation filter', 'an unreadable room is actionable',
         (classify(_room('Deep gouges are cut in this place, forming clean '
                         'furrows as though sliced through clay.'),
                   'text here') or ('none',))[0],
         'NO-ENCLOSURE')
    case('escalation filter', 'an empty description is actionable',
         (classify(_room(''), '') or ('none',))[0], 'NO-DESCRIPTION')

    # --- the critic never guesses -----------------------------------------
    # When it cannot run, every answer must be 'not adjudicated' and the
    # verdict must be empty. A critic that degraded into a plausible guess
    # would put invented readings into the corpus wearing the same clothes as
    # measured ones.
    unavailable = critic.Availability(False, 'a fixture: nothing is installed')
    proposal = critic.review(
        {'key': 'k', 'samples': [{'room_id': 1, 'description': 'a room'}]},
        unavailable)
    case('critic honesty', 'an unavailable critic adjudicates nothing',
         proposal.state, critic.NOT_ADJUDICATED)
    case('critic honesty', 'an unavailable critic proposes no verdict',
         proposal.verdict, None)
    case('critic honesty', 'a cluster with no samples is not adjudicated',
         critic.review({'key': 'k', 'samples': []},
                       critic.Availability(True, 'a fixture')).state,
         critic.NOT_ADJUDICATED)
    # The three states are distinct values. Folding any two together is how
    # 'I could not tell' becomes 'no problem found'.
    case('critic honesty', 'the three states are three different things',
         len({critic.DECIDED, critic.CANNOT_TELL, critic.NOT_ADJUDICATED}), 3)

    # Leave the real rulings in force for anything that runs after this.
    _TABLE_CACHE.clear()
    rulings.reload()


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
    # The denominator. This is what goes to zero if the file is truncated or
    # `build()` returns early, and it is set below the real count so it does
    # not need touching every time a case is added.
    if len(CASES) < 21 or len(guards) < 5:
        print('REFUSING TO PASS: fewer cases ran than this file contains, '
              'so a green result here would mean nothing')
        return 2
    return 1 if failures else 0


def test_all() -> None:
    """pytest entry point."""
    assert main() == 0


if __name__ == '__main__':
    raise SystemExit(main())
