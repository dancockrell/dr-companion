"""Break the bot on purpose and check the right cases notice.

`selftest` proves each check fires on a case it should catch. That is not the
same as proving the check is wired to the code it is about: a case can pass
because some *other* line happens to produce the same answer, and it goes on
passing after the line it was written for is deleted.

So each sabotage below names the cases it expects to go red, and this refuses
to call a sabotage caught unless exactly those cases fail. A sabotage that
reds more than expected matters as much as one that reds fewer - it means two
checks are entangled and the suite says less than it appears to.

Two guards, because both failure modes have bitten this project:

* **The patched tree must pass unmodified first.** A copy that does not even
  import fails every case, and "every expected case went red" is satisfied by
  a tree that no longer runs at all. That gate runs before any sabotage.
* **A sabotage that changes no bytes is an abort, not a pass.** If a fragment
  drifts out of the source, the file is rewritten identically, the suite
  passes, and the output reads "not needed" when it means "did nothing".

    python -m playbot.breakcheck
"""

from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent

# (name, file, find, replace, the case names that must go red and no others)
SABOTAGES = [
    (
        'a look no longer carries the uid forward',
        'playbot/live.py', 'elif not moved:', 'elif False:',
        {'a look after a move keeps the uid the move gave',
         'a carried uid is labelled as carried'},
    ),
    (
        'a move with no nav keeps the old uid instead of clearing it',
        'playbot/live.py',
        '        else:\n            self.last_uid = None',
        '        else:\n            pass',
        # Only the third. The first two stay green under this sabotage and
        # that is correct: `room.uid` on a move is left alone by the `elif not
        # moved` gate whatever `last_uid` does, so those two cases are about
        # the gate and never touched this line. Expecting them here was my
        # error, and the harness is what found it - which is the argument for
        # naming the cases rather than counting them.
        {'a look after an unidentified move does not resurrect a stale uid'},
    ),
    (
        'the retreat picks the first exit the game offered, as it used to',
        'playbot/patrol.py', 'return None, back',
        "return None, next((d for d in room.exits if d in COMPASS), 'north')",
        # The two `out` cases stay green, correctly: with no invertible last
        # move `_retreat` returns before ever reaching this line, so nothing
        # done to it can change them.
        {'an unmapped room is left by undoing the last move',
         'the retreat is not simply the first exit the game offered'},
    ),
    (
        'the run-length threshold is raised past anything a walk produces',
        'playbot/patrol.py', 'if len(run) >= SAME_RUN:', 'if len(run) >= 999:',
        {'a run of identical rooms is complained about'},
    ),
    (
        'the sameness ratio never fires',
        'playbot/patrol.py', 'if share < 0.5:', 'if share < 0.0:',
        {'a walk with few distinct pictures is called thin'},
    ),
    (
        'an occupied room no longer counts as occupied',
        'playbot/patrol.py', "if room.players and 'also here' in room.players.lower():",
        'if False:',
        {'a room with someone in it and an empty scene is complained about'},
    ),
    (
        'the safe area is emptied',
        'playbot/world.py', "'The Crossing',", "'The Crossing NOT',",
        # Just the two exploration cases. Everything else about identity -
        # uid lookup, titles, the room records themselves - is untouched by
        # the safe-area list, which bounds `moves()` and nothing more. That is
        # worth having pinned: it says the safety boundary is not quietly
        # load-bearing for the rest of the bot.
        {'frontier exploration covers more ground than a random walk',
         'frontier exploration reaches at least 100 distinct rooms in 150 moves'},
    ),
]


def failures(tree: pathlib.Path) -> tuple[set[str], int, str]:
    """Run the suite in `tree` and return the case names that failed."""
    # No bytecode cache, and this is not tidiness. A `.pyc` is keyed on the
    # source's (mtime, size), and one of the sabotages below swaps `0.5` for
    # `0.0` - the same number of bytes. Restore that file inside the same
    # mtime tick and Python considers its cached bytecode current, so the
    # *next* sabotage runs the previous one's code. It happened: the sameness
    # check reported red under a sabotage of the safe-area list, which cannot
    # touch it, and the false entanglement was this cache rather than the
    # suite. Suspect the instrument before the target.
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    result = subprocess.run(
        [sys.executable, '-m', 'playbot.selftest'],
        cwd=tree, capture_output=True, text=True, timeout=600, env=env,
    )
    out = result.stdout + result.stderr
    names = set()
    for line in out.splitlines():
        found = re.match(r'\s*FAIL (.+?)(?::|$)', line)
        if found:
            names.add(found.group(1).strip())
    return names, result.returncode, out


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        tree = pathlib.Path(tmp) / 'tree'
        tree.mkdir()
        for package in ('playbot', 'forge'):
            shutil.copytree(REPO / package, tree / package,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))

        # Gate. Without this, "the expected cases went red" is satisfied by a
        # copy that does not import, and every sabotage below reads as caught.
        clean, code, out = failures(tree)
        if clean or code != 0:
            print('THE UNMODIFIED COPY DOES NOT PASS. Nothing below means anything.')
            print(out[-2000:])
            return 2
        print(f'unmodified copy passes in {tree}\n')

        originals = {path: (tree / path).read_text(encoding='utf-8')
                     for _, path, _, _, _ in SABOTAGES}
        bad = 0

        for name, path, find, replace, expected in SABOTAGES:
            target = tree / path
            source = originals[path]
            damaged = source.replace(find, replace)
            if damaged == source:
                print(f'ABORT  {name}\n'
                      f'       the fragment {find!r} is not in {path} any more, so this\n'
                      f'       sabotage changed nothing. That is a broken test, not a pass.')
                return 2
            target.write_text(damaged, encoding='utf-8')
            try:
                red, _, _ = failures(tree)
            finally:
                target.write_text(source, encoding='utf-8')
                restored = target.read_text(encoding='utf-8')
                if restored != source:
                    print(f'ABORT  could not restore {path}')
                    return 2

            missing, extra = expected - red, red - expected
            if not missing and not extra:
                print(f'caught {name}\n'
                      f'       {len(red)} cases went red, exactly the ones named')
                continue
            bad += 1
            print(f'WRONG  {name}')
            if missing:
                print(f'       expected red and stayed green: {sorted(missing)}')
            if extra:
                print(f'       went red unexpectedly: {sorted(extra)}')

        print()
        print(f'{len(SABOTAGES)} sabotages, {bad} did not red exactly what they should')
        return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
