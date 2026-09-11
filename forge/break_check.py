"""Break each guard on purpose and check the right controls go red.

`test_extract.py` passing tells you the suite ran. It does not tell you the
suite can fail, and a suite that cannot fail is worth exactly as much as one
that was never written. So this damages one guard at a time, in a copy of the
package, and asserts which guards go red - not merely that *something* did.

Asserting *which* matters twice over. A sabotage that reddens fewer guards
than named means the control never reached the line it was aimed at. One that
reddens more means the guards are entangled and the suite is claiming less
independence than it appears to.

Every case also states that the sabotage changed the file at all: an edit that
silently matched nothing would rewrite the source unchanged, the suite would
pass, and the output would read like proof.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent

# (name, file, find, replace, the guards that must go red and no others)
SABOTAGE = [
    ('term boundary loses its closing anchor', 'extract.py',
     "_INFLECTION = r'(?:s|es)?'",
     "_INFLECTION = r'[a-z]*'",
     # Two guards, declared rather than tidied away. 'under the trees' has one
     # end-to-end case that asks read_room() for a whole enclosure, and every
     # enclosure score is counted with these patterns - so gutting the boundary
     # necessarily takes it down too. That is a real dependency and the honest
     # thing is to write it here, where a *change* in the entanglement shows up
     # as a failure, rather than to weaken the check into "something went red".
     {'term boundary', 'under the trees'}),
    ('figurative-water guard always says no', 'extract.py',
     "    head = f'{term} of '",
     "    return False\n    head = f'{term} of '",
     {'figurative water'}),
    ('distance penalty removed', 'extract.py',
     '    net_distance = max(0, distance - immediate)',
     '    net_distance = 0',
     {'scenery at a distance'}),
    ('surface window widened past the sentence', 'extract.py',
     '            lo, hi = _sentence_bounds(lowered, hit.start())',
     '            lo, hi = 0, len(lowered)',
     {'ground near surface'}),
    ('built-floor guard stops guarding', 'extract.py',
     '    return not any(phrase in lowered for phrase in _FLOOR_OF_A_PLACE)',
     '    return True',
     {'built floor'}),
    ('room-wall guard accepts any wall', 'extract.py',
     '    return any(_compiled(phrase).search(lowered) for phrase in _ROOM_WALL)',
     "    return 'wall' in lowered",
     {'room wall'}),
    # The boundary itself. Reverting to containment puts back the bug where
    # 'one wall' is read out of the middle of 'stone walls' - 440 rooms given
    # an interior vote by an accident of spelling.
    ('room-wall matching goes back to containment', 'extract.py',
     '    return any(_compiled(phrase).search(lowered) for phrase in _ROOM_WALL)',
     '    return any(phrase in lowered for phrase in _ROOM_WALL)',
     {'room wall'}),
    ('terrain table emptied', 'lexicon.py',
     "TERRAIN = {\n    'dune': ('dune', 'sand drift'),",
     "TERRAIN = {\n    'unused': ('zzzznotaword',),\n    'dune-was-here': ('sand drift',),",
     {'terrain is a feature'}),
    ('canopy question always answers "overhead"', 'extract.py',
     '    if over == away:',
     '    if False:',
     {'under the trees'}),
    ('canopy question refuses to answer', 'extract.py',
     '    over = any(cue in lowered for cue in _UNDER_THE_TREES)',
     '    return None  # sabotage\n    over = any(cue in lowered for cue in _UNDER_THE_TREES)',
     {'under the trees'}),
    ('other-sense guard blocks everything', 'extract.py',
     '    blocked = sum(text.count(phrase) for phrase in phrases)',
     '    blocked = total',
     {'other sense'}),
    ('tunnel loses its determiner', 'lexicon.py',
     "'the tunnel', 'a tunnel', 'this tunnel', 'of tunnel',",
     "'tunnel',",
     {'tunnel determiner'}),

    # --- the adjudication path ---------------------------------------------
    # The guard that keeps the coverage number honest. If an override stops
    # naming the ruling that made it, a hand-decided room becomes
    # indistinguishable from one the parser read, and every number downstream
    # is quietly wrong while every test still passes.
    ('an override stops naming the ruling that made it', 'extract.py',
     "        reading.sources[field_name] = ruling['id']",
     "        reading.sources[field_name] = 'parsed'",
     {'override provenance'}),
    ('adjudicated always says no', 'extract.py',
     "        return any(src != 'parsed' for src in self.sources.values())",
     '        return False',
     {'override provenance'}),
    # The rulings file stops being validated. Every negative case in the
    # loader depends on this, and nothing else should.
    ('rulings validation is disarmed', 'rulings.py',
     '    if not condition:\n        raise RulingError(message)',
     '    return',
     {'rulings load'}),
    # A removal that matches nothing goes back to being a silent no-op: the
    # ruling would be out of force while the audit reported it as applied.
    ('an absent term is removed silently', 'extract.py',
     '            if term not in terms:\n                raise _rulings.RulingError(',
     '            if False:\n                raise _rulings.RulingError(',
     {'lexicon ruling'}),
    # Author-side silence starts being escalated again, which is how a queue
    # of 1,718 actionable rooms turns back into 6,720 mostly unactionable ones.
    ('author-side silence is escalated again', 'escalate.py',
     '    # Everything left is a room whose only doubt is that the author never said\n'
     '    # what the ground was. Not actionable, and deliberately not queued.\n'
     '    return None',
     "    return 'NO-GROUND', 'the author never said'",
     {'escalation filter'}),
    # The critic guesses when it cannot run. This is the single worst failure
    # available to this package: invented readings that are indistinguishable
    # from measured ones.
    ('the critic guesses when unavailable', 'critic.py',
     "        return Proposal(cluster_key=cluster['key'], state=NOT_ADJUDICATED,\n"
     "                        why=ready.reason, rooms=len(samples))",
     "        return Proposal(cluster_key=cluster['key'], state=DECIDED,\n"
     "                        verdict='outdoor', why=ready.reason, "
     "rooms=len(samples))",
     {'critic honesty'}),
    # 'I could not tell' collapses into 'nothing to report'. Three states
    # folded into two is where the lie enters.
    ('cannot-tell collapses into not-adjudicated', 'critic.py',
     "CANNOT_TELL = 'cannot tell from the text'",
     "CANNOT_TELL = 'not adjudicated'",
     {'critic honesty'}),

    # --- people -------------------------------------------------------------
    # The crowd kind emptied of its determined forms. Declared as measured, and
    # the surprise is worth naming: 'presence trap' goes red too, because four
    # of its cases assert that the *honest* form of a trapped word still fires
    # ("a real crowd is still a crowd"), which is the direction that stops a
    # table with nothing in it from passing the trap suite. 'guard sense' and
    # 'presence conflict' survive, because neither depends on the crowd kind.
    ('crowd kind loses its determined forms', 'lexicon.py',
     "    'crowd': ('a crowd', 'the crowd', 'crowds', 'throng', 'bustle',",
     "    'unused': ('zzzznotaword',),\n    'crowd-was-here': ('throng', 'bustle',",
     {'presence detected', 'presence states', 'presence trap',
      'busy elsewhere', 'live contract'}),
    # The five states collapse to four. This is the defect the whole module was
    # written against: silence about people reported as an empty room.
    ('UNSAID collapses into SOLITARY', 'presence.py',
     "UNSAID = 'unsaid'",
     "UNSAID = 'solitary'",
     {'presence states'}),
    ('UNREAD collapses into UNSAID', 'presence.py',
     "UNREAD = 'unread'",
     "UNREAD = 'unsaid'",
     {'presence states'}),
    # `populated` starts answering yes for silence, which is how a renderer ends
    # up drawing a crowd in a room nobody was described in.
    ('populated says yes for silence', 'presence.py',
     '        return self.state in (THRONGED, FREQUENTED)',
     '        return self.state != UNREAD',
     {'presence states'}),
    # Busyness belonging to somewhere else starts counting as this room's, so
    # "tucked away from the hustle and bustle" becomes the busiest room in town.
    ('busy-elsewhere guard always says no', 'presence.py',
     '    before = sentence[:at]',
     '    return False\n    before = sentence[:at]',
     {'busy elsewhere'}),
    # ...and the same guard the other way, blocking everything. A guard that
    # cannot pass carries exactly as much information as one that cannot fail.
    ('busy-elsewhere guard blocks everything', 'presence.py',
     '    return any(cue in before for cue in _ELSEWHERE)',
     '    return True',
     {'busy elsewhere', 'presence states', 'presence detected',
      'presence trap', 'live contract'}),
    # Word order stops mattering, so "far from the quiet gardens" reads as a
    # denial of the traffic that precedes it.
    ('busy-elsewhere ignores word order', 'presence.py',
     '    before = sentence[:at]',
     '    before = sentence',
     {'busy elsewhere'}),
    # The guard word goes back to being read by containment. 'presence trap' is
    # entangled with this on purpose and it is declared: three of its cases are
    # guard cases ("a banister guards", "a guard tower is a building", "a guard
    # tower with a guard in it"), because the guard word is the trap this table
    # works hardest to avoid and belongs in the trap list as well as its own.
    ('guard is read as a person everywhere', 'presence.py',
     '    if term not in _OCCURRENCE_GUARDED:\n        return False',
     '    return False\n    if term not in _OCCURRENCE_GUARDED:\n        return False',
     {'guard sense', 'presence trap'}),
    ('guard is read as a verb everywhere', 'presence.py',
     '    tail = sentence[end:end + 14]',
     '    return True\n    tail = sentence[end:end + 14]',
     {'guard sense', 'presence trap'}),
    # Read per sentence instead of per occurrence: one verb anywhere in the
    # sentence would then wipe out a person named in the same breath.
    ('guard is read per sentence, not per occurrence', 'presence.py',
     '    return all(_guard_is_a_verb(sentence, a, b) for a, b in spans)',
     '    return any(_guard_is_a_verb(sentence, a, b) for a, b in spans)',
     {'guard sense', 'presence trap'}),
    # A matcher that finds nothing starts inventing a verdict instead of saying
    # the caller and the pattern disagree.
    ('a disagreeing matcher guesses instead of raising', 'presence.py',
     '        raise ValueError(',
     '        return False\n        raise ValueError(',
     {'guard sense'}),
    # The conflict between named people and an emptiness word stops being
    # recorded, so 44 rooms where the text argues with itself look decided.
    ('a self-contradicting description stops saying so', 'presence.py',
     "            conflict = (f'the description names people ({\", \".join(terms[:3])}) '",
     "            conflict = None if True else (f'names people '",
     {'presence conflict'}),
    # The live contract breached the only way it realistically would be: a
    # convenient field on the static spec. Appended at the end of the dataclass,
    # because the first version of this case inserted it after `room_id` and
    # broke the class definition outright - which every suite then failed to
    # import, printing no FAIL line, and `run()` read as "red: nothing". That
    # blind spot in this file was found by this case and is fixed above.
    ('occupancy is baked into the spec', 'compose.py',
     '    varied: list[str] = field(default_factory=list)\n    unplaced: int = 0',
     '    varied: list[str] = field(default_factory=list)\n    unplaced: int = 0\n'
     '    room_uid: int | None = None\n    stale_after: float = 30.0',
     {'live contract'}),
    # The list splitter stops splitting, which would collapse a room's whole
    # contents into one occupant.
    ('the also-see splitter stops splitting', 'presence.py',
     "    chunks = text.split(',')",
     '    chunks = [text]',
     {'also see'}),
    # An empty list yields one empty item: a filter that empties its input
    # looking like a filter that found something.
    ('an empty also-see line yields one blank', 'presence.py',
     '    if not text:\n        return []',
     '    if not text:\n        return [text]',
     {'also see'}),
]


# Both suites run, and their guard names share one namespace. A sabotage in
# the parser can redden a rulings guard and vice versa - that entanglement is
# real and the exact-set assertions below are what make it visible instead of
# letting it hide behind "something went red".
SUITES = ('forge.test_extract', 'forge.test_escalate', 'forge.test_presence')


def run(pkg_parent: pathlib.Path) -> tuple[int, set[str]]:
    """Run both suites in `pkg_parent` and return (worst exit code, red guards)."""
    red = set()
    worst = 0
    for suite in SUITES:
        proc = subprocess.run(
            [sys.executable, '-m', suite],
            cwd=pkg_parent, capture_output=True, text=True,
        )
        worst = max(worst, proc.returncode)
        for line in proc.stdout.splitlines():
            if line.startswith('FAIL  '):
                # "FAIL  <guard padded to 24>  N cases, M failing"
                red.add(line[6:].split('  ')[0].strip())
        # A suite that dies before printing anything reports no red guards,
        # which is indistinguishable from a clean run. Name it instead.
        #
        # The condition used to be `returncode not in (0, 1)`, and that left the
        # commonest crash invisible: an unhandled exception at import time exits
        # **1**, prints no `FAIL` line, and was read as a clean run. Found by a
        # sabotage that moved a field in a dataclass, broke every suite outright,
        # and was reported as "red: nothing" - which looked like the sabotage
        # having no effect rather than the harness having none. The honest
        # question is not which exit code came back, it is whether a non-zero
        # exit named anything, so that is what is asked.
        if proc.returncode != 0 and not any(
                line.startswith('FAIL  ') for line in proc.stdout.splitlines()):
            red.add(f'{suite} died without naming a failure')
    return worst, red


def main() -> int:
    failures = 0

    # The gate that goes first. Every verdict below is a comparison against a
    # clean run, so an unmodified copy that is already red makes the whole
    # exercise unreadable - a collection error satisfies "exit non-zero"
    # exactly as well as a caught sabotage does.
    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        shutil.copytree(HERE, root / 'forge')
        code, red = run(root)
        if code != 0 or red:
            print(f'REFUSING TO CONTINUE: the unmodified suite is not green '
                  f'(exit {code}, red guards {sorted(red) or "none"}). '
                  f'Nothing below would mean anything.')
            return 2
        print('control: unmodified suite is green\n')

    for name, filename, find, replace, expect in SABOTAGE:
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            shutil.copytree(HERE, root / 'forge')
            target = root / 'forge' / filename
            before = target.read_text(encoding='utf-8')

            # A sabotage that changes nothing must abort, never pass. An edit
            # whose anchor has drifted rewrites the file unchanged, the suite
            # stays green, and the line below would read "this guard is not
            # needed" when it means "the test did nothing".
            if find not in before:
                print(f'ABORT  {name}: anchor not found in {filename}, '
                      f'so this case damaged nothing')
                failures += 1
                continue
            after = before.replace(find, replace, 1)
            if after == before:
                print(f'ABORT  {name}: replacement was identical')
                failures += 1
                continue
            target.write_text(after, encoding='utf-8')

            code, red = run(root)
            ok = red == expect
            failures += not ok
            mark = 'ok  ' if ok else 'FAIL'
            print(f'{mark}  {name}')
            print(f'        red: {sorted(red) or "nothing"}')
            if not ok:
                print(f'        expected exactly: {sorted(expect)}')

    print(f'\n{len(SABOTAGE)} sabotages, {failures} not behaving as declared')
    if len(SABOTAGE) < 33:
        print('REFUSING TO PASS: fewer sabotages than this file declares')
        return 2
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
