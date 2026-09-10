"""Walk the real character, explore on purpose, and complain about all of it.

The loop: arrive, learn *which* room this is from the number the game hands
over, build the scene the forge would build for it, check the two agree, then
choose the move that gets to ground nobody has stood on yet.

Three things changed here. The first two were defects; the third was simply
absent:

**A room's name is not its name.** "The Crossing, Magen Road" is four rooms.
The exploration memory was keyed on the title string, so those four shared one
memory, and "rooms visited" counted *steps* - a number that goes up when the
bot walks in a circle. Identity now comes from ``<nav rm='10031'/>``, which
the game sends on every arrival and the database records as each room's
``uid``, and the report counts distinct rooms.

**Wandering is not exploring.** Picking a random unused exit re-reads the same
streets, worst exactly where the rooms are densest. `playbot.world` holds the
database's own ``wayto`` graph, so the bot can ask "which way is the nearest
room I have not seen" and walk a route to it.

**Nothing was measuring the play.** The bot judged scenes against text and had
no sense of its own experience: how long a command took to answer, whether one
answered at all, whether an exit went where the map says. Those are the
complaints a real player files first, and they are filed here under
``subject='game'`` (the world or the map disagreed with itself) and
``subject='bot'`` (this program could not read what it was sent), so they stay
separable from the scene defects the forge owns.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time

from forge.compose import compose
from forge.extract import read_room

from .complaints import Complaint, Sink
from .live import ROUNDTIME_PHRASES, Session
from .oracle import _signature, check_neighbours, check_room
from .world import SAFE_LOCATIONS, World, desc_key

# How many rooms in a row may render identically before a player stops being
# able to tell where they are. Two is a coincidence; a street of five that all
# look the same is the complaint every player of a game like this files, and it
# is the one no per-room rule can see. Not a matter of taste: whether two
# scenes carry the same signature is a fact, and this only counts them.
SAME_RUN = 3

DEFAULT_DB = r'C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json'

# Above this, a player notices the wait. Not a guess about the network: the
# run prints the whole distribution beside it, so the threshold can be argued
# with from the same numbers that produced it.
SLOW_SECONDS = 2.0

COMPASS = {'north', 'northeast', 'east', 'southeast', 'south',
           'southwest', 'west', 'northwest', 'up', 'down', 'out'}


class Patrol:
    """One walk. Holds what has been seen and what went wrong seeing it."""

    def __init__(self, world: World, session: Session, sink: Sink,
                 mission: str, slow: float = SLOW_SECONDS,
                 per_minute: int = 20) -> None:
        self.world = world
        self.session = session
        self.sink = sink
        self.mission = mission
        self.slow = slow
        # A tenth over the governor's own spacing. Pacing at exactly 60/N
        # walks into the limit rather than under it - the first live run of
        # this lost four moves to `rate limit: 30/minute`, because the
        # governor counts sends inside a rolling minute and a send takes a
        # moment to leave. The margin costs six seconds an hour.
        self.interval = (60.0 / max(per_minute, 1)) * 1.1
        self._last_send = 0.0

        self.visited: set[int] = set()          # database room ids
        self.order: list[int] = []
        self.identified_by_uid = 0
        self.identified_by_description = 0
        self.unidentified = 0
        self.latencies: list[float] = []
        self.moves_attempted = 0
        self.moves_that_went_elsewhere = 0
        self.moves_that_did_not_move = 0
        self.stopped_because: str | None = None
        self.last_movement: str | None = None
        self.retreats = 0
        self.uid_carried = 0
        # The scene each visited room produced, and the order they were walked
        # in, so the pair checks and the sameness run below have something to
        # work on. A per-room check cannot see either.
        self.scenes: dict[int, object] = {}
        self.signatures: list[tuple[int, str]] = []

    # -- pacing ----------------------------------------------------------

    def pace(self) -> None:
        """Wait out the gap the governor would otherwise refuse us for.

        The governor raises rather than sleeps, on purpose: it is a stop, not
        a throttle. Pacing here keeps the walk under its limit instead of
        walking into it, and leaves the hard stop exactly where it was.
        """
        wait = self.interval - (time.monotonic() - self._last_send)
        if wait > 0:
            time.sleep(wait)
        self._last_send = time.monotonic()

    # -- complaining -----------------------------------------------------

    def file(self, severity: str, subject: str, summary: str, **kw) -> None:
        self.sink.file(Complaint(
            severity=severity, subject=subject, summary=summary,
            mission=self.mission, **kw,
        ))

    def judge_turn(self, turn, where: str, room_id: int | None) -> None:
        """The execution complaints: what this command cost the player."""
        if turn.refusal:
            self.file('note', 'bot',
                      'the safety allowlist refused a move the map database records',
                      room_id=room_id, room_title=where,
                      expected=f'{turn.command!r} to be a movement the bot may make',
                      observed=turn.refusal)
            return
        if not turn.sent:
            return

        if turn.latency is None:
            self.file('blocking', 'game',
                      'a command was sent and the game never finished answering',
                      room_id=room_id, room_title=where,
                      expected='a prompt within the timeout',
                      observed=f'{turn.command!r}: no prompt, {len(turn.raw)} bytes back')
            return

        self.latencies.append(turn.latency)
        if turn.latency >= self.slow:
            self.file('thin', 'game',
                      f'a command took longer than {self.slow:g}s to answer',
                      room_id=room_id, room_title=where,
                      expected=f'an answer inside {self.slow:g}s',
                      observed=f'{turn.command!r} answered in {turn.latency:.2f}s',
                      evidence={'latency': round(turn.latency, 3)})

        if turn.silent:
            self.file('wrong', 'game',
                      'a command produced a prompt and no output whatsoever',
                      room_id=room_id, room_title=where,
                      expected='the game to say something, even a refusal',
                      observed=f'{turn.command!r} returned nothing')

        blocked = turn.blocked
        if blocked:
            self.file('wrong', 'game',
                      'the map database records a way out that the game refuses',
                      room_id=room_id, room_title=where,
                      expected=f'{turn.command!r} to work, the database says it leads somewhere',
                      observed=f'the game said: {blocked!r}',
                      evidence={'command': turn.command})

        low = turn.raw.lower()
        if any(phrase in low for phrase in ROUNDTIME_PHRASES):
            self.file('note', 'game',
                      'a move was answered with a wait rather than a room',
                      room_id=room_id, room_title=where,
                      expected='to arrive',
                      observed=f'{turn.command!r} hit roundtime')

    # -- identity --------------------------------------------------------

    def identify(self, room) -> dict | None:
        """Which database room the game is showing, and say how sure we are.

        The uid is exact and the description is a guess, so when both are
        available and disagree that is a finding rather than a tie to break.
        """
        by_uid = self.world.match_uid(room.uid)
        by_desc = self.world.match_description(room.description)

        if by_uid is not None:
            self.identified_by_uid += 1
            if getattr(room, 'uid_source', None) == 'carried':
                self.uid_carried += 1
            stored = [desc_key(d) for d in (by_uid.get('description') or [])]
            live_key = desc_key(room.description or '')
            if live_key and stored and live_key not in stored:
                self.file('wrong', 'game',
                          'the stored description does not match what the game shows in that room',
                          room_id=by_uid['id'], room_title=room.title,
                          expected=f'the database text for #{by_uid["id"]}',
                          observed=(room.description or '')[:160],
                          evidence={'uid': room.uid})
            return by_uid

        if room.uid is not None:
            self.unidentified += 1
            self.file('wrong', 'game',
                      'the game gave a room uid that is not in the map database',
                      room_title=room.title,
                      expected='every room the character can stand in to be mapped',
                      observed=f'uid {room.uid}: {room.title}')
            return None

        if len(by_desc) == 1:
            self.identified_by_description += 1
            # Filed against the bot, not the game. The game sends `<nav>` on
            # arrival and only there, so the one command that can reach this
            # is the opening look of a session, when there has been no arrival
            # to carry an identity from. The previous walk filed nine of these
            # as a game defect - "the game sent no room uid" - which read as
            # the world being unreliable when it was the bot asking with the
            # wrong verb. It is now one per session and it is honest about
            # whose limitation it is.
            self.file('note', 'bot',
                      'the first room of a session is identified by prose, having never been arrived at',
                      room_id=by_desc[0]['id'], room_title=room.title,
                      expected='an arrival to take a uid from',
                      observed='matched on the first 60 characters of the description')
            return by_desc[0]

        if len(by_desc) > 1:
            self.unidentified += 1
            self.file('wrong', 'game',
                      'several database rooms share one description and the game sent no uid',
                      room_title=room.title,
                      expected='one room to match',
                      observed=f'{len(by_desc)} rooms share it: '
                               + ', '.join(f'#{r["id"]}' for r in by_desc[:5]))
            return None

        self.unidentified += 1
        self.file('wrong', 'game',
                  'a room the game showed is not in the map database we generate from',
                  room_title=room.title,
                  expected='the stored description to match what a player reads',
                  observed=(room.description or '')[:160])
        return None

    # -- the scene half --------------------------------------------------

    def judge_room(self, record: dict, room) -> None:
        reading = read_room(record)
        stored_exits = [e.strip().lower() for e in reading.exits]
        live_exits = [e.strip().lower() for e in room.exits]

        # Compose from the *stored* exits and check against the *live* ones,
        # in that order and on purpose. The scene a player will actually see
        # is built offline from this database - there is no live game at
        # generation time - so composing from live exits would test a pipeline
        # that does not exist and hide exactly the drift this walk is for.
        scene = compose(reading)
        if scene is not None:
            self.scenes[record['id']] = scene
            self.signatures.append((record['id'], _signature(scene)))
        if room.exits:
            reading.exits = list(room.exits)

        stored_compass = {e for e in stored_exits if e in COMPASS}
        live_compass = {e for e in live_exits if e in COMPASS}
        if live_exits and stored_compass != live_compass:
            self.file('wrong', 'game',
                      'the map database and the live game disagree about a room\u2019s exits',
                      room_id=record['id'], room_title=room.title,
                      expected=f'stored: {", ".join(sorted(stored_compass)) or "none"}',
                      observed=f'live: {", ".join(sorted(live_compass)) or "none"}',
                      evidence={
                          'only_stored': sorted(stored_compass - live_compass),
                          'only_live': sorted(live_compass - stored_compass),
                      })

        for complaint in check_room(
            reading, scene, room.description or '', room.title, self.mission
        ):
            self.sink.file(complaint)

        if scene and room.objects:
            _check_objects(room, scene, self.sink, self.mission)

    # -- the walk --------------------------------------------------------

    def unsafe_state(self, room) -> str | None:
        """Anything that means stop walking and say why."""
        health = room.health
        if health is not None and health < 90:
            return f'health is {health}'
        if room.indicators.get('BLEEDING'):
            return 'the character is bleeding'
        return None

    def run(self, steps: int) -> None:
        session = self.session
        self.pace()
        room, turn = session.look()
        self.judge_turn(turn, room.title or '(unknown)', None)

        stuck = 0
        for step in range(steps):
            if not room.usable:
                self.file('wrong', 'bot',
                          'the game sent something the room parser could not read',
                          room_title=room.title,
                          expected='a title and a description',
                          observed=f'title={room.title!r} description={bool(room.description)}')
                self.pace()
                room, turn = session.look()
                self.judge_turn(turn, room.title or '(unknown)', None)
                stuck += 1
                if stuck >= 4:
                    self.stopped_because = 'four unreadable rooms in a row'
                    return
                continue

            danger = self.unsafe_state(room)
            if danger:
                self.file('blocking', 'bot', 'the patrol stopped itself: the character is not safe',
                          room_title=room.title,
                          expected='a character standing in a town in one piece',
                          observed=danger)
                self.stopped_because = danger
                return

            record = self.identify(room)
            here = record['id'] if record else None
            if here is not None and here not in self.visited:
                self.visited.add(here)
                self.order.append(here)
                self.judge_room(record, room)

            if room.indicators.get('SITTING') or room.indicators.get('PRONE') \
                    or room.indicators.get('KNEELING'):
                self.pace()
                _, turn = session.ask('stand')
                self.judge_turn(turn, room.title, here)

            move = self._choose(here, room)
            if move is None:
                self.stopped_because = 'no unvisited room is reachable inside the safe area'
                return
            expected_id, movement = move

            self.moves_attempted += 1
            self.last_movement = movement
            self.pace()
            arrived, turn = session.walk(movement)
            self.judge_turn(turn, room.title, here)

            landed = self.world.match_uid(arrived.uid)
            landed_id = landed['id'] if landed else None

            if landed_id is not None and expected_id is not None:
                if landed_id != expected_id:
                    if landed_id == here:
                        self.moves_that_did_not_move += 1
                        self.file('wrong', 'game',
                                  'a move the map database records left the character where it was',
                                  room_id=here, room_title=room.title,
                                  expected=f'{movement!r} to reach #{expected_id}',
                                  observed='still in the same room afterwards',
                                  evidence={'movement': movement})
                    else:
                        self.moves_that_went_elsewhere += 1
                        self.file('wrong', 'game',
                                  'an exit does not lead where the map database says it does',
                                  room_id=here, room_title=room.title,
                                  expected=f'{movement!r} to reach #{expected_id} '
                                           f'({_title(self.world, expected_id)})',
                                  observed=f'arrived at #{landed_id} '
                                           f'({_title(self.world, landed_id)})',
                                  evidence={'movement': movement})

            if not arrived.usable:
                # A move whose answer carried no room at all: look rather than
                # guess, because walking on from a room we cannot see is how a
                # bot ends up somewhere it should not be.
                self.pace()
                arrived, turn = session.look()
                self.judge_turn(turn, arrived.title or '(unknown)', None)
            room = arrived

    def finish(self) -> None:
        """The checks that are about more than one room, run once at the end.

        The live walk was not running either of these. `check_neighbours` was
        written for the offline pass and imported only there, so the single
        most player-visible defect the project has a rule for - two rooms you
        can walk between drawing the same picture - was never once applied to
        the rooms actually walked.

        The run-length check below is new, and it is the version of that
        complaint a player would recognise. Adjacent pairs are a property of
        the map; a *street* of rooms that all look alike is what someone
        actually walks down, and a pairwise check reports it as scattered
        pairs rather than as the one thing it is.
        """
        wayto = {rid: (self.world.rooms.get(rid) or {}).get('wayto') or {}
                 for rid in self.scenes}
        for complaint in check_neighbours(self.scenes, wayto):
            self.sink.file(complaint)

        run: list[int] = []
        previous: str | None = None
        for room_id, signature in self.signatures + [(-1, '\0end')]:
            if signature == previous:
                run.append(room_id)
                continue
            if len(run) >= SAME_RUN:
                self.file('wrong', 'scene',
                          f'{len(run)} rooms walked in a row render identically',
                          room_id=run[0],
                          room_title=_title(self.world, run[0]),
                          expected=f'fewer than {SAME_RUN} consecutive rooms sharing a picture',
                          observed=f'#{run[0]}..#{run[-1]} all carry {previous}',
                          evidence={'rooms': run[:8], 'signature': previous})
            run = [room_id]
            previous = signature

        if self.signatures:
            distinct = len({s for _, s in self.signatures})
            share = distinct / len(self.signatures)
            if share < 0.5:
                self.file('thin', 'scene',
                          'most of the walk looked like the same handful of places',
                          expected='a picture distinct enough to navigate by',
                          observed=f'{len(self.signatures)} rooms produced {distinct} '
                                   f'distinct scenes ({share:.0%})',
                          evidence={'rooms': len(self.signatures), 'distinct': distinct})

    def _choose(self, here: int | None, room) -> tuple[int | None, str] | None:
        """The next move: toward unseen ground when the graph knows the way."""
        if here is not None:
            typeable = self.world.moves(here)
            if not typeable:
                # Not the same state as "everything has been seen", and the
                # first version of this reported it as though it were: the
                # walk announced it had explored the whole town while standing
                # in a smithy whose only recorded way out is a Lich script.
                scripted = self.world.scripted_moves(here)
                self.file('wrong', 'game',
                          'the map records no way out of this room that a player could type',
                          room_id=here, room_title=room.title,
                          expected='at least one exit as a plain command',
                          observed=(f'{len(scripted)} exits, all Lich scripts'
                                    if scripted else 'no exits at all'),
                          evidence={'scripted': list(scripted.values())[:3]})
                return self._retreat(room, 'this room has no typeable exit')

            step = self.world.frontier_step(here, self.visited)
            if step:
                if step[0] in self.world.scripted_moves(here):
                    self.file('note', 'game',
                              'an exit is recorded only as a Lich script, not as a command',
                              room_id=here, room_title=room.title,
                              expected='a movement string a player could type',
                              observed=f'unwrapped {step[1]!r} out of the script')
                return step
            # Everything reachable has been seen. Say so rather than starting
            # a random walk that would inflate the step count and find nothing.
            return None
        return self._retreat(room, 'the room the character is standing in is not on the map')

    # The move that undoes each move, so an off-map step can be walked back.
    # `out` has no inverse worth guessing - `in` may be a different doorway -
    # and a direction absent here simply means the retreat is refused.
    INVERSE = {
        'north': 'south', 'south': 'north', 'east': 'west', 'west': 'east',
        'northeast': 'southwest', 'southwest': 'northeast',
        'northwest': 'southeast', 'southeast': 'northwest',
        'up': 'down', 'down': 'up',
    }

    def _retreat(self, room, why: str) -> tuple[int | None, str] | None:
        """Undo the last move, or stop. Never a fresh direction chosen blind.

        This replaces the one place the patrol could leave its own safe area.
        `world.moves` refuses every step into a room outside `SAFE_LOCATIONS`,
        so a routed walk is bounded by construction - but both fallbacks here
        used to pick the first compass direction out of the *game's* exit list,
        which is bounded by nothing at all. Standing in an unmapped room beside
        a town gate, the bot would have walked through it, and the safe-area
        allowlist would have had no say: it is only consulted for rooms the map
        knows, and this branch runs precisely when the map does not know one.

        Walking back the way we came cannot do that. The room we came from was
        in the safe set a moment ago, which is why we were allowed to leave it.
        The step is one move, backwards, into somewhere already checked.
        """
        back = self.INVERSE.get((self.last_movement or '').strip().lower())
        if back is None:
            self.file('blocking', 'bot',
                      'the patrol stopped rather than choose a direction it could not bound',
                      room_title=room.title,
                      expected='a mapped room, so the safe-area check has something to check',
                      observed=f'{why}; last move {self.last_movement!r} has no inverse')
            self.stopped_because = f'{why}, and no way back'
            return None
        self.retreats += 1
        self.file('wrong', 'game', 'the character reached a room the map database does not hold',
                  room_title=room.title,
                  expected='every room reachable from the safe area to be mapped',
                  observed=f'{why}; retreating {back!r}',
                  evidence={'came_by': self.last_movement, 'retreat': back})
        return None, back


def _title(world: World, room_id: int | None) -> str:
    record = world.rooms.get(int(room_id)) if room_id is not None else None
    if not record:
        return 'unknown'
    titles = record.get('title') or []
    return (titles[0] if titles else 'untitled').strip('[]')


def _check_objects(room, scene, sink: Sink, mission: str) -> None:
    """Things standing in the room right now that the scene has no place for.

    The stored description is written once; `You also see ...` is what is
    actually there this minute. A scene built only from the former can be
    perfectly faithful to the text and still miss the anvil in front of you.
    """
    kinds = {p.kind for p in scene.placements}
    lowered = room.objects.lower()
    for noun, wants in (('anvil', 'hearth'), ('forge', 'hearth'), ('well', 'well'),
                        ('fountain', 'well'), ('statue', 'statue'), ('sign', 'sign'),
                        ('table', 'counter'), ('bench', 'counter')):
        if noun in lowered and wants not in kinds:
            sink.file(Complaint(
                severity='wrong', subject='scene',
                summary=f'the room contains a {noun} the scene has nowhere to put',
                room_title=room.title, mission=mission,
                expected=f'a {wants} placement',
                observed=f'scene kinds: {", ".join(sorted(kinds)) or "none"}',
                evidence={'room_objects': room.objects[:200]},
            ))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', default=DEFAULT_DB)
    parser.add_argument('--port', type=int, default=11024)
    parser.add_argument('--steps', type=int, default=12, help='moves to make')
    parser.add_argument('--budget', type=int, default=200,
                        help='hard cap on commands for the whole session')
    parser.add_argument('--per-minute', type=int, default=20,
                        help='commands per minute; the walk paces itself to stay under it')
    parser.add_argument('--slow', type=float, default=SLOW_SECONDS,
                        help='seconds above which an answer is a complaint')
    parser.add_argument('--locations', nargs='*', default=sorted(SAFE_LOCATIONS),
                        help='the safe area, by the database\u2019s own location names')
    parser.add_argument('--out', help='write complaints here as JSONL')
    args = parser.parse_args(argv)

    world = World.load(args.db, frozenset(args.locations))
    safe = world.safe_room_ids()
    print(f'map database: {len(world.rooms):,} rooms, {len(world.by_uid):,} with a uid')
    print(f'safe area: {len(safe):,} rooms in {len(world.safe_locations)} locations')

    session = Session(port=args.port, per_minute=args.per_minute, budget=args.budget)
    sink = Sink(args.out)
    mission = (f'walk up to {args.steps} moves through {len(safe):,} safe rooms, '
               'judging both the scenes and the play')
    patrol = Patrol(world, session, sink, mission, slow=args.slow,
                    per_minute=args.per_minute)

    started = time.time()
    try:
        session.drain(1.0)
        patrol.run(args.steps)
    except KeyboardInterrupt:
        patrol.stopped_because = 'interrupted'
    finally:
        # In the `finally` because `run` returns early from six places and an
        # interrupted walk has just as much to say about what it saw as a
        # finished one. A cross-room check that only runs when the loop ends
        # tidily is a check that stops existing exactly when a walk goes wrong.
        patrol.finish()
        session.close()
    elapsed = time.time() - started

    print()
    print(f'distinct rooms: {len(patrol.visited)}   moves attempted: {patrol.moves_attempted}'
          f'   in {elapsed / 60:.1f} min')
    print(f'  arrivals identified by uid: {patrol.identified_by_uid}'
          f' (of which {patrol.uid_carried} carried across a look)'
          f'   by description: {patrol.identified_by_description}'
          f'   not identified: {patrol.unidentified}')
    print(f'  retreats out of unmapped rooms: {patrol.retreats}'
          f'   distinct scene signatures: {len({s for _, s in patrol.signatures})}'
          f' over {len(patrol.signatures)} scenes')
    print(f'  moves that landed elsewhere: {patrol.moves_that_went_elsewhere}'
          f'   moves that did not move: {patrol.moves_that_did_not_move}')
    if patrol.latencies:
        ordered = sorted(patrol.latencies)
        print(f'  answer time over {len(ordered)} commands: '
              f'median {statistics.median(ordered):.2f}s, '
              f'p90 {ordered[int(len(ordered) * 0.9) - 1]:.2f}s, '
              f'worst {ordered[-1]:.2f}s')
    print(f'  commands sent: {session.governor.sent}'
          f'   refused by the safety list: {len(session.refusals)}')
    for refusal in session.refusals[:5]:
        print(f'    refused: {refusal}')
    if patrol.stopped_because:
        print(f'  stopped: {patrol.stopped_because}')
    print()
    print(sink.report())
    if args.out:
        print(f'{sink.flush()} distinct complaints -> {args.out}')

    if patrol.visited and not sink.all():
        print('\nNOTHING FOUND across a real walk. Suspect the oracle before the world.')
        return 2
    if not patrol.visited:
        print('\nNO ROOM WAS EVER IDENTIFIED. That is this program, not the world.')
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
