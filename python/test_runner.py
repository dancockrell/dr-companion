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
print("-- after_hunting (the bare-function example) is actually in the catalog --")
# example_custom.py documents three ways a player might write a task - a
# Flow instance (morning), a Flow subclass (SmartRecover), and a bare
# function chaining two flows (after_hunting). Only the first two were ever
# wired into REGISTRY; this is the id, not the object, so it needs no
# factory call and no live Companion() - see the next section for why that
# matters here.
ok("example.after_hunting is registered", "example.after_hunting" in REGISTRY)

print()
print("-- _example()'s dispatch, against fakes rather than the real example file --")
# Deliberately not calling the real REGISTRY factories here (e.g.
# REGISTRY["example.morning"][3]()): example_custom.py builds `morning =
# Flow(...)` at import time with no companion, and Task.__init__ constructs
# a real Companion() when none is given - which reads
# %LOCALAPPDATA%/DR Companion Data on this machine and would raise
# ConnectionError on a clean one with no app ever having run. That is a
# property of Flow's default construction, not of what this test is
# actually checking (the isinstance/callable branching inside _example's
# make()), so a `runner` module patched to use fakes exercises the same
# logic without the same dependency.
import types  # noqa: E402
import runner as runner_module  # noqa: E402


class _FakeFlowInstance:
    def run(self) -> None:
        pass


class _FakeFlowSubclass:
    def run(self) -> None:
        pass


def _fake_after_hunting() -> None:
    raise AssertionError("a bare function factory must never be called eagerly")


fake_module = types.SimpleNamespace(
    plain_instance=_FakeFlowInstance(),
    subclass=_FakeFlowSubclass,
    bare_fn=_fake_after_hunting,
)

# `importlib.import_module` checks `sys.modules` before ever touching the
# filesystem, so registering the fake there - rather than patching
# `import_module` itself, which would affect every other import happening
# anywhere in this process for as long as the patch is live - is what makes
# `_example()`'s own `importlib.import_module("tasks.example_custom")`
# resolve to the fake without touching Python's import machinery at all.
real_module = sys.modules.get("tasks.example_custom")
sys.modules["tasks.example_custom"] = fake_module
try:
    ok(
        "a class is instantiated",
        isinstance(runner_module._example("subclass")(), _FakeFlowSubclass),
    )
    ok(
        "an already-built instance is returned as-is, not re-wrapped",
        runner_module._example("plain_instance")() is fake_module.plain_instance,
    )
    wrapped = runner_module._example("bare_fn")()
    ok(
        "a bare function is wrapped rather than called immediately",
        isinstance(wrapped, runner_module._RunFn),
    )
    raised = False
    try:
        wrapped.run()
    except AssertionError:
        raised = True
    ok(
        "...and calling .run() on the wrapper is what finally calls it",
        raised,
    )
finally:
    if real_module is None:
        sys.modules.pop("tasks.example_custom", None)
    else:
        sys.modules["tasks.example_custom"] = real_module

print()
ok("enough was checked for a pass to mean something", checked >= 6, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
