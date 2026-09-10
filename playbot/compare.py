"""Two walks, side by side, so a cycle can say what it changed.

A cycle that reports what it found is reporting half of it. The point of
walking the same world twice is the difference: which complaint classes the
forge's improvements actually retired, which survived them, and which are new
because the bot learned to look for them. Without this the two runs are two
lists and somebody has to diff them by eye, which is how a class quietly stops
being reported and nobody notices.

Three outcomes, kept apart on purpose, because folding any of them into
another is where the lie enters:

  gone      filed before, not filed now
  stayed    filed in both, with both counts, since a class can survive while
            getting much better or much worse and "stayed" alone hides that
  new       filed now and not before

**A class that is gone is not necessarily fixed.** It can also be a class the
second walk never gave itself the chance to see - different rooms, a shorter
run, a check that stopped being called. So `gone` is printed as a question
rather than as a result, and the coverage line above it is what tells you
which reading is available.

    python -m playbot.compare out/live-patrol.jsonl out/live-cycle2.jsonl
"""

from __future__ import annotations

import json
import pathlib
import sys


def load(path: str) -> dict[tuple[str, str], tuple[int, str]]:
    rows: dict[tuple[str, str], tuple[int, str]] = {}
    for line in pathlib.Path(path).read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        key = (record['subject'], record['summary'])
        rows[key] = (int(record.get('count', 1)), record['severity'])
    return rows


def main(argv: list[str] | None = None) -> int:
    argv = list(argv if argv is not None else sys.argv[1:])
    if len(argv) != 2:
        print(__doc__)
        return 2
    before, after = load(argv[0]), load(argv[1])

    # A comparison of two files that share no class at all is almost always a
    # mistake - the wrong pair of files, or a run that filed nothing - and it
    # would otherwise print as "everything fixed, everything new", which is
    # the most flattering possible reading of a broken input.
    if before and after and not (set(before) & set(after)):
        print('THESE TWO RUNS SHARE NO COMPLAINT CLASS AT ALL.')
        print('That is far more likely to be the wrong pair of files than a')
        print('world that changed completely. Nothing below is trustworthy.')
        return 2

    gone = sorted(set(before) - set(after))
    stayed = sorted(set(before) & set(after))
    new = sorted(set(after) - set(before))

    print(f'before: {len(before)} classes, {sum(c for c, _ in before.values()):,} complaints')
    print(f'after:  {len(after)} classes, {sum(c for c, _ in after.values()):,} complaints')

    print(f'\nGONE ({len(gone)}) - filed before, not filed now. Fixed, or never')
    print('reached by the second walk; the coverage numbers say which.')
    for subject, summary in gone:
        count, severity = before[(subject, summary)]
        print(f'  [{severity:<8}] {subject:<6} was x{count:<5} {summary}')

    print(f'\nSTAYED ({len(stayed)}) - filed by both, with both counts.')
    for subject, summary in stayed:
        was, severity = before[(subject, summary)]
        now, _ = after[(subject, summary)]
        arrow = '->' if was != now else '=='
        print(f'  [{severity:<8}] {subject:<6} x{was} {arrow} x{now}  {summary}')

    print(f'\nNEW ({len(new)}) - filed now and not before. A new defect, or a')
    print('check that did not exist last time; the commit says which.')
    for subject, summary in new:
        count, severity = after[(subject, summary)]
        print(f'  [{severity:<8}] {subject:<6} x{count:<5} {summary}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
