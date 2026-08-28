# Python scripting API

Decided in [ENGINE.md](ENGINE.md): Python is the scripting language this
project offers, out-of-process, talking to the app over a documented socket
rather than reaching into Ruby's or Rust's own state. This is that document.

## Quick start

DR Companion has to be running - it writes the connection details on startup.

```python
from dr_companion import Companion

c = Companion()

@c.on_line
def watch(line):
    if "you are stunned" in line.text.lower():
        c.send("stand")

c.run()
```

`dr_companion.py` is pure standard library. No `pip install` - copy the file
next to your script, or add `python/` to your `PYTHONPATH`, and
`import dr_companion` works.

## How a script finds the app

On every start, DR Companion writes two files to its data directory
(`%LOCALAPPDATA%\DR Companion Data`, the same folder `app_data_path` reports
in the app itself):

| File | Contents |
|---|---|
| `script-api.port` | The port the script socket is listening on |
| `script-api.token` | A fresh random token, required to do anything |

`Companion()` reads both automatically. Pass `port=`/`token=` explicitly only
if you have a reason to point at a different app instance.

The token is regenerated every time the app starts. A script holding an old
one gets `auth_failed` and should re-read the file, not retry the same token.

## Why a token, on loopback

Loopback is not a boundary - any process running as you can open a socket to
`127.0.0.1`, same as it could open the token file itself. The token stops
*another* program on the machine from silently reading your game or sending
commands as you; it does not stop anything already running with your
privileges, which could read the token file directly. Same threat model as
`companion_bridge.lic`'s own token, and the same honest limit on what it is
worth.

## The wire protocol

Newline-delimited JSON over TCP. One JSON object per line, `\n`-terminated.
If you are not using `dr_companion.py` - a script in another language, say -
this is everything it does for you.

**Handshake**, immediately on connect:

```
→ (nothing - just connect)
← {"type": "hello", "version": 1}
→ {"type": "auth", "token": "<the token from script-api.token>"}
← {"type": "auth_ok"}                    (or "auth_failed", then the socket closes)
```

Auth has a 2-second window. Send it as your first line or the server drops
you.

**After auth**, two things flow in either direction:

Requests you can send:

```
{"type": "send", "command": "look"}      # exactly as typed, no interpretation
{"type": "status"}                       # ask once; also arrives unprompted, see below
```

Messages you receive, unprompted, as they happen:

```
{"type": "line", "seq": 1234, "text": "..."}
{"type": "state", "connected": true, "host": "127.0.0.1", "port": 11024, "lines": 1234, "note": ""}
{"type": "error", "message": "..."}      # your last request was bad, or something failed
```

A `status` request's reply is indistinguishable from an unprompted `state`
message - both are `{"type": "state", ...}`. `dr_companion.py`'s `status()`
handles the ambiguity by reading until a `state` message arrives, passing
anything else (a `line` that arrived first) through to your other callbacks
rather than dropping it.

## The `Line`/`Status` shapes

```python
@dataclass(frozen=True)
class Line:
    seq: int      # stable, increasing - not a count of visual lines, see the gap below
    text: str

@dataclass(frozen=True)
class Status:
    connected: bool
    host: str
    port: int
    lines: int    # lines received since attaching, not since this script connected
    note: str     # why not connected, when not
```

## The known gap: markup is not parsed for you yet

**Read this before assuming a script can match on speech, thoughts, or
combat cleanly.**

`Line.text` is the same raw chunk `src-tauri/src/game_link.rs` reads off the
wire - exactly what the app's own frontend receives before
`src/lib/gameStream.ts` turns it into clean lines with a channel and a bold
flag. That parser exists only in TypeScript, and it earned its current shape
through several rounds of real bugs found against it: a tag split across two
socket reads, a literal `<` in ordinary game text capturing a real
`</popStream>` sixty characters later and merging two lines into the wrong
channel. Porting that logic to Rust for this file, untested against the same
fixtures that found those bugs, risks a second parser that quietly disagrees
with the first on some malformed tag - which is a worse defect than an
honestly documented gap, because it would look like it worked until the one
case where the two disagreed.

So today, a thought looks like this in `Line.text`:

```
<pushStream id='thoughts'/>You hear the faint thoughts of Wipsy echo in your mind: hello<popStream/>
```

If your script needs to act on a channel, match the tag yourself for now:

```python
import re

THOUGHT = re.compile(r"<pushStream id='thoughts'/>(.*?)<popStream/>")

@c.on_line
def watch(line):
    m = THOUGHT.search(line.text)
    if m:
        handle_thought(m.group(1))
```

This is exactly the kind of pattern-matching Genie users already write by
hand, and matching the tag yourself is still the whole story if you build
directly on `dr_companion.Companion`. It is not the only way in any more,
though: `drtask.py` (below) is a second, independently-grounded layer that
closes this gap for the common case - it does not share code with
`gameStream.ts`, so read its own module docstring for what it is confident
about (`progressBar`/`roundTime` parsing, checked against Lich's own
`xmlparser.rb`) versus what remains a text match.

## Beyond the transport: `drtask.py`, `flow.py`, task discovery, and `lich.py`

`dr_companion.py` is deliberately minimal - a socket, `send()`, `on_line()`.
Everything below is a client of it; none of it changes the wire protocol
above.

**`python/drtask.py`** is the layer most scripts should actually build on.
`Task` gives you clean, tag-stripped lines with their channel labelled
(`on_clean`), current vitals with unknown-vs-zero kept distinct
(`on_vitals` - a vital the game has never reported is `NaN`, not `0`, so a
condition on it does nothing rather than firing on a number nobody sent),
roundtime-aware sending, and a hard cap on commands per minute enforced in
the one method (`do()`) anything reaches the game through - a runaway loop is
stopped and told why rather than allowed to look like scripted abuse on a
live account. Read its own module docstring before writing a task; the
reasoning for each parsing decision (why `progressBar.text` and never
`.value`, why `roundTime` is an absolute epoch second and not a duration) is
there, grounded against Lich's own `xmlparser.rb`.

**`python/flow.py`** builds `Flow`/`Step` on top of `Task`: a sequence of
steps, each with commands to send, an optional `when=lambda f: ...` condition
(an ordinary Python expression - no condition grammar to parse), and a way to
know a step finished (`until=r"regex"`, waiting for the game to actually say
so, or a flat `settle` when there is nothing to wait for). See its own module
docstring and `python/tasks/example_custom.py` for the full shape.

**`python/runner.py`** is the catalog: `python python/runner.py --list` and
`run <id>`. The built-in flows and the read-only `task.watch` example live in
`python/tasks/`; anything you save under `python/tasks/user/*.py` is
discovered automatically as `user.<filename>` - no registration, no restart.
See `python/tasks/user/README.md`.

**`python/tasks/user/`** in this repo ships five ready-to-run examples,
each answering a Genie-era automation category with an original
implementation (no script text ported from anyone - see the repo's Scope
note): `autostand.py` (retries `stand` on a bounded schedule after a stun),
`channel_logger.py` (every channel to its own timestamped file, from
`CleanLine.stream`), `watchlist.py` (alert - and optionally act - when a name
shows up anywhere in the text), `afk_reply.py` (per-sender-cooldown tell
auto-responder), and `vitals_monitor.py` (fire a Lich command when a vital
crosses a threshold, via `on_vitals`). Each is runnable directly
(`python python/tasks/user/autostand.py`) or through the catalog
(`python python/runner.py run user.autostand`).

**`python/lich.py`** wraps Lich's own `;`-prefixed command language -
`;force`, `;kill`, `;pause`, `;unpause`, `;list`, `;vars` - so a script
starts, stops and force-restarts Lich scripts (including the dr-scripts
ecosystem) without hand-formatting strings and re-deriving that "already
running" needs `;force` (Lich's own message, from `script.rb`). It does not
parse Lich's replies - those arrive as ordinary lines through whichever of
`on_line`/`on_clean` you're using, undecoded, for the reason `lich.py`'s
module docstring gives: guessing at Lich's plain-text table format without a
test fixture to check it against is the same mistake this file already warns
against for the game's own markup. `lich.py` works with either
`dr_companion.Companion` or a `drtask.Task`'s `.c` - `Lich(task.c)`.
`python/scripts/lichctl.py` is a small terminal front end to it: start, stop,
pause, force, list, all as one-shot CLI commands rather than a running
script. See `python/scripts/README.md`.

## Testing your own script

`python/examples/hello.py` is the minimal working example - run it with the
app open and attached to a game (real Lich, or `node tools/fake-lich.mjs`)
and watch real lines print.

`python/test_dr_companion.py` is the library's own test suite. It connects to
whatever DR Companion instance is actually running rather than a stand-in for
one - the same reasoning as `game_link.rs`'s Rust tests using a bare
`TcpListener` for Lich, except here the app *is* this project's own code, so
there is no excuse for testing anything less than the real thing. It skips
loudly (exit code 2, not a silent pass) if the app is not running - a green
result against nothing would be indistinguishable from a green result that
actually exercised the socket.

```bash
python python/test_dr_companion.py
```

`python/test_lich.py` is `lich.py`'s own suite, and unlike
`test_dr_companion.py` it does not need the app running - `lich.py` only
formats strings and hands them to `Companion.send()`, so a fake `Companion`
that just records what it was sent is a complete test double for it:

```bash
python python/test_lich.py
```

## What this API deliberately does not do

- **No script management.** The app does not start, stop, or watch your
  script process - that is future work, tracked as an open question, not
  built and hidden. Run your script the way you run any Python program.
- **No access to Ruby's `DRStats`, `Room`, or any Lich global.** That
  boundary is what lets the engine's internals change later without breaking
  every script written against this API - see ENGINE.md's reasoning.
- **No command interpretation.** `send()` puts your string on the wire
  exactly as given, CRLF-terminated. Aliases and macros are your script's job.
