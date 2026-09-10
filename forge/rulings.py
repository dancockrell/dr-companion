"""Decisions about the hard cases, written down so they accumulate.

The parser handles the bulk deterministically and escalates what it cannot
read. This file is the other half of that design: the place a decision about
an escalated cluster is recorded so the next run inherits it, instead of the
decision living in one session's context and evaporating when it closes.

Two kinds of decision, and they are kept apart on purpose because they carry
different weight:

**A lexicon ruling** changes what the parser knows a word means. It is a rule:
it applies to every room whose text contains the term, it was reached by
looking at a counted population rather than at one room, and a room it helps
is still a room that was *read*. What makes it honest is that the term came
from a measurement recorded beside it, and that `audit --rulings` prints every
one with the effect it had.

**A room override** decides one named room by hand. It is not a rule and does
not generalise, and a room closed this way must never be countable as a room
the parser read - that is the difference between a coverage number and a lie.
So an override sets `RoomReading.sources[field]` to its ruling id, the audit
counts overridden rooms in their own column, and nothing merges the two.

The third thing in here is the one that matters most and is easiest to skip:
**open questions**. A cluster nobody could settle from the text is recorded
with the specific question that would settle it, not dropped. A queue that
quietly loses its hard cases looks exactly like a queue that solved them.
"""

from __future__ import annotations

import json
import pathlib

RULINGS_PATH = pathlib.Path(__file__).resolve().parent / 'rulings.json'

# Every field a room override is allowed to set. An override that could set
# anything would be a second parser with no tests, so the surface is closed:
# a typo'd field name is an error at load rather than a silently ignored key
# that reads, from the audit, exactly like a ruling that had no effect.
OVERRIDABLE = ('enclosure', 'ground')

# What a lexicon ruling is allowed to touch. Same reasoning.
LEXICON_TABLES = ('enclosure', 'ground', 'structure', 'terrain', 'goods',
                  'flora', 'water', 'light', 'tint', 'scale')


class RulingError(Exception):
    """A rulings file that cannot be trusted. Raised rather than warned about.

    A malformed ruling that loads as a no-op is the failure this whole package
    is written against: the audit would report a clean run and the decision it
    was supposed to carry would simply not be there.
    """


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RulingError(message)


class Rulings:
    """The loaded decision record, validated."""

    def __init__(self, data: dict):
        self.version = data.get('version')
        _require(self.version == 1, f'unknown rulings version {self.version!r}')
        self.lexicon: list[dict] = []
        self.rooms: dict[int, dict] = {}
        self.by_id: dict[str, dict] = {}
        self.open_questions: list[dict] = data.get('open_questions', [])

        for ruling in data.get('rulings', []):
            rid = ruling.get('id')
            _require(bool(rid), 'every ruling needs an id')
            _require(rid not in self.by_id, f'duplicate ruling id {rid!r}')
            _require(bool(ruling.get('why')), f'{rid}: a ruling needs a why')
            _require(bool(ruling.get('by')), f'{rid}: a ruling needs a by')
            self.by_id[rid] = ruling

            kind = ruling.get('kind')
            if kind == 'lexicon':
                table = ruling.get('table')
                _require(table in LEXICON_TABLES,
                         f'{rid}: unknown lexicon table {table!r}')
                _require(bool(ruling.get('category')),
                         f'{rid}: a lexicon ruling needs a category')
                _require(bool(ruling.get('add') or ruling.get('remove')),
                         f'{rid}: a lexicon ruling that adds and removes '
                         f'nothing would load as a no-op')
                self.lexicon.append(ruling)
            elif kind == 'room':
                rooms = ruling.get('rooms') or []
                _require(bool(rooms), f'{rid}: a room ruling needs rooms')
                fields = ruling.get('set') or {}
                _require(bool(fields), f'{rid}: a room ruling needs a set')
                for field in fields:
                    _require(field in OVERRIDABLE,
                             f'{rid}: cannot override {field!r}; '
                             f'overridable fields are {OVERRIDABLE}')
                for room_id in rooms:
                    _require(room_id not in self.rooms,
                             f'{rid}: room {room_id} is already overridden by '
                             f'{self.rooms.get(room_id, {}).get("id")!r}')
                    self.rooms[room_id] = ruling
            else:
                raise RulingError(f'{rid}: unknown ruling kind {kind!r}')

        for question in self.open_questions:
            _require(bool(question.get('question')),
                     'an open question without a question is a shrug')
            _require(bool(question.get('id')), 'every open question needs an id')

    def for_room(self, room_id: int) -> dict | None:
        return self.rooms.get(room_id)

    def applied_terms(self) -> dict[tuple[str, str, str], str]:
        """(table, category, term) -> ruling id, for everything a ruling added.

        This is what lets a detection say which ruling put the word in the
        parser's mouth, so a term ruling is traceable in the output rather
        than blending into the tables it extends.
        """
        out = {}
        for ruling in self.lexicon:
            for term in ruling.get('add', ()):
                out[(ruling['table'], ruling['category'], term)] = ruling['id']
        return out


def load(path: pathlib.Path | str | None = None) -> Rulings:
    path = pathlib.Path(path or RULINGS_PATH)
    if not path.exists():
        # An absent file is a real state - no decisions yet - and is not the
        # same as a broken one. It loads as empty and says so; it never
        # silently stands in for a file that failed to parse.
        return Rulings({'version': 1, 'rulings': [], 'open_questions': []})
    with path.open(encoding='utf-8') as handle:
        return Rulings(json.load(handle))


# The one loaded copy the parser reads. Loaded on first use and kept, because
# `active()` is called once per room and the file does not change under a run.
_LOADED: Rulings | None = None


def active() -> Rulings:
    """The rulings the parser is running with."""
    global _LOADED
    if _LOADED is None:
        _LOADED = load()
    return _LOADED


def reload(path: pathlib.Path | str | None = None) -> Rulings:
    """Load again, optionally from somewhere else, and make that the active set.

    The seam exists so the unhappy paths can be run on purpose: a test can
    point the parser at a rulings file that is missing, empty, or deliberately
    malformed, and watch what it does. A branch nobody can execute deliberately
    is a branch nobody can prove they fixed.
    """
    global _LOADED
    _LOADED = load(path)
    return _LOADED
