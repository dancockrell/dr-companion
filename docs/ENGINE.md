# DR Companion as an engine

Decided 27 Aug 2026. This changes what the project is, so it is written down
before it is built, and the parts that are still open are marked as open rather
than quietly assumed.

Until now this was a **companion**: a panel beside Genie, reading a summary that
a Lich script chose to push at it. It becomes a **client**: the thing you play
in, with Genie gone.

## The shape

```
   DragonRealms  <--->  Lich (Ruby, vendored)  <--->  DR Companion
                        auth, socket, protocol,        every pixel,
                        dr-scripts ecosystem            every keystroke
                              ^
                              |
                        Python scripting
```

Genie is removed. Lich is not, and that is the whole point of the design.

## Why Lich is the heart rather than the thing being replaced

Genie and Lich look like two halves of the same job and are not.

**Genie is a terminal.** A socket, a text pane, an input line, highlights, a
map. Everything it does well, this app either already does better - the map is
17,750 rooms with the cartographers' own colours, against Genie's - or is
bounded, ordinary UI work.

**Lich is the game.** It holds the eaccess authentication handshake, the
Simutronics wire protocol, the XML parse that turns a stream into rooms,
vitals, wounds and exits, and the entire dr-scripts ecosystem that the
community has built for twenty years. Reimplementing that is months of work to
end up with less, and it would mean this app handling account passwords
first-party - a line the project has deliberately stayed behind all the way
through (see `src-tauri/src/lich.rs`).

So: Lich keeps doing the hard thing it is good at, and stops being an external
dependency somebody has to install and launch correctly.

**Licence checked before deciding, not after.** Lich 5 is BSD 3-Clause
(Murray Miron 2005-2006, Matt Lowe 2006-2020, Elanthia Online 2021-present).
Permissive: vendoring is fine, attribution and the licence text must travel
with it. Verify with `head -6 <lich>/LICENSE` rather than trusting this line.

## How the frontend attaches

Lich already serves arbitrary frontends. It knows six by name and has a
capability table for them in `lib/common/front-end.rb` - `supports_xml?`,
`supports_streams?`, `supports_room_window?`.

The seam is `--detachable-client=PORT`. Lich opens a `TCPServer`, and the
socket that connects becomes `$_CLIENT_`: Lich writes game output to it and
reads player commands from it. `lib/main/main.rb` around line 385.

DR Companion connects to that port and *is* the client. No bridge script
choosing what to summarise. **Every line the game sends.**

That last point is the real gain, and it is not tidiness. As a companion this
app saw only what `companion_bridge.lic` decided to forward. The helm-versus-
wind-instrument warning, the highlight corpus, the mindstate ladder - all of
that was reaching through a straw for text that was on the wire the whole time.

## Genie is capability-limited at this boundary. We do not have to be.

Found 27 Aug 2026 in `lib/common/front-end.rb`, and it changes what "beat
Genie" means from a UI ambition into a protocol fact.

Lich decides what to send a frontend from a registered capability set:

| frontend | capabilities |
|---|---|
| `stormfront` (Wrayth) | `xml` `streams` `mono` `room_window` |
| `profanity` | `xml` `streams` |
| `genie` | `xml` `mono` |
| `frostbite` | `xml` |
| `wizard` | `gsl` |

**Genie does not get streams and does not get a room window.** Lich has them
and does not send them, because Genie cannot use them. Identify as the richest
frontend and the same Lich, on the same port, sends strictly more.

That is not a trick played on Lich. `register` is a public API taking a
capability list, and since Lich is vendored here, `drcompanion` can be a
registered frontend in its own right rather than borrowing Wrayth's name. That
is the honest end state.

**Correction, 28 Aug 2026 (#31).** The line above claimed declaring
`--stormfront` gets the full stream today. It does not, and this was never
verified against the actual resolver before being written. Lich's headless
launch path (`main.rb:320`, `resolve_headless_frontend` in
`login_helpers.rb`) only special-cases `--saga` and `--genie`; `--stormfront`
falls through to `'profanity'`, so `Frontend.client` is `'profanity'` on
every DR Companion session, never `'stormfront'`. This still gets `streams` -
the row this whole section is actually about - and loses `mono` and
`room_window`, two separate capabilities gating two separate things (a
formatting wrapper on injected room-text lines, and a duplicate exits
window), neither of which this app reads - see `src-tauri/src/lich.rs`'s
module doc for the full verification, including where each is actually
checked in Lich's source. The registered-frontend path above is still the
honest end state; it is just not what declaring `--stormfront` gets today.

Streams are the feature this unlocks and it is the one Genie users build named
windows by hand to fake: the game tags thoughts, deaths, speech and room
content as *separate channels*, and a client that receives them does not have
to guess from the text which is which. Every regexp in `dr-genie-settings` that
identifies an arrival or a departure is pattern-matching for something the
protocol already labels.

**Consequence for the parser:** a frontend claiming `xml` receives a tagged
stream, not plain lines. The pane currently renders raw text, which is correct
for what the fixture sends and wrong for what a real Lich will send. Parsing
that stream is the next piece, and the fixture needs an XML mode so it is
testable before a live login.

## Scripting: Python

Ruby stays under the hood because Lich is Ruby and dr-scripts are Ruby, and
those keep working untouched. Python is the language *this project* offers for
new work.

**Three runtimes ship: Ruby, Python and the app itself.** Decided 27 Aug 2026,
after the cost was put in front of Dan rather than discovered later. Ruby
because Lich is Ruby and 229 scripts in the local library are Ruby. Python
because that is the language this project offers. The installer carries both.

The alternative was writing new automation in Ruby, or abandoning dr-scripts.
The first is not what was asked for and the second is the ecosystem.

**Old scripts get a port path rather than a museum.** A Ruby script that still
works is not a problem to solve, but a player who wants to *change* one should
not have to learn Ruby to do it. So the direction is: Ruby scripts keep
running untouched under Lich, and there is a route to bring one across to
Python rather than a wall. What that route is - a translator, a compatibility
shim over the same API, or a documented rewrite guide - is not decided, and
picking it before there is a Python API to port *to* would be deciding the
answer before the question.

Python talks to the game through a documented API rather than by being spliced
into Lich's globals. A Python script asks the engine for state and sends
commands; it does not reach into `DRStats`. That boundary is what lets the
Ruby side be replaced later without breaking every Python script, and it is
what makes a Python script testable without a game.

**Decided 27 Aug 2026: out-of-process.** A Python script is its own process,
talking to the app over a loopback socket - the same shape `game_link.rs`
already uses for Lich, a listener and a line reader. A script that
divide-by-zeros, infinite-loops, or imports something that segfaults takes
down its own process and nothing else, which for a language users write
scripts in matters more than the latency an embedded interpreter would save.

Built: `src-tauri/src/script_api.rs` (the server, started from `lib.rs`'s
`.setup()`), `python/dr_companion.py` (the client library, pure standard
library - no `pip install` between a script idea and running it), and
`docs/PYTHON_API.md` (the documented API this section calls for).

**Known gap, not hidden:** a script receives the same raw wire chunks
`game_link.rs` reads before `src/lib/gameStream.ts` parses them into clean
lines with a channel and a bold flag - so `<pushStream id='thoughts'/>`
markup reaches Python as text today. That parser exists only in TypeScript and
is hardened by several rounds of real bugs found in it; porting it to Rust
untested against the same fixtures would risk a second, silently-disagreeing
parser, which is worse than a documented absence. Stream/bold extraction for
scripts is future work, not something faked in the meantime.

## Scripting: TypeScript, alongside Python

Decided 28 Aug 2026, on Dan's direct call rather than found and justified
afterward - flagged here because it revises "three runtimes ship" above,
which named Ruby, Python and the app as the deliberate, closed set.

**Why this is a smaller decision than Python was, not the same one again.**
The Python section above earned its "cost was put in front of Dan" framing
because Python was a genuinely new dependency, introduced solely so this
project would have a scripting language. TypeScript is not that: Node is
already an unconditional prerequisite for developing and building this app
(the frontend is Node/npm, and `DEPENDENCIES.md` already lists "Node 24 or
newer"), and `src-tauri/src/script_api.rs` was never Python-specific -
`python/dr_companion.py`'s own docs say so: "If you are not using
dr_companion.py - a script in another language, say - this is everything it
does for you." So this is a second client of an already-generic protocol, not
a fourth runtime the installer has to carry the way Ruby and Python are.

**Built:** `typescript/dr_companion.ts` and `typescript/drtask.ts`, direct
counterparts to the Python client and task layer - same wire protocol, same
parsing rules for `progressBar`/`roundTime`/`pushStream` (shared reasoning,
not re-derived, so the two runtimes cannot quietly disagree about what a tag
means), same rate cap. Node's lack of a blocking socket read means the API
shape differs where it has to: `dr_companion.ts` is an `EventEmitter` over an
async socket rather than Python's `on_line`/blocking `run()` loop. See
`typescript/README.md`.

**Built (29 Aug 2026): the catalog, and the app never running it any
differently from Python.** `typescript/runner.ts` is `runner.py`'s direct
counterpart - same `--list`/`run <id>` CLI, same JSON shape, same
`user.<filename>` id scheme for anything saved in `tasks/user/`. Wired
through `src-tauri/src/node.rs`, a near-duplicate of `python.rs` for the
reason stated in that file's own header: detects a usable Node (22.6+ or
24+, since `.ts` support is flag-gated below 24), spawns the runner,
streams stdout/stderr as `node:line`, reports state as `node:state`. The
frontend (`src/lib/nodeTasks.ts`, `TaskFlowPanel.tsx`) merges the Python and
TypeScript catalogs into one Tasks list rather than a second tab - a task
tile does not care which language wrote it, and a player choosing between
"hunt" and "watch" was never choosing a language. The one invariant that
crosses the boundary: at most one task runs at a time regardless of which
language it's in, enforced by the frontend stopping the other backend
before starting either (each backend already stops its own previous task on
its own account). `ScriptEditor.tsx` gained TypeScript as a third language
alongside Python and Ruby, with its own template and its own save location
(`typescript/tasks/user/`).

**Not built yet:** a TypeScript `flow.py`/`Flow`/`Step` equivalent. `Task` is
still the whole of what a TypeScript script is written against; a `Flow`
port is the obvious next step and should follow `flow.py`'s shape
(`when`/`until`/`settle`) rather than inventing a second one. Not deciding
this now for the same reason the Ruby-to-Python port path wasn't decided
above: picking it before more than a couple of real TypeScript tasks exist
to learn from would be answering a question that has not been asked yet by
real use. In the meantime a TypeScript task is written directly against
`Task` (see `typescript/tasks/watch.ts` or the editor's own template) - more
code than a `Flow`-based Python task for the same job, not unusably so.

## Display: 1080p, 1440p, 2160p

Three targets, and the failure mode differs at each end.

At **1080p** the constraint is height: 1080 logical pixels minus window chrome
is not much for a map, a dashboard and a text pane, and the honest answer may
be that one column collapses to a tab rather than everything shrinking.

At **2160p** the constraint is that nothing must simply get bigger. A 4K screen
is space to *show more*, not the same layout at 200%. Windows usually reports
4K at 150% scaling, so the app sees roughly 2560x1440 logical pixels and a
`devicePixelRatio` of 1.5 - the art and the map must be drawn for the real
pixels or they read as soft, and the text must not be laid out for the logical
ones as though the screen were small.

The existing layout is fixed pixel columns, which is right for what it does -
a column width is a decision the player makes, not a proportion - but it needs
defaults per resolution band rather than one 300/420 that is generous at 1080p
and cramped at 2160p.

**Open:** whether the text pane is the third column or a fourth. At 1080p there
is not room for four.

## Order of work, riskiest first

1. **Attach and stream.** Connect to Lich's client port, receive the tagged
   stream, render raw text in a pane. Proves the whole design. Nothing else
   changes.
2. **The text pane properly.** Virtualised scrollback from the first commit,
   not retrofitted: a MUD produces a lot of text and 50,000 lines rendered
   naively in a webview will crawl. This is the single largest engineering
   risk in the project.
3. **Input.** History, aliases, macros, completion, echo.
4. **Highlights and sounds**, importing the existing Genie `.cfg` corpus in
   `dr-genie-settings` so nothing is retyped.
5. **Streams to panes.** Thoughts, deaths, arrivals, room - the thing named
   windows are for.
6. **Python scripting.** Done 27 Aug 2026 - the transport, the client library
   and one working example. See the section above for the gap it ships with.
7. **Vendor Lich** and make launching it invisible. Done 27 Aug 2026, its
   precondition finally met the same day: the frontend now works end to end
   against a Lich it launches itself.

Vendoring was last on purpose. Until the frontend worked against a Lich
somebody installed, bundling one would only have made the failures harder to
see - and today's session found three real ones the slow way first (missing
gems, missing source files, the `--genie`/streams bug) before this was safe
to build.

**Decided: bundle, and offer an update from the same mechanism that already
downloads one.** Dan's call, given the actual number: Ruby4Lich5.exe is
65 MB. `tools/vendor-fetch.mjs` fetches and verifies it into
`src-tauri/vendor/` (gitignored - 65 MB does not belong in git history
forever, the same reasoning `public/rooms/` already states) before a release
build; `tauri.conf.json`'s `bundle.resources` ships whatever is there.
`npm run tauri:build` runs the fetch first automatically, so this cannot be
silently skipped.

**What that cost, and the fix.** Tauri validates `bundle.resources` on *every*
build, not only a bundling one, so a fresh clone could not run `cargo build`
or `cargo test` at all - it stopped at `resource path vendor\Ruby4Lich5.exe
doesn't exist`, gating 59 Rust unit tests behind a 65 MB download none of them
use. Measured: two placeholder files, four and fourteen bytes, are enough for
all 59 to run green.

`npm run worktree:init` is the one command that clears this in a new clone or
worktree: it writes the placeholders and initialises the submodules, which are
the two things a fresh checkout lacks and neither of which the Rust error
mentions.

So `tools/vendor-fetch.mjs --stub` writes those placeholders (`npm run
vendor:stub`), and `--require-real` refuses them, wired into `tauri:build`
after the fetch. The guard is what makes the convenience safe: a placeholder
reaching a release would ship an installer whose bundled Ruby is the word
"stub", and that surfaces on a user's machine as a first run that cannot find
Ruby - a long way from the decision that caused it. It recognises a stub by a
marker in the file's own bytes as well as by the manifest, because a manifest
can be deleted and the file left behind.

`tools/vendor-stub-test.mjs` (`npm run test:vendor`) proves the guard refuses
a stub, refuses one whose manifest has been deleted, refuses bytes that
disagree with their recorded hash - **and accepts a genuine hash-matching
file**, so a guard that simply always failed could not pass it either.

At runtime, `setup::bundled_ruby4lich5` resolves the bundled copy through
Tauri's own resource directory and re-verifies its SHA-256 against a manifest
the fetch script wrote - not because the fetch script's own check could not
be trusted, but because that check ran at build time and this runs whenever a
player presses install, and nothing enforces those two moments being close
together. Same "verify before use" rule the network path already followed,
applied at the point it actually matters. The Ruby row in `plan_setup` offers
the bundled copy first (no download, works offline) and the live GitHub
release alongside it only when the versions actually differ, framed as an
update - two rows for identical bytes is not a real choice.

Verified against the real Tauri app, not just the unit tests: fetched a real
65 MB release asset, restarted the app, called `install_bundled_ruby4lich5`
through the running app's own IPC, and independently re-hashed the file it
produced outside the app entirely - the SHA-256 matched byte for byte. A
`cargo test` pass alone would not have caught whether `BaseDirectory::Resource`
actually resolves correctly in this app's dev-mode layout; only asking the
real running app did.

**Not yet done:** the BSD-3-Clause license text is not shown anywhere in
dr-companion's own UI for the bundled copy - the installer itself has its own
license page, but that is Ruby4Lich5's disclosure, not this app's. Worth a
line in an About screen before this ships in dr-companion's own release,
not before.

## Tests the build cannot run, and tests it simply does not

`node tools/run-tests.mjs` runs what is listed in `tools/test-suites.json`.
Everything else is invisible, and two very different absences look identical
from outside it: a suite deliberately left out because it needs an environment
the build box has not got, and a suite nobody ever registered.

`npm run test:needs-env` separates them and fails if either list has drifted.

Needing an environment:

- `test:godot-export` - the `godot/shared-assets` submodule and a Godot 4
  binary on PATH.
- `test:live-chain` - the app running with the viewer attached. Not written
  yet; it arrives with increment B4.
- `test:protocol-harness` - Ruby, and a free TCP port: it starts
  `lich-scripts/test/protocol_harness.rb` and talks to it over a real socket.

The second list is a backlog rather than a design. As of 5 Sep 2026 there are
21 `test:` scripts that exist, need nothing special, and are reached by neither
`test-suites.json` nor any registered script that composes others - so they
have not run since the day they were written. `test:needs-env` names them all,
and refuses to let a new one appear unlisted or a listed one stay behind after
it is wired in.

## What is not decided

- Text pane as third column or fourth.
- Whether the bridge script survives at all. As a frontend the app gets
  everything raw, so the script's summaries may be redundant - but they are
  also *parsed*, and reimplementing that parse in TypeScript to throw away a
  working Ruby one would be a poor trade.
