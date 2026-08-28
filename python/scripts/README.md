# Scripts

Ready-to-run Python scripts built on `dr_companion.py`, `lich.py`,
`streamkit.py` and `flow.py`. Each is one file, standard library only, run
directly:

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
| Hand-chained combat macro (attack/loot/skin/tend, sleep, repeat) | `flow_hunt.py` | Built on `flow.py`; waits for the game's own `<prompt>` tag instead of a guessed sleep, and reads "still bleeding" from the live stream instead of a fixed step count |
| Scripts started and watched over by hand, one after another | `flow_script_chain.py` | Also built on `flow.py`; starts a Lich script, waits for it to actually finish (a line match, bounded by a timeout) rather than a guessed duration, then decides from live vitals whether to force-start a healer script before going again |

## Flows: `flow.py`

The two scripts above are built on `flow.py`, a small workflow engine: a
`Flow` is a list of `Step`s, each with commands to send, optional Python
logic (`Step.run`), an optional condition (the same `gauge<50` / `bleeding` /
`!bleeding` grammar the bridge's own flow editor uses -
`src/lib/flowConditions.ts`), and a way to wait for the next step (the game's
own prompt tag, a line matching a pattern, or a fixed sleep). A `FlowRunner`
walks the steps, once or in a loop, against a live `Companion`.

This is the "wire together lich commands" and "pure python flows" halves of
the same tool: a `Step.run` can call into `lich.py` to chain existing Lich
scripts with real conditions between them (`flow_script_chain.py`), or just
be plain Python logic with no Lich script involved at all
(`flow_hunt.py`) - the engine does not care which, because a step is exactly
as canned or as arbitrary as the callable you give it. See `flow.py`'s own
module docstring for the full API and both flavours of example.

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
