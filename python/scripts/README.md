# Scripts

Ready-to-run Python scripts built on `dr_companion.py`, `lich.py` and
`streamkit.py`. Each is one file, standard library only, run directly:

```
python python/scripts/autostand.py
```

Every script prints `--help` for its own flags. All of them need DR Companion
running and attached to a game, same as `python/examples/hello.py`.

## What replaces what

Genie players build automation out of highlight files, hotkeys and named
windows. These are the Python equivalent of the categories that keep coming
up, built fresh against this project's own API rather than ported from
anyone's script text - see the repo's [Scope](../../README.md#scope) note on
why: script code belongs to whoever wrote it.

| Genie-era category | Script | What is different |
|---|---|---|
| Autostand / getup trigger | `autostand.py` | Retries `stand` on a bounded schedule instead of firing once and hoping; cancels early if a recovery line is seen |
| Named windows kept and logged by hand | `channel_logger.py` | Every known channel to its own timestamped file, picked from the game's own stream tags rather than guessed from text |
| Highlight-on-name trigger | `watchlist.py` | Cooldown per name, a live-editable name file, and an optional Lich command fired on match |
| AFK tell auto-responder | `afk_reply.py` | Per-sender cooldown and a count, so the tenth tell in an hour is not answered like the first |
| Health-bar watching | `vitals_monitor.py` | Reads the same `progressBar` data the client renders and can force-start a Lich script (a healer, say) when a vital crosses a threshold |
| Command-line trigger | `lichctl.py` | A terminal front end to Lich's own script engine - start, stop, pause, force, list - through DR Companion, no game window needed |

## Building your own

```python
import _common  # noqa: F401 - adds python/ to sys.path

from dr_companion import Companion
from lich import Lich
import streamkit as sk

c = Companion()
lich = Lich(c)

@c.on_line
def watch(line):
    if sk.is_stunned_line(line.text):
        lich.force_start("my-recovery-script")

c.run()
```

`lich.py` and `streamkit.py` are documented in their own module docstrings -
`python -c "import lich; help(lich)"` or just read the files. Both are honest
about what they do not know: `streamkit.py`'s text-matched helpers
(`is_stunned_line`, the tell pattern in `afk_reply.py`) are regexes against
plain game text, not the hardened tag parser `src/lib/gameStream.ts` is - see
`docs/PYTHON_API.md`'s "known gap" section before betting a script on a
pattern that has not been checked against a live game.
