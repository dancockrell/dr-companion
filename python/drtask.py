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

import json
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from dr_companion import Companion, Line, app_data_dir


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


@dataclass
class SightTopic:
    """The last answer to one rotation question, and when it arrived."""

    text: str
    at: float


class SightPicture:
    """A rotating set of cheap, read-only commands, sent only during downtime.

    This is the answer to "can we push commands for information without
    impacting the ability to send combat or movement": every command this
    sends goes through `Task.do(..., wait_rt=False)`, the same escape hatch
    `walk_to` and a step's own `until`-wait already rely on for commands
    DragonRealms accepts *during* roundtime. It never calls `wait_rt()`
    itself, so it can never be the reason a real action was late - the worst
    it can do is spend a slice of the rate cap that a real action would
    otherwise have used, which is why it is capped at half of that budget
    (see `maybe_refresh`) rather than left to compete for all of it.

    A task opts in with `self.enable_sight_picture()` (see `Task`), which
    starts a dedicated background thread ticking this once a second. That
    thread is what lets it use the downtime *inside* a step's own wait - a
    `until=r"Bank|teller"` wait on a long walk, or the seconds a `wait_rt()`
    call is blocked before a real attack - not just the gaps between steps.

    Storage is one topic's-worth of text per topic, overwritten in place, not
    a growing log: this is a snapshot of "what do we currently know", not a
    history, and its on-disk form (`save`/`load`) is capped at a few hundred
    bytes per topic for the same reason a room description does not need to
    be kept forever to be useful right now.
    """

    #: Commands DragonRealms accepts during roundtime and that drtask.py's own
    #: `do()` docstring already names as the reason `wait_rt=False` exists.
    #: `look` and `exp` are asked for by name in issue-tracking here; `perc`
    #: (perception) rounds the set out to "where am I, what's nearby, how hurt
    #: am I, how am I progressing" - the four questions a player glances at
    #: between fights. Kept short on purpose: a longer rotation makes each
    #: topic staler between refreshes for no benefit the app currently reads.
    TOPICS: tuple[str, ...] = ("health", "exp", "look", "perc")

    #: Response text is collected for this long after the command is sent,
    #: then whatever arrived is kept as the answer. Long enough for a normal
    #: multi-line room description or exp listing to land; short enough that
    #: a slow or garbled reply does not hold the rotation open.
    COLLECT_SECONDS = 3.0

    #: The file this snapshot is saved to and loaded from - beside the script
    #: API's own token/port files, which is where `dr_companion.py` already
    #: knows to look, so nothing new has to be taught where "the app's data"
    #: lives.
    STORE_NAME = "sight-picture.json"

    def __init__(self, interval: float = 20.0) -> None:
        self.interval = interval
        self.snapshot: dict[str, SightTopic] = {}
        self._last_sent = 0.0
        self._rotation_index = 0
        self._collecting: Optional[str] = None
        self._buffer: list[str] = []
        self._collect_until = 0.0

    def maybe_refresh(self, task: "Task") -> None:
        """Called about once a second. Sends at most one command, and only
        when it is genuinely free: nothing is already in flight, the
        interval has elapsed, and the rate cap has headroom to spare."""
        now = time.time()
        if self._collecting is not None and now >= self._collect_until:
            self._flush()
        if self._collecting is not None or now - self._last_sent < self.interval:
            return
        # Half the cap, not all of it. `_rate.sent` is the same 60-second
        # window `do()` itself enforces; reading it without recording into it
        # is why this check can happen every tick with no side effect of its
        # own. A real action always sees at least half the cap free, however
        # aggressively this rotates.
        with task._send_lock:
            recent = len(task._rate.sent)
        if recent >= MAX_COMMANDS_PER_MINUTE // 2:
            return

        topic = self.TOPICS[self._rotation_index % len(self.TOPICS)]
        self._rotation_index += 1
        self._last_sent = now
        self._collecting = topic
        self._buffer = []
        self._collect_until = now + self.COLLECT_SECONDS
        task.do(topic, wait_rt=False)

    def capture(self, text: str) -> None:
        """Every clean line, offered by `Task._feed`. Kept only while a
        rotation answer is being collected; otherwise a no-op cheap enough to
        call on every line the game sends."""
        if self._collecting is not None:
            self._buffer.append(text)

    def _flush(self) -> None:
        if self._collecting is not None and self._buffer:
            # Capped rather than trusting the game to be brief - a room with a
            # long description or a crowd of items should not turn one topic
            # into the biggest thing in the snapshot.
            text = " ".join(self._buffer).strip()[:400]
            if text:
                self.snapshot[self._collecting] = SightTopic(text=text, at=time.time())
        self._collecting = None
        self._buffer = []

    def as_dict(self) -> dict[str, dict[str, object]]:
        """The snapshot, with ages rather than timestamps - a consumer wants
        "how stale is this," not the clock time it arrived."""
        now = time.time()
        return {
            topic: {"text": t.text, "age_seconds": round(now - t.at, 1)}
            for topic, t in self.snapshot.items()
        }

    def save(self, path: Optional[Path] = None) -> Path:
        """Overwrite the store with the current snapshot. One small file,
        not an appended log - see the class docstring."""
        target = path or (app_data_dir() / self.STORE_NAME)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.as_dict(), indent=2), encoding="utf-8")
        return target

    @classmethod
    def load(cls, path: Optional[Path] = None) -> dict[str, dict[str, object]]:
        """Read what a (possibly different, possibly already-stopped) task
        last saved. A consumer that only wants to know what is known - not to
        run a task itself - never needs a `SightPicture` instance for this."""
        target = path or (app_data_dir() / cls.STORE_NAME)
        try:
            return json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}


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
        #: Guards `_rate` and the underlying socket write together, so a
        #: background sight-picture tick and the main thread's own `do()`
        #: calls cannot interleave on either. Held only around the rate check
        #: and the send itself - never around `wait_rt()`'s sleep, which is
        #: deliberately the one place a background tick is *supposed* to be
        #: able to slip a command in. See `do()`.
        self._send_lock = threading.Lock()
        self.sight_picture: Optional[SightPicture] = None
        self._sight_thread: Optional[threading.Thread] = None

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

        # Locked around the rate check and the send together, not around
        # `wait_rt()` above - a background sight-picture tick is meant to be
        # able to use exactly the seconds this call spends blocked there.
        # Without the lock, that tick and this call could both read `_rate`
        # before either recorded into it, or interleave two writes on the
        # same socket - see `Companion.send`'s own note that it is not
        # thread-safe.
        with self._send_lock:
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

    def enable_sight_picture(self, interval: float = 20.0) -> SightPicture:
        """Opt in to background, downtime-only info gathering.

        Starts a daemon thread ticking roughly once a second, calling
        `SightPicture.maybe_refresh` - which is what actually decides whether
        anything is sent, and never touches `wait_rt()`. Call this from
        `on_start()`; it is a no-op to call more than once (the existing
        picture is returned unchanged), since restarting the rotation on
        every reconnect would throw away whatever was already known for no
        reason.

        Returns the `SightPicture` so a task can read `.snapshot` /
        `.as_dict()` itself, e.g. to decide "have I looked around recently"
        without spending a command to find out.
        """
        if self.sight_picture is not None:
            return self.sight_picture
        self.sight_picture = SightPicture(interval)

        def _tick() -> None:
            while not self._stopping:
                try:
                    self.sight_picture.maybe_refresh(self)
                except RateLimited:
                    # The rate cap is shared with real actions on purpose -
                    # see `maybe_refresh`'s own headroom check, which should
                    # make this unreachable in practice. If it ever isn't,
                    # the task has already been stopped by `do()`; this
                    # thread's job is done either way.
                    return
                time.sleep(1.0)

        self._sight_thread = threading.Thread(target=_tick, daemon=True)
        self._sight_thread.start()
        return self.sight_picture

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
            # Offered before `on_clean`, not after: a subclass's own
            # `on_clean` (Flow's included) may stop the task or otherwise act
            # on this line, and the sight picture's collection window should
            # see every line that arrived regardless of what the task does
            # with it afterward.
            if self.sight_picture is not None:
                self.sight_picture.capture(text)
            self.on_clean(CleanLine(seq=line.seq, text=text, stream=stream, raw=raw))

    def run(self) -> None:
        self.c.connect()
        self.c.on_line(self._feed)
        self.on_start()
        self.c.run()
