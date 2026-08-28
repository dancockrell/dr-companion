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

There is no TypeScript counterpart to `flow.py`/the task catalog
(`runner.py`) yet - `Task` is the whole of what ships here today. A `Flow`
port is a reasonable next step and would follow `flow.py`'s shape (`when`,
`until`, `settle`) rather than reinventing one.

## Testing

Both files have a test suite that runs without a live app:

```bash
node --experimental-strip-types typescript/test_dr_companion.ts   # a bare TCP server stands in for the app
node --experimental-strip-types typescript/test_drtask.ts         # fixed strings and a fake Companion
```

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
