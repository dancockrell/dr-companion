# Testing this against a live game

Almost nothing in this app has been exercised against DragonRealms. Every
automated test runs against fakes, which proves the plumbing and proves nothing
about the game.

This page used to open by saying nothing here had *ever* talked to the game.
That stopped being true: `docs/LIVE-SESSION-RUNBOOK.md` opens on "one so far
tonight, a few minutes", and `docs/LIVE-STATE.md` has a section headed "For
whoever gets the next live session". Those two are where live time and what it
settled are recorded. Treat everything below as untested against a real account
unless one of them says otherwise, and add to them rather than to this page
when you get a session of your own.

This document says what is likely to be wrong, how to find out, and what to
send back. It is deliberately specific about where the weak points are, because
a tester who knows where to push finds things faster than one who wanders.

## Before you merge

There is no CI. `npm run gate` is the gate and the person merging runs it; the
ritual is [`docs/MERGING.md`](MERGING.md). `node tools/gate.mjs --list` prints
what it covers and what it knowingly does not.

Two negative suites are outside it, each for a stated reason, and both are worth
running by hand after touching what they guard:

```bash
# damages src-tauri/src/command_gate.rs on purpose and runs cargo between edits.
# Minutes, and no other session may be building this tree while it does.
node tools/command-lane-break-check.mjs

# drives a browser against the running app, and needs Python.
python tools/sign-in-break-check.py
```

The rest of the `tools/*-break-check.*` harnesses are gate stages or are run by
the full suite; `node tools/needs-env.mjs` fails if one is ever added and
registered nowhere.

## Setting up

1. Get Lich running. Sign in on the app's first screen and it starts Lich for
   you — that is the route to test, and it needs no other program open. If you
   would rather keep your own frontend, start Lich your usual way instead.
2. Copy `lich-scripts/companion_bridge.lic` into Lich's `scripts` folder. The
   app will do this for you from the setup screen if it can find Lich.
3. In game: `;companion_bridge`. The app starts Lich headless, so Lich's
   command character is a semicolon (`main.rb:58`), and the app prints the
   command rather than making you remember it. A frontend of your own may use
   a different one — check its own documentation.
4. In the app: Settings → Bridge → **Live Lich**
5. Open the **Console** at the bottom and turn **trace** on.

If the bridge will not start, run it again with `stop` and then start it. It
refuses to run twice on the same port on purpose.

## Turn trace on before you do anything

The console is the whole point. With trace on, every command the bridge sends,
every reply, and every failed match is recorded. Without it, a failure looks
like a button that did nothing, which tells nobody anything.

The **problems** filter shows only the rows that mean something went wrong:

| Row | Means |
|---|---|
| `no_match` | We sent a command and nothing we expected came back. **The most useful failure.** The row includes the pattern that failed and how long we waited. |
| `refused` | The game said `...wait`, `still stunned` or `Sorry, you may only`. Retried automatically; only a problem if it repeats. |
| `gave_up` | Refused three times running. |
| `error` | An exception. Should not happen; if it does, that is a bug in the bridge. |
| `log_error` | A line the bridge itself flagged as an error, such as "this settings file will not parse at line 41". Its sender took the trouble to call it an error, so it does not depend on somebody spotting it in a scroll. |

The rows of that table are `PROBLEM_KINDS` in `src/lib/bugReport.ts`, and
`tools/doc-claims-test.mjs` fails the build if the two lists stop matching in
either direction.

**Copy** puts the whole console on the clipboard, oldest first, ready to paste
into an issue.

## What is most likely broken

In rough order of confidence that something is wrong:

### 1. Every game-text pattern

All of them are in `Companion::Patterns` at the top of the bridge script. They
came from reading community Genie scripts, not from a live account.

A `no_match` row means a pattern is wrong. The fix is usually one line, and the
thing that makes it possible is the raw game text, which is why the trace keeps
it. If you can also paste what the game printed in your own client, that
settles it.

### 2. Status flags

`State#situation` reads `XMLData.indicator` and guesses at names like
`IconDEAD`, `IconSTUNNED`, `IconBLEEDING`. Those names are from the shared
Simutronics XML protocol and are **not confirmed for DragonRealms**.

Worth checking: get stunned, get bleeding, die. Does the panel notice? If the
situation chips never appear, the indicator names are wrong.

### 3. The instance mapping

`State#instance` maps `XMLData.game` through `DR`/`DRX`/`DRF`/`DRT` to
Prime/Platinum/Fallen/Test. If your instance reads Unknown in the header, that
map is wrong for your game. What that costs is worth stating exactly rather than
guessing at, because nothing refuses on it: `grep -rn "'Unknown'" src/` finds
three uses, none of them a gate. Profiles, pins and nudges are keyed by
character *and* instance, so an Unknown instance quietly gives you a second,
empty set of them; and `install_mapdb` picks a different candidate order
(`companion_bridge.lic`, `State.instance == 'Prime'`). Report it anyway — a
wrong instance is a wrong `XMLData.game`, which is a fact about your connection
worth knowing.

### 4. Vital maxima

Health, mana, stamina and spirit come from DragonRealms as percentages.
The bridge no longer hardcodes their maxima: `vital_max` in
`companion_bridge.lic` reads `XMLData.max_*` and falls back to 100 only when
the game has reported nothing yet. Concentration is the one that is *not* a
percentage — Lich parses `330/330` out of the same attribute — so that is the
bar to watch. If a maximum reads 100 on a pool where the game shows something
else, `XMLData.max_*` is arriving empty and the fallback is what you are seeing.

### 5. Room and location

`Room.current` needs Lich's map database. Without maps, `roomId` and `zone` are
nil and the location line falls back to the room title. That is expected, not a
bug, but it is worth confirming it degrades quietly rather than throwing.

## What is worth trying, in order

**Read-only first.** None of this sends anything to the game.

- Does the character name, guild, circle and favor count look right?
- Open **Training**. Do your skills appear with plausible ranks, and does the
  mindstate label match what `EXP` shows in game? This is the single most
  valuable check in the app, because mindstate is the thing everything else is
  built on.
- Wound yourself and watch the Situation banner.
- Walk between rooms. Does the location update?

**Then the safety controls.** These are the ones that must not fail.

- Start any Lich script, then press **Stop all**. Everything except the bridge
  should die. Try it while in roundtime, while stunned, and while dead.
- **Pause** and **Resume**.
- Break the connection deliberately: stop the bridge script while the panel
  is connected. The panel should notice, back off, and reconnect when you start
  it again. It should not spin.
- Let the game sit idle long enough to be disconnected. The panel should
  eventually say the game clock has stopped rather than claiming to be
  connected.

**Then the intents that touch the game.**

Do not take a list here on trust; it went stale once already, when this page
still said two. `node tools/intent-drift-test.mjs` prints the real numbers, and
fails the build when the UI, the bridge and the mock disagree:

```
Declared intents (types.ts):        35
Implemented in bridge (real):       28
True unimplemented set:              7
```

The 28 come from the `HANDLERS` hash in `companion_bridge.lic` — a runtime
enumeration, not a hand-kept list — and the bridge reports them on `hello` as
`implementedIntents`. Two worth starting with, because they are the smallest:

- `check_health` — read-only. Reports wounds and bleeders.
- `stow_all` — puts what is in your hands away.

An intent outside that set refuses with `ok:false` and a reason. That is on
purpose, not an error: an intent that is not implemented says so rather than
silently doing nothing.

## What is not implemented, so do not report it

- The seven intents `tools/intent-drift-test.mjs` reports as unimplemented, which
  at the time of writing are `burgle`, `escape_heal`, `go_healer`,
  `start_combat`, `start_training`, `town_run` and `travel` — buffs landed
  R1, 10 Sep 2026, loot landed R2, 10 Sep 2026. Run it rather than trusting
  that list.
- Vault, bank and container capacities. Inventory reports containers but not
  how full they are.
- Wound severity per body part. `check_health` reports counts, not a chart.

## Reporting

Useful:

- The **Copy** output from the console, with trace on
- What you did and what you expected
- Your guild, instance and account type, since most of the logic branches on
  those
- Lich version and frontend

Especially useful: a `no_match` row plus the line your own client printed. That
pair is enough to fix a pattern without guessing.

## Running the offline tests

Neither needs a game or an account.

```bash
ruby lich-scripts/test/cmd_test.rb lich-scripts/companion_bridge.lic
```

Ten assertions on the command layer: retrying past each of the three refusals,
giving up cleanly, waiting out roundtime, surviving an exception.

```bash
npm run test:protocol-harness
```

Serves the real protocol to a real WebSocket client with the Lich runtime
stubbed. This is how the framing was verified in the first place, and it is
now one command rather than two shells: it starts
`lich-scripts/test/protocol_harness.rb`, drives it with `tools/ws-client.mjs`,
checks nine properties of the exchange, and stops the process it started.

It stays outside `tools/test-suites.json` because it needs Ruby and a free TCP
port, so the build box cannot be relied on to run it — `npm run test:needs-env`
is the list of suites in that position and why each is there.

## Playing the whole thing without a game, and without Godot

```bash
npm run test:mud-client-e2e         # about two seconds; also in npm run test:all
npm run test:mud-client-e2e-break   # proves the run above can go red
```

One run that signs in through the scripted EAccess, attaches to
`tools/fake-lich.mjs` over a real loopback socket, plays a session (room,
exits, vitals, occupants, channels, a highlight, a gag, an alias, a macro dry
run then a real fire, Pause, Stop), watches the socket drop and come back, and
round-trips the player configuration — with the viewer absent throughout.

Every step prints OK, FAIL, or NOT CHECKED with the command that would settle
it. Four things are NOT CHECKED because they are Rust and nothing here builds
it; each names its `cargo test`. Read those rather than the total.

The break-check runs three seams (`DRC_E2E_SABOTAGE=bypass-lane`,
`early-drop`, `no-godot-lie`) and asserts that each reddens its own steps and
no others. It runs the unsabotaged harness first and refuses to interpret
anything until that is green.

The pictures are separate, because they need a dev server and a browser and no
registered suite here does:

```bash
npm run dev -- --port 5183 --strictPort false
node tools/mud-client-e2e-shots.mjs http://127.0.0.1:5183/
```

Kill that dev server by the pid holding the port when you are done. The record
of one full run is `docs/verification/mud-client-e2e-2026-09-09.md`; where it
and these commands disagree, the commands are right.
