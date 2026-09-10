"""Prove the bot's new instruments can fail before believing what they report.

Every case here does two things: shows the check firing on a case it should
catch, and shows it *silent* on a case it should not. A check that always
fires carries as much information as one that never does, and both of those
read as a clean pass from outside.

The parser cases run against bytes captured off the live wire on 10 Sep 2026,
not against a document's idea of what the game sends. The exploration case
runs against the real 18,950-room database, because the defect it is about -
a random walk re-reading the same three streets - only exists at the density
of a real street grid and no four-room fixture reproduces it.

    python -m playbot.selftest

Exit 0 means every case passed and the count below is the number that ran; a
run that checked nothing must not be able to say "all passed", so the floor
is asserted rather than assumed.
"""

from __future__ import annotations

import random
import sys

from forge.compose import Placement, Scene
from forge.extract import RoomReading

from .live import parse_room
from .oracle import check_room
from .world import World

FLOOR = 32   # well under the real count, so truncation or an import failure shows

# Captured from 127.0.0.1:11024 on 10 Sep 2026 by sending `south` as Phemius.
# Note what it does *not* have: the compass is empty on a move, and the room's
# parts arrive as components rather than as a `roomDesc` preset.
MOVE_PAYLOAD = (
    "You go south.\n"
    "<nav rm='10031'/>\n"
    "<streamWindow id='room' title='Room' subtitle=\" - [The Crossing, Town Green Southeast]\""
    " location='center' target='drop' ifClosed='' resident='true'/>\n"
    "<component id='room desc'>This tranquil corner of the Green has a small bower of"
    " entwined modwyn vines.</component>\n"
    "<component id='room objs'>You also see a limestone bench and a waste bin.</component>\n"
    "<component id='room players'>Also here: Chore.</component>\n"
    "<component id='room exits'>Obvious paths: <d>north</d>, <d>west</d>,"
    " <d>northwest</d>.<compass></compass></component>\n"
    "<style id=\"roomName\" />[The Crossing, Town Green Southeast]\n"
    "<prompt time=\"1789050068\">&gt;</prompt>"
    "<progressBar id='health' value='0' text='health 100/100'/>"
    "<indicator id='IconSTANDING' visible='y'/><indicator id='IconBLEEDING' visible='n'/>"
)

_ran = 0
_failed: list[str] = []


def check(name: str, condition: bool, detail: str = '') -> None:
    global _ran
    _ran += 1
    if not condition:
        _failed.append(f'{name}{": " + detail if detail else ""}')


# -- the parser -------------------------------------------------------------

def parser_cases() -> None:
    room = parse_room(MOVE_PAYLOAD)
    check('move payload yields the room uid', room.uid == 10031, f'got {room.uid}')
    check('move payload yields the title',
          room.title == 'The Crossing, Town Green Southeast', f'got {room.title!r}')
    check('move payload yields the description from a component',
          bool(room.description) and 'modwyn' in (room.description or ''),
          f'got {room.description!r}')
    # The one that was silently broken: an empty <compass></compass> used to
    # win over the prose list, so a room with three ways out reported none.
    check('an empty compass falls through to Obvious paths',
          sorted(room.exits) == ['north', 'northwest', 'west'], f'got {room.exits}')
    check('room objects come off the component',
          'limestone bench' in (room.objects or ''), f'got {room.objects!r}')
    check('vitals are read', room.health == 100, f'got {room.health}')
    check('indicators are read', room.indicators.get('STANDING') is True
          and room.indicators.get('BLEEDING') is False, f'got {room.indicators}')

    # Sabotage: take the nav away and the uid must go, not fall back to
    # something plausible. Identity that guesses is worse than no identity.
    without_nav = MOVE_PAYLOAD.replace("<nav rm='10031'/>", '')
    check('no nav means no uid, rather than a guess',
          parse_room(without_nav).uid is None)
    # Sabotage the other side: if the fallback path were dead, this would
    # still report three exits and the case above would prove nothing.
    indoors = parse_room(MOVE_PAYLOAD.replace('Obvious paths', 'Obvious exits'))
    check('the indoor wording of the exits line is read too',
          sorted(indoors.exits) == ['north', 'northwest', 'west'], f'got {indoors.exits}')
    without_paths = MOVE_PAYLOAD.replace('Obvious paths', 'Nothing here')
    check('with no Obvious paths there are no exits (the fallback is doing the work)',
          parse_room(without_paths).exits == [], f'got {parse_room(without_paths).exits}')


# -- identity ---------------------------------------------------------------

def identity_cases(world: World) -> None:
    crossing = [r for r in world.rooms.values() if r.get('location') == 'The Crossing']
    titles: dict[str, list[int]] = {}
    for record in crossing:
        for title in record.get('title') or []:
            titles.setdefault(title, []).append(record['id'])
    conflated = {t: ids for t, ids in titles.items() if len(ids) > 1}
    # This is the bug the rewrite is about, stated as a measurement rather
    # than as a claim: keying exploration on the title merges these.
    check('titles really do conflate rooms in The Crossing', bool(conflated),
          'no title is shared, so the old key was not actually ambiguous here')
    check('at least one title covers three or more rooms',
          any(len(ids) >= 3 for ids in conflated.values()),
          f'worst was {max((len(i) for i in conflated.values()), default=0)}')

    room = world.match_uid(10031)
    check('a live uid resolves to exactly one database room', room is not None)
    if room:
        check('and it is the room the game named that uid',
              'Town Green Southeast' in (room.get('title') or [''])[0],
              f'got {room.get("title")}')
    check('an invented uid resolves to nothing', world.match_uid(999999999) is None)


# -- exploration ------------------------------------------------------------

def exploration_cases(world: World) -> None:
    start = world.match_uid(10030)
    check('the start room is in the database', start is not None)
    if start is None:
        return
    start_id = start['id']

    def frontier_walk(moves: int) -> int:
        here, visited = start_id, {start_id}
        for _ in range(moves):
            step = world.frontier_step(here, visited)
            if step is None:
                break
            here = step[0]
            visited.add(here)
        return len(visited)

    def random_walk(moves: int, seed: int = 1) -> int:
        rng = random.Random(seed)
        here, visited = start_id, {start_id}
        for _ in range(moves):
            options = list(world.moves(here))
            if not options:
                break
            here = rng.choice(options)
            visited.add(here)
        return len(visited)

    frontier = frontier_walk(150)
    wandering = random_walk(150)
    check('frontier exploration covers more ground than a random walk',
          frontier > wandering, f'frontier {frontier} vs random {wandering}')
    check('frontier exploration reaches at least 100 distinct rooms in 150 moves',
          frontier >= 100, f'reached {frontier}')
    # The control that makes the above mean something: a walk that has to
    # find new rooms in a graph with none left cannot, and must say so rather
    # than looping. If this hung or returned a large number, the comparison
    # above would be measuring nothing.
    everything = world.safe_room_ids()
    check('a frontier step with nothing left to find returns None',
          world.frontier_step(start_id, everything) is None)

    route = world.route(start_id, lambda rid: rid != start_id)
    check('a route to somewhere reachable exists', bool(route))
    check('a route to a goal nothing satisfies is None',
          world.route(start_id, lambda rid: False) is None)
    # Scripted exits: the typed command is unwrapped, the script that calls
    # another script is not. The second half is the safety half - `bescort`
    # walks the character out of town.
    from .world import scripted_command
    check('a single fput script yields its command',
          scripted_command(";e fput 'go stair'; waitfor 'Obvious exits:'") == 'go stair',
          'the fput form is not being unwrapped')
    check('a script that starts another script yields nothing',
          scripted_command(";e start_script('bescort', ['segoltha', 'west']);"
                           "wait_while{running?('bescort')};") is None)
    check('a script with two commands in it yields nothing',
          scripted_command(";e fput 'go stair'; fput 'north'") is None)

    check('a script move is never offered as a route',
          all(not m.startswith(';') for m in world.moves(start_id).values()))
    # The room the first live walk got stuck in: its only recorded exit is a
    # script, so before the unwrapping it had no typeable way out at all.
    check('the Forging Society smithy now has a way out',
          world.moves(8910) == {8775: 'go first arch'}, f'got {world.moves(8910)}')
    check('and the map still records that exit only as a script',
          bool(world.scripted_moves(8910)))


# -- the new oracle checks --------------------------------------------------

def _scene(**kw) -> Scene:
    base = dict(room_id=1, archetype='outdoor', ground='dirt', ground_source='text',
                boundary='open', canopy='sky', openings=['north'],
                placements=[Placement(kind='tree', where='north', source='rule')],
                light='lantern')
    base.update(kw)
    return Scene(**base)


def _reading(exits=('north',)) -> RoomReading:
    return RoomReading(room_id=1, exits=list(exits), words=40)


def oracle_cases() -> None:
    def summaries(scene, description, exits=('north',)):
        return [c.summary for c in
                check_room(_reading(exits), scene, description, 'a room', 'selftest')]

    clean = summaries(_scene(), 'A quiet street runs north past a young tree.')
    check('a matching scene and description produce no new complaint',
          not any(k in ' '.join(clean) for k in ('opening where', 'same position',
                                                 'roof', 'open sky', 'calls the room dark')),
          f'got {clean}')

    invented = summaries(_scene(openings=['north', 'west']),
                         'A quiet street runs north past a young tree.')
    check('an opening the game never reported is caught',
          any('opening where the game reports no exit' in s for s in invented), f'got {invented}')

    stacked = summaries(_scene(placements=[
        Placement(kind='tree', where='north', source='text'),
        Placement(kind='well', where='north', source='text'),
    ]), 'A quiet street runs north past a young tree.')
    check('two features at one position are caught',
          any('same position' in s for s in stacked), f'got {stacked}')
    doors = summaries(_scene(placements=[
        Placement(kind='door', where='edge', source='text'),
        Placement(kind='door', where='edge', source='text'),
    ]), 'A quiet street runs north.')
    check('two doors at the edge are not reported as stacked',
          not any('same position' in s for s in doors), f'got {doors}')

    roofed = summaries(_scene(archetype='interior', canopy='ceiling'),
                       'Above you the open sky is bright with stars.')
    check('an interior scene under a described sky is caught',
          any('open to the sky' in s for s in roofed), f'got {roofed}')
    outdoors = summaries(_scene(), 'A low ceiling of blackened rafters presses down.')
    check('an outdoor scene under a described ceiling is caught',
          any('has open sky' in s for s in outdoors), f'got {outdoors}')

    dark = summaries(_scene(light=None), 'The gloom here is thick and the corners are unlit.')
    check('a dark room with no light setting is caught',
          any('calls the room dark' in s for s in dark), f'got {dark}')
    lit = summaries(_scene(light='lantern'), 'The gloom here is thick and the corners are unlit.')
    check('a dark room that does carry a light setting is not complained about',
          not any('calls the room dark' in s for s in lit), f'got {lit}')


def execution_cases(world: World) -> None:
    """The play complaints, which a clean run cannot prove anything about.

    A 194-move walk of The Crossing produced a p90 answer time of 0.43s and
    not one slow command, so the live run is evidence the game is quick and
    no evidence at all that the check would have caught a slow one. These
    cases are where that half is established.
    """
    from .complaints import Sink
    from .live import Turn
    from .patrol import Patrol

    def judged(turn) -> list[str]:
        sink = Sink()
        # No session: judging a turn is arithmetic on what already came back,
        # and needing a live game to test it would be the reason it is untested.
        patrol = Patrol(world, None, sink, 'selftest', slow=2.0)
        patrol.judge_turn(turn, 'a room', 1)
        return [c.summary for c, _, _ in sink.all()]

    slow = judged(Turn(command='north', raw='You go north.<prompt/>', latency=3.0, sent=True))
    check('a slow answer is complained about',
          any('longer than 2s' in s for s in slow), f'got {slow}')
    quick = judged(Turn(command='north', raw='You go north.<prompt/>', latency=0.3, sent=True))
    check('a quick answer is not complained about', quick == [], f'got {quick}')

    dead = judged(Turn(command='north', raw='', latency=None, sent=True))
    check('a command the game never finished answering is blocking',
          any('never finished answering' in s for s in dead), f'got {dead}')

    silent = judged(Turn(command='north', raw='<prompt time="1"/>', latency=0.2, sent=True))
    check('a prompt with no output is complained about',
          any('no output whatsoever' in s for s in silent), f'got {silent}')

    refused = judged(Turn(command='go gate', raw="You can't go there.", latency=0.4, sent=True))
    check('an exit the game refuses is complained about',
          any('way out that the game refuses' in s for s in refused), f'got {refused}')
    fine = judged(Turn(command='go gate', raw='You go through the gate.', latency=0.4, sent=True))
    check('a move that worked is not reported as refused',
          not any('refuses' in s for s in fine), f'got {fine}')

    waited = judged(Turn(command='north', raw='...wait 2 seconds.', latency=0.4, sent=True))
    check('roundtime is noted', any('wait rather than a room' in s for s in waited),
          f'got {waited}')


def main() -> int:
    world = World.load()
    parser_cases()
    identity_cases(world)
    exploration_cases(world)
    oracle_cases()
    execution_cases(world)

    print(f'{_ran} cases ran, {len(_failed)} failed')
    for failure in _failed:
        print(f'  FAIL {failure}')
    if _ran < FLOOR:
        print(f'\nONLY {_ran} CASES RAN, expected at least {FLOOR}. '
              'Treat this as a broken harness, not a pass.')
        return 2
    return 1 if _failed else 0


if __name__ == '__main__':
    sys.exit(main())
