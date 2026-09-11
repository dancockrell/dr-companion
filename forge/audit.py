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

from . import presence as _presence
from . import rulings as _rulings
from .extract import _compiled, read_room
from .lexicon import PRESENCE

DEFAULT_DB = r'C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json'


def load(path: str) -> list[dict]:
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def _presence_terms(rooms: list[dict]) -> int:
    """Count each PRESENCE term over the corpus on its own, and name the zeros.

    This is the instrument behind the claim in `lexicon.py` that nothing in the
    PRESENCE table is there because it seemed like a word a fantasy game would
    use. Each term is counted independently - no first-match shadowing, no
    kinds - so a term that has stopped earning its place shows up as a zero
    instead of hiding behind a synonym.

    A positive control runs first. It counts a term that is certainly in the
    corpus and a term that is certainly not, and refuses to print anything if
    either comes back wrong: a scanner whose matcher is broken reports every
    term as zero, and a page of zeros reads exactly like a vocabulary that has
    gone stale.
    """
    described = [(r.get('description') or [''])[0].lower() for r in rooms]
    described = [text for text in described if text]

    def rooms_with(term: str) -> int:
        pattern = _compiled(term)
        return sum(1 for text in described if pattern.search(text))

    control_present = rooms_with('the')
    control_absent = rooms_with('zzzznotaword')
    if control_present < len(described) // 2 or control_absent != 0:
        print(f'REFUSING TO REPORT: the control failed. {control_present:,} of '
              f'{len(described):,} rooms contain "the" and {control_absent} '
              f'contain a nonsense word. Every count below would be about this '
              f'scanner rather than about the corpus.')
        return 2
    print(f'control: "the" matched {control_present:,} of {len(described):,} '
          f'descriptions, a nonsense word matched {control_absent}\n')

    total_terms = 0
    zeros = []
    for kind, terms in PRESENCE.items():
        print(f'{kind}:')
        for term in terms:
            n = rooms_with(term)
            total_terms += 1
            if not n:
                zeros.append(f'{kind}/{term}')
            print(f'  {n:>7,}  {term!r}')
    print(f'\n{total_terms} terms across {len(PRESENCE)} kinds, '
          f'{len(zeros)} in no room at all')
    if zeros:
        print(f'these have stopped earning their place: {zeros}')
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=DEFAULT_DB, help="Lich's DR map database")
    parser.add_argument('--location', help='limit to one location, e.g. Zoluren')
    parser.add_argument('--limit', type=int, help='stop after N rooms')
    parser.add_argument('--queue', help='write the escalation queue here as JSONL')
    parser.add_argument('--examples', type=int, default=0, help='show N doubted rooms')
    parser.add_argument('--rulings', action='store_true',
                        help='print every ruling in force and the open questions')
    parser.add_argument('--presence-terms', action='store_true',
                        help='count every PRESENCE term over the corpus '
                             'independently, and print the zeros')
    args = parser.parse_args(argv)

    rooms = load(args.db)
    if args.location:
        rooms = [r for r in rooms if r.get('location') == args.location]
    if args.limit:
        rooms = rooms[: args.limit]

    if not rooms:
        print('REFUSING TO REPORT: no rooms matched, so any percentage below would be a lie')
        return 2

    if args.presence_terms:
        return _presence_terms(rooms)

    read_ok, bare, doubted, refused, overridden = [], [], [], [], []
    enclosures = collections.Counter()
    grounds = collections.Counter()
    feature_counts = []
    placed, unplaced = 0, 0
    doubt_reasons = collections.Counter()
    presence_states = collections.Counter()
    presence_kinds = collections.Counter()
    presence_terms = collections.Counter()
    presence_conflicts = 0

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

        presence_states[reading.presence.state] += 1
        presence_conflicts += reading.presence.conflict is not None
        for kind in reading.presence.kinds:
            presence_kinds[kind] += 1
        for term in reading.presence.terms:
            presence_terms[term] += 1

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

    # People. Five states and they are printed as five, because the whole
    # reason this section exists is that a room described as busy, a room
    # described as deserted, a room whose author never mentioned anybody, and a
    # room with no readable description are four different facts that a single
    # "occupants: 0" would destroy.
    print()
    print('people, as the descriptions account for them:')
    for state in _presence.STATES:
        n = presence_states.get(state, 0)
        note = {
            _presence.THRONGED: 'the text says many are habitually here',
            _presence.FREQUENTED: 'the text names people or a role, not a crowd',
            _presence.SOLITARY: 'the text positively says nobody is here',
            _presence.UNSAID: 'readable, and silent about people - NOT empty',
            _presence.UNREAD: 'no description to read',
        }[state]
        print(f'  {state:<12} {n:>7,}  {pct(n)}   {note}')

    # The denominator, asserted rather than assumed. This is the number that
    # goes to zero if `density()` stops being called or starts returning None,
    # and without it a run in which nothing was classified would print five
    # tidy zeros and look like a room population that simply has no people in
    # it - which is the exact defect being fixed.
    counted = sum(presence_states.values())
    if counted != total:
        print(f'  REFUSING TO REPORT: {counted:,} rooms carry a presence state '
              f'but {total:,} were examined. Some room was never classified, '
              f'and the percentages above are therefore wrong.')
        return 2
    unknown = set(presence_states) - set(_presence.STATES)
    if unknown:
        print(f'  REFUSING TO REPORT: unknown presence states {sorted(unknown)}')
        return 2

    described = presence_states.get(_presence.THRONGED, 0) + \
        presence_states.get(_presence.FREQUENTED, 0)
    print(f'  describes presence at all: {described:,}  {pct(described)}')
    if presence_conflicts:
        print(f'  descriptions that argue with themselves: {presence_conflicts:,} '
              f'- see `conflict` on the reading for which of the two it is: '
              f'people named alongside an emptiness word, or the only busyness '
              f'word in the room belonging to somewhere else')

    if presence_kinds:
        print()
        print('what kind of presence, rooms per kind (a room can have several):')
        for kind, n in presence_kinds.most_common():
            print(f'  {kind:<12} {n:>7,}  {pct(n)}')
        print()
        print('the terms behind it, top 15 as the parser saw them:')
        for term, n in presence_terms.most_common(15):
            print(f'  {n:>7,}  {term!r}')
        # Why this is not the same as a per-term corpus count, and why the
        # honest number lives behind `--presence-terms` instead: `_all_matches`
        # takes the FIRST matching term in each kind and stops, so a room that
        # says both 'merchant' and 'trader' is only ever credited to one of
        # them. Reading a zero out of this list would be reading the shadowing,
        # not the corpus, and a term at zero here may be in a thousand rooms.
        print('  (first match per kind wins, so these under-count any term '
              'that shares a kind - use --presence-terms for the real counts)')

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
