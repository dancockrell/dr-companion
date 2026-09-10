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
import re
import sys

from forge.compose import Placement, Scene
from forge.extract import RoomReading

from .live import parse_room
from .oracle import check_room
from .world import World

FLOOR = 50   # well under the real count, so truncation or an import failure shows

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


# Captured the same session, by sending `look` in the room the move above
# arrived in. The whole point of keeping it is what is missing: there is no
# `<nav>` anywhere in it, and there never is on a look.
LOOK_PAYLOAD = (
    "<preset id='roomDesc'>This tranquil corner of the Green has a small bower of"
    " entwined modwyn vines.</preset>\n"
    "Obvious paths: <d>north</d>, <d>west</d>.\n"
    "<style id=\"roomName\" />[The Crossing, Town Green Southeast]\n"
    "<prompt time=\"1789050071\">&gt;</prompt>"
)


# The exact bytes a refused move comes back as, captured 10 Sep 2026 by
# sending `up` in The Crossing, Bank Street. 62 bytes: no room block, so no
# nav, and the character has demonstrably not moved.
BLOCKED_PAYLOAD = ('You can\'t go there.\r\n'
                   '<prompt time="1789058921">&gt;</prompt>\r\n')


class _FakeSocket:
    """Hands back one scripted reply, then behaves like a quiet socket."""

    def __init__(self, reply: str) -> None:
        self.reply = reply.encode('utf-8')
        self.chunks: list[bytes] = []
        self.sent: list[bytes] = []

    def recv(self, _size: int) -> bytes:
        # Nothing until something has been sent. `ask` calls `flush` first,
        # and a fixture that answers that call feeds the reply to the drain
        # instead of to the read - which made these cases fail against a fix
        # that works. The fixture has to model the order, not just the bytes.
        import socket as _socket
        if not self.chunks:
            raise _socket.timeout()
        return self.chunks.pop(0)

    def sendall(self, data: bytes) -> None:
        self.sent.append(data)
        self.chunks.append(self.reply)

    def close(self) -> None:
        pass


def _walked(reply: str, last_uid: int | None):
    """Drive the real `Session.walk` against a scripted reply.

    The point is that `walk` decides for itself whether the character moved,
    from the reply, and that decision is the thing under test.
    """
    from .live import Session
    from .safety import Governor

    session = Session.__new__(Session)
    session.sock = _FakeSocket(reply)
    session.governor = Governor(per_minute=100, total=100)
    session.transcript, session.refusals, session.turns = [], [], []
    session.vitals, session.indicators = {}, {}
    session.last_uid = last_uid
    session.walk('north', timeout=1.0)
    return session


def uid_cases() -> None:
    """A look carries no identity, and what the bot does about that.

    Three states, not two: read off the wire, carried because the character
    demonstrably did not move, and unknown. Folding the third into either of
    the others is the whole defect.
    """
    from .live import Session, Turn

    session = Session.__new__(Session)      # no socket: only `absorb` is under test
    session.vitals, session.indicators, session.last_uid = {}, {}, None

    arrived = session.absorb(MOVE_PAYLOAD, moved=True)
    check('a move carries the room uid off the wire', arrived.uid == 10031,
          f'got {arrived.uid}')
    check('a uid read off the wire is labelled as read', arrived.uid_source == 'nav',
          f'got {arrived.uid_source}')

    looked = session.absorb(LOOK_PAYLOAD, moved=False)
    check('a look has no nav in it at all', '<nav' not in LOOK_PAYLOAD)
    check('a look after a move keeps the uid the move gave', looked.uid == 10031,
          f'got {looked.uid}')
    check('a carried uid is labelled as carried', looked.uid_source == 'carried',
          f'got {looked.uid_source}')

    # The half that matters more: a *move* with no nav must not inherit one.
    # Carrying it there would assert a position instead of reading one, and
    # the safe-area bound downstream trusts this number.
    moved_blind = session.absorb(LOOK_PAYLOAD, moved=True)
    check('a move with no nav leaves the uid unknown', moved_blind.uid is None,
          f'got {moved_blind.uid}')
    check('an unknown uid is not labelled as anything', moved_blind.uid_source is None,
          f'got {moved_blind.uid_source}')
    after = session.absorb(LOOK_PAYLOAD, moved=False)
    check('a look after an unidentified move does not resurrect a stale uid',
          after.uid is None, f'got {after.uid}')

    # These go through `Session.walk` rather than calling `absorb` with a
    # `moved` this file worked out for itself. The first version did the
    # latter and the sabotage harness caught it: damaging the line in `walk`
    # that decides `moved` left every one of these green, because the test was
    # checking my own arithmetic and never executed the code under test. A
    # case that cannot see the line it is named after is worse than no case.
    check('a refused move does not throw away the identity of the room you are in',
          _walked(BLOCKED_PAYLOAD, last_uid=10031).last_uid == 10031,
          f'got {_walked(BLOCKED_PAYLOAD, last_uid=10031).last_uid}')

    walked = _walked(BLOCKED_PAYLOAD, last_uid=10031)
    check('and a look after a refused move still knows where it is',
          walked.absorb(LOOK_PAYLOAD, moved=False).uid == 10031)

    # The control. A move that was *not* refused and carried no nav must still
    # clear it, or the fix above has simply disabled the clearing.
    check('an unrefused move with no nav still clears the identity',
          _walked('You wander off.\r\n<prompt/>', last_uid=10031).last_uid is None,
          f'got {_walked("You wander off.<prompt/>", last_uid=10031).last_uid}')


def exit_cases() -> None:
    """A reply carrying two compasses must not report six exits."""
    doubled = MOVE_PAYLOAD.replace(
        '<compass></compass>',
        '<compass><dir value="n"/><dir value="e"/><dir value="n"/></compass>')
    check('duplicate compass directions are collapsed',
          parse_room(doubled).exits == ['north', 'east'],
          f'got {parse_room(doubled).exits}')
    check('collapsing does not lose a genuinely distinct exit',
          sorted(parse_room(MOVE_PAYLOAD).exits) == ['north', 'northwest', 'west'],
          f'got {parse_room(MOVE_PAYLOAD).exits}')


def retreat_cases(world: World) -> None:
    """The patrol may never choose a direction the safe area cannot bound."""
    from .complaints import Sink
    from .live import Session, Turn
    from .patrol import Patrol

    def patrol_at(last_movement):
        sink = Sink()
        session = Session.__new__(Session)
        patrol = Patrol(world, session, sink, 'test')
        patrol.last_movement = last_movement
        return patrol, sink

    class Room:
        title = 'somewhere unmapped'
        exits = ['north', 'east', 'south']

    patrol, sink = patrol_at('north')
    move = patrol._choose(None, Room())
    check('an unmapped room is left by undoing the last move', move == (None, 'south'),
          f'got {move}')
    check('leaving the map is complained about',
          any('map database does not hold' in c.summary for c, _, _ in sink.all()),
          f'got {[c.summary for c, _, _ in sink.all()]}')

    # The case this replaced: the old code took `room.exits[0]` here, which is
    # 'north' - a direction chosen with nothing bounding where it goes.
    check('the retreat is not simply the first exit the game offered',
          move[1] != Room.exits[0])

    patrol, sink = patrol_at('out')
    move = patrol._choose(None, Room())
    check('with no invertible last move the patrol stops instead of guessing',
          move is None, f'got {move}')
    check('stopping rather than guessing is blocking',
          any(c.severity == 'blocking' for c, _, _ in sink.all()),
          f'got {[(c.severity, c.summary) for c, _, _ in sink.all()]}')


def sameness_cases(world: World) -> None:
    """A street of identical rooms, which no per-room rule can see."""
    from .complaints import Sink
    from .live import Session, Turn
    from .patrol import SAME_RUN, Patrol

    def walked(signatures):
        sink = Sink()
        patrol = Patrol(world, Session.__new__(Session), sink, 'test')
        patrol.signatures = [(100 + i, s) for i, s in enumerate(signatures)]
        patrol.finish()
        return [c.summary for c, _, _ in sink.all()]

    same = walked(['a'] * (SAME_RUN + 1))
    check('a run of identical rooms is complained about',
          any('render identically' in s for s in same), f'got {same}')

    varied = walked(list('abcdefgh'))
    check('a walk of distinct rooms produces no sameness complaint',
          not any('render identically' in s for s in varied), f'got {varied}')
    check('a distinct walk is not called samey either',
          not any('same handful of places' in s for s in varied), f'got {varied}')

    # A run one short of the threshold must stay silent, or the check is
    # really "any two rooms alike" wearing a threshold's clothes.
    edge = walked(['a'] * (SAME_RUN - 1) + list('xyz'))
    check(f'a run of {SAME_RUN - 1} does not trip a threshold of {SAME_RUN}',
          not any('render identically' in s for s in edge), f'got {edge}')

    # Alternating on purpose, so no three in a row are alike: this isolates
    # the ratio check from the run check above. A fixture like 'aabbccdd'
    # trips both at once and would let either one carry the other - and it
    # sits at exactly 50%, on the wrong side of the threshold, which is how
    # this case first failed.
    samey = walked(list('abababab'))
    check('a walk with few distinct pictures is called thin',
          any('same handful of places' in s for s in samey), f'got {samey}')
    check('and that fixture trips the ratio check without the run check',
          not any('render identically' in s for s in samey), f'got {samey}')


class _ScriptedSession:
    """A session that hands `Patrol.run` a prepared sequence of rooms."""

    def __init__(self, rooms):
        self.rooms = list(rooms)
        self.governor = self.refusals = None
        self.asked = 0

    def _next(self):
        from .live import Turn
        room = self.rooms.pop(0) if self.rooms else _unreadable()
        self.asked += 1
        return room, Turn(command='x', raw='<prompt/>', latency=0.1, sent=True)

    def look(self, timeout=8.0):
        return self._next()

    def walk(self, _movement, timeout=12.0):
        return self._next()

    def ask(self, _command, timeout=8.0):
        return self._next()


def _readable(world: World):
    from .live import LiveRoom
    record = world.match_uid(10031)
    return LiveRoom(uid=10031, title=(record.get('title') or ['x'])[0],
                    description=(record.get('description') or ['x'])[0],
                    exits=['north'])


def _unreadable():
    from .live import LiveRoom
    return LiveRoom(uid=None, title='somewhere', description=None)


def stuck_cases(world: World) -> None:
    """The guard that ended both live walks of this cycle, 440 steps early.

    `stuck` counted every unreadable room a walk ever met and never came back
    down, so it fired on the fourth in the *session* while its message said
    "in a row". Nothing could see it from inside: the walk stopped, said a
    sentence that sounded like a reason, and reported everything it had found
    up to that point as a completed run.
    """
    from .complaints import Sink
    from .patrol import Patrol

    def walk(rooms, steps=14):
        patrol = Patrol(world, _ScriptedSession(rooms), Sink(), 'test')
        patrol.pace = lambda: None
        patrol.run(steps)
        return patrol.stopped_because

    # The shape matters. `run` already recovers from one unreadable arrival by
    # looking, so a single unreadable room never reaches the top of the loop.
    # Two in succession do: the walk lands unreadable, the recovery look is
    # unreadable too, and the next pass through the loop is where `stuck`
    # moves. So (readable, unreadable, unreadable) repeated puts exactly one
    # increment between two readable rooms - six of them, well past the
    # threshold of four, with a reset available each time.
    #
    # An earlier fixture here alternated one-for-one and failed against the
    # fix, because it simply ran out of rooms and the scripted session then
    # returned unreadable ones forever - four in a row, stopping the walk for
    # the right reason at the wrong time. The fixture was wrong, not the code.
    scattered = [_readable(world)] + [_unreadable(), _unreadable(),
                                      _readable(world)] * 8
    stopped = walk(scattered, steps=20)
    check('four unreadable rooms scattered through a walk do not stop it',
          stopped != 'four unreadable rooms in a row', f'stopped: {stopped!r}')

    # No readable room at the front, deliberately. With one, the walk has to
    # reach `_choose` and pick a move before it can meet an unreadable room,
    # so this case would also depend on the map graph - and it did: emptying
    # the safe area reddened it, because the walk then stopped for a different
    # reason entirely. Starting unreadable means the guard is the only thing
    # under test, which is what the case is named after.
    consecutive = [_unreadable() for _ in range(12)]
    stopped = walk(consecutive, steps=20)
    check('four unreadable rooms in a row still stop the walk',
          stopped == 'four unreadable rooms in a row', f'stopped: {stopped!r}')


def population_cases(world: World) -> None:
    """An occupied room whose picture is empty - the live-only complaint."""
    from .complaints import Sink
    from .live import Session, Turn
    from .patrol import Patrol

    class Bare:
        placements: list = []

    def occupants(payload):
        sink = Sink()
        patrol = Patrol(world, Session.__new__(Session), sink, 'test')
        patrol._check_population(parse_room(payload), Bare())
        return [c.summary for c, _, _ in sink.all()]

    peopled = occupants(MOVE_PAYLOAD)
    check('a room with someone in it and an empty scene is complained about',
          any('draws nobody' in s for s in peopled), f'got {peopled}')

    # The control. Without it this case passes just as well against a check
    # that fires on every room it is ever handed.
    empty = occupants(MOVE_PAYLOAD.replace(
        "<component id='room players'>Also here: Chore.</component>", ''))
    check('an empty room produces no such complaint', empty == [], f'got {empty}')

    check('the forge really has no feature for a person, which is what the '
          'complaint asserts',
          not _forge_mentions_a_person_kind(),
          'something in forge now produces a person placement, so reword the complaint')


def _forge_mentions_a_person_kind() -> bool:
    """Is there any placement kind standing for a person yet?

    The complaint above claims a capability is missing, and a claim about
    somebody else's code goes stale the moment they add it - at which point
    the bot would be filing a defect that has been fixed. This reads the
    forge rather than remembering what it said today.
    """
    import pathlib

    import forge
    root = pathlib.Path(forge.__file__).parent
    for path in root.glob('*.py'):
        if path.name.startswith('test_'):
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            if 'kind' not in line or line.lstrip().startswith('#'):
                continue
            if re.search(r"kind\s*=\s*['\"](person|people|crowd|figure|npc)", line):
                return True
    return False


def main() -> int:
    world = World.load()
    parser_cases()
    identity_cases(world)
    exploration_cases(world)
    oracle_cases()
    execution_cases(world)
    population_cases(world)
    exit_cases()
    stuck_cases(world)
    uid_cases()
    retreat_cases(world)
    sameness_cases(world)

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
