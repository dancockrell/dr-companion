# TypeScript scripting

A second scripting language for DR Companion, alongside `python/`. Same
transport, same server (`src-tauri/src/script_api.rs` was already
language-agnostic - see `dr_companion.ts`'s module docstring), a different
runtime for players who'd rather write TypeScript than Python.

## Quick start

DR Companion has to be running - it writes the connection details on startup,
the same files `python/dr_companion.py` reads.

```typescript
import { Companion } from './dr_companion.ts'

const c = new Companion()
c.on('line', (line) => {
  if (line.text.toLowerCase().includes('you are stunned')) {
    c.send('stand')
  }
})
await c.connect()
```

```bash
node typescript/examples/hello.ts          # Node 24+
node --experimental-strip-types typescript/examples/hello.ts   # Node 22.6-23.5
```

No `npm install`, no build step, no `.d.ts` to generate - `dr_companion.ts`
and `drtask.ts` are zero-dependency, and Node's own type stripping runs a
`.ts` file directly. See `dr_companion.ts`'s module docstring for the one
real constraint that comes with skipping a build step (constructor parameter
properties and a couple of other TypeScript features don't survive it).

## The two files

**`dr_companion.ts`** is the transport - the direct counterpart to
`python/dr_companion.py`, same wire protocol, same connection-file discovery.
Where it differs: Node has no blocking socket read, so this is an ordinary
`EventEmitter` (`c.on('line', ...)` / `c.on('state', ...)`) over an async
socket instead of Python's `on_line`/`run()` loop. `connect()`, `send()` and
`status()` are `async`.

**`drtask.ts`** is the task layer - the counterpart to `python/drtask.py`:
clean, channel-labelled lines (`onClean`), current vitals with
unknown-vs-zero kept distinct (`onVitals` - see `Vital.percent`), roundtime-
aware sending, and the same hard cap on commands per minute enforced in the
one place anything reaches the game (`do()`). The parsing regexes and the
safety cap are shared reasoning with `drtask.py`, not re-derived, so the two
runtimes cannot quietly disagree about what a `progressBar` or `roundTime`
tag means.

There is no TypeScript counterpart to `flow.py`/`Flow`/`Step` yet - `Task` is
the whole of what a TypeScript script is written against today. A `Flow`
port is a reasonable next step and would follow `flow.py`'s shape (`when`,
`until`, `settle`) rather than reinventing one. In the meantime a task reacts
to game text and vitals directly, the way `tasks/watch.ts` does - more code
than a `Flow`-based Python task for the same job, not unusably so.

## Running from the app

**`runner.ts`** is the catalog, and the direct counterpart to `runner.py`:

```bash
node runner.ts --list          # what can be run, as JSON — Node 24+
node runner.ts run task.watch  # run one
node --experimental-strip-types runner.ts --list   # Node 22.6-23.5
```

Save a `.ts` file in `tasks/user/` and it's discovered on the next `--list`
or `run` — no line to add, no restart, same as `runner.py`. The id is
`user.<filename>`; the first line of the file's opening `/** ... */` comment
becomes the summary. A file can either do its work at the top level (like
`tasks/watch.ts` — `await watch.run()` as the last line) or export a `main`
function, a `TASK` value, or a `task` value, checked in that order.

This is exactly what the app itself runs: `src-tauri/src/node.rs` shells out
to `runner.ts` the same way `python.rs` shells out to `runner.py`, detects a
usable Node (22.6+, or 24+ where the type-stripping flag is no longer
needed), and streams the task's stdout/stderr back to the same Tasks panel
Python tasks show up in — one list, not a second tab, because a task tile
doesn't care which language wrote it. The app enforces one thing across the
boundary: at most one task runs at a time, in either language.

Writing a new TypeScript task from inside the app (rather than by hand in
this folder) works the same way Python's does — the Tasks panel's "New TS"
button, or the Scripts tab's editor with TypeScript selected, saves straight
into `tasks/user/` with a working template to start from.

## Testing

All three files have a test suite that runs without a live app:

```bash
node --experimental-strip-types typescript/test_dr_companion.ts   # a bare TCP server stands in for the app
node --experimental-strip-types typescript/test_drtask.ts         # fixed strings and a fake Companion
node --experimental-strip-types typescript/test_runner.ts         # runner.ts's own CLI, out of process
```

All three are wired into `npm run test:all` (`test:ts-companion`,
`test:ts-drtask`, `test:ts-runner`), so they run in CI exactly like every
other suite - not a TypeScript-only side channel somebody has to remember to
run by hand.

`test_dr_companion.ts` uses a real `net.createServer` speaking the actual
wire protocol rather than mocking `Companion` itself - the same reasoning
`game_link.rs`'s own Rust tests use a bare `TcpListener` for Lich: this
project has no live DR Companion to test against in every environment, and a
fake that speaks the real protocol is a closer test than skipping the
network entirely.

## Examples

`examples/hello.ts` - the minimal watcher, counterpart to
`python/examples/hello.py`.

`tasks/watch.ts` - a read-only watcher reporting vitals, roundtime and
channel-labelled lines, ported from `python/tasks/watch.py` rather than
redesigned, so both runtimes' "does the scripting stack work at all" check
says the same thing.
