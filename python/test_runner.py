"""runner.py's catalog - category grouping and ordering.

No running app or task needed: this only exercises the catalog-building
logic (REGISTRY + user_tasks() + the sort), never actually runs a task.

Run:

    python python/test_runner.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from runner import CATEGORY_ORDER, REGISTRY, _category_key, catalog

failed = 0
checked = 0


def ok(label: str, cond: bool, detail: str = "") -> bool:
    global checked, failed
    checked += 1
    print(f"{'OK  ' if cond else 'FAIL'} {label}{f': {detail}' if detail else ''}")
    if not cond:
        failed += 1
    return cond


print("-- every built-in entry declares a real category --")
bad = [tid for tid, entry in REGISTRY.items() if entry[2] not in CATEGORY_ORDER]
ok(
    "no REGISTRY entry uses a category CATEGORY_ORDER doesn't know about",
    bad == [],
    repr(bad),
)

print()
print("-- the catalog is actually grouped, not just labelled --")
entries = catalog()
ok(
    "every entry carries a category key",
    all("category" in e for e in entries),
)
seen_categories: list[str] = []
for e in entries:
    if not seen_categories or seen_categories[-1] != e["category"]:
        seen_categories.append(e["category"])
ok(
    "each category's entries are contiguous - a category never reappears "
    "after a different one starts",
    len(seen_categories) == len(set(seen_categories)),
    repr(seen_categories),
)
ok(
    "the categories that do appear follow CATEGORY_ORDER's relative order",
    seen_categories == sorted(seen_categories, key=CATEGORY_ORDER.index),
    repr(seen_categories),
)

print()
print("-- the first entry matches CATEGORY_ORDER's own first category --")
# Not hardcoded to a specific category name: CATEGORY_ORDER is the thing
# that actually decides this, and asserting a literal category here would
# make the test wrong the next time a new category earns top billing
# (as "Routines" did over "Combat") rather than catching a real regression.
ok(
    "the first catalog entry belongs to CATEGORY_ORDER[0]",
    entries[0]["category"] == CATEGORY_ORDER[0],
    f"{entries[0]['category']!r} vs {CATEGORY_ORDER[0]!r}",
)

print()
print("-- an unknown category sorts after every known one, not scattered in --")
known_max = max(_category_key(c) for c in CATEGORY_ORDER)
ok(
    "a category CATEGORY_ORDER has never heard of sorts strictly after all of them",
    _category_key("Something New") > known_max,
    repr((_category_key("Something New"), known_max)),
)

print()
ok("enough was checked for a pass to mean something", checked >= 6, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
