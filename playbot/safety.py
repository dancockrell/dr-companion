"""What the bot is allowed to do, enforced by an allowlist rather than a rule.

This bot plays a real DragonRealms character on a real Simutronics account.
The things that can go wrong are not bugs, they are losses: a death drops
your inventory where you died, a sale cannot be unsold, a given item is
gone, and a bot that hammers the game reads as exactly the thing an account
gets actioned for.

So the safe set is a list, not a judgement. A verb that is not on the list is
refused, which means a new capability has to be added here deliberately and
by a person, rather than emerging from a model deciding it seemed reasonable
at the time. `python -m playbot.safety` prints the list.
"""

from __future__ import annotations

import re
import time

# Verbs that only look. These cannot lose anything.
LOOK = {
    'look', 'l', 'glance', 'read', 'appraise', 'inventory', 'inv', 'i',
    'health', 'exp', 'experience', 'skills', 'info', 'stats', 'wealth',
    'time', 'weather', 'exits', 'compass', 'search', 'listen', 'smell',
    'touch', 'tap', 'peer', 'observe', 'assess', 'perceive',
}

# Movement. Reversible by walking back, but it can carry you somewhere
# dangerous, so where it may go is bounded separately below.
MOVE = {
    'north', 'south', 'east', 'west', 'northeast', 'northwest',
    'southeast', 'southwest', 'up', 'down', 'out', 'in', 'go', 'climb',
    'enter', 'exit',
}

# Posture. Free and reversible.
POSTURE = {'stand', 'sit', 'kneel', 'lie', 'stance'}

ALLOWED = LOOK | MOVE | POSTURE

# Never, whatever a mission says. Each of these can cost something that
# cannot be got back, and the bot has no business with any of them.
FORBIDDEN = {
    'attack', 'kill', 'fire', 'throw', 'cast', 'ambush', 'backstab',
    'sell', 'buy', 'order', 'pay', 'give', 'drop', 'put', 'stow',
    'wear', 'remove', 'wield', 'sheathe', 'get', 'take', 'loot',
    'withdraw', 'deposit', 'exchange', 'tip', 'bribe',
    'quit', 'exit game', 'logout', 'delete', 'suicide',
    'steal', 'pick', 'burgle', 'hide', 'retreat', 'flee',
    'say', 'whisper', 'tell', 'shout', 'yell', 'ooc', 'chat',
}


class Refused(Exception):
    """Raised instead of sending something outside the safe set."""


class Governor:
    """Rate and budget limits, so a loop cannot become a flood.

    A stuck mission that sends a command every few milliseconds is
    indistinguishable from an attack on the game's own servers, and it is the
    bot author's job to make that impossible rather than unlikely.
    """

    def __init__(self, per_minute: int = 20, total: int = 500) -> None:
        self.per_minute = per_minute
        self.total = total
        self.sent = 0
        self._times: list[float] = []

    def check(self) -> None:
        now = time.monotonic()
        self._times = [t for t in self._times if now - t < 60]
        if self.sent >= self.total:
            raise Refused(f'session budget spent: {self.total} commands')
        if len(self._times) >= self.per_minute:
            raise Refused(f'rate limit: {self.per_minute}/minute')
        self._times.append(now)
        self.sent += 1


def vet(command: str) -> str:
    """Return the command if it is safe to send, or raise Refused saying why."""
    text = command.strip().lower()
    if not text:
        raise Refused('empty command')
    if ';' in text or '|' in text or '\n' in text:
        raise Refused('a command may not chain or start a script')

    head = re.split(r'\s+', text)[0]

    for bad in FORBIDDEN:
        if head == bad or text.startswith(bad + ' '):
            raise Refused(f'"{bad}" is on the forbidden list and never runs')

    if head not in ALLOWED:
        raise Refused(f'"{head}" is not on the allowlist; add it deliberately or not at all')

    return text


if __name__ == '__main__':
    print(f'allowed  ({len(ALLOWED)}): ' + ', '.join(sorted(ALLOWED)))
    print()
    print(f'forbidden ({len(FORBIDDEN)}): ' + ', '.join(sorted(FORBIDDEN)))
