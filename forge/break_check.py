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
]


# Both suites run, and their guard names share one namespace. A sabotage in
# the parser can redden a rulings guard and vice versa - that entanglement is
# real and the exact-set assertions below are what make it visible instead of
# letting it hide behind "something went red".
SUITES = ('forge.test_extract', 'forge.test_escalate')


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
        if proc.returncode not in (0, 1):
            red.add(f'{suite} did not run')
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
    if len(SABOTAGE) < 19:
        print('REFUSING TO PASS: fewer sabotages than this file declares')
        return 2
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
