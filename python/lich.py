"""A small, honest wrapper over Lich's own `;` command language.

`dr_companion.py` gives a script one primitive: `send(command)`, a string on
the wire with no interpretation - see docs/PYTHON_API.md's "What this API
deliberately does not do". That is the right primitive for the transport, but
"wire together lich commands" (the actual ask this module exists to answer)
means a script author should not have to remember that starting a script that
is already running needs `;force` (`script.rb:138`, "already running ... use
;force" - referenced from `src/components/shared/CommandPalette.tsx`), or that
Genie users type `,` where everyone else types `;` (`lich-scripts/README.md`).

This module does not parse Lich's replies. Lich does not tag its own output
with a stream the way the game does - `;list` prints a plain-text table - so
turning that back into structured data would be exactly the kind of guess
`docs/ENGINE.md` warns against building untested. What this gives a script is
the other half: *correct commands going out*, spelled once, in one place,
instead of every script re-typing `;force ` and hoping it matches what Lich
actually expects.

# Example

    from dr_companion import Companion
    from lich import Lich

    c = Companion()
    lich = Lich(c)

    lich.start("autostow")          # ";autostow"
    lich.start("autostow", "42")    # ";autostow 42"
    lich.force_start("autostow")    # ";force autostow" - restart if already running
    lich.pause("autostow")          # ";pause autostow"
    lich.resume("autostow")         # ";unpause autostow"
    lich.stop("autostow")           # ";kill autostow"
    lich.stop_all()                 # ";kill all"
    lich.list_running()             # ";list"
    lich.vars_list()                # ";vars list"
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from dr_companion import Companion


_NAME_FORBIDDEN = (" ", "\t", "\n", "\r", ";", ",")


def _check_script_name(name: str) -> str:
    """Lich script names are filenames underneath, not free text.

    Rejecting whitespace and the two command prefixes here, before the string
    ever reaches `send()`, turns "my script silently did nothing" into an
    exception pointing at the actual mistake - a name copy-pasted with a
    leading `;`, or built from an f-string that picked up a stray argument.
    """
    name = name.strip()
    if not name:
        raise ValueError("script name is empty")
    if any(ch in name for ch in _NAME_FORBIDDEN):
        raise ValueError(
            f"{name!r} does not look like a bare script name - "
            "no spaces, commas or semicolons. Pass arguments separately."
        )
    return name


class Lich:
    """Issues Lich's own `;`-prefixed commands over a `Companion`.

    Genie users type these with a leading `,` instead - pass `prefix=","` if
    this script is meant to run through a Genie-fronted Lich. Every other
    frontend, this app included, uses `;`.
    """

    def __init__(self, companion: "Companion", prefix: str = ";") -> None:
        if prefix not in (";", ","):
            raise ValueError(f"Lich only recognises ';' or ',' as a command prefix, not {prefix!r}")
        self._c = companion
        self._prefix = prefix

    def _cmd(self, rest: str) -> None:
        self._c.send(f"{self._prefix}{rest}")

    # -- running scripts --------------------------------------------------

    def start(self, name: str, *args: str) -> None:
        """`;name arg1 arg2 ...` - refused by Lich if `name` is already
        running. Use `force_start` when a restart is what you want."""
        name = _check_script_name(name)
        rest = " ".join((name, *args)) if args else name
        self._cmd(rest)

    def force_start(self, name: str, *args: str) -> None:
        """`;force name arg1 arg2 ...` - starts `name` even if a copy is
        already running. This is the answer to "already running ... use
        ;force", not a guess: that message is Lich's own, from `script.rb`."""
        name = _check_script_name(name)
        rest = " ".join(("force", name, *args))
        self._cmd(rest)

    def stop(self, name: str) -> None:
        """`;kill name`."""
        self._cmd(f"kill {_check_script_name(name)}")

    def stop_all(self) -> None:
        """`;kill all` - every running script, this bridge/API connection
        included if it happens to be one. Lich's own blunt instrument;
        there is no "kill all except me" in the command language."""
        self._cmd("kill all")

    def pause(self, name: str) -> None:
        """`;pause name`."""
        self._cmd(f"pause {_check_script_name(name)}")

    def resume(self, name: str) -> None:
        """`;unpause name` - Lich's own verb, not `resume`. Named `resume`
        here to match `pause` and read like an antonym; the method sends
        what Lich actually listens for."""
        self._cmd(f"unpause {_check_script_name(name)}")

    def list_running(self) -> None:
        """`;list` - Lich prints running scripts as plain text on the game
        stream, same as it would to any other frontend. Read it back the way
        any other line is read: through `Companion.on_line`, matching on
        whatever Lich's own formatting turns out to be. This method does not
        parse the reply - see the module docstring for why."""
        self._cmd("list")

    # -- variables ----------------------------------------------------------

    def vars_list(self) -> None:
        """`;vars list` - the same list `VarsPanel.tsx` reads through the
        bridge, requested here through the command language instead. Answer
        arrives as ordinary lines, unparsed, same caveat as `list_running`."""
        self._cmd("vars list")

    def vars_set(self, key: str, value: str) -> None:
        """`;vars set key value`."""
        key = key.strip()
        if not key or any(ch in key for ch in _NAME_FORBIDDEN):
            raise ValueError(f"{key!r} does not look like a bare variable name")
        self._cmd(f"vars set {key} {value}")

    def vars_delete(self, key: str) -> None:
        """`;vars delete key`."""
        key = key.strip()
        if not key or any(ch in key for ch in _NAME_FORBIDDEN):
            raise ValueError(f"{key!r} does not look like a bare variable name")
        self._cmd(f"vars delete {key}")

    # -- raw escape hatch -----------------------------------------------

    def raw(self, rest: str) -> None:
        """Anything this module has not named yet. `rest` is appended to the
        prefix exactly as given - `lich.raw("send hello")` sends `;send
        hello`. Prefer a named method where one exists; this is for the
        command language moving faster than this module."""
        self._cmd(rest)
