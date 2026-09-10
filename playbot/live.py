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

    <style id="roomName" />[The Crossing, Trothfang Street]
    <preset id='roomDesc'>Due north you see the square...</preset>
    You also see a shaggy mutt, an iron anvil, ...
    Obvious paths: <d>north</d>, <d>east</d>.
    <compass><dir value="n"/><dir value="e"/></compass>
"""

from __future__ import annotations

import re
import socket
import time
from dataclasses import dataclass, field

from .safety import Governor, Refused, vet

_TAG = re.compile(r'<[^>]+>')
_ROOM_NAME = re.compile(r"<style id=\"roomName\"\s*/>\[([^\]]+)\]")
_ROOM_DESC = re.compile(r"<preset id='roomDesc'>(.*?)</preset>", re.S)
_PATHS = re.compile(r'Obvious paths:(.*?)\.', re.S)
_COMPASS_DIR = re.compile(r'<dir value="([a-z]+)"\s*/>')
_ROOM_OBJS = re.compile(r"<component id='room objs'>(.*?)</component>", re.S)

_COMPASS_WORD = {
    'n': 'north', 's': 'south', 'e': 'east', 'w': 'west',
    'ne': 'northeast', 'nw': 'northwest', 'se': 'southeast', 'sw': 'southwest',
    'up': 'up', 'down': 'down', 'out': 'out',
}


def strip_tags(text: str) -> str:
    return re.sub(r'\s+', ' ', _TAG.sub('', text)).strip()


@dataclass
class LiveRoom:
    title: str | None = None
    description: str | None = None
    exits: list[str] = field(default_factory=list)
    objects: str | None = None
    seen_at: float = field(default_factory=time.time)

    @property
    def usable(self) -> bool:
        return bool(self.title and self.description)


class Session:
    """One attached session. Close it when done - a forgotten socket holds a port."""

    def __init__(self, host: str = '127.0.0.1', port: int = 11024,
                 per_minute: int = 20, budget: int = 200) -> None:
        self.sock = socket.create_connection((host, port), timeout=15)
        self.sock.settimeout(2)
        self.governor = Governor(per_minute=per_minute, total=budget)
        self.transcript: list[str] = []
        self.refusals: list[str] = []

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def drain(self, seconds: float = 2.0) -> str:
        """Read whatever the game has to say for a while."""
        buf, start = b'', time.time()
        while time.time() - start < seconds:
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                break
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
        text = buf.decode('utf-8', 'replace')
        if text:
            self.transcript.append(text)
        return text

    def send(self, command: str) -> None:
        """Send, or record the refusal. Never raises past the caller's loop."""
        try:
            safe = vet(command)
            self.governor.check()
        except Refused as why:
            self.refusals.append(f'{command!r}: {why}')
            return
        self.sock.sendall((safe + '\n').encode('utf-8'))

    def look(self, settle: float = 2.5) -> LiveRoom:
        self.send('look')
        time.sleep(1.0)
        return parse_room(self.drain(settle))

    def walk(self, direction: str, settle: float = 2.5) -> LiveRoom:
        self.send(direction)
        time.sleep(1.2)
        return parse_room(self.drain(settle))


def parse_room(raw: str) -> LiveRoom:
    room = LiveRoom()

    name = _ROOM_NAME.search(raw)
    if name:
        room.title = name.group(1).strip()

    desc = _ROOM_DESC.search(raw)
    if desc:
        room.description = strip_tags(desc.group(1))

    # The compass is structured and the prose list is not, so prefer it and
    # fall back only when the game did not send one.
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

    return room
