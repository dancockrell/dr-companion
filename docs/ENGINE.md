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

**Open:** whether Python runs in-process (embedded, e.g. PyO3 on the Rust side)
or out-of-process against the same socket. In-process is faster and shares
lifetime; out-of-process cannot take the client down with it, which for a
scripting language users write in matters more than speed. Leaning
out-of-process. Not yet decided.

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
6. **Python scripting.**
7. **Vendor Lich** and make launching it invisible.

Vendoring is last on purpose. Until the frontend works against a Lich somebody
installed, bundling one only makes the failures harder to see.

## What is not decided

- In-process or out-of-process Python.
- Text pane as third column or fourth.
- Whether the bridge script survives at all. As a frontend the app gets
  everything raw, so the script's summaries may be redundant - but they are
  also *parsed*, and reimplementing that parse in TypeScript to throw away a
  working Ruby one would be a poor trade.
