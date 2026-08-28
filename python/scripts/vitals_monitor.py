"""Watch health/mana/stamina/spirit as the game reports them, and act before
you would have noticed yourself.

Genie's health-bar is read-only: a player watches four numbers and decides
what to do. This keeps the same four numbers - parsed from the same
`progressBar` tags the game already sends, via `streamkit.all_vitals_in`, so
it is reading what the client is fed rather than guessing from prose - and
adds the one thing a human eyeball cannot do reliably at 2am: cross a
threshold and *do something about it*, every time, with a cooldown so a
health bar sitting at 38% does not force-start a healer script every second.

`--on-critical-script` is the "wire together lich commands" case made
concrete: name a Lich script (your own, or one from dr-scripts) and this
force-starts it - `;force <name>` via `lich.py` - the moment the named vital
drops at or below `--threshold`, then leaves it alone for `--cooldown`
seconds so the script gets a chance to actually run before being restarted on
top of itself.

    python python/scripts/vitals_monitor.py
    python python/scripts/vitals_monitor.py --vital health --threshold 40 \\
        --on-critical-script heal-me --cooldown 90
"""

from __future__ import annotations

import _common  # noqa: F401

import argparse
import time

import streamkit as sk
from dr_companion import Companion, Line
from lich import Lich


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--vital",
        default="health",
        choices=["health", "mana", "spirit", "stamina", "concentration"],
        help="which vital triggers --on-critical-script (default health)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=50.0,
        help="percent at or below which the vital is 'critical' (default 50)",
    )
    parser.add_argument(
        "--on-critical-script",
        default="",
        help="Lich script name to force-start when --vital crosses --threshold",
    )
    parser.add_argument(
        "--cooldown",
        type=float,
        default=60.0,
        help="seconds to wait before force-starting --on-critical-script again (default 60)",
    )
    parser.add_argument(
        "--quiet", action="store_true", help="only print on a threshold crossing, not every update"
    )
    args = parser.parse_args()

    last: dict[str, sk.Vital] = {}
    last_trigger = -1e9

    c = Companion()
    lich = Lich(c)

    @c.on_line
    def watch(line: Line) -> None:
        nonlocal last_trigger
        for vital in sk.all_vitals_in(line.text):
            previous = last.get(vital.id)
            last[vital.id] = vital
            crossed_down = (
                previous is not None and previous.pct > args.threshold >= vital.pct
            )
            if not args.quiet or crossed_down:
                print(f"vitals: {vital.id} {vital.current}/{vital.max} ({vital.pct:.0f}%)")

            if vital.id != args.vital or vital.pct > args.threshold:
                continue
            if not args.on_critical_script:
                continue
            now = time.monotonic()
            if now - last_trigger < args.cooldown:
                continue
            last_trigger = now
            print(f"vitals: {vital.id} at {vital.pct:.0f}% - force-starting '{args.on_critical_script}'")
            lich.force_start(args.on_critical_script)

    print(f"vitals_monitor: watching - attached: {c.status()}")
    c.run()


if __name__ == "__main__":
    main()
