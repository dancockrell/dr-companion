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
print("-- containment: a bad script cannot take the app with it --")
# A task is a separate process (see pythonTasks.ts's header: "Stop kills a
# process; there is no half-stopped state"), so containment is not something
# this file can assert by catching an exception. It has to run the real
# runner as a real child and look at what came back.
#
# Three ways a player's script goes wrong, and the point is that the three
# are reported *differently*. A runner that returned "it failed" for all of
# them would pass a check that only asked whether each one failed, and the
# app would have nothing to tell the player.
#
# USER_DIR is redirected at the child rather than writing fixtures into
# python/tasks/user, which holds shipped examples and, on a real machine, a
# player's own scripts. A test that leaves a file called "raises" in
# somebody's task list has broken containment in the other direction.
import subprocess  # noqa: E402
import tempfile  # noqa: E402
import textwrap  # noqa: E402

PY_DIR = Path(__file__).resolve().parent

FIXTURES = {
    "drc_fixture_good": '''"""A task that behaves."""


def main():
    print("fixture: finished")
''',
    "drc_fixture_raises": '''"""A task that raises."""


def main():
    raise RuntimeError("containment fixture raised on purpose")
''',
    "drc_fixture_exits": '''"""A task that exits non-zero without raising."""

import sys


def main():
    sys.stdout.write("fixture: exiting 3\\n")
    sys.stdout.flush()
    raise SystemExit(3)
''',
    "drc_fixture_loops": '''"""A task that never finishes."""

import sys
import time


def main():
    sys.stdout.write("fixture: looping\\n")
    sys.stdout.flush()
    while True:
        time.sleep(0.05)
''',
}

# Runs the real runner.main in a child, with USER_DIR pointed at the fixtures.
DRIVER = textwrap.dedent(
    """
    import pathlib
    import sys

    sys.path.insert(0, sys.argv[1])
    import runner

    runner.USER_DIR = pathlib.Path(sys.argv[2])
    raise SystemExit(runner.main(["run", sys.argv[3]]))
    """
)

LOOP_TIMEOUT_S = 5

with tempfile.TemporaryDirectory(prefix="drc-containment-") as tmp:
    tmp_dir = Path(tmp)
    for stem, source in FIXTURES.items():
        (tmp_dir / f"{stem}.py").write_text(source, encoding="utf-8")

    def run_fixture(stem: str, timeout: float = 60.0) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-c", DRIVER, str(PY_DIR), str(tmp_dir), f"user.{stem}"],
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    # The denominator. If the driver is broken - a bad path, an import error,
    # a runner that cannot see the fixture directory at all - every check
    # below "passes" by failing for the wrong reason. This is the one that
    # goes to zero when the harness breaks, so it runs first.
    good = run_fixture("drc_fixture_good")
    ok(
        "the harness can run a well-behaved task through the real runner",
        good.returncode == 0 and "fixture: finished" in good.stdout,
        f"exit {good.returncode}, stdout {good.stdout.strip()!r}, stderr {good.stderr.strip()[-200:]!r}",
    )

    raised = run_fixture("drc_fixture_raises")
    ok(
        "a task that raises is reported as a failure naming the exception",
        raised.returncode != 0
        and "RuntimeError" in raised.stderr
        and "containment fixture raised on purpose" in raised.stderr,
        f"exit {raised.returncode}, stderr tail {raised.stderr.strip()[-160:]!r}",
    )

    exited = run_fixture("drc_fixture_exits")
    ok(
        "a task that exits non-zero is reported with its own exit code, not a traceback",
        exited.returncode == 3 and "Traceback" not in exited.stderr,
        f"exit {exited.returncode}, stderr {exited.stderr.strip()[-160:]!r}",
    )

    looped_timed_out = False
    looped_started = False
    try:
        run_fixture("drc_fixture_loops", timeout=LOOP_TIMEOUT_S)
    except subprocess.TimeoutExpired as expired:
        looped_timed_out = True
        # Partial output, so a timeout that means "the child never started"
        # cannot be read as "the task looped". Without this the check would
        # pass just as happily against a fixture that crashed on import and
        # a driver that hung on its own.
        partial = expired.stdout or b""
        if isinstance(partial, bytes):
            partial = partial.decode("utf-8", "replace")
        looped_started = "fixture: looping" in partial
    ok(
        "a task that loops forever is stopped by the caller's timeout",
        looped_timed_out,
        f"timeout was {LOOP_TIMEOUT_S}s",
    )
    ok(
        "...and it really was looping, not failing to start",
        looped_started,
    )

    unknown = subprocess.run(
        [sys.executable, "-c", DRIVER, str(PY_DIR), str(tmp_dir), "user.no_such_task"],
        capture_output=True,
        text=True,
        timeout=60,
    )
    ok(
        "an unknown task id is its own reported state, not one of the three above",
        unknown.returncode == 2 and "No task called" in unknown.stderr,
        f"exit {unknown.returncode}",
    )

    # The property the increment is actually about: the app can tell these
    # apart. Four outcomes, four distinct reported states.
    reported = {
        "good": good.returncode,
        "raises": raised.returncode,
        "exits": exited.returncode,
        "unknown": unknown.returncode,
    }
    ok(
        "the four outcomes are reported distinctly rather than as one 'it failed'",
        len(set(reported.values())) == 4,
        repr(reported),
    )

    # And this process is still here, having watched all four. The assertion
    # is on reported state because the runner is out-of-process; this is the
    # part that says the out-of-process claim held.
    after = run_fixture("drc_fixture_good")
    ok(
        "this process is unaffected: a good task still runs after all four",
        after.returncode == 0 and "fixture: finished" in after.stdout,
        f"exit {after.returncode}",
    )

print()
ok("enough was checked for a pass to mean something", checked >= 6, f"{checked} assertions")

print()
print("all passed" if failed == 0 else f"{failed} failed")
raise SystemExit(0 if failed == 0 else 1)
