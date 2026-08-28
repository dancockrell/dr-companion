"""A base for DragonRealms tasks written in Python.

`dr_companion.py` is the transport - it connects, authenticates, and hands you
raw lines. This is the layer above it, and it exists because of a gap that
module documents honestly:

    Line.text is the raw tagged wire text, not clean lines.
    <pushStream id='thoughts'/>...<popStream/> and <d cmd='east'>east</d>
    arrive as-is.

Every task would otherwise re-solve that, and they would solve it slightly
differently, which is how two parsers end up disagreeing with each other
instead of with the game. So it is solved once, here.

# What this adds over the raw client

    clean text        tags stripped, entities decoded
    stream labels     which channel a line came from, from the game's own tag
    vitals            health/mana/stamina/spirit/concentration, kept current
    roundtime         when the game will next accept a command
    paced sending     commands wait for roundtime instead of being swallowed

# The safety rule this file exists to enforce

**A task cannot send commands faster than MAX_COMMANDS_PER_MINUTE.**

This is not politeness. A loop with a bug - a condition that never goes false,
a step that retries on a message it misreads - will otherwise send hundreds of
commands a minute to a live account on a live server, which is indistinguishable
from scripted abuse from Simutronics' side and is the player's account at risk,
not the script's. The cap is enforced in `do()` and cannot be turned off by a
task; a task that hits it is stopped and told why, because a task that silently
throttles is a task whose author never learns their loop is broken.

# Parsing notes, each grounded rather than guessed

Vitals are read from a progressBar's `text`, never its `value`. Lich hardcodes
`value='0'` on the bars it synthesises and puts the real numbers in the text
(`<progressBar id='health' value='0' text='health 100/100'/>`), and its own
parser reads it the same way - xmlparser.rb:709, `attributes['text'].scan(...)`.
A reader taking `value` shows zero health on a healthy character and nothing
errors.

Roundtime arrives as `<roundTime value='<epoch>'/>` - an absolute second, not a
duration (xmlparser.rb:766). It is compared against the local clock, which
assumes the two agree to within a second or so; they do in practice, and a
task that treats a stale roundtime as expired simply sends a moment early and
the game refuses it, which is recoverable. The reverse - inventing a duration -
would not be.

# Use

    from drtask import Task

    class Watch(Task):
        def on_clean(self, line):
            if 'you are stunned' in line.text.lower():
                self.do('stand')

    Watch().run()
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Optional

from dr_companion import Companion, Line


class RateLimited(RuntimeError):
    """A task tried to send faster than the cap. See MAX_COMMANDS_PER_MINUTE."""


#: Comfortably above human play, far below anything that looks automated.
#: A person typing hard manages perhaps 30; DragonRealms roundtimes mean most
#: real play is well under 20.
MAX_COMMANDS_PER_MINUTE = 40

_TAG = re.compile(r"<[^>]*>")
_ENTITIES = {"&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'"}

_STREAM_OPEN = re.compile(r"<pushStream\s+id=['\"]([^'\"]+)['\"]\s*/?>")
_PROGRESS = re.compile(
    r"<progressBar\s+[^>]*id=['\"]([^'\"]+)['\"][^>]*text=['\"]([^'\"]*)['\"]"
)
_ROUNDTIME = re.compile(r"<roundTime\s+value=['\"](\d+)['\"]")

#: The five DragonRealms vitals. Deliberately a fixed set: an unknown
#: progressBar id is not a vital, and storing it as one would put a number on a
#: panel that nobody parsed. Concentration is here because a Bard spends it -
#: it was missing from the app's own stream parser until it was checked
#: against the bridge's field list.
VITAL_IDS = ("health", "mana", "stamina", "spirit", "concentration")


def unescape(text: str) -> str:
    """Decode entities once. `&amp;lt;` must stay `&lt;`, so `&amp;` is last."""
    for entity, ch in _ENTITIES.items():
        if entity != "&amp;":
            text = text.replace(entity, ch)
    return text.replace("&amp;", "&")


def strip_tags(text: str) -> str:
    """Markup out, the text it wrapped kept.

    `<d cmd='east'>east</d>` becomes `east` - the tag is presentation, the word
    is what the player read. Dropping the content instead would silently lose
    exits, item names and half of every room description.

    Loops the regex to a fixed point rather than one `sub()` pass - the
    TypeScript mirror of this function (`typescript/drtask.ts`) hit a CodeQL
    finding on the single-pass version: removing one match can splice two
    surviving fragments into a new `<...>` span the regex never re-scans for.
    Looping until a pass changes nothing closes that regardless of the
    specific input shape, rather than patching the one construction found.
    Terminates in at most `len(text)` iterations - each pass only removes
    characters or leaves the string unchanged, never adds any.
    """
    current = text
    while True:
        nxt = _TAG.sub("", current)
        if nxt == current:
            return unescape(current)
        current = nxt


@dataclass
class Vital:
    current: int
    max: int
    #: False when the game has not reported this vital yet. A vital that has
    #: never arrived is not a vital at zero, and the difference decides whether
    #: a task acts.
    known: bool = True

    @property
    def percent(self) -> float:
        """Percent full, or NaN when the vital is unknown.

        NaN rather than 0.0, and this is the important line in the file.

        An unknown vital returning 0.0 reads as "nearly dead" to every
        condition anybody will write - `health.percent < 50` fires, the task
        runs to a healer, and the character was never hurt. Caught on the
        first real run: a fixture that sends no health bar made a branching
        flow decide the character needed treatment.

        NaN compares false against everything, in both directions, so
        `< 50` and `> 50` are both false while the answer is unknown. A task
        therefore does nothing on a vital it has never seen, which is the only
        safe default - acting on a number nobody reported is worse than not
        acting.

        A task that genuinely wants to know can ask `known`.
        """
        if not self.known or self.max <= 0:
            return float("nan")
        return 100.0 * self.current / self.max


@dataclass
class CleanLine:
    """One line, parsed. `raw` is kept so nothing this layer failed to
    understand is lost - a task can always fall back to it."""

    seq: int
    text: str
    stream: str
    raw: str


@dataclass
class _Rate:
    sent: list[float] = field(default_factory=list)

    def record(self, now: float) -> int:
        self.sent = [t for t in self.sent if now - t < 60.0]
        self.sent.append(now)
        return len(self.sent)


class Task:
    """Subclass this and override the hooks you want.

    Nothing here sends a command on its own. A task that wants to act calls
    `do()`, which is the single place a command reaches the game and the single
    place the rate cap is enforced.
    """

    def __init__(self, companion: Optional[Companion] = None) -> None:
        self.c = companion or Companion()
        self.vitals: dict[str, Vital] = {}
        #: Absolute epoch second the current roundtime ends, or 0.
        self.roundtime_until: float = 0.0
        self._rate = _Rate()
        self._stopping = False

    # -- hooks ---------------------------------------------------------

    def on_clean(self, line: CleanLine) -> None:
        """A line of game text, tags stripped. Override this."""

    def on_vitals(self, vitals: dict[str, Vital]) -> None:
        """Called when any vital changes."""

    def on_start(self) -> None:
        """Called once, after connecting, before any line arrives."""

    # -- actions -------------------------------------------------------

    def do(self, command: str, *, wait_rt: bool = True) -> None:
        """Send a command, respecting roundtime and the rate cap.

        `wait_rt=False` is for the handful of commands DragonRealms accepts
        during roundtime - `look`, `health`, `exp` and the like. Using it for
        anything that acts wastes the command: the game refuses it and the
        task, having sent it, believes it happened.
        """
        if wait_rt:
            self.wait_rt()

        count = self._rate.record(time.time())
        if count > MAX_COMMANDS_PER_MINUTE:
            self.stop()
            raise RateLimited(
                f"{count} commands in the last minute, cap is "
                f"{MAX_COMMANDS_PER_MINUTE}. The task has been stopped.\n"
                "This is almost always a loop that never sees its own exit "
                "condition - check what the task is waiting for, rather than "
                "raising the cap."
            )
        self.c.send(command)

    def walk_to(self, destination: "str | int") -> None:
        """Walk to a Lich room id (or one of go2's own named targets, e.g.
        "bank") by starting Lich's own ;go2, the same script the map panel's
        click-to-travel uses (companion_bridge.lic's map_walk intent).

        Not a reimplementation of movement - go2 already knows how to
        retreat out of combat, work a locked door, use a day pass, take the
        Ta'Vaalor shortcut, and a dozen other DragonRealms-specific cases a
        plain sequence of `self.do(direction)` calls would get wrong. Sent
        once, through the same rate cap and roundtime wait as any other
        command; go2 itself paces the actual walking.

        The command prefix is hardcoded to `;`, not looked up. Lich's own
        choice between `;` and `,` (`$clean_lich_char`) depends on which
        game frontend it thinks it's serving, and this app's launch only
        ever resolves to `stormfront`/`profanity`, never `genie` - see
        docs/LIVE-STATE.md and issue #31. The comma branch cannot be reached
        by any task this app starts, so there's nothing to detect.
        """
        self.do(f";go2 {destination}", wait_rt=False)

    def wait_rt(self, extra: float = 0.2) -> None:
        """Block until the current roundtime has passed."""
        while True:
            remaining = self.roundtime_until - time.time()
            if remaining <= 0:
                return
            time.sleep(min(remaining + extra, 1.0))

    def stop(self) -> None:
        self._stopping = True
        self.c.stop()

    # -- plumbing ------------------------------------------------------

    def _feed(self, line: Line) -> None:
        raw = line.text

        rt = _ROUNDTIME.search(raw)
        if rt:
            self.roundtime_until = float(rt.group(1))

        changed = False
        for vid, text in _PROGRESS.findall(raw):
            key = vid.lower()
            if key not in VITAL_IDS:
                continue
            nums = re.findall(r"-?\d+", text)
            if len(nums) < 2:
                # One number is not a vital with an unknown maximum, it is a
                # shape this does not understand. Inventing a max would put a
                # plausible bar on screen built from nothing.
                continue
            self.vitals[key] = Vital(int(nums[0]), int(nums[1]))
            changed = True
        if changed:
            self.on_vitals(self.vitals)

        stream = ""
        m = _STREAM_OPEN.search(raw)
        if m:
            stream = m.group(1)

        text = strip_tags(raw).strip()
        if text:
            self.on_clean(CleanLine(seq=line.seq, text=text, stream=stream, raw=raw))

    def run(self) -> None:
        self.c.connect()
        self.c.on_line(self._feed)
        self.on_start()
        self.c.run()
