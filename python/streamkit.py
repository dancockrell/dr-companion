"""Best-effort reading of the raw game markup a `dr_companion.Line` carries.

docs/PYTHON_API.md names the gap this lives in: `Line.text` is the same wire
chunk `game_link.rs` reads before `src/lib/gameStream.ts` turns it into clean,
channel-tagged lines. That parser is a hardened state machine - it survives a
tag split across two socket reads and a literal `<` in game text - and this
module is deliberately *not* a second implementation of it. Porting a state
machine like that untested against the fixtures that found its real bugs
(`tools/stream-test.mjs`, `tools/stream-state-test.mjs`) would risk a second
parser that quietly disagrees with the first, which `docs/ENGINE.md` calls out
as worse than an honest gap.

What this module is instead: regex helpers for the shapes of tag that arrive
whole inside one `Line.text` often enough to be useful in practice - a
`<pushStream id='thoughts'/>...<popStream/>` pair the game happened to emit
between two newlines, a `<progressBar id='health' .../>` on its own line. They
will miss a tag split across a read boundary, same as any regex would; they do
not attempt to track the stream stack across lines the way the real parser
does. Treat every function here as "probably right, occasionally silent",
never as ground truth for anything a script bets the character's life on.

# Example

    from dr_companion import Companion
    import streamkit as sk

    c = Companion()

    @c.on_line
    def watch(line):
        for stream_id, text in sk.tagged_segments(line.text):
            if stream_id == "thoughts":
                print("thought:", sk.strip_tags(text))

        vital = sk.vitals_in(line.text)
        if vital and vital.id == "health" and vital.pct < 40:
            print("health low:", vital.current, "/", vital.max)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterator, Optional

# The channel names DR is known to use, per `src/lib/gameStream.ts`'s own
# docstring. Not exhaustive - the game can push a stream id this list has
# never seen, and `tagged_segments` reports it verbatim rather than dropping
# it, same as the TS parser does.
KNOWN_STREAMS = ("thoughts", "talk", "death", "whispers", "logons", "room", "inv")

_TAG = re.compile(r"<[^<>]{1,256}>")

# A pushStream/popStream pair that both landed inside the same chunk of text.
# Non-greedy so back-to-back streams (`<pushStream id='a'/>x<popStream/><pushStream id='b'/>y<popStream/>`)
# split into two matches rather than one that swallows both.
_PUSH_POP = re.compile(
    r"<pushStream\s+id=(['\"])(?P<id>.*?)\1\s*/>(?P<text>.*?)<popStream\s*/>",
    re.DOTALL,
)

# `<progressBar id='health' value='0' text='health 100/100'/>` - value is
# always 0 in Lich's own dumps, the real numbers are in text. See
# `vitalFromText` in gameStream.ts for why value is never trusted.
_PROGRESS_BAR = re.compile(
    r"<progressBar\s+[^>]*\bid=(['\"])(?P<id>[^'\"]*)\1[^>]*\btext=(['\"])(?P<text>[^'\"]*)\3[^>]*/>"
)
_VITAL_IDS = frozenset({"health", "mana", "spirit", "stamina", "concentration"})

# `<indicator id='IconBLEEDING' visible='y'/>`
_INDICATOR = re.compile(
    r"<indicator\s+[^>]*\bid=(['\"])Icon(?P<id>[^'\"]*)\1[^>]*\bvisible=(['\"])(?P<visible>[^'\"]*)\3[^>]*/>"
)

_NUMS = re.compile(r"-?\d+")


def strip_tags(text: str) -> str:
    """Every `<...>` tag removed, whatever is left joined back together.

    For reading the words a stream carried, not for anything that needs to
    know which tag said what - this throws that away."""
    return _TAG.sub("", text)


def tagged_segments(text: str) -> Iterator[tuple[str, str]]:
    """`(stream_id, inner_text)` for each `pushStream ... popStream` pair
    that opens and closes inside this one string.

    A stream that opens in one `Line` and closes in a later one - the same
    gap `partial`/`stack` exist to survive in the real parser - is invisible
    here. `inner_text` still has its own nested tags in it; run it through
    `strip_tags` if you want plain words."""
    for m in _PUSH_POP.finditer(text):
        yield m.group("id"), m.group("text")


def thoughts_in(text: str) -> list[str]:
    """Convenience over `tagged_segments`: just the thought text, tag-stripped
    and whitespace-trimmed, in order."""
    return [strip_tags(t).strip() for sid, t in tagged_segments(text) if sid == "thoughts"]


@dataclass(frozen=True)
class Vital:
    id: str
    current: int
    max: int

    @property
    def pct(self) -> float:
        """0-100, or 0.0 if `max` is 0 rather than dividing by zero - a
        reported max of 0 is a state to notice, not to crash on."""
        if self.max <= 0:
            return 0.0
        return 100.0 * self.current / self.max


def vitals_in(text: str) -> Optional[Vital]:
    """The first `progressBar` for health/mana/spirit/stamina/concentration
    found in `text`, or `None`. A `Line` normally carries at most one of
    these, so "first" rarely matters - it exists so this has a defined answer
    rather than silently picking one when it does."""
    for v in all_vitals_in(text):
        return v
    return None


def all_vitals_in(text: str) -> list[Vital]:
    """Every recognised vital `progressBar` found in `text`, in order."""
    out: list[Vital] = []
    for m in _PROGRESS_BAR.finditer(text):
        vid = m.group("id").lower()
        if vid not in _VITAL_IDS:
            continue
        nums = _NUMS.findall(m.group("text"))
        if len(nums) < 2:
            continue
        out.append(Vital(id=vid, current=int(nums[0]), max=int(nums[1])))
    return out


def indicators_in(text: str) -> dict[str, bool]:
    """`{"stunned": True, "bleeding": False, ...}` for every `indicator` tag
    found, keyed the same way `gameStream.ts` keys them: the `Icon` prefix
    stripped, lowercased. `visible='y'` becomes `True`, `'n'` becomes
    `False`; anything else (the game does emit a blank `visible=''`
    sometimes - see the TS parser's own note) is left out rather than guessed
    at, so a caller can tell "reported off" from "not reported"."""
    out: dict[str, bool] = {}
    for m in _INDICATOR.finditer(text):
        key = m.group("id").lower()
        visible = m.group("visible")
        if visible == "y":
            out[key] = True
        elif visible == "n":
            out[key] = False
        # anything else: unknown, omitted on purpose
    return out


# Phrases DR itself prints in plain text when you are stunned. Not tags -
# there is no confirmed stun/roundtime tag on the wire this module can point
# to a tested parser for, so this falls back to the same thing Genie scripts
# have always done: match the sentence.
#
# `_STUNNED` is the one line this project has independent confirmation of -
# `src/lib/chatChannels.ts` already matches `you are stunned` to route combat
# text, so this is not a guess invented for this module. There is no equal
# confirmation anywhere in this repo for DragonRealms' exact stun-recovery
# wording, so `is_recovered_line` is a best guess, not a verified fact - see
# its own docstring. Prefer `is_stunned_line` plus a retry timer
# (`scripts/autostand.py` does this) over trusting recovery text alone.
_STUNNED = re.compile(r"\byou are stunned\b", re.IGNORECASE)
_RECOVER = re.compile(r"\byou regain your senses\b", re.IGNORECASE)


def is_stunned_line(text: str) -> bool:
    """True if this line is the game telling you that you are stunned.
    Text-matched, not tag-based - see the module note above `_STUNNED`."""
    return bool(_STUNNED.search(strip_tags(text)))


def is_recovered_line(text: str) -> bool:
    """True if this line looks like DR telling you stun has worn off.

    Unverified against a real game or an existing parser in this repo -
    unlike `is_stunned_line`, nothing here has confirmed DR's exact wording.
    Treat a `False` from this function as "unknown", not "still stunned"."""
    return bool(_RECOVER.search(strip_tags(text)))
