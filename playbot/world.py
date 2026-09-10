"""The map database as a graph, so the bot can explore instead of wander.

Three things live here, and they exist because the bot could not do any of
them before:

**Identity.** A room's name is not its name. "The Crossing, Magen Road" is
four different rooms, and the previous patrol keyed its exploration memory on
the title string, so those four rooms shared one memory and its "rooms
visited" count was a count of *steps*. The game hands out the real identity on
every arrival - ``<nav rm='10031'/>``, confirmed on the wire - and the
database records the same number in each room's ``uid``. Matching those two is
exact, and it is what makes a distinct-room count mean anything.

**Reachability.** ``wayto`` is a real graph: room id -> the movement string
that gets you to a neighbour. With it the bot can ask "which way is the
nearest room I have not seen" instead of rolling a die at every junction. A
random walk in a street grid re-reads the same three streets; a frontier
search does not.

**Bounds.** Exploration that can route can also route somewhere that kills
you, so the safe area is a named allowlist of ``location`` values and every
route is checked against it. This narrows what the bot may do; it never widens
it. `playbot.safety` still vets every individual command on top of this.
"""

from __future__ import annotations

import json
import re
from collections import deque
from dataclasses import dataclass, field

DEFAULT_DB = r'C:\Ruby4Lich5\Lich5\data\DR\map-1788915136.json'

# Town locations with no hostile creatures in them. Deliberately short and
# deliberately a list: the Sewers, the Lost Crossing and everything outside
# the walls are absent on purpose, and adding one is an edit somebody has to
# make and justify, exactly like adding a verb to the safety allowlist.
SAFE_LOCATIONS = frozenset({
    'The Crossing',
    'Crossing Temple',
    'Crossing Orphanage',
    'Crossing Outfitting Society',
    'Crossing Forging Society',
    'Crossing Enchanting Society',
    'Crossing Engineering Society',
    'Crossing Alchemy Society',
})


# Some exits exist in the database only as a Lich script:
#     ";e fput 'go stair'; waitfor 'Obvious exits:'"
# The command a player would actually type is inside it. Pulling that one
# string out is not a way round the safety allowlist - what comes out still
# goes through `vet` like everything else - it is the difference between a
# bot that can enter a building and one that cannot. Anything that calls
# another script is refused outright: two of the thirty-one in The Crossing
# are `bescort`, which walks the character out of town, and that is precisely
# the move a town-bounded patrol must not make.
_FPUT = re.compile(r"fput '([^']+)'")


def scripted_command(movement: str) -> str | None:
    """The single typed command hiding inside a Lich script move, or None."""
    if 'start_script' in movement or 'Script.exists?' in movement:
        return None
    found = _FPUT.findall(movement)
    if len(found) != 1:
        return None
    return found[0].strip()


def normalise(text: str) -> str:
    return re.sub(r'[^a-z ]+', '', re.sub(r'\s+', ' ', text.lower())).strip()


def desc_key(text: str) -> str:
    return normalise(text)[:60]


@dataclass
class World:
    """The rooms, indexed the three ways the bot needs to ask about them."""

    rooms: dict[int, dict] = field(default_factory=dict)
    by_uid: dict[int, dict] = field(default_factory=dict)
    by_desc: dict[str, list[dict]] = field(default_factory=dict)
    safe_locations: frozenset[str] = SAFE_LOCATIONS

    # -- loading ---------------------------------------------------------

    @classmethod
    def load(cls, path: str = DEFAULT_DB,
             safe_locations: frozenset[str] = SAFE_LOCATIONS) -> 'World':
        with open(path, encoding='utf-8') as handle:
            records = json.load(handle)
        return cls.from_records(records, safe_locations)

    @classmethod
    def from_records(cls, records: list[dict],
                     safe_locations: frozenset[str] = SAFE_LOCATIONS) -> 'World':
        world = cls(safe_locations=safe_locations)
        for record in records:
            world.rooms[int(record['id'])] = record
            for uid in record.get('uid') or []:
                # One room in 18,950 carries two uids and a handful of uids
                # appear under two rooms. First writer wins and the collision
                # is not silent: `uid_collisions` counts them so a caller can
                # say how much of its identity is exact.
                if int(uid) in world.by_uid:
                    continue
                world.by_uid[int(uid)] = record
            for description in record.get('description') or []:
                key = desc_key(description)
                if key:
                    world.by_desc.setdefault(key, []).append(record)
        return world

    # -- identity --------------------------------------------------------

    def by_room_id(self, room_id: int) -> dict | None:
        return self.rooms.get(int(room_id))

    def match_uid(self, uid: int | None) -> dict | None:
        if uid is None:
            return None
        return self.by_uid.get(int(uid))

    def match_description(self, description: str | None) -> list[dict]:
        """Every stored room whose description opens the same way.

        Returns the whole list rather than the first hit on purpose: several
        rooms sharing one description is a fact about the world worth
        reporting, and `.get(...)` hid it.
        """
        if not description:
            return []
        out, seen = [], set()
        for record in self.by_desc.get(desc_key(description)) or []:
            # A room with two stored descriptions that share an opening 60
            # characters lands in this bucket twice, and the first version of
            # this reported "2 rooms share it: #794, #794" - an ambiguity that
            # was really one room seen double. Same defect as comparing a room
            # with itself in the neighbour check.
            if record['id'] in seen:
                continue
            seen.add(record['id'])
            out.append(record)
        return out

    # -- graph -----------------------------------------------------------

    def safe(self, record: dict | None) -> bool:
        return bool(record) and record.get('location') in self.safe_locations

    def moves(self, room_id: int) -> dict[int, str]:
        """Neighbour id -> the movement string, for moves inside the safe area.

        A ``wayto`` value beginning with ';' is a Lich script, not a command a
        player types, and it is dropped here rather than sent and refused.
        """
        record = self.rooms.get(int(room_id))
        if not record:
            return {}
        out: dict[int, str] = {}
        for neighbour, movement in (record.get('wayto') or {}).items():
            try:
                neighbour_id = int(neighbour)
            except (TypeError, ValueError):
                continue
            if neighbour_id == int(room_id):
                continue
            if not isinstance(movement, str):
                continue
            if movement.startswith(';'):
                movement = scripted_command(movement)
                if movement is None:
                    continue
            if not self.safe(self.rooms.get(neighbour_id)):
                continue
            out[neighbour_id] = movement.strip()
        return out

    def scripted_moves(self, room_id: int) -> dict[int, str]:
        """The neighbours this room can only be reached from by a Lich script.

        Reported rather than used: a map whose exits are not typeable is a
        finding about the map, and it is invisible if the bot silently walks
        them.
        """
        record = self.rooms.get(int(room_id)) or {}
        out = {}
        for neighbour, movement in (record.get('wayto') or {}).items():
            if isinstance(movement, str) and movement.startswith(';'):
                try:
                    out[int(neighbour)] = movement
                except (TypeError, ValueError):
                    continue
        return out

    def route(self, start: int, goal_test, limit: int = 4000) -> list[tuple[int, str]] | None:
        """Breadth-first path from `start` to the nearest room satisfying `goal_test`.

        Returns [(next_room_id, movement), ...] - the moves to make, in order -
        or None when nothing reachable satisfies it. `goal_test` takes a room
        id so a caller can ask for "any room I have not visited" without this
        module knowing what a visit is.
        """
        start = int(start)
        if start not in self.rooms:
            return None
        seen = {start}
        queue: deque[tuple[int, list[tuple[int, str]]]] = deque([(start, [])])
        expanded = 0
        while queue and expanded < limit:
            room_id, path = queue.popleft()
            expanded += 1
            if path and goal_test(room_id):
                return path
            for neighbour_id, movement in self.moves(room_id).items():
                if neighbour_id in seen:
                    continue
                seen.add(neighbour_id)
                queue.append((neighbour_id, path + [(neighbour_id, movement)]))
        return None

    def frontier_step(self, room_id: int, visited: set[int]) -> tuple[int, str] | None:
        """The single next move that makes progress toward unseen ground.

        Prefers an adjacent unvisited room, and only when every neighbour is
        known does it pay for a search. The difference is the whole point: a
        random walk here revisits, and it revisits worst exactly where the
        rooms are densest.
        """
        for neighbour_id, movement in self.moves(room_id).items():
            if neighbour_id not in visited:
                return neighbour_id, movement
        path = self.route(room_id, lambda rid: rid not in visited)
        return path[0] if path else None

    # -- reporting -------------------------------------------------------

    def safe_room_ids(self) -> set[int]:
        return {rid for rid, rec in self.rooms.items() if self.safe(rec)}


if __name__ == '__main__':
    world = World.load()
    safe = world.safe_room_ids()
    print(f'{len(world.rooms):,} rooms, {len(world.by_uid):,} carry a uid')
    print(f'{len(safe):,} rooms in the safe area: {", ".join(sorted(world.safe_locations))}')
    shared = sum(1 for v in world.by_desc.values() if len(v) > 1)
    print(f'{shared:,} descriptions are shared by more than one room')
