"""The catalog of runnable tasks, and the one way to run one.

    python python/runner.py --list          what can be run, as JSON
    python python/runner.py run flow.hunt   run one

# Why this exists rather than the app running a file

A file is not a unit of work. `tasks/flows.py` holds seven flows and does
nothing on its own; `tasks/example_custom.py` holds three. An app that offered
one button per *file* would offer a button that prints a usage message, and
would hide six of the seven flows behind it.

So the addressable thing is a task id - `flow.hunt`, `task.watch` - and this
module is the single place that maps ids to callables. The app reads this
catalog and so does a person at a prompt, which means the list in the UI cannot
drift from what is actually runnable: there is nothing to keep in sync.

# Adding your own

Save a `.py` file in `tasks/user/`. That is the whole procedure - it is
discovered, so there is no line to add here and no restart. The id is
`user.<filename>`, the first line of the docstring becomes the summary the app
shows, and a `main()` is called if there is one.

Discovery re-reads the folder every time it is asked, and a player's file is
loaded by path rather than by module name, so a script edited and saved runs in
its new form on the next press. A cached module would keep running whatever was
on disk when the app started, which is the worst possible bug in an editor.

`REGISTRY` below is for what ships with the app.
"""

from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _flow(name: str):
    """A flow from tasks.flows, imported late.

    Late so that `--list` works on a machine where something in a task module
    is broken: the catalog is the thing the app needs in order to *say* what is
    broken, so it must not itself depend on every task importing cleanly.
    """

    def make():
        return importlib.import_module("tasks.flows").FLOWS[name]()

    return make


def _watch():
    return importlib.import_module("tasks.watch").Watch()


def _routine():
    return importlib.import_module("tasks.routine").Routine()


class _RunFn:
    """Wraps a bare function so it satisfies the one contract every factory
    below returns: something with a `.run()` to call. `after_hunting()` in
    example_custom.py - "two flows, one after the other" - is exactly this
    shape, and it could not be registered as-is: the old normalisation below
    called a callable immediately to decide what it was, which for a plain
    function *runs the whole thing* (two real Flow.run() calls, blocking, a
    real socket) right there in the catalog-building step, then hands
    `.run()` a `None` to call. This defers the call to the one place a task
    is actually supposed to start.
    """

    def __init__(self, fn) -> None:
        self._fn = fn

    def run(self) -> None:
        self._fn()


def _example(attr: str):
    def make():
        mod = importlib.import_module("tasks.example_custom")
        thing = getattr(mod, attr)
        # Three shapes, because all three appear in that file on purpose -
        # they are the three ways a player might reasonably write one:
        #   a class (SmartRecover)     - instantiate it
        #   a bare function (after_hunting) - defer calling it to run()
        #   anything else (morning, a plain Flow instance) - already runnable
        # `isinstance(thing, type)` is checked first and specifically,
        # because a class is also `callable` - a callable-only test (the old
        # code) cannot tell a class from a bare function, and calling a bare
        # function here rather than deferring it is the bug this replaced.
        if isinstance(thing, type):
            return thing()
        if callable(thing) and not hasattr(thing, "run"):
            return _RunFn(thing)
        return thing

    return make


#: The order a category's tasks show in, top to bottom, when the app groups
#: by category rather than listing everything flat. Not every category has to
#: appear here - one that isn't is shown after all the ones that are, in
#: whatever order `dict` iteration gives it, which for `USER_DIR`'s "Custom"
#: is alphabetical by filename (see `user_tasks`'s own `sorted()`).
#:
#: "What loop am I actually in" is the question a player asks about their
#: own play far more often than "what does this one task do," and a flat
#: list of ten names answers neither - see PYTHON_API.md and the app's own
#: Tasks & Scripts panel, which grouped by category the day this was added.
CATEGORY_ORDER: tuple[str, ...] = (
    "Routines",
    "Combat",
    "Recovery",
    "Upkeep",
    "Utility",
    "Custom",
    "Examples",
)

#: id -> (title, summary, category, factory). The order within a category is
#: the order the app shows; the category itself is ordered by CATEGORY_ORDER.
REGISTRY: dict[str, tuple[str, str, str, object]] = {
    "task.routine": (
        "Hunt & recover",
        "Hunts until hurt, recovers or finds a healer, then resumes on its own.",
        "Routines",
        _routine,
    ),
    "flow.hunt": ("Hunt", "Find something, engage it, keep at it.", "Combat", _flow("hunt")),
    "flow.ambush": ("Ambush", "Hide, wait, strike from cover.", "Combat", _flow("ambush")),
    "flow.disengage": ("Break off", "Defensive, retreat, flee.", "Combat", _flow("disengage")),
    "flow.recover": ("Recover", "Tend what is bleeding, then rest.", "Recovery", _flow("recover")),
    "flow.to_healer": (
        "To a healer",
        "Stow, walk, show the damage.",
        "Recovery",
        _flow("to_healer"),
    ),
    "flow.prepare": (
        "Prepare",
        "Refresh, harness, offensive stance.",
        "Upkeep",
        _flow("prepare"),
    ),
    "flow.town_run": (
        "Town run",
        "Bank the coins, then somewhere safe.",
        "Upkeep",
        _flow("town_run"),
    ),
    "task.watch": (
        "Watch",
        "Read-only. Reports what it sees, sends nothing.",
        "Utility",
        _watch,
    ),
    "example.morning": (
        "Morning routine",
        "A plain step list, as an example.",
        "Examples",
        _example("morning"),
    ),
    "example.smart_recover": (
        "Smart recover",
        "Branches on what the game actually said.",
        "Examples",
        _example("SmartRecover"),
    ),
    "example.after_hunting": (
        "After hunting",
        "Two flows, one after the other - recover, then bank it.",
        "Examples",
        _example("after_hunting"),
    ),
}


#: Where a player's own Python tasks live. Anything here is discovered, so
#: writing a file is the whole of installing it - no line to add, no restart.
USER_DIR = Path(__file__).resolve().parent / "tasks" / "user"


def _user(path: Path):
    """Load and run a player's file.

    Imported by path rather than by module name, because a file a player just
    saved should run on the next press without a restart - a cached module
    would keep running the version that was on disk when the app started, which
    is the most infuriating possible bug in an editor.
    """

    def make():
        import importlib.util

        spec = importlib.util.spec_from_file_location(f"user_{path.stem}", path)
        if spec is None or spec.loader is None:
            raise ImportError(f"could not load {path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        # Three shapes, because all three are things a player reasonably
        # writes: a `main()`, a `TASK` object, or a bare script that did its
        # work at import. Checked in that order; the bare script is the
        # fallback rather than an error.
        for attr in ("main", "TASK", "task"):
            thing = getattr(mod, attr, None)
            if thing is not None:
                result = thing() if callable(thing) else thing
                if hasattr(result, "run"):
                    return result
                return _Done()
        return _Done()

    return make


class _Done:
    """A script that finished at import time. `run()` is then a no-op."""

    def run(self) -> None:
        pass


def user_tasks() -> dict[str, tuple[str, str, str, object]]:
    """A player's own tasks, discovered from disk each time this is asked."""
    found: dict[str, tuple[str, str, str, object]] = {}
    if not USER_DIR.is_dir():
        return found
    for path in sorted(USER_DIR.glob("*.py")):
        if path.stem.startswith("_"):
            continue
        # First line of the docstring as the summary, when there is one. It is
        # what a person writes anyway, so it costs the author nothing.
        summary = ""
        try:
            head = path.read_text(encoding="utf-8", errors="replace").lstrip()
            for quote in ('"""', "'''"):
                if head.startswith(quote):
                    summary = head[3:].split(quote)[0].strip().splitlines()[0]
                    break
        except OSError:
            pass
        found[f"user.{path.stem}"] = (
            path.stem.replace("_", " ").title(),
            summary or "Your script.",
            # Every user file is "Custom" - there is no way to know a
            # player's own script is really a recovery routine versus a
            # combat one without running it, and guessing wrong would be
            # worse than one honest bucket for "yours."
            "Custom",
            _user(path),
        )
    return found


def _category_key(category: str) -> tuple[int, str]:
    """Sorts by CATEGORY_ORDER's position, then alphabetically for anything
    (a future category, a typo) that order does not mention - so an unlisted
    category is grouped and stable rather than scattered across the output
    in dict-iteration order."""
    try:
        return (CATEGORY_ORDER.index(category), "")
    except ValueError:
        return (len(CATEGORY_ORDER), category)


def catalog() -> list[dict[str, str]]:
    combined = {**REGISTRY, **user_tasks()}
    ordered_ids = sorted(combined, key=lambda tid: _category_key(combined[tid][2]))
    return [
        {
            "id": task_id,
            "title": combined[task_id][0],
            "summary": combined[task_id][1],
            "category": combined[task_id][2],
            # Whether it can send commands. The app shows this, because
            # "reports what it sees" and "drives your character" deserve
            # visibly different buttons.
            "kind": "read-only" if task_id == "task.watch" else "sends commands",
        }
        for task_id in ordered_ids
    ]


def main(argv: list[str]) -> int:
    if "--list" in argv:
        print(json.dumps(catalog(), indent=2))
        return 0

    if len(argv) >= 2 and argv[0] == "run":
        task_id = argv[1]
        registry = {**REGISTRY, **user_tasks()}
        if task_id not in registry:
            # Named, with the alternatives, rather than a bare failure. The id
            # came from somewhere - a button, a typed command - and the useful
            # answer is which ids exist.
            print(f"No task called {task_id!r}. Available:", file=sys.stderr)
            for known in registry:
                print(f"  {known}", file=sys.stderr)
            return 2
        registry[task_id][3]().run()
        return 0

    print(__doc__.strip())
    print()
    for entry in catalog():
        print(f"  {entry['id']:24} [{entry['category']:9}] {entry['title']} - {entry['summary']}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
