"""Who a room says is usually there, and where the people who are there *now* come from.

Two different claims, and this file exists to keep them apart.

**The stored description says who is usually somewhere. Only the live game says
who is there now.** A map database entry is written once and read for years; it
can tell you that a market is a place merchants and customers haggle in, and it
cannot tell you that a shaggy mutt and two players are standing in it this
second. No offline pass over the corpus could ever have raised the second
question, which is why a live playtest bot walking 169 real rooms was what
found the defect this module answers: every scene drawn empty of people.

So there are two halves here and they never touch:

* `density()` and the `PRESENCE` table in `lexicon.py` read the description.
  What they produce is a **persistent property of the place** - this is a busy
  street, that is a guarded gate - and it goes into the generated room spec,
  which is static and per-room.
* `Occupancy` below is the **live** half. It is a shape, not a transport: it
  says what a caller must hand the renderer at draw time, and it is explicitly
  not part of the room spec. See `Occupancy`'s own docstring for why baking it
  in would be wrong rather than merely inconvenient.

The five states
---------------

A room the description says is busy, a room the description says is empty, a
room whose description simply never mentions people, and a room we could not
read at all are **four different things**, and this file refuses to fold them
together. Everything in this repository's history argues for that refusal: a
container capacity hardcoded to zero, and 17,750 rooms classified by their
titles, are both a placeholder that looked like an answer.

    THRONGED    the description says many people are habitually here
    FREQUENTED  the description names people or a role, but not a crowd
    SOLITARY    the description positively says nobody is here
    UNSAID      a readable description that mentions nobody either way
    UNREAD      there was no description to read

`UNSAID` is the one to be careful with. It does **not** mean the room is empty.
It means the author never said, and the only thing that can answer it is the
live game. A renderer that draws `UNSAID` the same as `SOLITARY` has invented
an emptiness the text never claimed, which is the same error as inventing a
floor - and it is the error that is easy to make, because the two look
identical on screen.
"""

from __future__ import annotations

from dataclasses import dataclass, field

THRONGED = 'thronged'
FREQUENTED = 'frequented'
SOLITARY = 'solitary'
UNSAID = 'unsaid'
UNREAD = 'unread'

#: Every state, so a caller can assert it has handled all of them rather than
#: discovering a fifth one at render time.
STATES = (THRONGED, FREQUENTED, SOLITARY, UNSAID, UNREAD)

#: The one `PRESENCE` kind that means *many*. A room with any detection of this
#: kind is thronged; a room with only the others is frequented. Kept as a name
#: rather than a hardcoded string in the function below so that adding a second
#: crowd kind to the lexicon is one edit, not two.
CROWD_KINDS = frozenset({'crowd'})


# The description saying, in its own words, that nobody is here.
#
# Deliberately small, and deliberately not the obvious words. 'empty' (236
# rooms), 'quiet' (371), 'silent' (186) and 'abandoned' (178) were all counted
# and left out: empty crates, a quiet corner, silent sentinels of fir, an
# abandoned cart. Every one of them describes a thing in the room far more often
# than it describes the room's population, and a cue that fires on furniture
# would put SOLITARY on hundreds of rooms that never claimed it.
#
# What is left is what can only be about people. Counted: 'deserted' 25,
# 'secluded' 34, 'solitude' 22, 'no one' 8, 'uninhabited' 4, 'nobody' 2,
# 'unoccupied' 1, 'devoid of life' 3. 'not a soul' was proposed, counted 0
# rooms, and is not listed. That is a small population and it is reported as a
# small one rather than padded out with words that would fire on scenery.
#
# Substring containment, with nothing to escape, for the reason given above
# `_FIGURATIVE_OF` in extract.py - and with the limitation named in
# `_room_wall` understood: containment cannot tell a word from the inside of a
# longer one. Each phrase here was checked against that. 'no one' is the one
# that needs a space either side, which the phrase already has on its left in
# every English sentence it can appear in, and on its right by the word break;
# there is no longer word that contains 'no one' in this corpus.
_NOBODY = (
    'deserted', 'uninhabited', 'unoccupied', 'secluded', 'solitude',
    'no one', 'nobody', 'devoid of life',
)


# Busyness attributed to somewhere else. "Tucked away from the hustle and
# bustle of the rest of the tower" is a room saying it is *quiet*, and the
# words it uses to say so are the same words a busy room uses.
#
# Found by reading contexts rather than by reasoning: 'hustle and bustle' is in
# 17 rooms and at least 6 of them are this phrasing verbatim. Without this
# guard the quietest rooms in the corpus would be the ones marked thronged.
_ELSEWHERE = (
    'away from the', 'removed from the', 'free of the', 'far from the',
    'avoid the', 'escape the', 'retreat from', 'safe from the',
    'sheltered from the', 'out of the',
)


def _elsewhere(sentence: str, at: int) -> bool:
    """Is the busyness in this sentence being attributed to somewhere else?

    Only cues that appear *before* the term count. "The bustle of the market is
    a world away from this cellar" and "tucked away from the bustle" mean
    opposite things about this room, and word order is what separates them.
    """
    before = sentence[:at]
    return any(cue in before for cue in _ELSEWHERE)


def attributed_elsewhere(kind: str, term: str, sentence: str) -> bool:
    """Is this crowd word describing a crowd that is somewhere else?

    Called from `extract.read_room`'s detection loop, so that a room the text
    says is quiet never carries a crowd **detection** at all.

    The first version of this guard ran only inside `density()`, on the reasoning
    that the word really was written in this room's description and so was honest
    to have detected - only the density verdict needed protecting. That reasoning
    was wrong, and a sabotage in `break_check.py` is what showed it: `compose.py`
    turns every detection into a placement, so a study "tucked away from the
    hustle and bustle of the rest of the tower" was getting a crowd sprite drawn
    in it while its presence state correctly read `unsaid`. Two answers to one
    question, disagreeing, which is the failure this repository's own rules open
    with. The detection is dropped here and the discarded term is handed to
    `density()` so it can still say what it discounted.
    """
    if kind not in CROWD_KINDS:
        return False
    at = sentence.find(term)
    if at < 0:
        return False
    return _elsewhere(sentence, at)


# 'guard' is the one presence word in this corpus that is a verb more often
# than it is a person, and it is too common to leave out: 388 occurrences across
# 359 rooms. The bare word was left out of the table at first and the determined
# forms ('a guard', 'the guards') put in instead, which measured 52 rooms and
# missed most of the real ones - "a beefy guard", "s'kra guards", "red and black
# uniformed guards", "a stern-looking clan guard". A determiner plus an
# adjective is the commonest way this corpus introduces a person, so a rule
# keyed on the determiner sitting next to the noun cannot work.
#
# What separates the two senses, measured over all 388 occurrences rather than
# reasoned about: **the verb here is transitive and the noun is not.** "A
# banister guards the edge", "the wall guards a group of buildings", "railings
# guard against falls", "obelisks stand guard over the road" - every verb
# instance is followed by its object or its preposition. The noun is followed by
# a verb, a comma, or a full stop: "guards lounge nearby", "guards, armed and
# armored, stand ready".
#
# Two blocklists, therefore, and they look at where the word is rather than
# only at whether a phrase is in the sentence somewhere.
_GUARD_TAKES_AN_OBJECT = (
    ' the ', ' a ', ' an ', ' against', ' each', ' either', ' its', ' his',
    ' her', ' their', ' this ', ' both', ' over ', ' from ', ' entry',
    ' entrance', ' access', ' one ', ' two ', ' all ',
)
# The compound nouns. A guard tower and a guard house are buildings, and 6
# rooms were being given invented watchmen by them.
_GUARD_COMPOUND = (
    ' tower', ' house', ' rail', ' post', ' shack', ' station', ' room',
    ' barracks',
)
# Phrasings in which something that is not a person does a guard's job. "A
# gnarled scrub oak stands lonely guard off to the side of the road."
_NOT_A_GUARD_BEFORE = (
    'stand guard', 'stands guard', 'standing guard', 'stood guard',
    'lonely guard', 'to guard', 'honor guard', 'honour guard',
)

#: Which presence terms need occurrence-level reading rather than a plain
#: containment check. Kept as a table so the next overloaded word is one entry
#: rather than another branch.
_OCCURRENCE_GUARDED = frozenset({'guard'})


def _guard_is_a_verb(sentence: str, start: int, end: int) -> bool:
    """Is this one occurrence of 'guard' the verb rather than the person?"""
    tail = sentence[end:end + 14]
    if any(tail.startswith(word) for word in _GUARD_COMPOUND):
        return True
    if any(tail.startswith(word) for word in _GUARD_TAKES_AN_OBJECT):
        return True
    head = sentence[max(0, start - 20):end]
    return any(phrase in head for phrase in _NOT_A_GUARD_BEFORE)


def every_occurrence_is_other(term: str, sentence: str, pattern) -> bool:
    """Is every occurrence of this presence term something other than a person?

    Returns False for any term not in `_OCCURRENCE_GUARDED`, so the caller can
    ask about every term without knowing which ones are overloaded.

    `pattern` is handed in rather than built here: `extract._compiled` owns the
    boundary rule - the one that stopped 'wind' matching 'window' - and a second
    matcher built in this file would be free to disagree with it, which is
    exactly the drift the rulings file exists to prevent elsewhere.

    Three states are not needed here and that is deliberate: a term the sentence
    does not contain returns False, because the caller only ever asks about
    terms it has already matched. A True is therefore always a claim about
    occurrences that exist.
    """
    if term not in _OCCURRENCE_GUARDED:
        return False
    spans = [(m.start(), m.end()) for m in pattern.finditer(sentence)]
    if not spans:
        # The caller matched this term, so an empty span list means the pattern
        # handed in is not the one that matched it. Saying "not other" here
        # would silently let the term through; saying "other" would silently
        # drop it. Neither is safe, so this is loud.
        raise ValueError(
            f'{term!r} was reported as matching but the pattern finds no '
            f'occurrence of it in {sentence[:60]!r}; the matcher and the caller '
            f'disagree and a verdict either way would be invented')
    return all(_guard_is_a_verb(sentence, a, b) for a, b in spans)


@dataclass
class PresenceReading:
    """What the description said about people, and how sure that is.

    `state` is one of `STATES` and is never None: "we do not know" has its own
    two names here (`UNSAID`, `UNREAD`) precisely so that it cannot be confused
    with an answer.
    """

    state: str
    kinds: list[str] = field(default_factory=list)
    terms: list[str] = field(default_factory=list)
    #: Set when the description does both - names people *and* says the place
    #: is deserted. The people win, because a named role is a stronger claim
    #: than an adjective, and the conflict is recorded rather than smoothed
    #: over so the audit can report how often it happens.
    conflict: str | None = None

    @property
    def populated(self) -> bool:
        """Does the description claim anybody is habitually here?

        Deliberately false for `UNSAID`. A caller that wants "draw nobody"
        must ask for `SOLITARY` by name.
        """
        return self.state in (THRONGED, FREQUENTED)


def density(lowered: str, detections, elsewhere: tuple[str, ...] = ()) -> PresenceReading:
    """Decide the presence state from a room's lowered description text.

    `detections` is the room's full detection list; only the `presence`
    category is consulted, and it is passed in whole rather than pre-filtered so
    that this function cannot be handed a population somebody else has already
    decided the answer for.

    `elsewhere` is the crowd terms `attributed_elsewhere` already threw out. They
    are not evidence of a crowd here and are not treated as any; they are carried
    so that a room whose only busyness words belonged to somewhere else can say
    so rather than reading as a room that simply never mentioned people.
    """
    if not lowered.strip():
        return PresenceReading(state=UNREAD)

    kept = [d for d in detections if d.category == 'presence']
    away = list(elsewhere)

    kinds, terms = [], []
    for d in kept:
        if d.kind not in kinds:
            kinds.append(d.kind)
        if d.term not in terms:
            terms.append(d.term)

    nobody = [phrase for phrase in _NOBODY if phrase in lowered]

    if kept:
        state = THRONGED if any(k in CROWD_KINDS for k in kinds) else FREQUENTED
        conflict = None
        if nobody:
            conflict = (f'the description names people ({", ".join(terms[:3])}) '
                        f'and also says {nobody[0]!r}')
        return PresenceReading(state=state, kinds=kinds, terms=terms,
                               conflict=conflict)

    if nobody:
        return PresenceReading(state=SOLITARY, terms=list(nobody))

    conflict = None
    if away:
        conflict = (f'the only busyness words here ({", ".join(away)}) are '
                    f'attributed to somewhere else')
    return PresenceReading(state=UNSAID, conflict=conflict)


# ---------------------------------------------------------------------------
# The live half. A contract, not a transport.
# ---------------------------------------------------------------------------

@dataclass
class Occupant:
    """One thing the live game says is standing in the room right now.

    `text` is the game's own noun phrase, kept **verbatim** and never parsed
    into a species, a name or a sprite key here. That is not laziness: the game
    writes "a shaggy mutt", "a Crossing Forging Society Building" and "an iron
    anvil" into the same sentence, and any classifier this module wrote would
    be guessing at exactly the seam where guessing has cost this project most.
    Classification, if it is ever wanted, belongs where there is a live session
    to check it against.

    `kind` is not inferred either - it comes from which stream the text arrived
    on, which the game itself decides:

        pc        <component id='room players'>
        contents  <component id='room objs'>, or the "You also see ..." line
        unknown   anything a caller could not attribute to a stream

    A creature and a hitching post both arrive on the `contents` stream and are
    not distinguishable from it, so `contents` is honest and `npc` would not be.
    """

    text: str
    kind: str = 'unknown'
    source: str | None = None


@dataclass
class Occupancy:
    """Who is in one room at one moment, and when that was true.

    **This never goes into a generated room spec, and the reason is not
    tidiness.** A spec is per-room and static - written once, read on every
    visit, cached, diffed, committed. Occupancy changes by the second. Baking a
    snapshot of it into the spec would produce a file that is wrong the instant
    after it is written and gives no way to tell how wrong: a room drawn with
    yesterday's crowd looks exactly like a room drawn with today's, and the
    first thing anyone would do is trust it.

    So the composition happens at draw time, and it takes two inputs:

        scene      from compose.py, keyed on room id, static, cacheable
        occupancy  this, keyed on room uid, live, with an age on it

    `at` and `stale_after` exist so a renderer can answer the question a
    snapshot cannot: *is this still true?* Past `at + stale_after` a caller must
    treat the occupancy as unknown and say so on screen - which is a third
    state, the same three-state discipline the description half keeps. An
    occupancy that has gone stale is not an empty room.

    `room_uid` is the game's own `<nav rm=...>` number, because that is the only
    identity the live game hands over on arrival; four different rooms in this
    game are called "The Crossing, Magen Road".
    """

    room_uid: int | None
    at: float
    occupants: list[Occupant] = field(default_factory=list)
    #: Seconds after `at` that this stops being an answer. 30 is a starting
    #: figure, not a measurement - nobody has yet timed how fast a DragonRealms
    #: room's population actually turns over, and this comment is here so that
    #: the next person knows the number is unearned rather than assuming it is.
    stale_after: float = 30.0
    #: Which streams this was built from, so a caller can tell "the game said
    #: there were no players" from "nobody asked for the players stream".
    streams: list[str] = field(default_factory=list)

    def fresh_at(self, now: float) -> bool:
        return now - self.at <= self.stale_after

    def to_dict(self) -> dict:
        return {
            'room_uid': self.room_uid,
            'at': self.at,
            'stale_after': self.stale_after,
            'streams': list(self.streams),
            'occupants': [{'text': o.text, 'kind': o.kind, 'source': o.source}
                          for o in self.occupants],
        }


#: The wire shape, written out so that a caller in another language - the Godot
#: lane reads JSON, not Python - can implement it without reading this file.
#: Kept next to the dataclass so the two cannot drift into disagreeing.
OCCUPANCY_SCHEMA = {
    'room_uid': 'int | null    the game\'s <nav rm=...>, null if unknown',
    'at': 'float          unix seconds when this was observed',
    'stale_after': 'float          seconds after `at` that this stops being an answer',
    'streams': 'string[]       which game streams were read',
    'occupants': '[{text, kind, source}]',
}


def split_also_see(line: str) -> list[str]:
    """Split one "You also see ..." list into its items.

    A pure function over a string the caller already has. It opens no socket and
    knows nothing about a session - the transport is another lane's and is
    deliberately not built here.

    The game writes an English list: "a shaggy mutt, the Crossing Forging
    Society Building, an iron anvil and a wooden sign". Commas separate, a
    trailing "and" joins the last two, and either may be absent. An empty or
    whitespace-only line yields an empty list rather than one empty item -
    a filter that empties its input must not look like a filter that found one
    thing.
    """
    text = line.strip()
    for lead in ('You also see ', 'you also see '):
        if text.startswith(lead):
            text = text[len(lead):]
    text = text.rstrip('.').strip()
    if not text:
        return []
    chunks = text.split(',')
    last = len(chunks) - 1
    items: list[str] = []
    for index, chunk in enumerate(chunks):
        chunk = chunk.strip()
        if not chunk:
            continue
        if chunk.lower().startswith('and '):
            chunk = chunk[4:].strip()
            if chunk:
                items.append(chunk)
            continue
        # Only the final chunk can carry the joining "and", and splitting on it
        # anywhere else would cut "a bucket of bread and butter" in half. The
        # index is what establishes "final"; an earlier version compared the
        # chunk to the last one by identity, which is a different question and
        # happened to give the right answer on the sample it was written for.
        at = chunk.lower().rfind(' and ') if index == last else -1
        if at > 0:
            head, tail = chunk[:at].strip(), chunk[at + 5:].strip()
            if head:
                items.append(head)
            if tail:
                items.append(tail)
            continue
        items.append(chunk)
    return items
