"""Play the actual game, and compare what it shows against what we built.

This is the half that could not be done offline. It attaches to Lich's
detachable client, walks the character through real rooms, and for each one
asks the question the whole project turns on: *the game just described this
place - does the scene we generated for it look like the same place?*

It never sends anything that is not on `playbot.safety`'s allowlist, and the
governor caps both the rate and the total, because this is a real account on
a real server and a loop that forgets to stop is indistinguishable from an
attack on it.

What it reads off the wire, all confirmed against a live session rather than
assumed from a document:

    <nav rm='10031'/>
    <style id="roomName" />[The Crossing, Trothfang Street]
    <preset id='roomDesc'>Due north you see the square...</preset>
    <component id='room objs'>You also see a shaggy mutt, an iron anvil...
    You also see a shaggy mutt, an iron anvil, ...
    Obvious paths: <d>north</d>, <d>east</d>.
    <compass><dir value="n"/><dir value="e"/></compass>
    <progressBar id='health' value='0' text='health 100/'/>
    <prompt time="1789050068">&gt;</prompt>

Three of those were not being read before this file was rewritten, and each
was costing something:

* ``<nav rm=...>`` is the room's real identity, handed over on every arrival.
  Without it the bot keyed everything on the room's *title*, and four
  different rooms are called "The Crossing, Magen Road".
* ``<prompt>`` is the end of the answer. Without it every command waited out
  a fixed settle window - 2.5 seconds whether the game replied in 200ms or
  not at all - so the bot was four times slower than the game and could not
  say how long anything took. Reading to the prompt is what turns "it felt
  slow" into a number.
* On a *move* the compass arrives empty and the room's parts arrive as
  ``<component id='room ...'>``; on a *look* it is the other way round. A
  parser that knows only one shape silently loses half of what it is told.
"""

from __future__ import annotations

import re
import socket
import time
from dataclasses import dataclass, field

from .safety import Governor, Refused, vet

_TAG = re.compile(r'<[^>]+>')
_NAV = re.compile(r"<nav\s+rm=['\"](\d+)['\"]")
_ROOM_NAME = re.compile(r"<style id=\"roomName\"\s*/>\[([^\]]+)\]")
_ROOM_DESC = re.compile(r"<preset id='roomDesc'>(.*?)</preset>", re.S)
_ROOM_DESC_COMPONENT = re.compile(r"<component id='room desc'>(.*?)</component>", re.S)
# The game says "Obvious paths:" outdoors and "Obvious exits:" indoors. A
# parser that knows only the first reads every interior as a room with no way
# out, which is how a walk ends up parked in a smithy reporting that it has
# explored the whole town.
_PATHS = re.compile(r'Obvious (?:paths|exits):(.*?)\.', re.S)
_COMPASS_DIR = re.compile(r'<dir value=[\'"]([a-z]+)[\'"]\s*/>')
_ROOM_OBJS = re.compile(r"<component id='room objs'>(.*?)</component>", re.S)
_ALSO_SEE = re.compile(r'You also see (.*?)(?:\r?\n|$)', re.S)
_ROOM_PLAYERS = re.compile(r"<component id='room players'>(.*?)</component>", re.S)
_PROMPT = re.compile(r'<prompt[ >]')
_VITAL = re.compile(r"<progressBar id='(health|mana|stamina|spirit|encumlevel|mindState)'"
                    r"[^>]*text='([^']*)'")
_INDICATOR = re.compile(r"<indicator id='Icon([A-Z]+)' visible='(y|n|)'\s*/>")

_COMPASS_WORD = {
    'n': 'north', 's': 'south', 'e': 'east', 'w': 'west',
    'ne': 'northeast', 'nw': 'northwest', 'se': 'southeast', 'sw': 'southwest',
    'up': 'up', 'down': 'down', 'out': 'out',
}

# The game's own refusals. Kept as plain substrings with nothing to escape,
# because the last regex written into this project through a shell arrived
# with its word boundary collapsed into a backspace byte and matched nothing
# for an hour while looking fine. Containment has nothing to get wrong.
BLOCKED_PHRASES = (
    "you can't go there",
    'you cannot go there',
    "that's not a direction",
    'you are unable to go',
    'there is nothing to go',
    'what were you referring to',
    'i could not find what you were referring to',
    'you might want to stand up first',
    'the gate is closed',
    'the door is closed',
    'you must first open',
)

# Not a refusal, a delay: the game accepted it and is making you wait.
ROUNDTIME_PHRASES = ('...wait', 'please wait', 'roundtime')


def strip_tags(text: str) -> str:
    return re.sub(r'\s+', ' ', _TAG.sub('', text)).strip()


@dataclass
class Turn:
    """One command and everything that came back from it.

    The latency is the number this class exists for. Everything else about a
    command can be inferred later from the transcript; how long the player
    waited cannot be, and it is the complaint a real player files first.
    """

    command: str
    raw: str = ''
    latency: float | None = None      # seconds to the prompt, None if none came
    sent: bool = False
    refusal: str | None = None

    @property
    def silent(self) -> bool:
        """The game answered and said nothing a player could read.

        Tags stripped first, on purpose: a reply of nothing but `<prompt/>`
        is exactly the case worth complaining about, and testing `raw.strip()`
        called it output because there were bytes in it.
        """
        return self.sent and not strip_tags(self.raw)

    @property
    def blocked(self) -> str | None:
        low = self.raw.lower()
        for phrase in BLOCKED_PHRASES:
            if phrase in low:
                return phrase
        return None


@dataclass
class LiveRoom:
    uid: int | None = None
    # How the uid was come by: 'nav' straight off the wire, 'carried' from the
    # last arrival because this reply was a look and a look never carries one,
    # None if unknown. Kept separate from the uid itself so a caller can tell
    # an exact identity from a justified inference - the two are different
    # claims and only one of them survives a move.
    uid_source: str | None = None
    title: str | None = None
    description: str | None = None
    exits: list[str] = field(default_factory=list)
    objects: str | None = None
    players: str | None = None
    vitals: dict[str, str] = field(default_factory=dict)
    indicators: dict[str, bool] = field(default_factory=dict)
    seen_at: float = field(default_factory=time.time)

    @property
    def usable(self) -> bool:
        return bool(self.title and self.description)

    @property
    def health(self) -> int | None:
        """Percent, out of the game's own `health 100/100` text."""
        text = self.vitals.get('health')
        if not text:
            return None
        found = re.search(r'(\d+)\s*/', text)
        return int(found.group(1)) if found else None


class Session:
    """One attached session. Close it when done - a forgotten socket holds a port."""

    def __init__(self, host: str = '127.0.0.1', port: int = 11024,
                 per_minute: int = 20, budget: int = 200) -> None:
        self.sock = socket.create_connection((host, port), timeout=15)
        self.sock.settimeout(0.25)
        self.governor = Governor(per_minute=per_minute, total=budget)
        self.transcript: list[str] = []
        self.refusals: list[str] = []
        self.turns: list[Turn] = []
        # Carried forward because the game does not repeat itself: a move
        # sends vitals, a look may not, and a room block may arrive with no
        # `<nav>` when nothing changed.
        self.vitals: dict[str, str] = {}
        self.indicators: dict[str, bool] = {}
        self.last_uid: int | None = None

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    # -- reading ---------------------------------------------------------

    def drain(self, seconds: float = 1.0) -> str:
        """Read whatever the game has to say for a while, and stop early if it stops."""
        buf, start = b'', time.time()
        while time.time() - start < seconds:
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
        text = buf.decode('utf-8', 'replace')
        if text:
            self.transcript.append(text)
        return text

    def _read_to_prompt(self, timeout: float, grace: float = 0.3) -> tuple[str, float | None]:
        """Read until the game's prompt says it has finished answering.

        Returns the text and the time the prompt took to arrive. A `None`
        latency means no prompt came inside the timeout, which is a complaint
        rather than an error - the caller decides what to do about it.
        """
        buf, start, latency = b'', time.time(), None
        while time.time() - start < timeout:
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
            if latency is None and _PROMPT.search(buf.decode('utf-8', 'replace')):
                latency = time.time() - start
                # A short grace read: the vitals block trails the prompt.
                deadline = time.time() + grace
                while time.time() < deadline:
                    try:
                        more = self.sock.recv(65536)
                    except socket.timeout:
                        continue
                    except OSError:
                        break
                    if not more:
                        break
                    buf += more
                break
        text = buf.decode('utf-8', 'replace')
        if text:
            self.transcript.append(text)
        return text, latency

    # -- sending ---------------------------------------------------------

    def send(self, command: str) -> Turn:
        """Send, or record the refusal. Never raises past the caller's loop."""
        turn = Turn(command=command)
        try:
            safe = vet(command)
            self.governor.check()
        except Refused as why:
            turn.refusal = str(why)
            self.refusals.append(f'{command!r}: {why}')
            self.turns.append(turn)
            return turn
        self.sock.sendall((safe + '\n').encode('utf-8'))
        turn.sent = True
        self.turns.append(turn)
        return turn

    def flush(self) -> str:
        """Throw away anything already waiting, so the next read is an answer.

        Without this the latency is a lie: a prompt still sitting in the
        socket from the last command is read instantly, and every command
        reports a round trip of nought seconds to a server that is a hundred
        milliseconds away at best. The first version of this measured a median
        of 0.00s and the number looked like a triumph.
        """
        junk = b''
        while True:
            try:
                chunk = self.sock.recv(65536)
            except (socket.timeout, OSError):
                break
            if not chunk:
                break
            junk += chunk
        text = junk.decode('utf-8', 'replace')
        if text:
            self.transcript.append(text)
        return text

    def ask(self, command: str, timeout: float = 8.0) -> Turn:
        """Send one command and read exactly as long as the answer takes."""
        self.flush()
        turn = self.send(command)
        if not turn.sent:
            return turn
        turn.raw, turn.latency = self._read_to_prompt(timeout)
        return turn

    def look(self, timeout: float = 8.0) -> tuple[LiveRoom, Turn]:
        turn = self.ask('look', timeout)
        return self.absorb(turn.raw, moved=False), turn

    def walk(self, movement: str, timeout: float = 12.0) -> tuple[LiveRoom, Turn]:
        turn = self.ask(movement, timeout)
        return self.absorb(turn.raw, moved=True), turn

    def absorb(self, raw: str, moved: bool = True) -> LiveRoom:
        """Parse a room and keep the session-level state the game sends once.

        ``moved`` says whether the command that produced this text could have
        changed which room the character is standing in, and it decides what an
        absent ``<nav>`` means. Measured on the wire rather than assumed, five
        commands in a row:

            look   nav=None   name="Wedding Chapel, Bride's Chamber"
            north  nav=755062 name='Wedding Chapel, Foyer'
            look   nav=None   name='Wedding Chapel, Foyer'
            south  nav=755064 name="Wedding Chapel, Bride's Chamber"
            look   nav=None   name="Wedding Chapel, Bride's Chamber"

        **The game sends the room's identity on arrival and never on a look.**
        So a look with no nav is not the game withholding anything; the
        character has not moved and the uid is the one it already gave us. The
        previous walk filed nine of those against the *game* - "the game sent
        no room uid" - when the bot had asked with the one verb that never
        carries one, and then identified those rooms by prose or not at all.

        A *move* with no nav is the opposite case and stays unknown: the
        character may well be somewhere else, and carrying the old uid forward
        there would assert a position rather than read one. That is the error
        worth being careful about, because everything downstream - the route,
        the safe-area bound - trusts this number.
        """
        room = parse_room(raw)
        if room.vitals:
            self.vitals.update(room.vitals)
        if room.indicators:
            self.indicators.update(room.indicators)
        room.vitals = dict(self.vitals)
        room.indicators = dict(self.indicators)
        if room.uid is not None:
            self.last_uid = room.uid
            room.uid_source = 'nav'
        elif not moved:
            room.uid = self.last_uid
            room.uid_source = 'carried' if self.last_uid is not None else None
        else:
            self.last_uid = None
        return room


def parse_room(raw: str) -> LiveRoom:
    room = LiveRoom()

    nav = _NAV.search(raw)
    if nav:
        room.uid = int(nav.group(1))

    name = _ROOM_NAME.search(raw)
    if name:
        room.title = name.group(1).strip()

    # A look sends `<preset id='roomDesc'>`; a move sends
    # `<component id='room desc'>`. Both are the same prose and a parser that
    # knows one shape reads half the game.
    desc = _ROOM_DESC.search(raw) or _ROOM_DESC_COMPONENT.search(raw)
    if desc:
        room.description = strip_tags(desc.group(1))

    # The compass is structured and the prose list is not, so prefer it - but
    # only when it has anything in it. On a move the game sends
    # `<compass></compass>`, and treating that as "no exits" is what makes a
    # bot stand still in a room with four doors.
    dirs = _COMPASS_DIR.findall(raw)
    if dirs:
        room.exits = [_COMPASS_WORD.get(d, d) for d in dirs]
    else:
        paths = _PATHS.search(raw)
        if paths:
            room.exits = [w for w in re.findall(r'[a-z]+', strip_tags(paths.group(1)).lower())
                          if w in _COMPASS_WORD.values()]

    objs = _ROOM_OBJS.search(raw)
    if objs:
        room.objects = strip_tags(objs.group(1))
    else:
        also = _ALSO_SEE.search(raw)
        if also:
            room.objects = strip_tags(also.group(1))

    players = _ROOM_PLAYERS.search(raw)
    if players:
        room.players = strip_tags(players.group(1))

    for vital, text in _VITAL.findall(raw):
        room.vitals[vital] = text
    for indicator, visible in _INDICATOR.findall(raw):
        room.indicators[indicator] = visible == 'y'

    return room
