# Scripts

Standalone command-line utilities, as opposed to `python/tasks/` (things you
run and watch react to the game). Currently one:

## `lichctl.py`

A terminal front end to Lich's own script engine, through DR Companion -
start, stop, pause, force-restart, list. Each invocation connects, sends
exactly one thing, and exits; it does not watch the game stream. Built on
`python/lich.py`, documented in `lich.py`'s own module docstring and
`docs/PYTHON_API.md`.

```
python python/scripts/lichctl.py start autostow
python python/scripts/lichctl.py force autostow
python python/scripts/lichctl.py stop-all
python python/scripts/lichctl.py list
python python/scripts/lichctl.py --help
```

## Looking for the reactive scripts?

Autostand, a per-channel logger, a name watchlist, an AFK tell
auto-responder, and a vitals monitor moved to `python/tasks/user/` - they are
`drtask.Task` subclasses now, so they're discoverable through the app's task
catalog the same way anything you save there is:

```
python python/tasks/user/autostand.py
python python/runner.py run user.autostand
```

See `python/tasks/user/README.md` for the task-writing conventions, and
`docs/PYTHON_API.md`'s "Beyond the transport" section for the full picture of
`drtask.py`/`flow.py`/`lich.py` and how they fit together.
