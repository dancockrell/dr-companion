"""streamkit.py against fixed strings - no running app needed, unlike
test_dr_companion.py. These are regex helpers over plain text, so there is no
excuse for that test needing a live socket the way the transport tests do.

Run with:

    python python/test_streamkit.py
"""

from __future__ import annotations

import sys

import streamkit as sk


def _ok(label: str, cond: bool, detail: str = "") -> bool:
    print(f"{'OK  ' if cond else 'FAIL'} {label:<50}{detail}")
    return cond


def main() -> int:
    failed = 0

    failed += not _ok("strip_tags removes tags", sk.strip_tags("<a>hi</a> there") == "hi there")
    failed += not _ok(
        "strip_tags leaves a literal '<' with no matching '>' alone",
        sk.strip_tags("watch out <NO ENTRY") == "watch out <NO ENTRY",
    )

    thought = "<pushStream id='thoughts'/>You hear Wipsy think: hello<popStream/>"
    segs = list(sk.tagged_segments(thought))
    failed += not _ok("tagged_segments finds one pair", len(segs) == 1, str(segs))
    failed += not _ok("tagged_segments id is 'thoughts'", segs and segs[0][0] == "thoughts")
    failed += not _ok(
        "thoughts_in extracts the text", sk.thoughts_in(thought) == ["You hear Wipsy think: hello"]
    )

    two = (
        "<pushStream id='talk'/>hi<popStream/> and "
        "<pushStream id='death'/>Bob has died.<popStream/>"
    )
    segs2 = list(sk.tagged_segments(two))
    failed += not _ok("tagged_segments finds two non-overlapping pairs", len(segs2) == 2, str(segs2))
    failed += not _ok("second pair id is 'death'", segs2[1][0] == "death" if len(segs2) == 2 else False)

    bar = "<progressBar id='health' value='0' text='health 87/100'/>"
    v = sk.vitals_in(bar)
    failed += not _ok("vitals_in parses id/current/max", v is not None and (v.id, v.current, v.max) == ("health", 87, 100))
    failed += not _ok("Vital.pct computes percent", v is not None and abs(v.pct - 87.0) < 1e-9)

    zero_max = sk.Vital(id="health", current=0, max=0)
    failed += not _ok("Vital.pct does not divide by zero", zero_max.pct == 0.0)

    unknown_bar = "<progressBar id='encumbrance' value='0' text='encumbrance 10/100'/>"
    failed += not _ok("vitals_in ignores non-vital progressBar ids", sk.vitals_in(unknown_bar) is None)

    two_bars = (
        "<progressBar id='health' value='0' text='health 50/100'/>"
        "<progressBar id='mana' value='0' text='mana 20/40'/>"
    )
    all_v = sk.all_vitals_in(two_bars)
    failed += not _ok("all_vitals_in finds both", [x.id for x in all_v] == ["health", "mana"], str(all_v))

    indicators = "<indicator id='IconBLEEDING' visible='y'/><indicator id='IconSTUNNED' visible='n'/>"
    ind = sk.indicators_in(indicators)
    failed += not _ok("indicators_in strips the Icon prefix and lowercases", ind == {"bleeding": True, "stunned": False}, str(ind))

    blank_visible = "<indicator id='IconPOISONED' visible=''/>"
    failed += not _ok(
        "indicators_in omits an indicator with blank visible rather than guessing",
        sk.indicators_in(blank_visible) == {},
    )

    failed += not _ok("is_stunned_line matches", sk.is_stunned_line("You are stunned for 3 rounds!"))
    failed += not _ok("is_stunned_line is case-insensitive", sk.is_stunned_line("YOU ARE STUNNED."))
    failed += not _ok("is_stunned_line does not match unrelated text", not sk.is_stunned_line("You stand up."))

    if failed:
        print(f"\n{failed} check(s) FAILED")
        return 1
    print("\nall checks OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
